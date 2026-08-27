#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shobjidl.h>
#include <stdio.h>
#include <fcntl.h>
#include <io.h>

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Uuid.lib")

static void json_wide(const wchar_t *value) {
  putwchar(L'"');
  for (const wchar_t *p = value; *p; p++) {
    if (*p == L'"' || *p == L'\\') { putwchar(L'\\'); putwchar(*p); }
    else if (*p < 0x20) wprintf(L"\\u%04x", (unsigned int)*p);
    else putwchar(*p);
  }
  putwchar(L'"');
}

int wmain(void) {
  _setmode(_fileno(stdout), _O_U8TEXT);
  HRESULT status = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  if (FAILED(status)) return 125;
  IFileOpenDialog *dialog = NULL; IShellItem *item = NULL; PWSTR path = NULL;
  status = CoCreateInstance(&CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER,
    &IID_IFileOpenDialog, (void **)&dialog);
  if (SUCCEEDED(status)) {
    DWORD options = 0; dialog->lpVtbl->GetOptions(dialog, &options);
    dialog->lpVtbl->SetOptions(dialog, options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
    dialog->lpVtbl->SetTitle(dialog, L"파일 활동을 기록할 폴더 선택");
    status = dialog->lpVtbl->Show(dialog, NULL);
  }
  if (status == HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
    wprintf(L"{\"selected\":false}\n"); status = S_OK;
  } else if (SUCCEEDED(status)) {
    status = dialog->lpVtbl->GetResult(dialog, &item);
    if (SUCCEEDED(status)) status = item->lpVtbl->GetDisplayName(item, SIGDN_FILESYSPATH, &path);
    if (SUCCEEDED(status) && path != NULL) {
      wprintf(L"{\"selected\":true,\"path\":"); json_wide(path); wprintf(L"}\n");
    }
  }
  if (path) CoTaskMemFree(path); if (item) item->lpVtbl->Release(item);
  if (dialog) dialog->lpVtbl->Release(dialog); CoUninitialize();
  return SUCCEEDED(status) ? 0 : 125;
}
