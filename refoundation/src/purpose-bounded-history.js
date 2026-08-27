import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');const clone=(value)=>structuredClone(value);
function text(value,label,max=300){const output=String(value??'').trim();if(!output||output.length>max||/[\u0000-\u001f\u007f]/u.test(output))
  throw new TypeError(`${label} is invalid`);return output;}
function safeLabel(value,fallback){let output=String(value??'').trim().slice(0,160);if(output.includes('/')||output.includes('\\'))output=basename(output.replaceAll('\\','/'));
  if(!output||/[0-9a-f]{32,}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}|\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}/iu.test(output))return fallback;
  return output.replace(/[\u0000-\u001f\u007f]/gu,' ');}
function tokens(query){return[...new Set(query.normalize('NFKC').toLocaleLowerCase('ko-KR').split(/[^\p{L}\p{N}]+/u).filter((item)=>item.length>=2))];}
function matches(candidate,terms){if(!terms.length)return true;const haystack=candidate.normalize('NFKC').toLocaleLowerCase('ko-KR');return terms.some((term)=>haystack.includes(term));}
function timeBucket(value,now){const time=Date.parse(value??'');if(!Number.isFinite(time))return'시점 확인 필요';const age=now-time;
  return age<86_400_000?'오늘':age<7*86_400_000?'최근 7일':age<31*86_400_000?'최근 한 달':'이전 기록';}
function exactMethods(value,names,label){if(!value||names.some((name)=>typeof value[name]!=='function'))throw new TypeError(`${label} adapter is incomplete`);return value;}

export function makePurposeBoundedHistoryAdapter({workHistory,fileActivityService,appActivityService,now=()=>Date.now()}={}){
  exactMethods(workHistory,['list','detail'],'work history');exactMethods(fileActivityService,['history'],'file activity');exactMethods(appActivityService,['history'],'app activity');
  const windows=new Map();const trim=()=>{const current=now();for(const[key,value]of windows)if(value.expiresAt<current)windows.delete(key);
    while(windows.size>32)windows.delete(windows.keys().next().value);};
  async function sourceRows(query){const [work,file,app]=await Promise.all([workHistory.list({query,status:null,cursor:null,limit:20}),
    fileActivityService.history({limit:100}),appActivityService.history({limit:100})]);const rows=[];
    for(const item of work.items??[])rows.push({kind:'work',sourceHandle:item.historyHandle,label:safeLabel(item.title,'과거 작업'),
      searchText:[item.title,item.statusText,item.actorText].join(' '),occurredAt:item.occurredAt??null,facts:{status:item.statusText??'상태 확인 필요',remaining:item.counts?.remaining??0}});
    for(const item of file.items??[])rows.push({kind:'file',sourceHandle:item.activityHandle,label:safeLabel(item.pathText,'과거 파일'),
      searchText:[item.pathText,item.kind].join(' '),occurredAt:item.occurredAt??null,facts:{change:item.kind,availability:item.availability}});
    for(const item of app.items??[])rows.push({kind:'app',sourceHandle:item.activityHandle,label:safeLabel(item.appLabel,'과거 앱'),
      searchText:[item.appLabel,item.activity].join(' '),occurredAt:item.startedAt??null,facts:{activity:item.activity,durationSeconds:Math.max(0,Math.round((item.durationMs??0)/1000))}});
    return rows;}
  return Object.freeze({async search({query,limit=8}={}){trim();const purpose=text(query,'history purpose',200);if(!Number.isSafeInteger(limit)||limit<1||limit>8)
      throw new TypeError('history candidate limit is invalid');const queryDigest=hash(['history-purpose',purpose]);const terms=tokens(purpose);const rows=(await sourceRows(purpose))
        .filter((item)=>matches(item.searchText,terms)).slice(0,limit);const queryHandle=hash(['history-query',randomUUID(),queryDigest]).slice(0,32);const candidates=rows.map((row)=>({
          handle:hash(['history-candidate',queryHandle,row.kind,row.sourceHandle]).slice(0,32),kind:row.kind,label:row.label,time:timeBucket(row.occurredAt,now()),facts:clone(row.facts)}));
      const entries=new Map(candidates.map((candidate,index)=>[candidate.handle,{...rows[index],candidate}]));const candidateDigest=hash(candidates);windows.set(queryHandle,{queryDigest,
        candidateDigest,candidateCount:candidates.length,entries,selected:null,expiresAt:now()+10*60_000});trim();return{schema:'t5.purpose-history-candidates.v1',queryHandle,
        candidateCount:candidates.length,candidateDigest,candidates:clone(candidates),rawHistorySent:false,modelCalls:0};},
    async select({queryHandle,handles}={}){trim();const window=windows.get(String(queryHandle));if(!window)throw new Error('history query window is unavailable');
      if(!Array.isArray(handles)||handles.length<1||handles.length>3||new Set(handles).size!==handles.length||handles.some((handle)=>!window.entries.has(handle)))
        throw new Error('history selection is invalid');window.selected=[...handles];return{schema:'t5.purpose-history-selection.v1',queryHandle,
        selectedHandles:[...handles],candidateDigest:window.candidateDigest,candidateCount:window.candidateCount,writes:0};},
    async reopen({queryHandle,handle}={}){trim();const window=windows.get(String(queryHandle));const entry=window?.entries.get(String(handle));
      if(!window||!entry||!window.selected?.includes(String(handle)))throw new Error('selected history handle is unavailable');let source;
      if(entry.kind==='work')source=await workHistory.detail(entry.sourceHandle);
      else{const list=entry.kind==='file'?await fileActivityService.history({limit:500}):await appActivityService.history({limit:500});
        const matches=(list.items??[]).filter((item)=>item.activityHandle===entry.sourceHandle);if(matches.length!==1)throw new Error('history source changed or missing');source=matches[0];}
      return{schema:'t5.purpose-history-reopen.v1',kind:entry.kind,label:entry.candidate.label,time:entry.candidate.time,source:clone(source),
        currentCorrectionPriority:true,writes:0,externalEffects:0};}});
}
