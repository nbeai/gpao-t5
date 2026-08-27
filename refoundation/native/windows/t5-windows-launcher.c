#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shlobj.h>
#include <shellapi.h>
#include <wchar.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#pragma comment(lib, "Shell32.lib")
#pragma comment(lib, "Ole32.lib")

static int parent_directory(wchar_t *path) {
  wchar_t *slash = wcsrchr(path, L'\\');
  if (slash == NULL) return 0;
  *slash = L'\0'; return 1;
}

static int product_port_file(wchar_t output[MAX_PATH]) {
  PWSTR local = NULL; HRESULT status = SHGetKnownFolderPath(&FOLDERID_LocalAppData, KF_FLAG_DEFAULT, NULL, &local);
  if (FAILED(status) || local == NULL) return 0;
  int written = swprintf_s(output, MAX_PATH, L"%ls\\GPAO-T5\\state\\console-port.json", local);
  CoTaskMemFree(local); return written > 0;
}

static int existing_port(const wchar_t *path) {
  FILE *file = NULL; if (_wfopen_s(&file, path, L"rb") != 0 || file == NULL) return 0;
  char body[1024]; size_t used = fread(body, 1, sizeof(body) - 1, file); fclose(file); body[used] = '\0';
  const char *marker = strstr(body, "\"port\":"); if (marker == NULL) return 0;
  long port = strtol(marker + 7, NULL, 10); return port > 0 && port <= 65535 ? (int)port : 0;
}

static void open_existing_console(const wchar_t *portFile) {
  int port = existing_port(portFile); if (!port) return; wchar_t url[128];
  swprintf_s(url, 128, L"http://127.0.0.1:%d", port);
  ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR command, int show) {
  (void)instance; (void)previous; (void)command; (void)show;
  wchar_t launcher[MAX_PATH], bin[MAX_PATH], root[MAX_PATH], node[MAX_PATH], entry[MAX_PATH];
  wchar_t portFile[MAX_PATH]; if (!product_port_file(portFile)) return 125;
  HANDLE singleton = CreateMutexW(NULL, TRUE, L"Local\\GPAO-T5.Refoundation.Console.v1");
  if (singleton == NULL) return 125;
  if (GetLastError() == ERROR_ALREADY_EXISTS) { open_existing_console(portFile); CloseHandle(singleton); return 0; }
  DWORD length = GetModuleFileNameW(NULL, launcher, MAX_PATH);
  if (length == 0 || length >= MAX_PATH) return 125;
  wcscpy_s(bin, MAX_PATH, launcher); if (!parent_directory(bin)) return 125;
  wcscpy_s(root, MAX_PATH, bin); if (!parent_directory(root)) return 125;
  if (swprintf_s(node, MAX_PATH, L"%ls\\bin\\node.exe", root) < 0) return 125;
  if (swprintf_s(entry, MAX_PATH, L"%ls\\app\\refoundation\\scripts\\ensure-local-runtime.mjs", root) < 0) return 125;
  wchar_t line[4 * MAX_PATH];
  if (swprintf_s(line, 4 * MAX_PATH, L"\"%ls\" \"%ls\" --product-root \"%ls\" --port-file \"%ls\"", node, entry, root, portFile) < 0) return 125;
  STARTUPINFOW startup; PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup)); ZeroMemory(&process, sizeof(process)); startup.cb = sizeof(startup);
  if (!CreateProcessW(node, line, NULL, NULL, FALSE, CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
      NULL, root, &startup, &process)) { CloseHandle(singleton); return 125; }
  CloseHandle(process.hThread); WaitForSingleObject(process.hProcess, INFINITE);
  DWORD exitCode = 125; GetExitCodeProcess(process.hProcess, &exitCode); CloseHandle(process.hProcess);
  if (exitCode == 0) open_existing_console(portFile);
  ReleaseMutex(singleton); CloseHandle(singleton); return (int)exitCode;
}
