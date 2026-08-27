import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeMacOSCoarseAppAdapter } from '../src/coarse-app-activity-platform-adapters.js';

const execute=promisify(execFile);const here=dirname(fileURLToPath(import.meta.url));const room=await mkdtemp(join(tmpdir(),'t5-ch2-actual-'));
const helper=join(room,'coarse-helper');const digestWork=()=>{const started=performance.now();let value='seed';for(let index=0;index<25000;index+=1)
  value=createHash('sha256').update(value).digest('hex');return{digest:value,wallMs:performance.now()-started,iterations:25000};};
async function sample(mode,index){let adapter=null,ledger=null;if(mode==='on'){ledger=new CoarseAppActivityLedger(join(room,`state-${index}`));const now=()=>new Date().toISOString();
  await ledger.configure({platform:'darwin',recordedAt:now()});await ledger.setEnabled({enabled:true,recordedAt:now()});adapter=makeMacOSCoarseAppAdapter({helper,ledger});
  await adapter.start({seconds:0.8,interval:0.1,afkSeconds:300});}const foreground=digestWork();if(adapter)await adapter.wait();const history=ledger?await ledger.query({limit:10}):[];
  return{mode,...foreground,segments:history.length,labels:history.map((item)=>item.appLabel),activities:history.map((item)=>item.activity),raw:ledger
    ?(await Promise.all((await readdir(ledger.directory)).map((name)=>readFile(join(ledger.directory,name),'utf8')))).join('\n'):''};}
try{if(process.platform!=='darwin')throw new Error('macOS is required');await execute('xcrun',['clang','-fobjc-arc','-O2','-framework','AppKit','-framework','CoreGraphics',
  join(here,'..','native','macos-coarse-app-activity.m'),'-o',helper]);const samples=[];for(const[index,mode]of['off','on','on','off'].entries())samples.push(await sample(mode,index));
  const on=samples.filter((item)=>item.mode==='on'),off=samples.filter((item)=>item.mode==='off');const median=(items)=>items.map((item)=>item.wallMs).sort((a,b)=>a-b).reduce((sum,value)=>sum+value,0)/items.length;
  const publicSamples=samples.map(({raw,...item})=>item);const serialized=JSON.stringify(publicSamples);const result={schema:'t5.ch2.macos-coarse-app-qualification.v1',design:'ABBA_off_on_on_off',samples:publicSamples,
    semanticDigestAgreement:new Set(samples.map((item)=>item.digest)).size===1,iterationsAgreement:new Set(samples.map((item)=>item.iterations)).size===1,
    actualSegments:on.reduce((sum,item)=>sum+item.segments,0),offMedianWallMs:median(off),onMedianWallMs:median(on),wallDeltaMs:median(on)-median(off),
    appLabelsPresent:on.every((item)=>item.labels.every(Boolean)),onlyHumanActivityLabels:on.every((item)=>item.activities.every((value)=>['사용 중','자리 비움','확인 필요'].includes(value))),
    forbiddenStored:/windowTitle|documentTitle|https?:|clipboard|keystroke|SECRET-CANARY/u.test(on.map((item)=>item.raw).join('\n')),
    forbiddenProjected:/appId|windowTitle|documentTitle|https?:|clipboard|keystroke/u.test(serialized),modelCalls:0,providerRequests:0,modelContextBytes:0,externalWrites:0};
  result.pass=result.semanticDigestAgreement&&result.iterationsAgreement&&result.actualSegments>=2&&result.appLabelsPresent&&result.onlyHumanActivityLabels
    &&!result.forbiddenStored&&!result.forbiddenProjected;process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(!result.pass)process.exitCode=1;
}finally{await rm(room,{recursive:true,force:true});}
