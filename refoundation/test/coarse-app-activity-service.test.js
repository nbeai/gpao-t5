import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeCoarseAppActivityService } from '../src/coarse-app-activity-service.js';

function controlled(){let settle;const done=new Promise((resolve)=>{settle=resolve;});const calls={start:0,stop:0};return{calls,settle,adapter:{
  async start(){calls.start+=1;return{state:'running'};},async stop(){calls.stop+=1;settle({state:'stopped'});return{state:'stopped'};},async wait(){return done;}}};}

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
