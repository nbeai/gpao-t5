import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
const modelFactory = () => ({ async respond() { return { text: '확인했어요.', toolCalls: [], usage: null }; } });

test('파일 활동은 설정 경로에서만 열리고 root·cursor·content를 공개하지 않는다', async (t) => {
  const room=await mkdtemp(join(tmpdir(),'t5-ch1-product-'));const calls=[];
  const state={available:true,configured:false,enabled:false,desiredEnabled:false,roots:[],eventCount:0,
    storageBytes:41,retention:'until_user_deletes',contentCapture:false,modelContextDefault:false,gap:null,
    userSafeSummary:'파일 활동 기록은 꺼져 있어요.',cursor:'PRIVATE-CURSOR'};
  const service={async status(){calls.push('status');return structuredClone(state);},
    async configure(input){calls.push(['configure',input]);state.configured=true;state.roots=[input.roots[0]];},
    async enable(){calls.push('enable');state.enabled=true;state.desiredEnabled=true;return{};},
    async pause(){calls.push('pause');state.enabled=false;state.desiredEnabled=false;return{};},
    async history(){calls.push('history');return{items:[{activityHandle:'a'.repeat(32),kind:'modified',pathText:'report.txt',
      occurredAt:'2026-08-27T00:00:00.000Z',availability:'available',actor:'unknown',coverage:'metadata_only'}]};},
    async forget(){calls.push('forget');state.eventCount=0;return{deletedEvents:1,remainingEvents:0,enabled:false};},async close(){calls.push('close');}};
  const selectedRoot=join(room,'selected-root');
  const server=makeConsoleServer({stateDir:join(room,'state'),workspace:join(room,'workspace'),modelFactory,fileActivityService:service,
    fileActivityRootSelector:async()=>selectedRoot});
  t.after(()=>new Promise((resolve)=>server.close(resolve)));const base=await listen(server);
  const unavailableServer=makeConsoleServer({stateDir:join(room,'state-2'),workspace:join(room,'workspace-2'),modelFactory});
  t.after(()=>new Promise((resolve)=>unavailableServer.close(resolve)));const unavailableBase=await listen(unavailableServer);
  const absentResponse=await fetch(`${unavailableBase}/file-activity/state`);const absent=await absentResponse.json();
  assert.equal(absent.available,false);assert.match(absentResponse.headers.get('cache-control'),/no-store/u);
  const beforeCalls=calls.length;await fetch(`${base}/overview`);await fetch(`${base}/memory/state`);
  assert.equal(calls.length,beforeCalls);
  const configuredResponse=await fetch(`${base}/file-activity/select`,{method:'POST',headers:{'content-type':'application/json'},
    body:'{}'});assert.equal(configuredResponse.status,200);
  assert.equal(calls[0][0],'configure');assert.equal(calls[0][1].roots[0],selectedRoot);
  const response=await fetch(`${base}/file-activity/state`);const publicState=await response.json();
  assert.equal(publicState.rootCount,1);assert.equal(publicState.enabled,true);assert.equal(publicState.cursor,undefined);
  assert.equal(JSON.stringify(publicState).includes(join(room,'workspace')),false);
  assert.equal(JSON.stringify(publicState).includes(selectedRoot),false);
  assert.match(response.headers.get('cache-control'),/no-store/u);
  const historyResponse=await fetch(`${base}/file-activity/history?limit=20`);const history=await historyResponse.json();
  assert.equal(history.items[0].pathText,'report.txt');assert.equal(JSON.stringify(history).includes('PRIVATE-CURSOR'),false);
  assert.match(historyResponse.headers.get('cache-control'),/no-store/u);
  const bad=await fetch(`${base}/file-activity/action`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action:'pause',recordId:'private'})});assert.equal(bad.status,400);
  await fetch(`${base}/file-activity/action`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'forget'})});
  assert.equal(calls.includes('forget'),true);
});

test('실제 다중 세션 목록은 Work와 Run snapshot을 한 번만 읽는다', async (t) => {
  const room=await mkdtemp(join(tmpdir(),'t5-session-list-snapshot-'));
  const server=makeConsoleServer({stateDir:join(room,'state'),workspace:join(room,'workspace'),modelFactory});
  t.after(()=>new Promise((resolve)=>server.close(resolve)));
  for(let index=0;index<40;index+=1)await server.sessionStore.create();
  let runReads=0;const originalList=server.runLedger.list.bind(server.runLedger);
  server.runLedger.list=async(...args)=>{runReads+=1;return originalList(...args);};
  const base=await listen(server);const response=await fetch(`${base}/sessions`);const listed=await response.json();
  assert.equal(response.status,200);assert.equal(listed.sessions.length,40);assert.equal(runReads,1);
});
