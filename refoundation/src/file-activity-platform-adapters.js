import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { normalizeMacOSFSEvent, normalizeWindowsUSNRecord,
  ScopedFileActivityLedger } from './scoped-file-activity-ledger.js';

function makeLineAdapter({ platform, source, helper, ledger, normalize, onError = () => {} } = {}) {
  if (process.platform !== platform) throw new Error(`${platform} file activity adapter is unavailable`);
  if (!helper || !(ledger instanceof ScopedFileActivityLedger)) throw new TypeError('helper and ledger are required');
  let child = null; let task = null; let stopping = false; let currentJournal = null; let terminalError = false;
  return Object.freeze({
    async start({ seconds = 3600 } = {}) {
      if (child) return { state: 'running' }; terminalError = false; const state = await ledger.status();
      if (!state.enabled || state.platform !== platform) return { state: 'disabled' };
      const args = state.roots.flatMap((root) => ['--root', root]); if (state.cursor) args.push('--since', state.cursor);
      args.push('--seconds', String(seconds)); child = spawn(helper, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const current = child; const exit = new Promise((resolve) => current.once('close', resolve));
      const lines = createInterface({ input: current.stdout });
      let resolveReady; let rejectReady; const ready = new Promise((resolve, reject) => { resolveReady=resolve;rejectReady=reject; });
      const pending=[];const inflight=new Set();let flushTimer=null;let pendingCursor=null;let pendingRecordedAt=null;let backgroundError=null;
      const flush=()=>{if(flushTimer){clearTimeout(flushTimer);flushTimer=null;}if(!pending.length)return Promise.resolve();
        const events=pending.splice(0);const cursor=pendingCursor;const recordedAt=pendingRecordedAt;const operation=ledger.ingest({
          source,journal:currentJournal,cursor,events,recordedAt});inflight.add(operation);
        operation.then(()=>inflight.delete(operation),()=>inflight.delete(operation));return operation;};
      const scheduleFlush=()=>{if(!flushTimer)flushTimer=setTimeout(()=>{flushTimer=null;flush().catch((error)=>{backgroundError??=error;});},100);};
      task = (async()=>{try{for await(const line of lines){const item=JSON.parse(line);
        if(backgroundError)throw backgroundError;
        if(item.kind==='error')throw new Error(item.error??'file_activity_helper_error');
        if(item.kind==='ready'){currentJournal=item.journal;const baseline=await ledger.ingest({source,journal:currentJournal,cursor:item.cursor,events:[],recordedAt:item.occurredAt});
          if(baseline.state==='rescan_required')throw new Error('file_activity_rescan_required');resolveReady({state:'running',cursor:item.cursor});continue;}
        const normalized=normalize(item);if(!normalized)continue;
        if(normalized.gap){await flush();await Promise.all([...inflight]);await ledger.markGap({source,journal:currentJournal,cursor:normalized.cursor,reason:normalized.reason,
          recordedAt:item.occurredAt??new Date().toISOString()});continue;}
        pending.push(normalized);pendingCursor=String(item.eventId??item.usn);pendingRecordedAt=item.occurredAt;scheduleFlush();
        if(pending.length>=128)await flush();
      }await flush();await Promise.all([...inflight]);if(backgroundError)throw backgroundError;const code=await exit;if(code!==0&&!stopping)throw new Error(`file activity helper exited ${code}`);
      }catch(error){terminalError=true;rejectReady(error);onError(error);}finally{if(flushTimer)clearTimeout(flushTimer);if(child===current)child=null;}})();return ready;},
    async stop(){if(!child)return{state:'stopped'};stopping=true;child.kill('SIGTERM');await task;stopping=false;return{state:'stopped'};},
    async wait(){await task;return{state:terminalError?'failed':'stopped'};}
  });
}

export function makeMacOSFSEventsAdapter(options = {}) {
  return makeLineAdapter({ ...options, platform: 'darwin', source: 'macos_fsevents', normalize: normalizeMacOSFSEvent });
}
export function makeWindowsUSNAdapter(options = {}) {
  return makeLineAdapter({ ...options, platform: 'win32', source: 'windows_usn', normalize: normalizeWindowsUSNRecord });
}
