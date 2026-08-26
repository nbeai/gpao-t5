#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wincrypt.h>
#include <wchar.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <io.h>

#pragma comment(lib, "Crypt32.lib")

static int fail(const wchar_t *step) {
  fwprintf(stderr, L"T5_WINDOWS_JOB_HOST_ERROR:%ls:%lu\n", step, GetLastError());
  return 125;
}

static int read_stdin(BYTE **data, DWORD *size) {
  size_t capacity = 4096, total = 0;
  BYTE *buffer = (BYTE *)malloc(capacity);
  if (buffer == NULL) return 0;
  for (;;) {
    if (total == capacity) {
      if (capacity >= 1048576) { free(buffer); return 0; }
      capacity *= 2;
      BYTE *next = (BYTE *)realloc(buffer, capacity);
      if (next == NULL) { free(buffer); return 0; }
      buffer = next;
    }
    size_t count = fread(buffer + total, 1, capacity - total, stdin);
    total += count;
    if (count == 0) break;
  }
  if (ferror(stdin) || total > 1048576) { free(buffer); return 0; }
  *data = buffer; *size = (DWORD)total; return 1;
}

static int dpapi_protect(void) {
  BYTE *plain = NULL; DWORD plainSize = 0;
  if (!read_stdin(&plain, &plainSize)) return 125;
  DATA_BLOB input = { plainSize, plain }, output = { 0, NULL };
  if (!CryptProtectData(&input, L"GPAO-T5", NULL, NULL, NULL,
      CRYPTPROTECT_UI_FORBIDDEN, &output)) { free(plain); return fail(L"CryptProtectData"); }
  free(plain);
  DWORD chars = 0;
  if (!CryptBinaryToStringA(output.pbData, output.cbData,
      CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, NULL, &chars)) {
    LocalFree(output.pbData); return fail(L"CryptBinaryToStringA-size");
  }
  char *encoded = (char *)malloc(chars);
  if (encoded == NULL) { LocalFree(output.pbData); return 125; }
  if (!CryptBinaryToStringA(output.pbData, output.cbData,
      CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, encoded, &chars)) {
    free(encoded); LocalFree(output.pbData); return fail(L"CryptBinaryToStringA");
  }
  fwrite(encoded, 1, chars > 0 ? chars - 1 : 0, stdout);
  free(encoded); LocalFree(output.pbData); return 0;
}

static int dpapi_unprotect(void) {
  BYTE *encoded = NULL; DWORD encodedSize = 0;
  if (!read_stdin(&encoded, &encodedSize)) return 125;
  DWORD cipherSize = 0;
  if (!CryptStringToBinaryA((const char *)encoded, encodedSize, CRYPT_STRING_BASE64,
      NULL, &cipherSize, NULL, NULL)) { free(encoded); return fail(L"CryptStringToBinaryA-size"); }
  BYTE *cipher = (BYTE *)malloc(cipherSize);
  if (cipher == NULL) { free(encoded); return 125; }
  if (!CryptStringToBinaryA((const char *)encoded, encodedSize, CRYPT_STRING_BASE64,
      cipher, &cipherSize, NULL, NULL)) {
    free(cipher); free(encoded); return fail(L"CryptStringToBinaryA");
  }
  free(encoded);
  DATA_BLOB input = { cipherSize, cipher }, output = { 0, NULL };
  LPWSTR description = NULL;
  if (!CryptUnprotectData(&input, &description, NULL, NULL, NULL,
      CRYPTPROTECT_UI_FORBIDDEN, &output)) { free(cipher); return fail(L"CryptUnprotectData"); }
  free(cipher); if (description != NULL) LocalFree(description);
  fwrite(output.pbData, 1, output.cbData, stdout); LocalFree(output.pbData); return 0;
}

int wmain(int argc, wchar_t **argv) {
  _setmode(_fileno(stdin), _O_BINARY); _setmode(_fileno(stdout), _O_BINARY);
  if (argc == 2 && wcscmp(argv[1], L"--dpapi-protect") == 0) return dpapi_protect();
  if (argc == 2 && wcscmp(argv[1], L"--dpapi-unprotect") == 0) return dpapi_unprotect();
  if (argc != 7 || wcscmp(argv[1], L"--application") != 0
      || wcscmp(argv[3], L"--command-line") != 0 || wcscmp(argv[5], L"--cwd") != 0) {
    fwprintf(stderr, L"T5_WINDOWS_JOB_HOST_ERROR:arguments\n"); return 125;
  }
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) return fail(L"CreateJobObjectW");
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    CloseHandle(job); return fail(L"SetInformationJobObject");
  }
  wchar_t *commandLine = _wcsdup(argv[4]);
  if (commandLine == NULL) { CloseHandle(job); return 125; }
  wchar_t resolvedApplication[32768];
  const wchar_t *application = argv[2];
  if (wcschr(application, L'\\') == NULL && wcschr(application, L'/') == NULL) {
    DWORD length = SearchPathW(NULL, application, NULL, 32768, resolvedApplication, NULL);
    if (length == 0 || length >= 32768) {
      free(commandLine); CloseHandle(job); return fail(L"SearchPathW");
    }
    application = resolvedApplication;
  }
  STARTUPINFOW startup; PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup)); ZeroMemory(&process, sizeof(process)); startup.cb = sizeof(startup);
  if (!CreateProcessW(application, commandLine, NULL, NULL, TRUE,
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, NULL, argv[6], &startup, &process)) {
    free(commandLine); CloseHandle(job); return fail(L"CreateProcessW");
  }
  free(commandLine);
  if (!AssignProcessToJobObject(job, process.hProcess)) {
    TerminateProcess(process.hProcess, 125); CloseHandle(process.hThread);
    CloseHandle(process.hProcess); CloseHandle(job); return fail(L"AssignProcessToJobObject");
  }
  if (ResumeThread(process.hThread) == (DWORD)-1) {
    TerminateJobObject(job, 125); CloseHandle(process.hThread);
    CloseHandle(process.hProcess); CloseHandle(job); return fail(L"ResumeThread");
  }
  CloseHandle(process.hThread);
  WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 125;
  if (!GetExitCodeProcess(process.hProcess, &exitCode)) exitCode = 125;
  CloseHandle(process.hProcess); CloseHandle(job);
  return (int)exitCode;
}
