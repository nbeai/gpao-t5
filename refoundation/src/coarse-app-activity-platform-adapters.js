import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { CoarseAppActivityLedger } from './coarse-app-activity-ledger.js';

const ALLOWED=new Set(['kind','segmentId','appId','appLabel','startedAt','endedAt','durationMs','afk']);
export function normalizeCoarseAppSegment(input={}){if(!input||typeof input!=='object'||Array.isArray(input)
  ||Object.keys(input).some((key)=>!ALLOWED.has(key))||input.kind!=='segment')return null;
  return{segmentId:String(input.segmentId),appId:String(input.appId),appLabel:String(input.appLabel),startedAt:input.startedAt,
    endedAt:input.endedAt,durationMs:Number(input.durationMs),afk:input.afk,workBinding:null};}

function makeAdapter({platform,source,helper,ledger,onError=()=>{}}={}){if(process.platform!==platform)throw new Error(`${platform} coarse app adapter is unavailable`);
  if(!helper||!(ledger instanceof CoarseAppActivityLedger))throw new TypeError('helper and app activity ledger are required');let child=null,task=null,stopping=false,failed=false;
  return Object.freeze({async start({seconds=86400,interval=1,afkSeconds=300}={}){if(child)return{state:'running'};const state=await ledger.status();
    if(!state.enabled||state.privateMode||state.platform!==platform)return{state:'disabled'};failed=false;child=spawn(helper,['--seconds',String(seconds),'--interval',String(interval),
      '--afk-seconds',String(afkSeconds)],{stdio:['ignore','pipe','pipe']});const current=child;const exit=new Promise((resolve)=>current.once('close',resolve));
    const lines=createInterface({input:current.stdout});let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const batch=[];task=(async()=>{try{for await(const line of lines){const input=JSON.parse(line);if(input.kind==='ready'){readyResolve({state:'running'});continue;}
      const segment=normalizeCoarseAppSegment(input);if(!segment)throw new Error('coarse app helper emitted invalid fields');batch.push(segment);
      if(batch.length>=64){await ledger.ingest({source,policyGeneration:state.generation,segments:batch.splice(0),recordedAt:new Date().toISOString()});}}
      if(batch.length)await ledger.ingest({source,policyGeneration:state.generation,segments:batch.splice(0),recordedAt:new Date().toISOString()});
      const code=await exit;if(code!==0&&!stopping)throw new Error(`coarse app helper exited ${code}`);
    }catch(error){failed=true;readyReject(error);onError(error);}finally{if(child===current)child=null;}})();return ready;},
    async stop(){if(!child)return{state:'stopped'};stopping=true;child.kill('SIGTERM');await task;stopping=false;return{state:'stopped'};},
    async wait(){await task;return{state:failed?'failed':'stopped'};}});}

export function makeMacOSCoarseAppAdapter(options={}){return makeAdapter({...options,platform:'darwin',source:'macos_workspace'});}
export function makeWindowsCoarseAppAdapter(options={}){return makeAdapter({...options,platform:'win32',source:'windows_foreground'});}
