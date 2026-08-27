import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
const modelFactory=()=>({async respond(){return{text:'ok',toolCalls:[]};}});
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return`http://127.0.0.1:${server.address().port}`;}

test('CH2 route는 settings-only이고 app identity·title·URL을 공개하지 않는다',async(t)=>{
  const room=await mkdtemp(join(tmpdir(),'t5-ch2-product-'));const calls=[];const state={available:true,configured:false,enabled:false,desiredEnabled:false,
    privateMode:false,segmentCount:1,storageBytes:100,excludeApps:[],retention:'until_user_deletes',userSafeSummary:'앱 활동 기록은 꺼져 있어요.'};
  const service={async status(){calls.push('status');return structuredClone(state);},async configure(){calls.push('configure');state.configured=true;},
    async enable(){calls.push('enable');state.enabled=true;state.desiredEnabled=true;return{};},async pause(){calls.push('pause');return{};},async setPrivate(){calls.push('private');return{};},
    async history(){calls.push('history');return{items:[{activityHandle:'a'.repeat(32),appHandle:'b'.repeat(32),appLabel:'편집기',startedAt:'2026-08-27T00:00:00.000Z',
      endedAt:'2026-08-27T00:00:05.000Z',durationMs:5000,activity:'사용 중',workBinding:'연결되지 않음',coverage:'foreground_app_only'}]};},
    async export(){calls.push('export');return{schema:'t5.coarse-app-activity-export.v1',items:[]};},async excludeApp(){calls.push('exclude');return{};},
    async includeAll(){calls.push('include');return{};},async forget(){calls.push('forget');return{};},async close(){}};
  const server=makeConsoleServer({stateDir:join(room,'state'),workspace:room,modelFactory,appActivityService:service});t.after(()=>new Promise((resolve)=>server.close(resolve)));
  const base=await listen(server);const before=calls.length;await fetch(`${base}/overview`);await fetch(`${base}/memory/state`);assert.equal(calls.length,before);
  const configured=await fetch(`${base}/app-activity/configure`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(configured.status,200);
  const response=await fetch(`${base}/app-activity/state`);const publicState=await response.json();assert.equal(publicState.enabled,true);assert.equal(publicState.excludeApps,undefined);
  assert.match(response.headers.get('cache-control'),/no-store/u);const history=await fetch(`${base}/app-activity/history?limit=20`).then((item)=>item.json());
  assert.equal(history.items[0].appLabel,'편집기');assert.equal(history.items[0].appId,undefined);assert.equal(JSON.stringify(history).includes('windowTitle'),false);
  const bad=await fetch(`${base}/app-activity/exclude`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({appHandle:'b'.repeat(32),url:'private'})});
  assert.equal(bad.status,400);await fetch(`${base}/app-activity/exclude`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({appHandle:'b'.repeat(32)})});
  assert.equal(calls.includes('exclude'),true);
});
