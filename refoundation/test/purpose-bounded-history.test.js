import test from 'node:test';import assert from'node:assert/strict';
import{makePurposeBoundedHistoryAdapter}from'../src/purpose-bounded-history.js';
function fixture(){let fileItems=[{activityHandle:'file-a',kind:'modified',pathText:'reports/견적서.xlsx',occurredAt:'2026-08-27T00:00:00.000Z',availability:'available'}];
  const workHistory={async list(){return{items:[{historyHandle:'work-a',title:'지난 견적 정리',statusText:'완료',actorText:'내 요청',counts:{remaining:0},occurredAt:'2026-08-26T00:00:00.000Z'}]};},
    async detail(handle){return{title:'지난 견적 정리',statusText:'완료',objective:'견적을 정리했어요.',handleEcho:handle};}};
  const fileActivityService={async history(){return{items:structuredClone(fileItems)};}};const appActivityService={async history(){return{items:[{activityHandle:'app-a',appLabel:'Numbers',
    startedAt:'2026-08-27T00:00:00.000Z',durationMs:5000,activity:'사용 중'}]};}};return{adapter:makePurposeBoundedHistoryAdapter({workHistory,fileActivityService,
    appActivityService,now:()=>Date.parse('2026-08-27T01:00:00.000Z')}),removeFile:()=>{fileItems=[];}};}
test('local filter는 Work·파일·앱에서 최대 8개 opaque 후보만 만든다',async()=>{const{adapter}=fixture();const result=await adapter.search({query:'견적서 지난 작업',limit:8});
  assert.equal(result.rawHistorySent,false);assert.equal(result.modelCalls,0);assert.ok(result.candidateCount>=1);assert.ok(result.candidates.every((item)=>/^[a-f0-9]{32}$/u.test(item.handle)));
  assert.doesNotMatch(JSON.stringify(result),/work-a|file-a|app-a|reports\//u);});
test('selection은 exact candidate set에 결속되고 foreign·duplicate·replay를 거부한다',async()=>{const{adapter}=fixture();const found=await adapter.search({query:'견적',limit:8});
  await assert.rejects(()=>adapter.select({queryHandle:found.queryHandle,handles:['f'.repeat(32)]}),/invalid/u);await assert.rejects(()=>adapter.select({queryHandle:found.queryHandle,
    handles:[found.candidates[0].handle,found.candidates[0].handle]}),/invalid/u);const selected=await adapter.select({queryHandle:found.queryHandle,handles:[found.candidates[0].handle]});
  assert.equal(selected.candidateDigest,found.candidateDigest);assert.equal(selected.writes,0);});
test('선택 source만 reopen하고 changed/missing file은 old metadata를 반환하지 않는다',async()=>{const{adapter,removeFile}=fixture();const found=await adapter.search({query:'견적서',limit:8});
  const file=found.candidates.find((item)=>item.kind==='file');await adapter.select({queryHandle:found.queryHandle,handles:[file.handle]});removeFile();
  await assert.rejects(()=>adapter.reopen({queryHandle:found.queryHandle,handle:file.handle}),/changed or missing/u);});
test('path·UUID·hash·secret 같은 label은 provider 후보에서 일반 label로 닫힌다',async()=>{const workHistory={async list(){return{items:[{historyHandle:'w',
  title:'/Users/private/01234567-89ab-cdef-0123-456789abcdef',statusText:'완료',actorText:'내 요청',counts:{}}]};},async detail(){return{};}};
  const adapter=makePurposeBoundedHistoryAdapter({workHistory,fileActivityService:{async history(){return{items:[]};}},appActivityService:{async history(){return{items:[]};}}});
  const result=await adapter.search({query:'private'});assert.equal(result.candidates[0]?.label,'과거 작업');assert.doesNotMatch(JSON.stringify(result),/Users|01234567/u);});
