import test from'node:test';import assert from'node:assert/strict';import{makePurposeHistoryTool}from'../src/purpose-history-tool.js';
import{makeToolSearchTool}from'../src/tool-search.js';
test('tool은 strict search→selected reopen만 열고 raw identity를 받지 않는다',async()=>{const calls=[];const tool=makePurposeHistoryTool({adapter:{
  async search(input){calls.push(['search',input]);return{candidates:[]};},async select(input){calls.push(['select',input]);},async reopen(input){calls.push(['reopen',input]);return{label:'과거 작업'};}}});
  assert.deepEqual(tool.parameters.required,['action','query','limit','queryHandle','handles']);assert.equal(tool.parameters.additionalProperties,false);
  assert.doesNotMatch(JSON.stringify(tool.parameters),/sessionId|workId|runId|recordId|path|sourceId/u);
  await tool.execute({action:'search',query:'지난 견적',limit:8,queryHandle:null,handles:[]});await tool.execute({action:'reopen',query:null,limit:null,
    queryHandle:'a'.repeat(32),handles:['b'.repeat(32)]});assert.deepEqual(calls.map((item)=>item[0]),['search','select','reopen']);});
test('unknown fields와 search/reopen 혼합은 adapter 전에 실패한다',async()=>{let calls=0;const tool=makePurposeHistoryTool({adapter:{async search(){calls++;},async select(){calls++;},async reopen(){calls++;}}});
  await assert.rejects(()=>tool.execute({action:'search',query:'x',limit:8,queryHandle:'a'.repeat(32),handles:[]}),/invalid/u);
  await assert.rejects(()=>tool.execute({action:'reopen',query:'x',limit:null,queryHandle:'a'.repeat(32),handles:['b'.repeat(32)]}),/invalid/u);assert.equal(calls,0);});
test('과거 Work·파일·앱 목적은 conversation-only 검색보다 purpose history를 연다',async()=>{const purpose=makePurposeHistoryTool({adapter:{async search(){},async select(){},async reopen(){}}});
  const search=makeToolSearchTool({tools:[purpose,{name:'session_search',description:'Search canonical past conversations for exact words and decisions.',
    searchTerms:['past conversation history transcript 과거 대화 원문']}]});const result=await search.execute({query:'past work file app history previous'});
  assert.deepEqual(result.activatedTools,['purpose_history','session_search']);});
