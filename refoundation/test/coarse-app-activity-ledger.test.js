import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';

const when=(second)=>`2026-08-27T01:00:${String(second).padStart(2,'0')}.000Z`;
const segment=(id,app='com.example.editor',start=0,end=5)=>({segmentId:id,appId:app,appLabel:'편집기',startedAt:when(start),endedAt:when(end),
  durationMs:(end-start)*1000,afk:'active',workBinding:null});

test('CH2 ledger는 default off이고 coarse app metadata만 0600에 기록한다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-ledger-'));const ledger=new CoarseAppActivityLedger(room);
  assert.equal((await ledger.status()).enabled,false);await ledger.configure({platform:'darwin',mode:'all_except',excludeApps:['com.secret.app'],recordedAt:when(0)});
  assert.deepEqual(await ledger.ingest({source:'fixture',policyGeneration:2,segments:[segment('s1')],recordedAt:when(6)}),{accepted:0,state:'paused'});
  await ledger.setEnabled({enabled:true,recordedAt:when(1)});const result=await ledger.ingest({source:'fixture',policyGeneration:2,
    segments:[segment('s1'),segment('excluded','com.secret.app',5,6)],recordedAt:when(6)});assert.deepEqual(result,{accepted:1,state:'recorded'});
  const state=await ledger.status();assert.equal(state.segmentCount,1);assert.equal(state.contentCapture,false);assert.equal(state.titleCapture,false);
  const names=await readdir(room);for(const name of names){const info=await import('node:fs/promises').then((fs)=>fs.stat(join(room,name)));assert.equal(info.mode&0o077,0);}
  const raw=(await Promise.all(names.map((name)=>readFile(join(room,name),'utf8')))).join('\n');assert.doesNotMatch(raw,/windowTitle|documentTitle|https?:|clipboard|keystroke/u);
});

test('title·URL·content·forged Work binding과 stale policy는 저장 전에 닫힌다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-closed-'));const ledger=new CoarseAppActivityLedger(room);
  await ledger.configure({platform:'darwin',recordedAt:when(0)});await ledger.setEnabled({enabled:true,recordedAt:when(1)});
  for(const extra of [{windowTitle:'private'},{url:'https://private.example'},{content:'secret'}])await assert.rejects(()=>ledger.ingest({source:'fixture',policyGeneration:2,
    segments:[{...segment('bad'),...extra}],recordedAt:when(6)}),/fields/u);
  await assert.rejects(()=>ledger.ingest({source:'fixture',policyGeneration:2,segments:[{...segment('bound'),workBinding:{workId:'fake'}}],recordedAt:when(6)}),/fields/u);
  assert.deepEqual(await ledger.ingest({source:'fixture',policyGeneration:1,segments:[segment('old')],recordedAt:when(6)}),{accepted:0,state:'stale_policy'});
  assert.equal((await ledger.status()).segmentCount,0);
});

test('include policy·private·pause·forget은 restart에서도 exact하다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-control-'));let ledger=new CoarseAppActivityLedger(room);
  await ledger.configure({platform:'darwin',mode:'include_only',includeApps:['com.allowed'],recordedAt:when(0)});
  await ledger.setEnabled({enabled:true,recordedAt:when(1)});await ledger.setPrivate({privateMode:true,recordedAt:when(2)});
  assert.deepEqual(await ledger.ingest({source:'fixture',policyGeneration:2,segments:[segment('private','com.allowed')],recordedAt:when(6)}),{accepted:0,state:'paused'});
  await ledger.setPrivate({privateMode:false,recordedAt:when(3)});await ledger.ingest({source:'fixture',policyGeneration:2,
    segments:[segment('allowed','com.allowed'),segment('foreign','com.foreign',5,6)],recordedAt:when(6)});assert.equal((await ledger.query({limit:10})).length,1);
  assert.deepEqual(await ledger.forgetAll({recordedAt:when(7)}),{deletedSegments:1,remainingSegments:0,enabled:false});
  ledger=new CoarseAppActivityLedger(room);assert.equal((await ledger.query()).length,0);assert.equal((await ledger.status()).enabled,false);
});

test('duration·duplicate·policy schema는 fail closed한다',async()=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-duration-'));const ledger=new CoarseAppActivityLedger(room);
  await assert.rejects(()=>ledger.configure({platform:'darwin',mode:'include_only',includeApps:[],recordedAt:when(0)}),/requires apps/u);
  await ledger.configure({platform:'darwin',recordedAt:when(0)});await ledger.setEnabled({enabled:true,recordedAt:when(1)});
  await assert.rejects(()=>ledger.ingest({source:'fixture',policyGeneration:2,segments:[{...segment('wrong'),durationMs:1}],recordedAt:when(6)}),/duration/u);
  assert.deepEqual(await ledger.ingest({source:'fixture',policyGeneration:2,segments:[segment('once'),segment('once')],recordedAt:when(6)}),{accepted:1,state:'recorded'});
});
