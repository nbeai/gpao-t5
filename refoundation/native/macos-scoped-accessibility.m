#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <string.h>

static id attribute(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess || value == NULL) return nil;
  return CFBridgingRelease(value);
}

static NSString *bounded_string(id value, NSUInteger maximum) {
  if (![value isKindOfClass:NSString.class]) return nil;
  NSString *text = [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.controlCharacterSet];
  if (text.length > maximum) text = [text substringToIndex:maximum];
  return text.length ? text : nil;
}

static BOOL bool_attribute(AXUIElementRef element, CFStringRef name, BOOL fallback) {
  id value = attribute(element, name);
  return [value isKindOfClass:NSNumber.class] ? [(NSNumber *)value boolValue] : fallback;
}

static BOOL secret_role(NSString *role, NSString *subrole) {
  return [subrole isEqualToString:(__bridge NSString *)kAXSecureTextFieldSubrole]
    || [subrole.lowercaseString containsString:@"secure"]
    || [subrole.lowercaseString containsString:@"password"];
}

static void observe_element(AXUIElementRef element, NSUInteger depth, NSUInteger maximumDepth,
  NSUInteger maximumNodes, NSMutableArray *output) {
  if (output.count >= maximumNodes || depth > maximumDepth) return;
  NSString *role = bounded_string(attribute(element, kAXRoleAttribute), 80) ?: @"unknown";
  NSString *subrole = bounded_string(attribute(element, kAXSubroleAttribute), 80) ?: @"";
  BOOL secret = secret_role(role, subrole);
  NSMutableDictionary *row = [@{ @"role": role, @"depth": @(depth),
    @"enabled": @(bool_attribute(element, kAXEnabledAttribute, YES)),
    @"selected": @(bool_attribute(element, kAXSelectedAttribute, NO)),
    @"focused": @(bool_attribute(element, kAXFocusedAttribute, NO)),
    @"secret": @(secret) } mutableCopy];
  NSString *label = bounded_string(attribute(element, kAXTitleAttribute), 240)
    ?: bounded_string(attribute(element, kAXDescriptionAttribute), 240);
  if (label) row[@"label"] = label;
  id rawValue = attribute(element, kAXValueAttribute);
  NSString *text = secret ? nil : bounded_string(rawValue, 240);
  row[@"valuePresent"] = @([rawValue isKindOfClass:NSString.class] && [(NSString *)rawValue length] > 0);
  if (text) row[@"text"] = text;
  [output addObject:row];
  if (output.count >= maximumNodes || depth == maximumDepth) return;
  id children = attribute(element, kAXChildrenAttribute);
  if (![children isKindOfClass:NSArray.class]) return;
  for (id child in (NSArray *)children) {
    if (output.count >= maximumNodes) break;
    if (CFGetTypeID((__bridge CFTypeRef)child) != AXUIElementGetTypeID()) continue;
    observe_element((__bridge AXUIElementRef)child, depth + 1, maximumDepth, maximumNodes, output);
  }
}

static void emit(NSDictionary *value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
}

int main(int argc, char **argv) {
  NSString *allowed = nil; NSUInteger maximumNodes = 120, maximumDepth = 6;
  for (int index = 1; index < argc;) {
    if (!strcmp(argv[index], "--allow-app-id") && index + 1 < argc) {
      allowed = [NSString stringWithUTF8String:argv[index + 1]]; index += 2;
    } else if (!strcmp(argv[index], "--max-nodes") && index + 1 < argc) {
      maximumNodes = (NSUInteger)strtoul(argv[index + 1], NULL, 10); index += 2;
    } else if (!strcmp(argv[index], "--max-depth") && index + 1 < argc) {
      maximumDepth = (NSUInteger)strtoul(argv[index + 1], NULL, 10); index += 2;
    } else return 64;
  }
  if (!allowed.length || maximumNodes < 1 || maximumNodes > 200 || maximumDepth > 8) return 64;
  @autoreleasepool {
    if (!AXIsProcessTrusted()) { emit(@{ @"state": @"needs_accessibility_permission" }); return 0; }
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    NSString *appId = app.bundleIdentifier ?: @"unknown";
    if (![appId isEqualToString:allowed]) {
      emit(@{ @"state": @"scope_mismatch", @"observedAppId": appId }); return 0;
    }
    AXUIElementRef application = AXUIElementCreateApplication(app.processIdentifier);
    id window = attribute(application, kAXFocusedWindowAttribute);
    if (!window || CFGetTypeID((__bridge CFTypeRef)window) != AXUIElementGetTypeID()) {
      CFRelease(application); emit(@{ @"state": @"focused_window_unavailable", @"appId": appId }); return 0;
    }
    NSMutableArray *elements = [NSMutableArray array];
    observe_element((__bridge AXUIElementRef)window, 0, maximumDepth, maximumNodes, elements);
    CFRelease(application);
    emit(@{ @"state": @"observed", @"appId": appId, @"pid": @(app.processIdentifier),
      @"window": @{ @"focused": @YES }, @"coverage": @{ @"nodes": @(elements.count),
        @"maximumNodes": @(maximumNodes), @"maximumDepth": @(maximumDepth),
        @"truncated": @(elements.count >= maximumNodes) }, @"elements": elements });
  }
  return 0;
}
