import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = async (name) => readFile(new URL(`../native/windows/${name}`, import.meta.url), 'utf8');

test('Windows file activity helper는 USN journal continuity와 scoped notifications만 읽는다', async () => {
  const text=await source('t5-windows-file-activity.c');
  assert.match(text,/FSCTL_QUERY_USN_JOURNAL/u);assert.match(text,/ReadDirectoryChangesW/u);
  assert.match(text,/FILE_LIST_DIRECTORY/u);assert.doesNotMatch(text,/ReadFile\s*\(/u);
  assert.doesNotMatch(text,/FSCTL_ENUM_USN_DATA|FSCTL_READ_USN_JOURNAL/u);
  assert.match(text,/usn_scoped_notifications/u);
});

test('Windows app activity helper는 foreground executable basename와 AFK만 읽는다', async () => {
  const text=await source('t5-windows-coarse-app-activity.c');
  assert.match(text,/GetForegroundWindow/u);assert.match(text,/GetLastInputInfo/u);assert.match(text,/QueryFullProcessImageNameW/u);
  assert.doesNotMatch(text,/GetWindowText|PrintWindow|BitBlt|Clipboard|UIAutomation|Internet/u);
  for(const key of ['appId','appLabel','durationMs','afk'])assert.match(text,new RegExp(key));
});

test('Windows folder picker와 launcher는 password shell이나 broad command 문자열을 거치지 않는다', async () => {
  const picker=await source('t5-windows-folder-picker.c');const launcher=await source('t5-windows-launcher.c');
  assert.match(picker,/FOS_PICKFOLDERS/u);assert.match(picker,/FOS_FORCEFILESYSTEM/u);
  assert.match(launcher,/CreateProcessW/u);assert.match(launcher,/--product-root/u);assert.match(launcher,/CreateMutexW/u);
  assert.match(launcher,/--port-file/u);assert.match(launcher,/127\.0\.0\.1/u);
  assert.doesNotMatch(`${picker}\n${launcher}`,/powershell|cmd\.exe/u);
});
