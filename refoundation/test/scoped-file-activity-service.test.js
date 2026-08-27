import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';
import { makeScopedFileActivityService } from '../src/scoped-file-activity-service.js';

function controlledAdapter() {
  let settle; const completion = new Promise((resolve) => { settle = resolve; });
  const calls = { starts: 0, stops: 0 };
  return { calls, settle, adapter: { async start() { calls.starts += 1; return { state: 'running' }; },
    async stop() { calls.stops += 1; settle({ state: 'stopped' }); return { state: 'stopped' }; },
    async wait() { return completion; } } };
}
async function waitFor(predicate) { for (let index=0;index<100;index+=1) { if (predicate()) return; await new Promise((resolve)=>setTimeout(resolve,2)); }
  throw new Error('condition timeout'); }

test('service는 adapter 없음과 collector failure를 enabled로 꾸미지 않는다', async () => {
  const room=await mkdtemp(join(tmpdir(),'t5-ch1-service-'));const root=join(room,'root');await mkdir(root);
  const ledger=new ScopedFileActivityLedger(join(room,'state'));const unavailable=makeScopedFileActivityService({ledger});
  await unavailable.configure({roots:[root],recordedAt:'2026-08-27T00:00:00.000Z'});
  await assert.rejects(()=>unavailable.enable(),(error)=>error.status===503);assert.equal((await unavailable.status()).enabled,false);
  const controlled=controlledAdapter();
  const service=makeScopedFileActivityService({ledger,adapterFactory:async()=>controlled.adapter});
  await service.enable({recordedAt:'2026-08-27T00:00:01.000Z'});assert.equal((await service.status()).enabled,true);
  await service.pause({recordedAt:'2026-08-27T00:00:02.000Z'});assert.equal(controlled.calls.starts,1);assert.equal(controlled.calls.stops,1);
  assert.equal((await service.status()).enabled,false);
});

test('collector가 자연 실패하면 durable intent를 보존하고 degraded truth를 보인다', async () => {
  const room=await mkdtemp(join(tmpdir(),'t5-ch1-service-failure-'));const root=join(room,'root');await mkdir(root);
  const ledger=new ScopedFileActivityLedger(join(room,'state'));let observed=null;
  let settle;const completion=new Promise((resolve)=>{settle=resolve;});
  const service=makeScopedFileActivityService({ledger,onError:(error)=>{observed=error.message;},adapterFactory:async()=>({
    async start(){return{state:'running'};},async stop(){settle({state:'stopped'});},async wait(){return completion;}})});
  await service.configure({roots:[root],recordedAt:'2026-08-27T00:01:00.000Z'});
  await service.enable({recordedAt:'2026-08-27T00:01:01.000Z'});settle({state:'failed'});
  for(let index=0;index<50&&!(await service.status()).degraded;index+=1)await new Promise((resolve)=>setTimeout(resolve,2));
  const state=await service.status();assert.equal(state.enabled,false);assert.equal(state.desiredEnabled,true);assert.equal(state.degraded,true);
  assert.match(state.userSafeSummary, /다시 시작하지 못했/u);
  assert.equal(observed,'file_activity_collector_failed');
});

test('프로세스 재시작은 durable 선택만 재개하고 close는 사용자 선택을 지우지 않는다', async () => {
  const room=await mkdtemp(join(tmpdir(),'t5-ch1-service-restart-'));const root=join(room,'root');await mkdir(root);
  const ledger=new ScopedFileActivityLedger(join(room,'state'));const first=controlledAdapter();
  const service1=makeScopedFileActivityService({ledger,adapterFactory:async()=>first.adapter});
  await service1.configure({roots:[root],recordedAt:'2026-08-27T00:02:00.000Z'});
  await service1.enable({recordedAt:'2026-08-27T00:02:01.000Z'});await service1.close();
  await new Promise((resolve)=>setTimeout(resolve,10));assert.equal(first.calls.starts,1);assert.equal((await ledger.status()).enabled,true);
  const second=controlledAdapter();const service2=makeScopedFileActivityService({ledger,adapterFactory:async()=>second.adapter});
  assert.equal((await service2.resumeConfigured()).enabled,true);assert.equal(second.calls.starts,1);
  await service2.pause({recordedAt:'2026-08-27T00:02:02.000Z'});
});

test('자연 collector 종료는 exact rollover하고 사용자 pause 뒤에는 다시 시작하지 않는다', async () => {
  const room=await mkdtemp(join(tmpdir(),'t5-ch1-service-rollover-'));const root=join(room,'root');await mkdir(root);
  const ledger=new ScopedFileActivityLedger(join(room,'state'));const instances=[];
  const service=makeScopedFileActivityService({ledger,adapterFactory:async()=>{const instance=controlledAdapter();instances.push(instance);return instance.adapter;}});
  await service.configure({roots:[root],recordedAt:'2026-08-27T00:02:10.000Z'});
  await service.enable({recordedAt:'2026-08-27T00:02:11.000Z'});instances[0].settle({state:'stopped'});await waitFor(()=>instances.length===2);
  assert.equal((await service.status()).desiredEnabled,true);assert.equal((await service.status()).enabled,true);
  await service.pause({recordedAt:'2026-08-27T00:02:12.000Z'});await new Promise((resolve)=>setTimeout(resolve,10));
  assert.equal(instances.length,2);assert.equal(instances[1].calls.stops,1);assert.equal((await service.status()).desiredEnabled,false);
});

test('전체 삭제는 collector를 먼저 멈추고 물리 event를 0으로 만든다', async () => {
  const room=await mkdtemp(join(tmpdir(),'t5-ch1-service-forget-'));const root=join(room,'root');await mkdir(root);
  const ledger=new ScopedFileActivityLedger(join(room,'state'));const controlled=controlledAdapter();
  const service=makeScopedFileActivityService({ledger,adapterFactory:async()=>controlled.adapter});
  await service.configure({roots:[root],recordedAt:'2026-08-27T00:03:00.000Z'});
  await service.enable({recordedAt:'2026-08-27T00:03:01.000Z'});
  await ledger.ingest({source:'fixture',journal:{kind:'fixture',volume:'v',journalId:'j'},cursor:'1',recordedAt:'2026-08-27T00:03:02.000Z',events:[
    {kind:'created',path:join(root,'a.txt'),occurredAt:'2026-08-27T00:03:02.000Z',sourceEventId:'1',identity:null,availability:'available'}]});
  const receipt=await service.forget({recordedAt:'2026-08-27T00:03:03.000Z'});
  assert.deepEqual(receipt,{deletedEvents:1,remainingEvents:0,enabled:false});assert.equal(controlled.calls.stops,1);
  assert.deepEqual((await service.history({limit:10})).items,[]);assert.equal((await service.status()).desiredEnabled,false);
});
