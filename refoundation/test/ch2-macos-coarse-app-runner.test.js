import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CH2 macOS actual은 ABBA 네 표본에서 app/AFK coarse truth와 Context0만 측정한다',async()=>{
  const source=await readFile(new URL('../scripts/run-ch2-macos-coarse-app-qualification.mjs',import.meta.url),'utf8');
  assert.match(source,/\['off','on','on','off'\]/u);assert.match(source,/makeMacOSCoarseAppAdapter/u);
  assert.match(source,/semanticDigestAgreement/u);assert.match(source,/forbiddenStored/u);assert.match(source,/modelContextBytes:0/u);
  assert.doesNotMatch(source,/makeConsoleServer|modelFactory/u);
});

test('CH2 macOS helper는 제품 pause·shutdown SIGTERM에도 마지막 안정 구간을 정산한다',async()=>{
  const source=await readFile(new URL('../native/macos-coarse-app-activity.m',import.meta.url),'utf8');
  assert.match(source,/signal\(SIGTERM,request_stop\)/u);
  assert.match(source,/while\(!stop_requested&&epoch_ms\(\)<deadline\)/u);
  assert.match(source,/emit_segment\(identity,label,currentAfk,start,epoch_ms\(\),\+\+sequence\)/u);
});
