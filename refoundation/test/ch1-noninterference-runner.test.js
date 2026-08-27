import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CH1 비개입은 off/on 완전교차 없이 ABBA 네 표본과 actual FSEvents만 쓴다',async()=>{
  const source=await readFile(new URL('../scripts/run-ch1-noninterference-qualification.mjs',import.meta.url),'utf8');
  assert.match(source,/\['off','on','on','off'\]/u);assert.match(source,/makeMacOSFSEventsAdapter/u);
  assert.match(source,/semanticDigestAgreement/u);assert.match(source,/modelCalls:0/u);
  assert.match(source,/modelContextBytes:0/u);assert.match(source,/collectorChildCpuQualified:false/u);
  assert.doesNotMatch(source,/makeConsoleServer|modelFactory|160|full.factorial/iu);
});
