import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

const STATE_SCHEMA='t5.coarse-app-activity-state.v1';const SEGMENT_SCHEMA='t5.coarse-app-activity-segment.v1';
const SOURCES=new Set(['macos_workspace','windows_foreground','fixture']);const AFK=new Set(['active','afk','unknown']);
const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const clone=(value)=>structuredClone(value);
function time(value){const text=String(value??'');const parsed=new Date(text);if(!text||!Number.isFinite(parsed.getTime())
  ||parsed.toISOString()!==text)throw new TypeError('canonical UTC time is required');return text;}
function text(value,label,max=300){const output=String(value??'');if(!output||output.length>max||/[\u0000-\u001f\u007f]/u.test(output))
  throw new TypeError(`${label} is invalid`);return output;}
function appIds(values,label){if(!Array.isArray(values)||values.length>128)throw new TypeError(`${label} is invalid`);
  const output=[...new Set(values.map((value)=>text(value,label,300)))].sort();if(output.length!==values.length)throw new TypeError(`${label} has duplicates`);return output;}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=`${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary,`${JSON.stringify(value)}\n`,{mode:0o600});await chmod(temporary,0o600);await rename(temporary,path);await chmod(path,0o600);}
async function appendLines(path,lines){if(!lines.length)return;const handle=await open(path,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY
  |(constants.O_NOFOLLOW??0),0o600);try{const before=await handle.stat();if(!before.isFile()||before.nlink!==1)throw new Error('app activity file is unsafe');
  await handle.write(`${lines.join('\n')}\n`);await handle.sync();const after=await handle.stat();const exact=await lstat(path);
  if(before.dev!==after.dev||before.ino!==after.ino||after.nlink!==1||exact.dev!==after.dev||exact.ino!==after.ino||exact.nlink!==1)
    throw new Error('app activity file identity changed');}finally{await handle.close();}await chmod(path,0o600);}
function allowedByPolicy(state,appId){return state.mode==='include_only'?state.includeApps.includes(appId):!state.excludeApps.includes(appId);}
function appHandle(appId){return hash(['app-policy',appId]).slice(0,32);}
function publicSegment(segment){return{activityHandle:hash(['app-segment',segment.segmentDigest]).slice(0,32),appHandle:appHandle(segment.appId),appLabel:segment.appLabel,
  startedAt:segment.startedAt,endedAt:segment.endedAt,durationMs:segment.durationMs,activity:segment.afk==='active'?'사용 중':segment.afk==='afk'?'자리 비움':'확인 필요',
  workBinding:'연결되지 않음',coverage:'foreground_app_only'};}

export class CoarseAppActivityLedger{
  constructor(directory){if(!directory||!isAbsolute(directory))throw new TypeError('absolute app activity directory is required');
    this.directory=directory;this.stateFile=join(directory,'state.json');this.queue=Promise.resolve();}
  serialize(work){const next=this.queue.then(work,work);this.queue=next.catch(()=>{});return next;}
  segmentFile(generation){return join(this.directory,`segments-${generation}.jsonl`);}
  async ensure(){await mkdir(this.directory,{recursive:true,mode:0o700});await chmod(this.directory,0o700);}
  async readState(){await this.ensure();try{const info=await lstat(this.stateFile);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)
    throw new Error('app activity state is unsafe');const value=JSON.parse(await readFile(this.stateFile,'utf8'));
    if(value.schema!==STATE_SCHEMA||!Number.isSafeInteger(value.generation)||value.generation<1)throw new Error('app activity state is invalid');return value;
  }catch(error){if(error?.code!=='ENOENT')throw error;return{schema:STATE_SCHEMA,generation:1,configured:false,enabled:false,privateMode:false,
    platform:null,mode:'all_except',includeApps:[],excludeApps:[],segmentCount:0,retention:'until_user_deletes',contentCapture:false,
    titleCapture:false,urlCapture:false,modelContextDefault:false};}}
  async readSegments(state=null){const current=state??await this.readState();try{const info=await lstat(this.segmentFile(current.generation));
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('app activity log is unsafe');const lines=(await readFile(this.segmentFile(current.generation),'utf8')).split('\n').filter(Boolean);
    return lines.map((line,index)=>{const segment=JSON.parse(line);if(segment.schema!==SEGMENT_SCHEMA||segment.sequence!==index+1)throw new Error('app activity sequence is invalid');
      const{schema:_s,sequence:_q,segmentDigest,...payload}=segment;if(segmentDigest!==hash(payload))throw new Error('app activity digest is invalid');return segment;});
  }catch(error){if(error?.code==='ENOENT')return[];throw error;}}
  async configure({platform=process.platform,mode='all_except',includeApps=[],excludeApps=[],recordedAt}={}){
    if(!['darwin','win32'].includes(platform)||!['all_except','include_only'].includes(mode))throw new TypeError('app activity policy is invalid');
    const include=appIds(includeApps,'include app');const exclude=appIds(excludeApps,'exclude app');if(include.some((id)=>exclude.includes(id)))
      throw new TypeError('include and exclude overlap');if(mode==='include_only'&&!include.length)throw new TypeError('include-only requires apps');
    return this.serialize(async()=>{const state=await this.readState();await rm(this.segmentFile(state.generation),{force:true});const next={...state,
      generation:state.generation+1,configured:true,enabled:false,privateMode:false,platform,mode,includeApps:include,excludeApps:exclude,
      segmentCount:0,configuredAt:time(recordedAt)};await atomicJson(this.stateFile,next);return this.status();});}
  async setEnabled({enabled,recordedAt}={}){return this.serialize(async()=>{const state=await this.readState();if(!state.configured)throw new Error('app activity is not configured');
    const next={...state,enabled:enabled===true,changedAt:time(recordedAt)};await atomicJson(this.stateFile,next);return this.status();});}
  async setPrivate({privateMode,recordedAt}={}){return this.serialize(async()=>{const state=await this.readState();if(!state.configured)throw new Error('app activity is not configured');
    const next={...state,privateMode:privateMode===true,privateChangedAt:time(recordedAt)};await atomicJson(this.stateFile,next);return this.status();});}
  async ingest({source,policyGeneration,segments,recordedAt}={}){if(!SOURCES.has(source)||!Number.isSafeInteger(policyGeneration)
    ||!Array.isArray(segments)||segments.length>2048)throw new TypeError('bounded app activity batch is required');return this.serialize(async()=>{
    const state=await this.readState();if(!state.enabled||state.privateMode)return{accepted:0,state:'paused'};if(policyGeneration!==state.generation)return{accepted:0,state:'stale_policy'};
    const existing=await this.readSegments(state);const seen=new Set(existing.map((item)=>item.segmentId));const accepted=[];
    for(const input of segments){const keys=new Set(['segmentId','appId','appLabel','startedAt','endedAt','durationMs','afk','workBinding']);
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some((key)=>!keys.has(key))||input.workBinding!==null)
        throw new Error('app activity segment fields are invalid');const appId=text(input.appId,'app id');if(!allowedByPolicy(state,appId))continue;
      const startedAt=time(input.startedAt);const endedAt=time(input.endedAt);const durationMs=Number(input.durationMs);
      if(Date.parse(endedAt)<Date.parse(startedAt)||!Number.isSafeInteger(durationMs)||durationMs<0||durationMs>86_400_000
        ||durationMs!==Date.parse(endedAt)-Date.parse(startedAt)||!AFK.has(input.afk))throw new Error('app activity duration is invalid');
      const payload={source,segmentId:text(input.segmentId,'segment id',500),appId,appLabel:text(input.appLabel,'app label'),startedAt,endedAt,durationMs,
        afk:input.afk,workBinding:null,coverage:'foreground_app_only'};if(!seen.has(payload.segmentId)){payload.segmentDigest=hash(payload);accepted.push(payload);seen.add(payload.segmentId);}}
    let sequence=existing.length;await appendLines(this.segmentFile(state.generation),accepted.map((segment)=>JSON.stringify({schema:SEGMENT_SCHEMA,
      sequence:++sequence,...segment})));const next={...state,segmentCount:existing.length+accepted.length,lastBatchAt:time(recordedAt)};
    await atomicJson(this.stateFile,next);return{accepted:accepted.length,state:accepted.length?'recorded':'duplicate'};});}
  async query({limit=100}={}){const state=await this.readState();const count=Math.min(500,Math.max(1,Number(limit)||100));
    return(await this.readSegments(state)).slice(-count).reverse().map(publicSegment);}
  async exportAll(){const state=await this.readState();return(await this.readSegments(state)).slice().reverse().map(publicSegment);}
  async excludeObservedApp({appHandle:requested,recordedAt}={}){if(!/^[a-f0-9]{32}$/u.test(requested??''))throw new TypeError('opaque app handle is required');
    return this.serialize(async()=>{const state=await this.readState();const segments=await this.readSegments(state);const matches=[...new Set(segments
      .filter((item)=>appHandle(item.appId)===requested).map((item)=>item.appId))];if(matches.length!==1)throw new Error('observed app handle is unavailable');
      await rm(this.segmentFile(state.generation),{force:true});const next={...state,generation:state.generation+1,enabled:false,privateMode:false,
        mode:'all_except',includeApps:[],excludeApps:[...new Set([...state.excludeApps,matches[0]])].sort(),segmentCount:0,configuredAt:time(recordedAt)};
      await atomicJson(this.stateFile,next);return{excluded:true,remainingSegments:0,enabled:false};});}
  async includeAll({recordedAt}={}){return this.serialize(async()=>{const state=await this.readState();await rm(this.segmentFile(state.generation),{force:true});
    const next={...state,generation:state.generation+1,enabled:false,privateMode:false,mode:'all_except',includeApps:[],excludeApps:[],segmentCount:0,
      configuredAt:time(recordedAt)};await atomicJson(this.stateFile,next);return{includedAll:true,remainingSegments:0,enabled:false};});}
  async status(){const state=await this.readState();const segments=await this.readSegments(state);let bytes=0;for(const path of[this.stateFile,this.segmentFile(state.generation)])
    try{bytes+=(await stat(path)).size;}catch(error){if(error?.code!=='ENOENT')throw error;}return{configured:state.configured,enabled:state.enabled,privateMode:state.privateMode,
      platform:state.platform,mode:state.mode,includeApps:clone(state.includeApps),excludeApps:clone(state.excludeApps),segmentCount:segments.length,storageBytes:bytes,
      retention:state.retention,contentCapture:false,titleCapture:false,urlCapture:false,modelContextDefault:false,generation:state.generation};}
  async forgetAll({recordedAt}={}){return this.serialize(async()=>{const state=await this.readState();const deletedSegments=(await this.readSegments(state)).length;
    await rm(this.segmentFile(state.generation),{force:true});const next={...state,generation:state.generation+1,enabled:false,privateMode:false,segmentCount:0,
      forgottenAt:time(recordedAt)};await atomicJson(this.stateFile,next);return{deletedSegments,remainingSegments:0,enabled:false};});}
}
