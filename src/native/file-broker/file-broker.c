#define _DARWIN_C_SOURCE 1

#include "protocol.h"

#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <copyfile.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef O_NOFOLLOW
#define O_NOFOLLOW 0
#endif

#define ROOT_FD 3
#define STATE_FD 4
#define META_MAGIC "T5FM"
#define META_VERSION 1u
#define META_PREPARED 1u
#define META_COMMITTED 2u
#define META_UNDO_PREPARED 3u
#define IO_CHUNK 65536u

struct meta_record {
  uint8_t state;
  bool old_exists;
  bool fingerprint_valid;
  uint64_t fingerprint[7];
  char *path;
  char *temp;
};

struct request {
  uint8_t opcode;
  char *text;
  uint8_t *data;
  uint64_t data_len;
};

static void fail(const char *code, const char *message);
static void fail_errno(const char *code);

static bool test_fail(const char *stage) {
#ifdef T5_BROKER_TESTING
  const char *wanted = getenv("T5FB_TEST_FAIL");
  return wanted != NULL && strcmp(wanted, stage) == 0;
#else
  (void)stage;
  return false;
#endif
}

static uint64_t be64_read(const uint8_t *p) {
  uint64_t value = 0;
  for (size_t i = 0; i < 8; i++) value = (value << 8u) | p[i];
  return value;
}

static void be64_write(uint8_t *p, uint64_t value) {
  for (int i = 7; i >= 0; i--) { p[i] = (uint8_t)(value & 0xffu); value >>= 8u; }
}

static uint32_t be32_read(const uint8_t *p) {
  uint32_t value;
  memcpy(&value, p, sizeof(value));
  return ntohl(value);
}

static void be32_write(uint8_t *p, uint32_t value) {
  value = htonl(value);
  memcpy(p, &value, sizeof(value));
}

static bool read_exact(int fd, void *buffer, size_t length) {
  uint8_t *p = buffer;
  while (length > 0) {
    ssize_t n = read(fd, p, length);
    if (n == 0) return false;
    if (n < 0) { if (errno == EINTR) continue; return false; }
    p += (size_t)n;
    length -= (size_t)n;
  }
  return true;
}

static bool write_exact(int fd, const void *buffer, size_t length) {
  const uint8_t *p = buffer;
  while (length > 0) {
    ssize_t n = write(fd, p, length);
    if (n < 0) { if (errno == EINTR) continue; return false; }
    p += (size_t)n;
    length -= (size_t)n;
  }
  return true;
}

static int durable_sync(int fd) {
  if (fcntl(fd, F_FULLFSYNC) == 0) return 0;
  return fsync(fd);
}

static int sync_directory(int fd) {
  return fsync(fd);
}

#ifdef T5_BROKER_TESTING
static void test_pause(const char *stage) {
  const char *wanted = getenv("T5FB_TEST_PAUSE");
  if (wanted == NULL || strcmp(wanted, stage) != 0) return;
  char ready[128], resume[128];
  if (snprintf(ready, sizeof(ready), ".t5fb-test-%s.ready", stage) < 0
      || snprintf(resume, sizeof(resume), ".t5fb-test-%s.resume", stage) < 0) fail("TEST_HOOK_FAILED", "test pause name failed");
  int fd = openat(STATE_FD, ready, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) fail_errno("TEST_HOOK_FAILED");
  if (durable_sync(fd) != 0 || close(fd) != 0 || sync_directory(STATE_FD) != 0) fail_errno("TEST_HOOK_FAILED");
  struct stat st;
  for (unsigned i = 0; i < 30000; i++) {
    if (fstatat(STATE_FD, resume, &st, AT_SYMLINK_NOFOLLOW) == 0) {
      (void)unlinkat(STATE_FD, resume, 0); (void)unlinkat(STATE_FD, ready, 0); (void)sync_directory(STATE_FD); return;
    }
    if (errno != ENOENT) fail_errno("TEST_HOOK_FAILED");
    usleep(1000);
  }
  fail("TEST_HOOK_TIMEOUT", "test pause timed out");
}
#else
static void test_pause(const char *stage) { (void)stage; }
#endif

static void respond(uint8_t status, const char *json) {
  size_t json_len = strlen(json);
  if (json_len > UINT32_MAX - 8u) _exit(111);
  uint32_t body_len = (uint32_t)json_len + 8u;
  uint8_t prefix[4];
  uint8_t header[8] = { 'T', '5', 'F', 'R', T5FB_PROTOCOL_VERSION, status, 0, 0 };
  be32_write(prefix, body_len);
  if (!write_exact(STDOUT_FILENO, prefix, sizeof(prefix))
      || !write_exact(STDOUT_FILENO, header, sizeof(header))
      || !write_exact(STDOUT_FILENO, json, json_len)) _exit(111);
}

static void fail(const char *code, const char *message) {
  char json[512];
  int n = snprintf(json, sizeof(json), "{\"ok\":false,\"code\":\"%s\",\"message\":\"%s\"}", code, message);
  if (n < 0 || (size_t)n >= sizeof(json)) respond(1, "{\"ok\":false,\"code\":\"BROKER_ERROR\",\"message\":\"file broker error\"}");
  else respond(1, json);
  exit(0);
}

static void fail_errno(const char *code) {
  (void)errno;
  fail(code, "native file broker operation failed");
}

static void recovery_required(const char *ref) {
  char json[192];
  (void)snprintf(json, sizeof(json), "{\"ok\":false,\"code\":\"RECOVERY_REQUIRED\",\"message\":\"durable recovery is required\",\"undoRef\":\"%s\"}", ref);
  respond(1, json);
  exit(0);
}

