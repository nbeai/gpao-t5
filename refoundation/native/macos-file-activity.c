#include <CoreServices/CoreServices.h>
#include <sys/stat.h>
#include <time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned long long root_device = 0;
static void json_string(const char *value) {
  putchar('"'); for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p < 0x20) printf("\\u%04x", *p); else putchar(*p);
  } putchar('"');
}
static void iso_now(char output[40]) {
  struct timespec ts; clock_gettime(CLOCK_REALTIME, &ts); struct tm value; gmtime_r(&ts.tv_sec, &value);
  size_t used = strftime(output, 30, "%Y-%m-%dT%H:%M:%S", &value);
  snprintf(output + used, 40 - used, ".%03ldZ", ts.tv_nsec / 1000000);
}
static void flag_names(FSEventStreamEventFlags flags) {
  struct Pair { FSEventStreamEventFlags flag; const char *name; } pairs[] = {
    {kFSEventStreamEventFlagItemCreated,"item_created"},{kFSEventStreamEventFlagItemRemoved,"item_removed"},
    {kFSEventStreamEventFlagItemRenamed,"item_renamed"},{kFSEventStreamEventFlagItemModified,"item_modified"},
    {kFSEventStreamEventFlagItemInodeMetaMod,"inode_meta_mod"},{kFSEventStreamEventFlagRootChanged,"root_changed"},
    {kFSEventStreamEventFlagMustScanSubDirs,"must_scan_subdirs"},{kFSEventStreamEventFlagUserDropped,"user_dropped"},
    {kFSEventStreamEventFlagKernelDropped,"kernel_dropped"},{kFSEventStreamEventFlagEventIdsWrapped,"event_ids_wrapped"}
  }; putchar('['); int first = 1;
  for (size_t i=0;i<sizeof(pairs)/sizeof(pairs[0]);i++) if (flags & pairs[i].flag) {
    if (!first) putchar(','); json_string(pairs[i].name); first=0;
  } putchar(']');
}
static void callback(ConstFSEventStreamRef stream, void *info, size_t count, void *rawPaths,
  const FSEventStreamEventFlags flags[], const FSEventStreamEventId ids[]) {
  (void)stream; (void)info; char **paths = rawPaths;
  for (size_t i=0;i<count;i++) { char timestamp[40]; iso_now(timestamp); struct stat facts;
    int available = lstat(paths[i], &facts) == 0;
    printf("{\"kind\":\"event\",\"eventId\":\"%llu\",\"path\":",(unsigned long long)ids[i]);
    json_string(paths[i]); printf(",\"flags\":"); flag_names(flags[i]); printf(",\"occurredAt\":");
    json_string(timestamp); printf(",\"availability\":\"%s\"",available?"available":"missing");
    if (available) printf(",\"device\":\"%llu\",\"inode\":\"%llu\"",
      (unsigned long long)facts.st_dev,(unsigned long long)facts.st_ino);
    printf("}\n"); fflush(stdout);
  }
}
static void stop_loop(CFRunLoopTimerRef timer, void *info) { (void)timer; (void)info; CFRunLoopStop(CFRunLoopGetCurrent()); }
int main(int argc,char **argv) {
  const char *roots[32]; size_t root_count=0; FSEventStreamEventId since=kFSEventStreamEventIdSinceNow; double seconds=3.0;
  for(int i=1;i<argc;){
    if(!strcmp(argv[i],"--root")&&i+1<argc&&root_count<32){roots[root_count++]=argv[i+1];i+=2;}
    else if(!strcmp(argv[i],"--since")&&i+1<argc){since=strtoull(argv[i+1],NULL,10);i+=2;}
    else if(!strcmp(argv[i],"--seconds")&&i+1<argc){seconds=strtod(argv[i+1],NULL);i+=2;}
    else {fputs("invalid arguments\n",stderr);return 64;}
  }
  if(!root_count||seconds<=0||seconds>86400){fputs("bounded roots required\n",stderr);return 64;}
  struct stat root_stat; if(lstat(roots[0],&root_stat)!=0||!S_ISDIR(root_stat.st_mode)){fputs("invalid root\n",stderr);return 66;}
  root_device=(unsigned long long)root_stat.st_dev;
  for(size_t i=1;i<root_count;i++){struct stat item;if(lstat(roots[i],&item)!=0||(unsigned long long)item.st_dev!=root_device){fputs("one volume per helper required\n",stderr);return 66;}}
  CFStringRef strings[32]; for(size_t i=0;i<root_count;i++)strings[i]=CFStringCreateWithCString(NULL,roots[i],kCFStringEncodingUTF8);
  CFArrayRef paths=CFArrayCreate(NULL,(const void**)strings,(CFIndex)root_count,&kCFTypeArrayCallBacks);
  FSEventStreamContext context={0,NULL,NULL,NULL,NULL}; FSEventStreamCreateFlags options=
    kFSEventStreamCreateFlagFileEvents|kFSEventStreamCreateFlagWatchRoot|kFSEventStreamCreateFlagNoDefer;
  FSEventStreamRef stream=FSEventStreamCreate(NULL,callback,&context,paths,since,0.05,options);
  if(!stream){puts("{\"kind\":\"error\",\"error\":\"stream_create_failed\"}");return 1;}
  FSEventStreamScheduleWithRunLoop(stream,CFRunLoopGetCurrent(),kCFRunLoopDefaultMode);
  if(!FSEventStreamStart(stream)){puts("{\"kind\":\"error\",\"error\":\"stream_start_failed\"}");return 1;}
  char timestamp[40];iso_now(timestamp);printf("{\"kind\":\"ready\",\"cursor\":\"%llu\",\"occurredAt\":",
    (unsigned long long)FSEventsGetCurrentEventId());json_string(timestamp);
  printf(",\"journal\":{\"kind\":\"fsevents_host\",\"volume\":\"%llu\",\"journalId\":\"host-v1\"}}\n",root_device);fflush(stdout);
  CFRunLoopTimerContext timer_context={0,NULL,NULL,NULL,NULL};CFRunLoopTimerRef timer=CFRunLoopTimerCreate(NULL,
    CFAbsoluteTimeGetCurrent()+seconds,0,0,0,stop_loop,&timer_context);CFRunLoopAddTimer(CFRunLoopGetCurrent(),timer,kCFRunLoopDefaultMode);
  CFRunLoopRun();FSEventStreamStop(stream);FSEventStreamInvalidate(stream);FSEventStreamRelease(stream);
  CFRunLoopTimerInvalidate(timer);CFRelease(timer);CFRelease(paths);for(size_t i=0;i<root_count;i++)CFRelease(strings[i]);return 0;
}
