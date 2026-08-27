import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('앱 시작은 packaged helper가 있을 때만 CH1을 재개하고 종료 때 collector를 정산한다', async () => {
  const source=await readFile(new URL('../scripts/start-console.mjs',import.meta.url),'utf8');
  assert.match(source,/new ScopedFileActivityLedger\(join\(stateDir, 'file-activity'\)\)/u);
  assert.match(source,/accessFile\(packagedFileActivityHelper, constants\.X_OK\)/u);
  assert.match(source,/makeMacOSFSEventsAdapter/u);assert.match(source,/makeWindowsUSNAdapter/u);assert.match(source,/resumeConfigured\(\)/u);
  assert.match(source,/fileActivityService,/u);assert.match(source,/server\.closeFileActivity\(\)/u);
  assert.match(source,/makeNativeFolderSelector/u);assert.match(source,/fileActivityRootSelector,/u);
  assert.match(source,/windowsProduct\?\.fileActivityHelper/u);
  assert.doesNotMatch(source,/windows_usn.*PASS/u);
});
