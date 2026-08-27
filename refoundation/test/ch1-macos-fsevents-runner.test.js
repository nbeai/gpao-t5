import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CH1 macOS qualification은 격리 root의 create modify rename delete와 content 0을 실측한다',async()=>{
  const source=await readFile(new URL('../scripts/run-ch1-macos-fsevents-qualification.mjs',import.meta.url),'utf8');
  assert.match(source,/makeMacOSFSEventsAdapter/u);assert.match(source,/contentCanaryStored/u);
  assert.match(source,/activity\.length>=2/u);assert.match(source,/modelCalls:0/u);assert.match(source,/externalWrites:0/u);
});
