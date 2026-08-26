#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdio.h>
#include <stdlib.h>

static int fail(const wchar_t *step) {
  fwprintf(stderr, L"T5_WINDOWS_JOB_HOST_ERROR:%ls:%lu\n", step, GetLastError());
  return 125;
}

int wmain(int argc, wchar_t **argv) {
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
