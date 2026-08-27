import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('앱 시작은 packaged CH2 helper만 재개하고 종료 때 collector를 정산한다',async()=>{
  const source=await readFile(new URL('../scripts/start-console.mjs',import.meta.url),'utf8');
  assert.match(source,/new CoarseAppActivityLedger\(join\(stateDir, 'app-activity'\)\)/u);
  assert.match(source,/T5_APP_ACTIVITY_HELPER/u);assert.match(source,/makeMacOSCoarseAppAdapter/u);assert.match(source,/makeWindowsCoarseAppAdapter/u);
  assert.match(source,/appActivityService,/u);assert.match(source,/server\.closeAppActivity\(\)/u);
  assert.match(source,/windowsProduct\?\.appActivityHelper/u);
  assert.doesNotMatch(source,/windows_foreground.*PASS/u);
});
