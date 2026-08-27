import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
test('CH3 live는 두 실제 모델의 full console search→reopen만 실행하고 사용자 history·external write는 0이다',async()=>{const source=await readFile(new URL('../scripts/run-ch3-live-purpose-history-qualification.mjs',import.meta.url),'utf8');
  assert.match(source,/gpt-5\.6-terra/u);assert.match(source,/gpt-5\.5/u);assert.match(source,/makeConsoleServer/u);assert.match(source,/purpose_history/u);
  assert.match(source,/realUserHistoryReads:0/u);assert.match(source,/externalWrites:0/u);assert.match(source,/loadReadOnlyConnectionCredential/u);
  assert.match(source,/AbortSignal\.timeout\(30000\)/u);assert.match(source,/modelCalls>5/u);assert.match(source,/priorAttemptTimedOutAndWasAborted:true/u);
  assert.doesNotMatch(source,/copyFile|credentialWrites:[1-9]|realUserHistoryReads:[1-9]/u);});
