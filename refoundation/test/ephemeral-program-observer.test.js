import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { executeEphemeralProgramActual } from '../src/ephemeral-program-actual.js';
import { observeEphemeralProgramOutput, assertVerifiedEphemeralProgramOutput } from '../src/ephemeral-program-observer.js';
import { assertSettledEphemeralProgramPublication,
  publishAndCleanEphemeralProgram } from '../src/ephemeral-program-publication.js';
import { admitEphemeralProgramPreparation, prepareEphemeralProgram } from '../src/ephemeral-program-preparation.js';
import { observeBundledQuickJsInterpreter, qualifyEphemeralProgramFixture } from '../src/ephemeral-program-quickjs.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeRecordReference } from '../src/record-reference.js';
import { makeRecordSourceReader } from '../src/record-source-reader.js';
const hash=(v)=>createHash('sha256').update(v).digest('hex');
const registry=()=>new ManagedProcessRegistry({platform:process.platform==='win32'?'linux':process.platform,outputLimit:131072});

async function pipeline(root, actualReturn) {
  const workspace=join(root,'workspace');await mkdir(workspace);const bytes=Buffer.from('A,10\nB,20\n');
  const path=join(workspace,'input.csv');await writeFile(path,bytes);
  const ref=makeRecordReference({sourceKind:'local_file',sourceStore:'managed-file',sourceId:'input',sourceRevision:1,
    sha256:hash(bytes),occurredAt:null,recordedAt:'2026-08-29T00:00:00.000Z',scope:{sessionId:'s',workId:'w',subjectKeys:[],channel:null},
    trust:'user_asserted',sensitivity:'personal',coverage:'full',availability:'available'});
  const source=`function transform(input){const v=JSON.parse(input);if(Array.isArray(v))return {ok:true};return ${actualReturn};}`;
  const admission=admitEphemeralProgramPreparation({capsuleId:'c',workId:'w',revision:1,source:{fileName:'x.js',bytes:source},
    fixture:{bytes:'[]'},oracle:{bytes:'{"ok":true}',provenance:'independent_observer_contract'},inputs:[ref],outputs:[
      {relativePath:'result/data.csv',kind:'text/csv',category:'publishable'},
      {relativePath:'internal/debug.json',kind:'application/json',category:'diagnostic'}]});
  const prepared=(await prepareEphemeralProgram({admission,scratchRoot:join(root,'scratch')})).prepared;
  const qualification=(await qualifyEphemeralProgramFixture({prepared,interpreter:await observeBundledQuickJsInterpreter(),processRegistry:registry()})).qualification;
  const reader=makeRecordSourceReader({mode:'O2_full_shadow',localFileResolver:async()=>({root:workspace,path})});
  return (await executeEphemeralProgramActual({qualification,sourceReader:reader,processRegistry:registry()})).execution;
}

test('G5 host observer는 declaration·format·input relation을 독립 확인하고 category별 verified output을 만든다',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t5-g5-ok-'));try{
    const execution=await pipeline(root,`{outputs:[
      {relativePath:'result/data.csv',encoding:'utf8',content:'name,amount\\nA,10\\nB,20\\n'},
      {relativePath:'internal/debug.json',encoding:'utf8',content:'{"rows":2}'}]}`);
    const verifier=async({inputs,outputs})=>({passed:true,inputSha256s:inputs.map(i=>i.sha256),outputSha256s:outputs.map(o=>o.sha256)});
    const result=await observeEphemeralProgramOutput({execution,relationVerifier:verifier,processRegistry:registry()});
    assert.equal(assertVerifiedEphemeralProgramOutput(result.verification),result.verification);
    assert.equal(result.receipt.state,'output_verified');assert.equal(result.receipt.publishableCount,1);
    assert.equal(result.receipt.cleanupRequiredCount,1);assert.equal(result.receipt.userTargetWrites,0);
    assert.equal(await readFile(result.verification.outputs[0].path,'utf8'),'name,amount\nA,10\nB,20\n');
    await mkdir(join(root,'workspace','result'));
    const published=await publishAndCleanEphemeralProgram({verification:result.verification,
      workspace:join(root,'workspace'),stateRoot:join(root,'publish-state')});
    assert.equal(assertSettledEphemeralProgramPublication(published.settlement),published.settlement);
    assert.equal(published.receipt.state,'published_verified_cleaned');assert.equal(published.receipt.publishedTargets,1);
    assert.equal(published.receipt.excludedInternalTargets,1);assert.equal(published.receipt.capsuleScratchCleaned,true);
    assert.equal(await readFile(join(root,'workspace','result','data.csv'),'utf8'),'name,amount\nA,10\nB,20\n');
    await assert.rejects(readFile(join(root,'workspace','internal','debug.json')),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}});

