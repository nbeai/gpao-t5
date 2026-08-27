import test from'node:test';import assert from'node:assert/strict';import{mkdir,mkdtemp}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{makeConsoleServer}from'../src/console-server.js';import{ScopedFileActivityLedger}from'../src/scoped-file-activity-ledger.js';
import{makeScopedFileActivityService}from'../src/scoped-file-activity-service.js';import{CoarseAppActivityLedger}from'../src/coarse-app-activity-ledger.js';
import{makeCoarseAppActivityService}from'../src/coarse-app-activity-service.js';
async function listen(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return`http://127.0.0.1:${server.address().port}`;}
test('실제 console은 purpose_history를 on-demand 열고 bounded 후보 뒤 선택 source만 reopen한다',async(t)=>{const room=await mkdtemp(join(tmpdir(),'t5-ch3-product-'));
  const scope=join(room,'scope');await mkdir(scope);const files=new ScopedFileActivityLedger(join(room,'file-state'));await files.configure({roots:[scope],platform:'darwin',recordedAt:'2026-08-27T00:00:00.000Z'});
  await files.setEnabled({enabled:true,recordedAt:'2026-08-27T00:00:01.000Z'});await files.ingest({source:'fixture',journal:{kind:'fixture',volume:'v',journalId:'j'},cursor:'1',
    recordedAt:'2026-08-27T00:00:02.000Z',events:[{kind:'modified',path:join(scope,'견적서.xlsx'),occurredAt:'2026-08-27T00:00:02.000Z',sourceEventId:'1',identity:null,availability:'available'}]});
  const apps=new CoarseAppActivityLedger(join(room,'app-state'));await apps.configure({platform:'darwin',recordedAt:'2026-08-27T00:00:00.000Z'});
  await apps.setEnabled({enabled:true,recordedAt:'2026-08-27T00:00:01.000Z'});await apps.ingest({source:'fixture',policyGeneration:2,recordedAt:'2026-08-27T00:00:06.000Z',
    segments:[{segmentId:'app-1',appId:'com.apple.Numbers',appLabel:'Numbers',startedAt:'2026-08-27T00:00:02.000Z',endedAt:'2026-08-27T00:00:06.000Z',durationMs:4000,afk:'active',workBinding:null}]});
  const fileService=makeScopedFileActivityService({ledger:files});const appService=makeCoarseAppActivityService({ledger:apps});let turn=0;const visible=[];const errors=[];
  const server=makeConsoleServer({stateDir:join(room,'state'),workspace:scope,fileActivityService:fileService,appActivityService:appService,onError:(error)=>errors.push(error?.stack??String(error)),modelFactory:()=>({async respond(input){
    turn+=1;visible.push(input.tools.map((tool)=>tool.name));if(turn===1)return{text:'',toolCalls:[{id:'find-tool',name:'tool_search',args:{query:'past work file app history previous'}}]};
    if(turn===2)return{text:'',toolCalls:[{id:'search-history',name:'purpose_history',args:{action:'search',query:'견적서 Numbers',limit:8,queryHandle:null,handles:[]}}]};
    if(turn===3){const receipt=JSON.parse(input.messages.findLast((item)=>item.role==='tool').content).result;const handles=receipt.candidates.map((item)=>item.handle);
      return{text:'',toolCalls:[{id:'reopen-history',name:'purpose_history',args:{action:'reopen',query:null,limit:null,queryHandle:receipt.queryHandle,handles}}]};}
    const reopened=input.messages.findLast((item)=>item.role==='tool').content;assert.match(reopened,/견적서\.xlsx/u);assert.match(reopened,/Numbers/u);
    assert.doesNotMatch(reopened,/com\.apple\.Numbers|scope\/|app-1|sourceEventId/u);return{text:'견적서 파일 기록과 Numbers 사용 기록을 확인했어요.',toolCalls:[]};}})});
  t.after(async()=>{await fileService.close();await appService.close();await new Promise((resolve)=>server.close(resolve));});const base=await listen(server);
  const session=await fetch(`${base}/sessions`,{method:'POST'}).then((response)=>response.json());const response=await fetch(`${base}/turn`,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({sessionId:session.id,text:'지난번 견적서와 사용한 앱 기록을 찾아줘'})});const result=await response.json();assert.equal(response.status,200,JSON.stringify({result,errors}));
  assert.match(result.reply,/견적서 파일 기록/u);assert.equal(visible[0].includes('purpose_history'),false);assert.equal(visible[1].includes('purpose_history'),true);
  assert.equal((await files.status()).eventCount,1);assert.equal((await apps.status()).segmentCount,1);
});
