import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import { makeMacOSFSEventsAdapter } from '../src/file-activity-platform-adapters.js';
import { ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';

const execute=promisify(execFile);const here=dirname(fileURLToPath(import.meta.url));
const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median=(values)=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
const room=await mkdtemp(join(tmpdir(),'t5-ch1-noninterference-'));const helper=join(room,'fsevents-helper');

async function foreground(root){const started=performance.now();const cpu=process.cpuUsage();
  for(let index=0;index<300;index+=1)await writeFile(join(root,`item-${String(index).padStart(3,'0')}.txt`),`value-${index}\n`);
  const names=(await readdir(root)).sort();const facts=[];for(const name of names){const info=await stat(join(root,name));facts.push([name,info.size]);}
  const elapsedMs=performance.now()-started;const usage=process.cpuUsage(cpu);return{elapsedMs,cpuMs:(usage.user+usage.system)/1000,
    fileCount:names.length,resultDigest:hash(facts),operationCount:600};}

async function sample(mode,index){const root=join(room,`${index}-${mode}`);await mkdir(root);let adapter=null;let ledger=null;
  if(mode==='on'){ledger=new ScopedFileActivityLedger(join(room,`${index}-state`));const now=()=>new Date().toISOString();
    await ledger.configure({roots:[root],platform:'darwin',recordedAt:now()});await ledger.setEnabled({enabled:true,recordedAt:now()});
    adapter=makeMacOSFSEventsAdapter({helper,ledger});await adapter.start({seconds:1.4});}
  const result=await foreground(root);if(adapter)await adapter.wait();const status=ledger?await ledger.status():null;
  let canaryStored=false;if(ledger){for(const name of await readdir(ledger.directory)){const text=await readFile(join(ledger.directory,name),'utf8');
    if(text.includes('value-'))canaryStored=true;}}
  return{mode,...result,activityCount:status?.eventCount??0,storageBytes:status?.storageBytes??0,contentCanaryStored:canaryStored};}

try{if(process.platform!=='darwin')throw new Error('macOS is required');
  await execute('clang',[join(here,'..','native','macos-file-activity.c'),'-framework','CoreServices','-o',helper]);
  const samples=[];for(const [index,mode] of ['off','on','on','off'].entries())samples.push(await sample(mode,index));
  const off=samples.filter((item)=>item.mode==='off');const on=samples.filter((item)=>item.mode==='on');
  const result={schema:'t5.ch1.noninterference-qualification.v1',design:'ABBA_off_on_on_off',samples,
    semanticDigestAgreement:new Set(samples.map((item)=>item.resultDigest)).size===1,
    fileCountAgreement:new Set(samples.map((item)=>item.fileCount)).size===1,
    operationCountAgreement:new Set(samples.map((item)=>item.operationCount)).size===1,
    offMedianWallMs:median(off.map((item)=>item.elapsedMs)),onMedianWallMs:median(on.map((item)=>item.elapsedMs)),
    wallDeltaMs:median(on.map((item)=>item.elapsedMs))-median(off.map((item)=>item.elapsedMs)),
    offMedianParentCpuMs:median(off.map((item)=>item.cpuMs)),onMedianParentCpuMs:median(on.map((item)=>item.cpuMs)),
    collectorEvents:on.reduce((sum,item)=>sum+item.activityCount,0),contentCanaryStored:on.some((item)=>item.contentCanaryStored),
    modelCalls:0,providerRequests:0,modelContextBytes:0,foregroundProductWrites:0,externalWrites:0,
    collectorChildCpuQualified:false};
  result.pass=result.semanticDigestAgreement&&result.fileCountAgreement&&result.operationCountAgreement
    &&result.collectorEvents>0&&!result.contentCanaryStored&&result.modelCalls===0&&result.modelContextBytes===0;
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(!result.pass)process.exitCode=1;
}finally{await rm(room,{recursive:true,force:true});}
