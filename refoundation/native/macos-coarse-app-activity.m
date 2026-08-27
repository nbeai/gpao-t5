#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void json_string(const char *value){putchar('"');for(const unsigned char *p=(const unsigned char *)value;*p;p++){
  if(*p=='"'||*p=='\\'){putchar('\\');putchar(*p);}else if(*p<0x20)printf("\\u%04x",*p);else putchar(*p);}putchar('"');}
static long long epoch_ms(void){return (long long)llround([[NSDate date] timeIntervalSince1970]*1000.0);}
static void iso_time(long long milliseconds,char output[40]){time_t seconds=(time_t)(milliseconds/1000);struct tm value;gmtime_r(&seconds,&value);
  size_t used=strftime(output,30,"%Y-%m-%dT%H:%M:%S",&value);snprintf(output+used,40-used,".%03lldZ",milliseconds%1000);}
static NSString *app_identity(NSRunningApplication *app){NSString *bundle=app.bundleIdentifier;if(bundle.length)return bundle;
  NSString *name=app.localizedName;if(name.length)return [@"name:" stringByAppendingString:name];return @"unknown";}
static NSString *app_label(NSRunningApplication *app){return app.localizedName.length?app.localizedName:@"확인되지 않은 앱";}
static const char *afk_state(double threshold){double idle=CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState,kCGAnyInputEventType);
  if(!isfinite(idle)||idle<0)return "unknown";return idle>=threshold?"afk":"active";}
static void emit_segment(NSString *identity,NSString *label,const char *afk,long long start,long long end,unsigned long long sequence){
  char started[40],ended[40];iso_time(start,started);iso_time(end,ended);printf("{\"kind\":\"segment\",\"segmentId\":\"%lld-%llu\",\"appId\":",start,sequence);
  json_string(identity.UTF8String);printf(",\"appLabel\":");json_string(label.UTF8String);printf(",\"startedAt\":");json_string(started);
  printf(",\"endedAt\":");json_string(ended);printf(",\"durationMs\":%lld,\"afk\":\"%s\"}\n",end-start,afk);fflush(stdout);}
int main(int argc,char **argv){double seconds=3.0,interval=0.25,afkThreshold=300.0;for(int i=1;i<argc;){
  if(!strcmp(argv[i],"--seconds")&&i+1<argc){seconds=strtod(argv[i+1],NULL);i+=2;}
  else if(!strcmp(argv[i],"--interval")&&i+1<argc){interval=strtod(argv[i+1],NULL);i+=2;}
  else if(!strcmp(argv[i],"--afk-seconds")&&i+1<argc){afkThreshold=strtod(argv[i+1],NULL);i+=2;}else return 64;}
  if(seconds<=0||seconds>86400||interval<0.1||interval>60||afkThreshold<5||afkThreshold>86400)return 64;
  @autoreleasepool{printf("{\"kind\":\"ready\"}\n");fflush(stdout);NSRunningApplication *app=NSWorkspace.sharedWorkspace.frontmostApplication;
    NSString *identity=app_identity(app),*label=app_label(app);char currentAfk[16];strcpy(currentAfk,afk_state(afkThreshold));
    long long start=epoch_ms(),deadline=start+(long long)llround(seconds*1000.0);unsigned long long sequence=0;
    while(epoch_ms()<deadline){usleep((useconds_t)llround(interval*1000000.0));@autoreleasepool{NSRunningApplication *next=NSWorkspace.sharedWorkspace.frontmostApplication;
      NSString *nextIdentity=app_identity(next),*nextLabel=app_label(next);const char *nextAfk=afk_state(afkThreshold);long long now=epoch_ms();
      if(![identity isEqualToString:nextIdentity]||strcmp(currentAfk,nextAfk)){emit_segment(identity,label,currentAfk,start,now,++sequence);
        identity=[nextIdentity copy];label=[nextLabel copy];strncpy(currentAfk,nextAfk,sizeof(currentAfk)-1);currentAfk[sizeof(currentAfk)-1]='\0';start=now;}}}
    emit_segment(identity,label,currentAfk,start,epoch_ms(),++sequence);}return 0;}
