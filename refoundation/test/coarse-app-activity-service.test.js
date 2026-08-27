import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeCoarseAppActivityService } from '../src/coarse-app-activity-service.js';

function controlled(){let settle;const done=new Promise((resolve)=>{settle=resolve;});const calls={start:0,stop:0};return{calls,settle,adapter:{
  async start(){calls.start+=1;return{state:'running'};},async stop(){calls.stop+=1;settle({state:'stopped'});return{state:'stopped'};},async wait(){return done;}}};}
async function waitFor(predicate){for(let index=0;index<100;index+=1){if(predicate())return;await new Promise((resolve)=>setTimeout(resolve,2));}
  throw new Error('condition timeout');}

test('service는 explicit enable 뒤만 실행하고 private·pause·forget을 정산한다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-service-'));const ledger=new CoarseAppActivityLedger(room);const fixture=controlled();
  const service=makeCoarseAppActivityService({ledger,adapterFactory:async()=>fixture.adapter});await service.configure({platform:'darwin',mode:'all_except'});
  assert.equal((await service.status()).enabled,false);await service.enable();assert.equal((await service.status()).enabled,true);assert.equal(fixture.calls.start,1);
  await service.setPrivate({privateMode:true});assert.equal((await service.status()).privateMode,true);assert.equal(fixture.calls.stop,1);
  const forgotten=await service.forget();assert.equal(forgotten.remainingSegments,0);assert.equal((await service.status()).enabled,false);
});

test('adapter 부재와 자연 실패를 enabled로 꾸미지 않는다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-service-fail-'));const ledger=new CoarseAppActivityLedger(room);
  const unavailable=makeCoarseAppActivityService({ledger});await unavailable.configure({platform:'darwin'});
  await assert.rejects(()=>unavailable.enable(),(error)=>error.status===503);assert.equal((await unavailable.status()).desiredEnabled,false);
  let settle;const done=new Promise((resolve)=>{settle=resolve;});let observed=null;const service=makeCoarseAppActivityService({ledger,onError:(error)=>{observed=error.message;},
    adapterFactory:async()=>({async start(){return{state:'running'};},async stop(){},async wait(){return done;}})});
  await service.enable();settle({state:'failed'});for(let index=0;index<50&&(await service.status()).desiredEnabled;index+=1)await new Promise((resolve)=>setTimeout(resolve,2));
  assert.equal((await service.status()).enabled,false);assert.equal(observed,'coarse_app_collector_failed');
});

test('자연 collector 종료는 rollover하고 private·pause는 durable intent를 보존한다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-service-rollover-'));const ledger=new CoarseAppActivityLedger(room);const instances=[];
  const service=makeCoarseAppActivityService({ledger,adapterFactory:async()=>{const instance=controlled();instances.push(instance);return instance.adapter;}});
  await service.configure({platform:'darwin'});await service.enable();instances[0].settle({state:'stopped'});await waitFor(()=>instances.length===2);
  assert.equal((await service.status()).desiredEnabled,true);await service.setPrivate({privateMode:true});assert.equal(instances[1].calls.stop,1);
  const privateEnable=await service.enable();assert.equal(privateEnable.privateMode,true);assert.equal(privateEnable.desiredEnabled,true);assert.equal(instances.length,2);
  const resumed=await service.setPrivate({privateMode:false});assert.equal(resumed.enabled,true);assert.equal(instances.length,3);
  await service.pause();await new Promise((resolve)=>setTimeout(resolve,10));assert.equal(instances.length,3);assert.equal((await service.status()).desiredEnabled,false);
});

test('내보내기는 hidden 500 상한 없이 complete coverage를 반환한다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-service-export-'));const ledger=new CoarseAppActivityLedger(room);
  await ledger.configure({platform:'darwin',recordedAt:'2026-08-27T00:00:00.000Z'});await ledger.setEnabled({enabled:true,recordedAt:'2026-08-27T00:00:01.000Z'});
  const base=Date.parse('2026-08-27T00:00:02.000Z');const segments=Array.from({length:501},(_,index)=>({segmentId:`segment-${index}`,
    appId:'com.example.app',appLabel:'예시 앱',startedAt:new Date(base+index*1000).toISOString(),endedAt:new Date(base+index*1000+500).toISOString(),
    durationMs:500,afk:'active',workBinding:null}));
  await ledger.ingest({source:'fixture',policyGeneration:(await ledger.status()).generation,segments,recordedAt:'2026-08-27T01:00:00.000Z'});
  const exported=await makeCoarseAppActivityService({ledger}).export();assert.equal(exported.coverage,'complete');assert.equal(exported.itemCount,501);
  assert.equal(exported.items.length,501);
});

test('제품 close는 durable 선택을 보존하고 collector를 다시 시작하지 않는다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-service-close-'));const ledger=new CoarseAppActivityLedger(room);const instances=[];
  const service=makeCoarseAppActivityService({ledger,adapterFactory:async()=>{const instance=controlled();instances.push(instance);return instance.adapter;}});
  await service.configure({platform:'darwin'});await service.enable();await service.close();await new Promise((resolve)=>setTimeout(resolve,10));
  assert.equal(instances.length,1);assert.equal(instances[0].calls.stop,1);assert.equal((await ledger.status()).enabled,true);
});