static bool valid_ref(const char *ref) {
  if (strlen(ref) != T5FB_MAX_REF || strncmp(ref, "u1.", 3) != 0) return false;
  for (size_t i = 3; i < T5FB_MAX_REF; i++) {
    char c = ref[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

static bool valid_relative_path(const char *path) {
  size_t length = strlen(path);
  if (length == 0 || length > T5FB_MAX_PATH || path[0] == '/' || path[length - 1] == '/') return false;
  const char *component = path;
  for (const char *p = path;; p++) {
    if (*p == '/' || *p == '\0') {
      size_t n = (size_t)(p - component);
      if (n == 0 || n > NAME_MAX || (n == 1 && component[0] == '.')
          || (n == 2 && component[0] == '.' && component[1] == '.')) return false;
      if (*p == '\0') break;
      component = p + 1;
    }
  }
  return true;
}

static bool parse_request(struct request *out) {
  uint8_t size_bytes[4];
  if (!read_exact(STDIN_FILENO, size_bytes, sizeof(size_bytes))) return false;
  uint32_t length = be32_read(size_bytes);
  if (length < 8u || length > T5FB_MAX_FRAME) return false;
  uint8_t *body = malloc(length);
  if (body == NULL || !read_exact(STDIN_FILENO, body, length)) { free(body); return false; }
  if (memcmp(body, T5FB_MAGIC, 4) != 0 || body[4] != T5FB_PROTOCOL_VERSION || body[6] != 0 || body[7] != 0) {
    free(body); return false;
  }
  out->opcode = body[5];
  size_t offset = 8;
  if (out->opcode == T5FB_PUT) {
    if (length - offset < 4u) { free(body); return false; }
    uint32_t text_len = be32_read(body + offset); offset += 4;
    if (text_len == 0 || text_len > T5FB_MAX_PATH || length - offset < (size_t)text_len + 8u) { free(body); return false; }
    out->text = malloc((size_t)text_len + 1u);
    if (out->text == NULL) { free(body); return false; }
    memcpy(out->text, body + offset, text_len); out->text[text_len] = '\0'; offset += text_len;
    if (memchr(out->text, '\0', text_len) != NULL) { free(body); return false; }
    out->data_len = be64_read(body + offset); offset += 8;
    if (out->data_len > T5FB_MAX_FRAME || out->data_len != (uint64_t)(length - offset)) { free(body); return false; }
    out->data = malloc(out->data_len == 0 ? 1u : (size_t)out->data_len);
    if (out->data == NULL) { free(body); return false; }
    if (out->data_len > 0) memcpy(out->data, body + offset, (size_t)out->data_len);
  } else if (out->opcode == T5FB_UNDO_REF) {
    if (length - offset < 4u) { free(body); return false; }
    uint32_t text_len = be32_read(body + offset); offset += 4;
    if (text_len == 0 || text_len > T5FB_MAX_REF || length - offset != text_len) { free(body); return false; }
    out->text = malloc((size_t)text_len + 1u);
    if (out->text == NULL) { free(body); return false; }
    memcpy(out->text, body + offset, text_len); out->text[text_len] = '\0';
  } else if ((out->opcode == T5FB_RECOVER || out->opcode == T5FB_SELF_TEST) && offset == length) {
    /* no fields */
  } else { free(body); return false; }
  free(body);
  return true;
}

static int same_inode(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino;
}

static int capability_contains(int ancestor_fd, int descendant_fd) {
  struct stat ancestor;
  if (fstat(ancestor_fd, &ancestor) != 0) return -1;
  int current = openat(descendant_fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (current < 0) return -1;
  for (unsigned depth = 0; depth < 4096; depth++) {
    struct stat here;
    if (fstat(current, &here) != 0) { close(current); return -1; }
    if (same_inode(&ancestor, &here)) { close(current); return 1; }
    int parent = openat(current, "..", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (parent < 0) { close(current); return -1; }
    struct stat above;
    if (fstat(parent, &above) != 0) { close(parent); close(current); return -1; }
    if (same_inode(&here, &above)) { close(parent); close(current); return 0; }
    close(current); current = parent;
  }
  close(current); errno = ELOOP; return -1;
}

static int validate_capabilities(void) {
  struct stat root_st;
  struct stat state_st;
  if (fstat(ROOT_FD, &root_st) != 0 || !S_ISDIR(root_st.st_mode)) return -1;
  if (fstat(STATE_FD, &state_st) != 0 || !S_ISDIR(state_st.st_mode)) return -1;
  if (state_st.st_uid != getuid() || (state_st.st_mode & 0077) != 0) return -2;
  int state_in_root = capability_contains(ROOT_FD, STATE_FD);
  int root_in_state = capability_contains(STATE_FD, ROOT_FD);
  if (state_in_root < 0 || root_in_state < 0) return -1;
  if (state_in_root == 1 || root_in_state == 1) return -3;
  return 0;
}

static int open_parent(const char *path, bool create, char **leaf_out) {
  char *copy = strdup(path);
  if (copy == NULL) return -1;
  char *slash = strrchr(copy, '/');
  char *leaf = slash == NULL ? copy : slash + 1;
  *leaf_out = strdup(leaf);
  if (*leaf_out == NULL) { free(copy); return -1; }
  if (slash != NULL) *slash = '\0';
  int current = dup(ROOT_FD);
  if (current < 0) { free(copy); free(*leaf_out); *leaf_out = NULL; return -1; }
  if (slash != NULL) {
    char *save = NULL;
    for (char *part = strtok_r(copy, "/", &save); part != NULL; part = strtok_r(NULL, "/", &save)) {
      struct stat st;
      if (fstatat(current, part, &st, AT_SYMLINK_NOFOLLOW) != 0) {
        if (errno != ENOENT || !create || mkdirat(current, part, 0700) != 0) { close(current); free(copy); free(*leaf_out); *leaf_out = NULL; return -1; }
        if (sync_directory(current) != 0) { close(current); free(copy); free(*leaf_out); *leaf_out = NULL; return -1; }
        if (fstatat(current, part, &st, AT_SYMLINK_NOFOLLOW) != 0) { close(current); free(copy); free(*leaf_out); *leaf_out = NULL; return -1; }
      }
      if (!S_ISDIR(st.st_mode) || S_ISLNK(st.st_mode)) { errno = ELOOP; close(current); free(copy); free(*leaf_out); *leaf_out = NULL; return -1; }
      int next = openat(current, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      if (next < 0) { close(current); free(copy); free(*leaf_out); *leaf_out = NULL; return -1; }
      struct stat opened;
      if (fstat(next, &opened) != 0 || opened.st_dev != st.st_dev || opened.st_ino != st.st_ino) {
        close(next); close(current); free(copy); free(*leaf_out); *leaf_out = NULL; errno = ESTALE; return -1;
      }
      struct stat sealed_state;
      if (fstat(STATE_FD, &sealed_state) != 0
          || (opened.st_dev == sealed_state.st_dev && opened.st_ino == sealed_state.st_ino)) {
        close(next); close(current); free(copy); free(*leaf_out); *leaf_out = NULL; errno = EPERM; return -1;
      }
      close(current); current = next;
    }
  }
  free(copy);
  return current;
}

static int revalidate_parent(const char *path, int expected_parent) {
  char *leaf = NULL;
  int observed_parent = open_parent(path, false, &leaf);
  free(leaf);
  if (observed_parent < 0) return -1;
  struct stat expected, observed;
  int rc = fstat(expected_parent, &expected) == 0 && fstat(observed_parent, &observed) == 0
    && expected.st_dev == observed.st_dev && expected.st_ino == observed.st_ino ? 0 : -1;
  close(observed_parent);
  if (rc != 0) errno = ESTALE;
  return rc;
}

static int revalidate_target(int parent, const char *leaf, bool existed, const struct stat *expected) {
  struct stat observed;
  if (fstatat(parent, leaf, &observed, AT_SYMLINK_NOFOLLOW) != 0) {
    if (!existed && errno == ENOENT) return 0;
    return -1;
  }
  if (!existed || !S_ISREG(observed.st_mode) || observed.st_nlink != 1
      || observed.st_dev != expected->st_dev || observed.st_ino != expected->st_ino
      || observed.st_size != expected->st_size
      || observed.st_mtimespec.tv_sec != expected->st_mtimespec.tv_sec
      || observed.st_mtimespec.tv_nsec != expected->st_mtimespec.tv_nsec
      || observed.st_ctimespec.tv_sec != expected->st_ctimespec.tv_sec
      || observed.st_ctimespec.tv_nsec != expected->st_ctimespec.tv_nsec) {
    errno = ESTALE;
    return -1;
  }
  return 0;
}

static int write_new_file_at(int dirfd, const char *name, const uint8_t *data, uint64_t length, mode_t mode) {
  int fd = openat(dirfd, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode);
  if (fd < 0) return -1;
  int rc = 0;
  if (length > 0 && !write_exact(fd, data, (size_t)length)) rc = -1;
  if (rc == 0 && durable_sync(fd) != 0) rc = -1;
  if (close(fd) != 0) rc = -1;
  if (rc != 0) unlinkat(dirfd, name, 0);
  return rc;
}

static int copy_between(int source_dir, const char *source_name, int dest_dir, const char *dest_name, mode_t mode) {
  int source = openat(source_dir, source_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (source < 0) return -1;
  struct stat st;
  if (fstat(source, &st) != 0 || !S_ISREG(st.st_mode) || st.st_nlink != 1) { close(source); errno = EPERM; return -1; }
  int dest = openat(dest_dir, dest_name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode);
  if (dest < 0) { close(source); return -1; }
  uint8_t buffer[IO_CHUNK];
  int rc = 0;
  for (;;) {
    ssize_t n = read(source, buffer, sizeof(buffer));
    if (n == 0) break;
    if (n < 0) { if (errno == EINTR) continue; rc = -1; break; }
    if (!write_exact(dest, buffer, (size_t)n)) { rc = -1; break; }
  }
  if (rc == 0 && durable_sync(dest) != 0) rc = -1;
  if (close(source) != 0) rc = -1;
  if (close(dest) != 0) rc = -1;
  if (rc != 0) unlinkat(dest_dir, dest_name, 0);
  return rc;
}

static int copy_all_between(int source_dir, const char *source_name, int dest_dir, const char *dest_name) {
  int source = openat(source_dir, source_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (source < 0) return -1;
  struct stat st;
  if (fstat(source, &st) != 0 || !S_ISREG(st.st_mode) || st.st_nlink != 1) { close(source); errno = EPERM; return -1; }
  int dest = openat(dest_dir, dest_name, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (dest < 0) { close(source); return -1; }
  int rc = fcopyfile(source, dest, NULL, COPYFILE_ALL) == 0 ? 0 : -1;
  if (rc == 0 && durable_sync(dest) != 0) rc = -1;
  if (close(source) != 0) rc = -1;
  if (close(dest) != 0) rc = -1;
  if (rc != 0) (void)unlinkat(dest_dir, dest_name, 0);
  return rc;
}

static int files_equal(int left_dir, const char *left_name, int right_dir, const char *right_name) {
  int left = openat(left_dir, left_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (left < 0) return 0;
  int right = openat(right_dir, right_name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (right < 0) { close(left); return 0; }
  struct stat a, b;
  if (fstat(left, &a) != 0 || fstat(right, &b) != 0 || !S_ISREG(a.st_mode) || !S_ISREG(b.st_mode)
      || a.st_size != b.st_size) { close(left); close(right); return 0; }
  uint8_t abuf[IO_CHUNK], bbuf[IO_CHUNK];
  int equal = 1;
  for (;;) {
    ssize_t an = read(left, abuf, sizeof(abuf));
    ssize_t bn = read(right, bbuf, sizeof(bbuf));
    if (an < 0 && errno == EINTR) continue;
    if (bn < 0 && errno == EINTR) continue;
    if (an < 0 || bn < 0 || an != bn || (an > 0 && memcmp(abuf, bbuf, (size_t)an) != 0)) { equal = 0; break; }
    if (an == 0) break;
  }
  close(left); close(right);
  return equal;
}

static void state_name(char *out, size_t out_size, const char *ref, const char *suffix) {
  (void)snprintf(out, out_size, "%s.%s", ref, suffix);
}

static void make_ref(char out[T5FB_MAX_REF + 1u]) {
  uint8_t random[16];
  static const char hex[] = "0123456789abcdef";
  arc4random_buf(random, sizeof(random));
  memcpy(out, "u1.", 3);
  for (size_t i = 0; i < sizeof(random); i++) {
    out[3 + i * 2] = hex[random[i] >> 4u];
    out[4 + i * 2] = hex[random[i] & 0x0fu];
  }
  out[T5FB_MAX_REF] = '\0';
}

static void fingerprint_from_stat(struct meta_record *meta, const struct stat *st) {
  meta->fingerprint_valid = true;
  meta->fingerprint[0] = (uint64_t)st->st_dev;
  meta->fingerprint[1] = (uint64_t)st->st_ino;
  meta->fingerprint[2] = (uint64_t)st->st_size;
  meta->fingerprint[3] = (uint64_t)st->st_ctimespec.tv_sec;
  meta->fingerprint[4] = (uint64_t)st->st_ctimespec.tv_nsec;
  meta->fingerprint[5] = (uint64_t)st->st_mtimespec.tv_sec;
  meta->fingerprint[6] = (uint64_t)st->st_mtimespec.tv_nsec;
}

static bool fingerprint_matches(const struct meta_record *meta, const struct stat *st) {
  return meta->fingerprint_valid
    && meta->fingerprint[0] == (uint64_t)st->st_dev
    && meta->fingerprint[1] == (uint64_t)st->st_ino
    && meta->fingerprint[2] == (uint64_t)st->st_size
    && meta->fingerprint[3] == (uint64_t)st->st_ctimespec.tv_sec
    && meta->fingerprint[4] == (uint64_t)st->st_ctimespec.tv_nsec
    && meta->fingerprint[5] == (uint64_t)st->st_mtimespec.tv_sec
    && meta->fingerprint[6] == (uint64_t)st->st_mtimespec.tv_nsec;
}

static int write_meta_named(const char *name, const struct meta_record *meta) {
  size_t path_len = strlen(meta->path), temp_len = strlen(meta->temp);
  size_t length = 72u + path_len + temp_len;
  uint8_t *bytes = calloc(1u, length);
  if (bytes == NULL) return -1;
  memcpy(bytes, META_MAGIC, 4); bytes[4] = META_VERSION; bytes[5] = meta->state;
  bytes[6] = meta->old_exists ? 1u : 0u; bytes[7] = meta->fingerprint_valid ? 1u : 0u;
  be32_write(bytes + 8, (uint32_t)path_len); be32_write(bytes + 12, (uint32_t)temp_len);
  for (size_t i = 0; i < 7; i++) be64_write(bytes + 16 + i * 8u, meta->fingerprint[i]);
  memcpy(bytes + 72, meta->path, path_len); memcpy(bytes + 72 + path_len, meta->temp, temp_len);
  int rc = write_new_file_at(STATE_FD, name, bytes, length, 0600);
  free(bytes);
  if (rc == 0) rc = sync_directory(STATE_FD);
  return rc;
}

static int write_meta(const char *ref, const struct meta_record *meta) {
  char name[64]; state_name(name, sizeof(name), ref, "meta");
  return write_meta_named(name, meta);
}

static int replace_meta(const char *ref, const struct meta_record *meta) {
  char name[64], next[80];
  state_name(name, sizeof(name), ref, "meta"); state_name(next, sizeof(next), ref, "meta.next");
  (void)unlinkat(STATE_FD, next, 0);
  if (write_meta_named(next, meta) != 0) return -1;
  if (renameatx_np(STATE_FD, next, STATE_FD, name, 0) != 0) { (void)unlinkat(STATE_FD, next, 0); return -1; }
  return sync_directory(STATE_FD);
}

static int read_meta(const char *ref, struct meta_record *meta) {
  char name[64]; state_name(name, sizeof(name), ref, "meta");
  int fd = openat(STATE_FD, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return -1;
  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_size < 72 || st.st_size > (off_t)(72 + T5FB_MAX_PATH + NAME_MAX)) { close(fd); errno = EINVAL; return -1; }
  size_t length = (size_t)st.st_size;
  uint8_t *bytes = malloc(length);
  if (bytes == NULL || !read_exact(fd, bytes, length)) { free(bytes); close(fd); return -1; }
  close(fd);
  uint32_t path_len = be32_read(bytes + 8), temp_len = be32_read(bytes + 12);
  if (memcmp(bytes, META_MAGIC, 4) != 0 || bytes[4] != META_VERSION
      || (bytes[5] != META_PREPARED && bytes[5] != META_COMMITTED && bytes[5] != META_UNDO_PREPARED) || bytes[6] > 1 || bytes[7] > 1
      || path_len == 0 || path_len > T5FB_MAX_PATH || temp_len == 0 || temp_len > NAME_MAX
      || length != 72u + path_len + temp_len) { free(bytes); errno = EINVAL; return -1; }
  meta->path = malloc((size_t)path_len + 1u); meta->temp = malloc((size_t)temp_len + 1u);
  if (meta->path == NULL || meta->temp == NULL) { free(meta->path); free(meta->temp); free(bytes); return -1; }
  memcpy(meta->path, bytes + 72, path_len); meta->path[path_len] = '\0';
  memcpy(meta->temp, bytes + 72 + path_len, temp_len); meta->temp[temp_len] = '\0';
  meta->state = bytes[5]; meta->old_exists = bytes[6] == 1; meta->fingerprint_valid = bytes[7] == 1;
  for (size_t i = 0; i < 7; i++) meta->fingerprint[i] = be64_read(bytes + 16 + i * 8u);
  free(bytes);
  if (!valid_relative_path(meta->path) || strchr(meta->temp, '/') != NULL) { free(meta->path); free(meta->temp); errno = EINVAL; return -1; }
  return 0;
}

static void free_meta(struct meta_record *meta) { free(meta->path); free(meta->temp); meta->path = NULL; meta->temp = NULL; }

static int mark_state(const char *ref, uint8_t state, const struct stat *fingerprint) {
  if (state == META_COMMITTED && test_fail("put_mark_committed")) { errno = EIO; return -1; }
  struct meta_record meta = {0};
  if (read_meta(ref, &meta) != 0) return -1;
  meta.state = state;
  if (fingerprint != NULL) fingerprint_from_stat(&meta, fingerprint);
  int rc = replace_meta(ref, &meta);
  free_meta(&meta);
  return rc;
}

static void cleanup_record(const char *ref) {
  char name[64];
  state_name(name, sizeof(name), ref, "old"); (void)unlinkat(STATE_FD, name, 0);
  state_name(name, sizeof(name), ref, "new"); (void)unlinkat(STATE_FD, name, 0);
  state_name(name, sizeof(name), ref, "meta"); (void)unlinkat(STATE_FD, name, 0);
  (void)sync_directory(STATE_FD);
}

/* 1 committed, 0 safely rolled back/no-op, -1 corrupt or ambiguous. */
static int recover_one(const char *ref) {
  struct meta_record meta = {0};
  if (read_meta(ref, &meta) != 0) return -1;
  if (meta.state == META_COMMITTED) { free_meta(&meta); return 1; }
  char *leaf = NULL;
  int parent = open_parent(meta.path, false, &leaf);
  if (parent < 0) { free_meta(&meta); return -1; }
  char new_name[64], old_name[64];
  state_name(new_name, sizeof(new_name), ref, "new"); state_name(old_name, sizeof(old_name), ref, "old");
  int matches_new = files_equal(parent, leaf, STATE_FD, new_name);
  if (meta.state == META_UNDO_PREPARED) {
    struct stat target;
    int target_rc = fstatat(parent, leaf, &target, AT_SYMLINK_NOFOLLOW);
    int matches_old = meta.old_exists ? files_equal(parent, leaf, STATE_FD, old_name)
      : (target_rc != 0 && errno == ENOENT);
    if (matches_old) {
      (void)unlinkat(parent, meta.temp, 0); (void)sync_directory(parent);
      close(parent); free(leaf); free_meta(&meta); cleanup_record(ref); return 0;
    }
    if (matches_new) {
      struct stat current;
      if (fstatat(parent, leaf, &current, AT_SYMLINK_NOFOLLOW) != 0 || !fingerprint_matches(&meta, &current)) {
        close(parent); free(leaf); free_meta(&meta); errno = ESTALE; return -1;
      }
      (void)unlinkat(parent, meta.temp, 0); (void)sync_directory(parent);
      int rc = mark_state(ref, META_COMMITTED, NULL);
      close(parent); free(leaf); free_meta(&meta); return rc == 0 ? 1 : -1;
    }
    close(parent); free(leaf); free_meta(&meta); errno = ESTALE; return -1;
  }
  if (matches_new) {
    struct stat committed;
    if (fstatat(parent, leaf, &committed, AT_SYMLINK_NOFOLLOW) != 0) {
      close(parent); free(leaf); free_meta(&meta); return -1;
    }
    (void)unlinkat(parent, meta.temp, 0);
    int rc = mark_state(ref, META_COMMITTED, &committed);
    close(parent); free(leaf); free_meta(&meta);
    return rc == 0 ? 1 : -1;
  }
  struct stat target;
  int target_rc = fstatat(parent, leaf, &target, AT_SYMLINK_NOFOLLOW);
  int matches_old = meta.old_exists ? files_equal(parent, leaf, STATE_FD, old_name) : (target_rc != 0 && errno == ENOENT);
  if (!matches_old) { close(parent); free(leaf); free_meta(&meta); errno = ESTALE; return -1; }
  (void)unlinkat(parent, meta.temp, 0);
  (void)sync_directory(parent);
  close(parent); free(leaf); free_meta(&meta);
  cleanup_record(ref);
  return 0;
}

static char *recover_all(void) {
  DIR *directory = fdopendir(openat(STATE_FD, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (directory == NULL) return NULL;
  size_t capacity = 256, used = 0;
  char *json = malloc(capacity);
  if (json == NULL) { closedir(directory); return NULL; }
  const char *start = "{\"ok\":true,\"undoRefs\":[";
  used = strlen(start); memcpy(json, start, used);
  bool first = true;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    size_t n = strlen(entry->d_name);
    if (n != T5FB_MAX_REF + 5u || strcmp(entry->d_name + T5FB_MAX_REF, ".meta") != 0) continue;
    char ref[T5FB_MAX_REF + 1u]; memcpy(ref, entry->d_name, T5FB_MAX_REF); ref[T5FB_MAX_REF] = '\0';
    if (!valid_ref(ref)) continue;
    int recovered = recover_one(ref);
    if (recovered < 0) { free(json); closedir(directory); errno = ESTALE; return NULL; }
    if (recovered == 0) continue;
    size_t needed = used + (first ? 0u : 1u) + T5FB_MAX_REF + 2u + 3u;
    if (needed > capacity) { while (capacity < needed) capacity *= 2u; char *next = realloc(json, capacity); if (next == NULL) { free(json); closedir(directory); return NULL; } json = next; }
    if (!first) json[used++] = ',';
    json[used++] = '"'; memcpy(json + used, ref, T5FB_MAX_REF); used += T5FB_MAX_REF; json[used++] = '"'; first = false;
  }
  closedir(directory);
  /* A crash before the prepared metadata was durably created may leave only a
     snapshot. With the state lock held, absence of the matching meta is proof
     that no live transaction can own it. Preserve unrelated state files. */
  directory = fdopendir(openat(STATE_FD, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (directory == NULL) { free(json); return NULL; }
  while ((entry = readdir(directory)) != NULL) {
    size_t n = strlen(entry->d_name);
    bool snapshot = n == T5FB_MAX_REF + 4u
      && (strcmp(entry->d_name + T5FB_MAX_REF, ".old") == 0
        || strcmp(entry->d_name + T5FB_MAX_REF, ".new") == 0);
    bool next_meta = n == T5FB_MAX_REF + 10u
      && strcmp(entry->d_name + T5FB_MAX_REF, ".meta.next") == 0;
    if (next_meta) { (void)unlinkat(STATE_FD, entry->d_name, 0); continue; }
    if (!snapshot) continue;
    char ref[T5FB_MAX_REF + 1u], meta_name[64];
    memcpy(ref, entry->d_name, T5FB_MAX_REF); ref[T5FB_MAX_REF] = '\0';
    if (!valid_ref(ref)) continue;
    state_name(meta_name, sizeof(meta_name), ref, "meta");
    struct stat st;
    if (fstatat(STATE_FD, meta_name, &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT) {
      (void)unlinkat(STATE_FD, entry->d_name, 0);
    }
  }
  closedir(directory);
  (void)sync_directory(STATE_FD);
  memcpy(json + used, "]}", 3u); used += 2u; json[used] = '\0';
  return json;
}

static int unsettled_ref(char out[T5FB_MAX_REF + 1u]) {
  DIR *directory = fdopendir(openat(STATE_FD, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (directory == NULL) return -1;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    size_t n = strlen(entry->d_name);
    bool meta = n == T5FB_MAX_REF + 5u && strcmp(entry->d_name + T5FB_MAX_REF, ".meta") == 0;
    bool next_meta = n == T5FB_MAX_REF + 10u && strcmp(entry->d_name + T5FB_MAX_REF, ".meta.next") == 0;
    bool snapshot = n == T5FB_MAX_REF + 4u
      && (strcmp(entry->d_name + T5FB_MAX_REF, ".old") == 0 || strcmp(entry->d_name + T5FB_MAX_REF, ".new") == 0);
    if (!meta && !next_meta && !snapshot) continue;
    char ref[T5FB_MAX_REF + 1u]; memcpy(ref, entry->d_name, T5FB_MAX_REF); ref[T5FB_MAX_REF] = '\0';
    if (!valid_ref(ref)) continue;
    if (next_meta) { memcpy(out, ref, T5FB_MAX_REF + 1u); closedir(directory); return 1; }
    if (meta) {
      struct meta_record record = {0};
      if (read_meta(ref, &record) != 0) { memcpy(out, ref, T5FB_MAX_REF + 1u); closedir(directory); return 1; }
      bool dirty = record.state != META_COMMITTED;
      free_meta(&record);
      if (dirty) { memcpy(out, ref, T5FB_MAX_REF + 1u); closedir(directory); return 1; }
      continue;
    }
    char meta_name[64]; state_name(meta_name, sizeof(meta_name), ref, "meta");
    struct stat st;
    if (fstatat(STATE_FD, meta_name, &st, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT) {
      memcpy(out, ref, T5FB_MAX_REF + 1u); closedir(directory); return 1;
    }
  }
  closedir(directory);
  return 0;
}

static void put_file(const struct request *request) {
  if (!valid_relative_path(request->text)) fail("INVALID_PATH", "path must be root relative components");
  test_pause("put_after_capability_validation");
  char *leaf = NULL;
  int parent = open_parent(request->text, true, &leaf);
  if (parent < 0) fail_errno("PATH_REJECTED");
  struct stat target;
  bool old_exists = fstatat(parent, leaf, &target, AT_SYMLINK_NOFOLLOW) == 0;
  if (old_exists && (!S_ISREG(target.st_mode) || target.st_nlink != 1)) { close(parent); free(leaf); fail("TARGET_REJECTED", "target is not a single-link regular file"); }
  if (old_exists && (target.st_flags & (UF_IMMUTABLE | UF_APPEND | SF_IMMUTABLE | SF_APPEND)) != 0) {
    close(parent); free(leaf); fail("TARGET_REJECTED", "target file flags do not permit atomic replacement");
  }
  if (!old_exists && errno != ENOENT) { close(parent); free(leaf); fail_errno("TARGET_REJECTED"); }

  char ref[T5FB_MAX_REF + 1u], old_name[64], new_name[64], temp[NAME_MAX + 1u];
  for (;;) {
    make_ref(ref); state_name(new_name, sizeof(new_name), ref, "new");
    struct stat collision;
    if (fstatat(STATE_FD, new_name, &collision, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT) break;
  }
  state_name(old_name, sizeof(old_name), ref, "old");
  (void)snprintf(temp, sizeof(temp), ".t5fb-%s.tmp", ref);
  if (old_exists && copy_all_between(parent, leaf, STATE_FD, old_name) != 0) { close(parent); free(leaf); fail_errno("BACKUP_FAILED"); }
  if (write_new_file_at(STATE_FD, new_name, request->data, request->data_len, 0600) != 0) {
    if (old_exists) unlinkat(STATE_FD, old_name, 0); close(parent); free(leaf); fail_errno("STATE_WRITE_FAILED");
  }
  struct meta_record meta = { .state = META_PREPARED, .old_exists = old_exists, .path = request->text, .temp = temp };
  if (write_meta(ref, &meta) != 0) { cleanup_record(ref); close(parent); free(leaf); fail_errno("STATE_WRITE_FAILED"); }
  if (write_new_file_at(parent, temp, request->data, request->data_len, old_exists ? (target.st_mode & 0777) : 0600) != 0) {
    cleanup_record(ref); close(parent); free(leaf); fail_errno("TEMP_WRITE_FAILED");
  }
  if (!files_equal(parent, temp, STATE_FD, new_name)) {
    unlinkat(parent, temp, 0); cleanup_record(ref); close(parent); free(leaf); fail("READBACK_MISMATCH", "temporary file readback did not match");
  }
  test_pause("put_before_commit");
  if (revalidate_parent(request->text, parent) != 0) {
    unlinkat(parent, temp, 0); cleanup_record(ref); close(parent); free(leaf); fail("PARENT_CHANGED", "target parent changed before commit");
  }
  if (revalidate_target(parent, leaf, old_exists, &target) != 0) {
    unlinkat(parent, temp, 0); cleanup_record(ref); close(parent); free(leaf); fail("TARGET_CHANGED", "target changed before commit");
  }
  if (renameatx_np(parent, temp, parent, leaf, 0) != 0) {
    unlinkat(parent, temp, 0); cleanup_record(ref); close(parent); free(leaf); fail_errno("ATOMIC_COMMIT_FAILED");
  }
  test_pause("put_after_rename");
  if (revalidate_parent(request->text, parent) != 0) {
    int rollback = 0;
    if (old_exists) {
      char rollback_temp[NAME_MAX + 1u];
      (void)snprintf(rollback_temp, sizeof(rollback_temp), ".t5fb-%s.rollback", ref);
      rollback = copy_all_between(STATE_FD, old_name, parent, rollback_temp);
      if (rollback == 0) rollback = renameatx_np(parent, rollback_temp, parent, leaf, 0);
      if (rollback != 0) (void)unlinkat(parent, rollback_temp, 0);
    } else {
      rollback = unlinkat(parent, leaf, 0);
    }
    if (rollback == 0) rollback = sync_directory(parent);
    close(parent); free(leaf);
    if (rollback != 0) recovery_required(ref);
    cleanup_record(ref);
    fail("PARENT_CHANGED", "target parent changed during commit; original was restored");
  }
  if (sync_directory(parent) != 0) { close(parent); free(leaf); recovery_required(ref); }
  struct stat committed_target;
  if (fstatat(parent, leaf, &committed_target, AT_SYMLINK_NOFOLLOW) != 0
      || mark_state(ref, META_COMMITTED, &committed_target) != 0) { close(parent); free(leaf); recovery_required(ref); }
  bool exact = files_equal(parent, leaf, STATE_FD, new_name) == 1;
  close(parent); free(leaf);
  if (!exact) recovery_required(ref);
  char json[160];
  (void)snprintf(json, sizeof(json), "{\"ok\":true,\"undoRef\":\"%s\",\"readbackExact\":true}", ref);
  respond(0, json);
}

static void undo_ref(const char *ref) {
  if (!valid_ref(ref)) fail("INVALID_UNDO_REF", "undo reference is invalid");
  int recovered = recover_one(ref);
  if (recovered < 0) fail("UNDO_REF_NOT_FOUND", "undo reference is missing or corrupt");
  if (recovered == 0) fail("UNDO_REF_NOT_FOUND", "undo reference was not committed");
  struct meta_record meta = {0};
  if (read_meta(ref, &meta) != 0 || meta.state != META_COMMITTED) fail("UNDO_REF_NOT_FOUND", "undo reference is unavailable");
  char *leaf = NULL;
  int parent = open_parent(meta.path, false, &leaf);
  if (parent < 0) { free_meta(&meta); fail_errno("TARGET_CHANGED"); }
  char old_name[64], new_name[64], temp[NAME_MAX + 1u];
  state_name(old_name, sizeof(old_name), ref, "old"); state_name(new_name, sizeof(new_name), ref, "new");
  struct stat current_target;
  if (!files_equal(parent, leaf, STATE_FD, new_name)
      || fstatat(parent, leaf, &current_target, AT_SYMLINK_NOFOLLOW) != 0
      || !fingerprint_matches(&meta, &current_target)) {
    close(parent); free(leaf); free_meta(&meta); fail("TARGET_CHANGED", "target changed after broker put");
  }
  (void)snprintf(temp, sizeof(temp), ".t5fb-%s.undo", ref);
  if (meta.old_exists) {
    if (copy_all_between(STATE_FD, old_name, parent, temp) != 0) {
      (void)unlinkat(parent, temp, 0); close(parent); free(leaf); free_meta(&meta); fail_errno("UNDO_FAILED");
    }
    test_pause("undo_before_commit");
    if (revalidate_parent(meta.path, parent) != 0) {
      (void)unlinkat(parent, temp, 0); close(parent); free(leaf); free_meta(&meta); fail("PARENT_CHANGED", "target parent changed before undo");
    }
    if (mark_state(ref, META_UNDO_PREPARED, NULL) != 0) {
      (void)unlinkat(parent, temp, 0); close(parent); free(leaf); free_meta(&meta); fail_errno("UNDO_RECORD_FAILED");
    }
    if (renameatx_np(parent, temp, parent, leaf, 0) != 0) {
      (void)mark_state(ref, META_COMMITTED, NULL);
      (void)unlinkat(parent, temp, 0); close(parent); free(leaf); free_meta(&meta); fail_errno("UNDO_FAILED");
    }
    test_pause("undo_after_effect");
    if (revalidate_parent(meta.path, parent) != 0) {
      char rollback_temp[NAME_MAX + 1u];
      (void)snprintf(rollback_temp, sizeof(rollback_temp), ".t5fb-%s.undo-rollback", ref);
      int rollback = copy_between(STATE_FD, new_name, parent, rollback_temp, 0600);
      if (rollback == 0) rollback = renameatx_np(parent, rollback_temp, parent, leaf, 0);
      if (rollback == 0) rollback = sync_directory(parent);
      if (rollback != 0) { (void)unlinkat(parent, rollback_temp, 0); close(parent); free(leaf); free_meta(&meta); recovery_required(ref); }
      (void)mark_state(ref, META_COMMITTED, NULL);
      close(parent); free(leaf); free_meta(&meta); fail("PARENT_CHANGED", "target parent changed during undo; broker value was restored");
    }
    if (sync_directory(parent) != 0) { close(parent); free(leaf); free_meta(&meta); recovery_required(ref); }
  } else {
    test_pause("undo_before_commit");
    if (revalidate_parent(meta.path, parent) != 0) {
      close(parent); free(leaf); free_meta(&meta); fail("PARENT_CHANGED", "target parent changed before undo");
    }
    if (mark_state(ref, META_UNDO_PREPARED, NULL) != 0) { close(parent); free(leaf); free_meta(&meta); fail_errno("UNDO_RECORD_FAILED"); }
    if (unlinkat(parent, leaf, 0) != 0) {
      (void)mark_state(ref, META_COMMITTED, NULL); close(parent); free(leaf); free_meta(&meta); fail_errno("UNDO_FAILED");
    }
    test_pause("undo_after_effect");
    if (revalidate_parent(meta.path, parent) != 0) {
      char rollback_temp[NAME_MAX + 1u];
      (void)snprintf(rollback_temp, sizeof(rollback_temp), ".t5fb-%s.undo-rollback", ref);
      int rollback = copy_between(STATE_FD, new_name, parent, rollback_temp, 0600);
      if (rollback == 0) rollback = renameatx_np(parent, rollback_temp, parent, leaf, 0);
      if (rollback == 0) rollback = sync_directory(parent);
      if (rollback != 0) { (void)unlinkat(parent, rollback_temp, 0); close(parent); free(leaf); free_meta(&meta); recovery_required(ref); }
      (void)mark_state(ref, META_COMMITTED, NULL);
      close(parent); free(leaf); free_meta(&meta); fail("PARENT_CHANGED", "target parent changed during undo; broker value was restored");
    }
    if (sync_directory(parent) != 0) { close(parent); free(leaf); free_meta(&meta); recovery_required(ref); }
  }
  close(parent); free(leaf); free_meta(&meta); cleanup_record(ref);
  respond(0, "{\"ok\":true,\"undone\":true}");
}

int main(void) {
#if !defined(__APPLE__) || !defined(__arm64__)
  fail("WRONG_PLATFORM", "native file broker supports darwin arm64 only");
#else
  int capability = validate_capabilities();
  if (capability == -2) fail("STATE_NOT_SEALED", "state capability must be a distinct current-user 0700 directory");
  if (capability == -3) fail("STATE_NOT_DISJOINT", "root and state capabilities must not contain each other");
  if (capability != 0) fail("INVALID_CAPABILITY", "root and state directory capabilities are required");
  int lock_fd = openat(STATE_FD, ".t5fb.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
  struct stat lock_st;
  if (lock_fd < 0 || fstat(lock_fd, &lock_st) != 0 || !S_ISREG(lock_st.st_mode) || lock_st.st_nlink != 1
      || flock(lock_fd, LOCK_EX) != 0) fail_errno("STATE_LOCK_FAILED");
  struct request request = {0};
  if (!parse_request(&request)) fail("INVALID_PROTOCOL", "request frame is invalid");
  if (request.opcode == T5FB_PUT || request.opcode == T5FB_UNDO_REF) {
    char dirty[T5FB_MAX_REF + 1u];
    int unsettled = unsettled_ref(dirty);
    if (unsettled < 0) fail_errno("RECOVERY_CHECK_FAILED");
    if (unsettled == 1) recovery_required(dirty);
  }
  if (request.opcode == T5FB_PUT) { put_file(&request); return 0; }
  if (request.opcode == T5FB_UNDO_REF) { undo_ref(request.text); return 0; }
  if (request.opcode == T5FB_RECOVER) {
    char *json = recover_all();
    if (json == NULL) fail("RECOVERY_AMBIGUOUS", "recovery cannot prove a safe state");
    respond(0, json); free(json); return 0;
  }
  if (request.opcode == T5FB_SELF_TEST) {
    respond(0, "{\"ok\":true,\"protocol\":1,\"rootCapability\":true,\"sealedStateCapability\":true,\"atomicRename\":\"renameatx_np\",\"fullFsync\":true}");
    return 0;
  }
  fail("INVALID_PROTOCOL", "unknown operation");
#endif
}
