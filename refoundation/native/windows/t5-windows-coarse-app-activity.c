#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <io.h>

static volatile LONG stopping = 0;
static BOOL WINAPI control(DWORD kind) { if (kind == CTRL_C_EVENT || kind == CTRL_BREAK_EVENT
  || kind == CTRL_CLOSE_EVENT || kind == CTRL_SHUTDOWN_EVENT) { InterlockedExchange(&stopping, 1); return TRUE; } return FALSE; }
static ULONGLONG now_ms(void) { FILETIME ft; GetSystemTimeAsFileTime(&ft); ULARGE_INTEGER value;
  value.LowPart=ft.dwLowDateTime; value.HighPart=ft.dwHighDateTime; return (value.QuadPart-116444736000000000ULL)/10000ULL; }
static void iso(ULONGLONG ms, wchar_t output[40]) { ULARGE_INTEGER value; FILETIME ft; SYSTEMTIME time;
  value.QuadPart=ms*10000ULL+116444736000000000ULL; ft.dwLowDateTime=value.LowPart;ft.dwHighDateTime=value.HighPart;
  FileTimeToSystemTime(&ft,&time); swprintf_s(output,40,L"%04u-%02u-%02uT%02u:%02u:%02u.%03uZ",time.wYear,time.wMonth,time.wDay,time.wHour,time.wMinute,time.wSecond,time.wMilliseconds); }
static void json(const wchar_t *value){putwchar(L'"');for(const wchar_t *p=value;*p;p++){if(*p==L'"'||*p==L'\\'){putwchar(L'\\');putwchar(*p);}else if(*p<0x20)wprintf(L"\\u%04x",(unsigned)*p);else putwchar(*p);}putwchar(L'"');}
static int foreground(wchar_t identity[MAX_PATH], wchar_t label[MAX_PATH]) { HWND window=GetForegroundWindow();DWORD pid=0;
  if(!window||!GetWindowThreadProcessId(window,&pid)||!pid)return 0;HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!process)return 0;
  wchar_t path[MAX_PATH];DWORD size=MAX_PATH;int ok=QueryFullProcessImageNameW(process,0,path,&size);CloseHandle(process);if(!ok)return 0;
  const wchar_t *base=wcsrchr(path,L'\\');base=base?base+1:path;wcscpy_s(identity,MAX_PATH,base);wcscpy_s(label,MAX_PATH,base);return 1; }
static const wchar_t *afk(DWORD threshold){LASTINPUTINFO info={sizeof(info)};if(!GetLastInputInfo(&info))return L"unknown";
  DWORD idle=GetTickCount()-info.dwTime;return idle>=threshold?L"afk":L"active";}
static void emit(const wchar_t *id,const wchar_t *label,const wchar_t *state,ULONGLONG start,ULONGLONG end,unsigned long sequence){wchar_t a[40],b[40];iso(start,a);iso(end,b);
  wprintf(L"{\"kind\":\"segment\",\"segmentId\":\"%llu-%lu\",\"appId\":",start,sequence);json(id);wprintf(L",\"appLabel\":");json(label);
  wprintf(L",\"startedAt\":");json(a);wprintf(L",\"endedAt\":");json(b);wprintf(L",\"durationMs\":%llu,\"afk\":",end-start);json(state);wprintf(L"}\n");fflush(stdout);}
int wmain(int argc,wchar_t **argv){double seconds=3,interval=.25,afkSeconds=300;for(int i=1;i<argc;){if(!wcscmp(argv[i],L"--seconds")&&i+1<argc){seconds=wcstod(argv[i+1],NULL);i+=2;}
  else if(!wcscmp(argv[i],L"--interval")&&i+1<argc){interval=wcstod(argv[i+1],NULL);i+=2;}else if(!wcscmp(argv[i],L"--afk-seconds")&&i+1<argc){afkSeconds=wcstod(argv[i+1],NULL);i+=2;}else return 64;}
  if(seconds<=0||seconds>86400||interval<.1||interval>60||afkSeconds<5||afkSeconds>86400)return 64;_setmode(_fileno(stdout),_O_U8TEXT);SetConsoleCtrlHandler(control,TRUE);
  wchar_t id[MAX_PATH]=L"unknown",label[MAX_PATH]=L"확인되지 않은 앱";foreground(id,label);wchar_t state[16];wcscpy_s(state,16,afk((DWORD)(afkSeconds*1000)));
  ULONGLONG start=now_ms(),deadline=start+(ULONGLONG)(seconds*1000);unsigned long sequence=0;wprintf(L"{\"kind\":\"ready\"}\n");fflush(stdout);
  while(!InterlockedCompareExchange(&stopping,0,0)&&now_ms()<deadline){Sleep((DWORD)(interval*1000));wchar_t nextId[MAX_PATH]=L"unknown",nextLabel[MAX_PATH]=L"확인되지 않은 앱",nextState[16];foreground(nextId,nextLabel);wcscpy_s(nextState,16,afk((DWORD)(afkSeconds*1000)));ULONGLONG now=now_ms();
    if(wcscmp(id,nextId)||wcscmp(state,nextState)){emit(id,label,state,start,now,++sequence);wcscpy_s(id,MAX_PATH,nextId);wcscpy_s(label,MAX_PATH,nextLabel);wcscpy_s(state,16,nextState);start=now;}}
  emit(id,label,state,start,now_ms(),++sequence);return 0;}
