import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { makeMacOSFSEventsAdapter } from '../src/file-activity-platform-adapters.js';
import { ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';

const run=promisify(execFile);const here=dirname(fileURLToPath(import.meta.url));const room=await mkdtemp(join(tmpdir(),'t5-ch1-fsevents-'));
const root=join(room,'allowed');const helper=join(room,'fsevents-helper');const errors=[];
try{await mkdir(root);await run('clang',[join(here,'..','native','macos-file-activity.c'),'-framework','CoreServices','-o',helper]);
  const ledger=new ScopedFileActivityLedger(join(room,'state'));const now=()=>new Date().toISOString();
  await ledger.configure({roots:[root],platform:'darwin',recordedAt:now()});await ledger.setEnabled({enabled:true,recordedAt:now()});
  const adapter=makeMacOSFSEventsAdapter({helper,ledger,onError:(error)=>errors.push(error.message)});
  const ready=await adapter.start({seconds:1.6});const first=join(root,'alpha.txt');const moved=join(root,'beta.txt');
  await writeFile(first,'CONTENT-CANARY-CH1');await new Promise((resolve)=>setTimeout(resolve,120));
  await writeFile(first,'CONTENT-CANARY-CH1-UPDATED');await new Promise((resolve)=>setTimeout(resolve,120));
  await rename(first,moved);await new Promise((resolve)=>setTimeout(resolve,120));await unlink(moved);await adapter.wait();
  const state=await ledger.status();const activity=await ledger.query({limit:100});const projected=JSON.stringify(activity);
  const raw=await Promise.all((await readdir(join(room,'state'))).map((name)=>readFile(join(room,'state',name),'utf8')));
  const result={schema:'t5.ch1.macos-fsevents-qualification.v1',ready,activityCount:state.eventCount,
    projectedCount:activity.length,kinds:[...new Set(activity.map((item)=>item.kind))].sort(),
    actorUnknownOnly:activity.every((item)=>item.actor==='unknown'),metadataOnly:activity.every((item)=>item.coverage==='metadata_only'),
    contentCanaryStored:raw.some((text)=>text.includes('CONTENT-CANARY-CH1')),
    contentCanaryProjected:projected.includes('CONTENT-CANARY-CH1'),rawRootProjected:projected.includes(root),
    cursorPresent:Boolean(state.cursor),journalGap:state.gap,storageBytes:state.storageBytes,errors,modelCalls:0,externalWrites:0};
  result.pass=ready.state==='running'&&activity.length>=2&&errors.length===0&&result.actorUnknownOnly&&result.metadataOnly
    &&!result.contentCanaryStored&&!result.contentCanaryProjected&&!result.rawRootProjected&&result.cursorPresent&&result.journalGap===null;
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);if(!result.pass)process.exitCode=1;
}finally{await rm(room,{recursive:true,force:true});}
