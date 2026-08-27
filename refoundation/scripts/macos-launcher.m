#import <AppKit/AppKit.h>
#include <string.h>

@interface T5Launcher : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSTask *child;
@property(nonatomic, strong) NSDate *lastOpen;
@property(nonatomic) BOOL backgroundRuntimeMode;
@property(nonatomic) BOOL primaryRegularInstance;
@property(nonatomic) BOOL terminationInProgress;
@end

@implementation T5Launcher

- (NSURL *)resources { return NSBundle.mainBundle.resourceURL; }
- (NSURL *)appRoot { return [[self resources] URLByAppendingPathComponent:@"app"]; }
- (NSURL *)support {
  return [[NSFileManager.defaultManager homeDirectoryForCurrentUser]
    URLByAppendingPathComponent:@"Library/Application Support/GPAO-T5"];
}
- (NSURL *)connectionFile { return [[self support] URLByAppendingPathComponent:@"credentials/model-connection.json"]; }
- (NSURL *)portFile { return [[self support] URLByAppendingPathComponent:@"state/console-port.json"]; }

- (NSString *)runtimeName {
#if defined(__arm64__)
  return @"node-arm64";
#elif defined(__x86_64__)
  return @"node-x64";
#else
  return @"node-unsupported";
#endif
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  if (self.backgroundRuntimeMode) {
    [self startConsole];
    return;
  }
  pid_t ownPid = NSProcessInfo.processInfo.processIdentifier;
  for (NSRunningApplication *running in NSWorkspace.sharedWorkspace.runningApplications) {
    if ([running.bundleIdentifier isEqualToString:NSBundle.mainBundle.bundleIdentifier]
      && running.processIdentifier != ownPid
      && running.activationPolicy == NSApplicationActivationPolicyRegular) {
      [running activateWithOptions:NSApplicationActivateIgnoringOtherApps];
      [self openConsoleWithCompletion:^{ [NSApp terminate:nil]; }];
      return;
    }
  }
  NSError *error = nil;
  [NSFileManager.defaultManager createDirectoryAtURL:[self support]
    withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:&error];
  if (error) { [self fail:@"GPAO-T5를 시작하지 못했어요" error:error]; return; }
  // 연결 방법은 콘솔 설정에서 사용자가 고른다. launcher가 credential 유무만 보고
  // ChatGPT OAuth를 먼저 실행하면 API 키 사용자는 자기 방법을 선택할 수 없다.
  self.primaryRegularInstance = YES;
  [self startConsole];
}

- (NSTask *)processForEntry:(NSString *)entry arguments:(NSArray<NSString *> *)arguments error:(NSError **)error {
  NSURL *node = [[[self resources] URLByAppendingPathComponent:@"runtime/bin"]
    URLByAppendingPathComponent:[self runtimeName]];
  if (![NSFileManager.defaultManager isExecutableFileAtPath:node.path]) {
    if (error) *error = [NSError errorWithDomain:@"GPAO-T5" code:1
      userInfo:@{NSLocalizedDescriptionKey: @"이 Mac에 맞는 동봉 런타임을 찾지 못했습니다."}];
    return nil;
  }
  NSTask *task = [NSTask new];
  task.executableURL = node;
  task.currentDirectoryURL = [self appRoot];
  task.arguments = [@[[[self appRoot] URLByAppendingPathComponent:entry].path]
    arrayByAddingObjectsFromArray:arguments ?: @[]];
  NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
  environment[@"T5_REFOUNDATION_CONSOLE_STATE"] = [[self support] URLByAppendingPathComponent:@"state"].path;
  environment[@"T5_REFOUNDATION_MODEL_CONNECTION_FILE"] = [self connectionFile].path;
  environment[@"T5_REFOUNDATION_PORT_FILE"] = [self portFile].path;
  environment[@"PATH"] = [@[
    [[self resources] URLByAppendingPathComponent:@"runtime/bin"].path,
    [[self appRoot] URLByAppendingPathComponent:@"refoundation/node_modules/.bin"].path,
    @"/opt/homebrew/bin", @"/usr/local/bin", @"/usr/bin", @"/bin", @"/usr/sbin", @"/sbin"
  ] componentsJoinedByString:@":"];
  task.environment = environment;
  NSURL *logs = [[self support] URLByAppendingPathComponent:@"logs"];
  [NSFileManager.defaultManager createDirectoryAtURL:logs withIntermediateDirectories:YES
    attributes:@{NSFilePosixPermissions: @0700} error:nil];
  NSURL *log = [logs URLByAppendingPathComponent:@"GPAO-T5.log"];
  if (![NSFileManager.defaultManager fileExistsAtPath:log.path]) {
    [NSFileManager.defaultManager createFileAtPath:log.path contents:nil attributes:@{NSFilePosixPermissions: @0600}];
  }
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:log.path];
  [handle seekToEndOfFile];
  task.standardOutput = handle;
  task.standardError = handle;
  return task;
}