test('G5 missing·unexpected output과 invalid format은 materialization 전에 unverified다',async()=>{
  for(const [name,value,reason] of [
    ['missing',`{outputs:[{relativePath:'result/data.csv',encoding:'utf8',content:'a,b\\n1,2\\n'}]}`,'output_set_mismatch'],
    ['unexpected',`{outputs:[{relativePath:'result/data.csv',encoding:'utf8',content:'a,b\\n1,2\\n'},{relativePath:'internal/debug.json',encoding:'utf8',content:'{}'},{relativePath:'extra.txt',encoding:'utf8',content:'x'}]}`,'output_set_mismatch'],
    ['invalid',`{outputs:[{relativePath:'result/data.csv',encoding:'utf8',content:'"broken'},{relativePath:'internal/debug.json',encoding:'utf8',content:'{}'}]}`,'output_format_invalid']]){
    const root=await mkdtemp(join(tmpdir(),`t5-g5-${name}-`));try{const execution=await pipeline(root,value);
      const result=await observeEphemeralProgramOutput({execution,relationVerifier:async()=>({passed:true})});
      assert.equal(result.verification,null);assert.equal(result.receipt.reason,reason);
    }finally{await rm(root,{recursive:true,force:true});}}
});

test('G6 cleanup 실패는 verified publication을 지우지 않고 cleanup_unknown으로 분리한다',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t5-g6-cleanup-'));try{const execution=await pipeline(root,`{outputs:[
    {relativePath:'result/data.csv',encoding:'utf8',content:'a,b\\n1,2\\n'},
    {relativePath:'internal/debug.json',encoding:'utf8',content:'{}'}]}`);
    const verifier=async({inputs,outputs})=>({passed:true,inputSha256s:inputs.map(i=>i.sha256),outputSha256s:outputs.map(o=>o.sha256)});
    const observed=await observeEphemeralProgramOutput({execution,relationVerifier:verifier});await mkdir(join(root,'workspace','result'));
    const result=await publishAndCleanEphemeralProgram({verification:observed.verification,workspace:join(root,'workspace'),
      stateRoot:join(root,'publish-state'),removeCapsule:async()=>{}});
    assert.equal(result.settlement,null);assert.equal(result.receipt.state,'published_verified_cleanup_unknown');
    assert.equal(await readFile(join(root,'workspace','result','data.csv'),'utf8'),'a,b\n1,2\n');
  }finally{await rm(root,{recursive:true,force:true});}});

test('G5 relation receipt가 exact input/output digest와 다르면 output_verified로 승격하지 않는다',async()=>{
  const root=await mkdtemp(join(tmpdir(),'t5-g5-relation-'));try{const execution=await pipeline(root,`{outputs:[
    {relativePath:'result/data.csv',encoding:'utf8',content:'a,b\\n1,2\\n'},
    {relativePath:'internal/debug.json',encoding:'utf8',content:'{}'}]}`);
    const result=await observeEphemeralProgramOutput({execution,relationVerifier:async()=>({passed:true,inputSha256s:[],outputSha256s:[]})});
    assert.equal(result.verification,null);assert.equal(result.receipt.reason,'relation_failed');
  }finally{await rm(root,{recursive:true,force:true});}});
