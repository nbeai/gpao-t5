#define UNICODE
#define _UNICODE
#include <windows.h>
#include <winioctl.h>
#include <wchar.h>
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <io.h>

static volatile LONG stopping=0;
static BOOL WINAPI control(DWORD kind){if(kind==CTRL_C_EVENT||kind==CTRL_BREAK_EVENT||kind==CTRL_CLOSE_EVENT||kind==CTRL_SHUTDOWN_EVENT){InterlockedExchange(&stopping,1);return TRUE;}return FALSE;}
static ULONGLONG now_ms(void){FILETIME ft;GetSystemTimeAsFileTime(&ft);ULARGE_INTEGER v;v.LowPart=ft.dwLowDateTime;v.HighPart=ft.dwHighDateTime;return(v.QuadPart-116444736000000000ULL)/10000ULL;}
static void iso(wchar_t out[40]){ULONGLONG ms=now_ms();ULARGE_INTEGER v;FILETIME ft;SYSTEMTIME t;v.QuadPart=ms*10000ULL+116444736000000000ULL;ft.dwLowDateTime=v.LowPart;ft.dwHighDateTime=v.HighPart;FileTimeToSystemTime(&ft,&t);swprintf_s(out,40,L"%04u-%02u-%02uT%02u:%02u:%02u.%03uZ",t.wYear,t.wMonth,t.wDay,t.wHour,t.wMinute,t.wSecond,t.wMilliseconds);}
static void json(const wchar_t *value){putwchar(L'"');for(const wchar_t*p=value;*p;p++){if(*p==L'"'||*p==L'\\'){putwchar(L'\\');putwchar(*p);}else if(*p<0x20)wprintf(L"\\u%04x",(unsigned)*p);else putwchar(*p);}putwchar(L'"');}
static int journal(wchar_t drive,USN_JOURNAL_DATA_V0*out){wchar_t volume[8];swprintf_s(volume,8,L"\\\\.\\%c:",drive);HANDLE h=CreateFileW(volume,GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,0,NULL);if(h==INVALID_HANDLE_VALUE)return 0;DWORD bytes=0;BOOL ok=DeviceIoControl(h,FSCTL_QUERY_USN_JOURNAL,NULL,0,out,sizeof(*out),&bytes,NULL);CloseHandle(h);return ok?1:0;}
static const wchar_t*reason(DWORD action){switch(action){case FILE_ACTION_ADDED:return L"file_create";case FILE_ACTION_REMOVED:return L"file_delete";case FILE_ACTION_RENAMED_OLD_NAME:return L"rename_old_name";case FILE_ACTION_RENAMED_NEW_NAME:return L"rename_new_name";default:return L"data_or_metadata_change";}}
int wmain(int argc,wchar_t**argv){wchar_t root[MAX_PATH]=L"";LONGLONG since=-1;double seconds=3600;for(int i=1;i<argc;){if(!wcscmp(argv[i],L"--root")&&i+1<argc){if(root[0])return 64;wcscpy_s(root,MAX_PATH,argv[i+1]);i+=2;}else if(!wcscmp(argv[i],L"--since")&&i+1<argc){since=_wcstoi64(argv[i+1],NULL,10);i+=2;}else if(!wcscmp(argv[i],L"--seconds")&&i+1<argc){seconds=wcstod(argv[i+1],NULL);i+=2;}else return 64;}
  if(!root[0]||wcslen(root)<3||root[1]!=L':'||seconds<=0||seconds>86400)return 64;_setmode(_fileno(stdout),_O_U8TEXT);DWORD attr=GetFileAttributesW(root);if(attr==INVALID_FILE_ATTRIBUTES||!(attr&FILE_ATTRIBUTE_DIRECTORY)||attr&FILE_ATTRIBUTE_REPARSE_POINT)return 66;
  USN_JOURNAL_DATA_V0 usn;if(!journal(root[0],&usn)){wprintf(L"{\"kind\":\"error\",\"error\":\"usn_journal_unavailable\"}\n");return 1;}wchar_t stamp[40];iso(stamp);
  wprintf(L"{\"kind\":\"ready\",\"cursor\":\"%lld\",\"occurredAt\":",usn.NextUsn);json(stamp);wprintf(L",\"journal\":{\"kind\":\"usn_scoped_notifications\",\"volume\":\"%c:\",\"journalId\":\"%llu\"}}\n",root[0],usn.UsnJournalID);fflush(stdout);
  if(since>=0&&(since<usn.FirstUsn||since>usn.NextUsn)){iso(stamp);wprintf(L"{\"kind\":\"event\",\"usn\":\"%lld\",\"gap\":true,\"reason\":\"usn_cursor_outside_journal\",\"occurredAt\":",usn.NextUsn);json(stamp);wprintf(L"}\n");fflush(stdout);}
  HANDLE dir=CreateFileW(root,FILE_LIST_DIRECTORY,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,NULL,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,NULL);if(dir==INVALID_HANDLE_VALUE)return 66;SetConsoleCtrlHandler(control,TRUE);
  BYTE buffer[64*1024];ULONGLONG deadline=now_ms()+(ULONGLONG)(seconds*1000);while(!InterlockedCompareExchange(&stopping,0,0)&&now_ms()<deadline){DWORD bytes=0;BOOL ok=ReadDirectoryChangesW(dir,buffer,sizeof(buffer),TRUE,FILE_NOTIFY_CHANGE_FILE_NAME|FILE_NOTIFY_CHANGE_DIR_NAME|FILE_NOTIFY_CHANGE_LAST_WRITE|FILE_NOTIFY_CHANGE_SIZE|FILE_NOTIFY_CHANGE_ATTRIBUTES,&bytes,NULL,NULL);if(!ok)break;
    USN_JOURNAL_DATA_V0 current;if(!journal(root[0],&current))break;FILE_NOTIFY_INFORMATION*item=(FILE_NOTIFY_INFORMATION*)buffer;for(;;){wchar_t relative[MAX_PATH];DWORD chars=item->FileNameLength/sizeof(wchar_t);if(chars>=MAX_PATH)chars=MAX_PATH-1;wmemcpy(relative,item->FileName,chars);relative[chars]=0;wchar_t path[2*MAX_PATH];swprintf_s(path,2*MAX_PATH,L"%ls\\%ls",root,relative);iso(stamp);
      wprintf(L"{\"kind\":\"event\",\"usn\":\"%lld\",\"path\":",current.NextUsn);json(path);wprintf(L",\"reasons\":[");json(reason(item->Action));wprintf(L"],\"occurredAt\":");json(stamp);DWORD facts=GetFileAttributesW(path);wprintf(L",\"availability\":\"%ls\"}\n",facts==INVALID_FILE_ATTRIBUTES?L"missing":L"available");fflush(stdout);if(!item->NextEntryOffset)break;item=(FILE_NOTIFY_INFORMATION*)((BYTE*)item+item->NextEntryOffset);}}
  CloseHandle(dir);return 0;}