- (NSTask *)processForEntry:(NSString *)entry error:(NSError **)error {
  return [self processForEntry:entry arguments:@[] error:error];
}

- (void)startConsole {
  NSError *error = nil;
  NSTask *task = [self processForEntry:@"refoundation/scripts/ensure-local-runtime.mjs" error:&error];
  if (!task) { [self fail:@"GPAO-T5를 시작하지 못했어요" error:error]; return; }
  __weak typeof(self) weakSelf = self;
  task.terminationHandler = ^(NSTask *finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self) return;
      if (finished.terminationStatus != 0) {
        if (!self.backgroundRuntimeMode) [self alert:@"GPAO-T5를 시작하지 못했어요"
          message:@"잠시 뒤 다시 열어 주세요. 계속되면 GPAO-T5.log를 확인해 주세요."];
        self.primaryRegularInstance = NO;
        [NSApp terminate:nil];
        return;
      }
      if (self.backgroundRuntimeMode) [NSApp terminate:nil];
      else [self openConsoleWithCompletion:nil];
    });
  };
  if (![task launchAndReturnError:&error]) { [self fail:@"GPAO-T5를 시작하지 못했어요" error:error]; return; }
  self.child = task;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  if (!self.primaryRegularInstance || self.terminationInProgress) return NSTerminateNow;
  self.terminationInProgress = YES;
  self.primaryRegularInstance = NO;
  NSError *error = nil;
  NSTask *task = [self processForEntry:@"refoundation/scripts/stop-local-runtime.mjs"
    arguments:@[@"--port-file", self.portFile.path, @"--reason", @"user_full_stop"] error:&error];
  if (!task) return NSTerminateNow;
  task.terminationHandler = ^(NSTask *finished) {
    dispatch_async(dispatch_get_main_queue(), ^{ [NSApp replyToApplicationShouldTerminate:YES]; });
  };
  if (![task launchAndReturnError:&error]) return NSTerminateNow;
  return NSTerminateLater;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  [self openConsoleWithCompletion:nil];
  return YES;
}

- (void)openConsoleWithCompletion:(void (^)(void))completion {
  if (self.lastOpen && -[self.lastOpen timeIntervalSinceNow] < 4) { if (completion) completion(); return; }
  self.lastOpen = [NSDate date];
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:45];
    while ([deadline timeIntervalSinceNow] > 0) {
      NSData *portData = [NSData dataWithContentsOfURL:[self portFile]];
      NSDictionary *json = portData ? [NSJSONSerialization JSONObjectWithData:portData options:0 error:nil] : nil;
      NSNumber *port = json[@"port"];
      if (port.integerValue > 0) {
        NSURL *health = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%ld/health", port.integerValue]];
        if ([NSData dataWithContentsOfURL:health].length > 0) {
          dispatch_async(dispatch_get_main_queue(), ^{
            [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:
              [NSString stringWithFormat:@"http://127.0.0.1:%ld", port.integerValue]]];
            if (completion) completion();
          });
          return;
        }
      }
      usleep(300000);
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [self alert:@"GPAO-T5 화면을 열지 못했어요" message:@"잠시 뒤 앱을 다시 열어 주세요."];
      if (completion) completion();
    });
  });
}

- (void)fail:(NSString *)title error:(NSError *)error {
  if (!self.backgroundRuntimeMode) [self alert:title message:error.localizedDescription ?: @"알 수 없는 오류"];
  self.primaryRegularInstance = NO;
  [NSApp terminate:nil];
}
- (void)alert:(NSString *)title message:(NSString *)message {
  NSAlert *alert = [NSAlert new];
  alert.messageText = title;
  alert.informativeText = message;
  alert.alertStyle = NSAlertStyleWarning;
  [alert runModal];
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    BOOL backgroundRuntimeMode = NO;
    for (int index = 1; index < argc; index += 1) {
      if (strcmp(argv[index], "--background-runtime") == 0) backgroundRuntimeMode = YES;
    }
    NSApplication *application = NSApplication.sharedApplication;
    T5Launcher *delegate = [T5Launcher new];
    delegate.backgroundRuntimeMode = backgroundRuntimeMode;
    application.delegate = delegate;
    [application setActivationPolicy:backgroundRuntimeMode
      ? NSApplicationActivationPolicyProhibited : NSApplicationActivationPolicyRegular];
    [application run];
  }
  return 0;
}
