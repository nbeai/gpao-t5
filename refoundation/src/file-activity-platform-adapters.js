import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { normalizeMacOSFSEvent, normalizeWindowsUSNRecord,
  ScopedFileActivityLedger } from './scoped-file-activity-ledger.js';

function makeLineAdapter({ platform, source, helper, ledger, normalize, onError = () => {} } = {}) {
  if (process.platform !== platform) throw new Error(`${platform} file activity adapter is unavailable`);
  if (!helper || !(ledger instanceof ScopedFileActivityLedger)) throw new TypeError('helper and ledger are required');
  let child = null; let task = null; let stopping = false; let currentJournal = null;
  return Object.freeze({
    async start({ seconds = 3600 } = {}) {
      if (child) return { state: 'running' }; const state = await ledger.status();
      if (!state.enabled || state.platform !== platform) return { state: 'disabled' };
      const args = state.roots.flatMap((root) => ['--root', root]); if (state.cursor) args.push('--since', state.cursor);
      args.push('--seconds', String(seconds)); child = spawn(helper, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const current = child; const lines = createInterface({ input: current.stdout });
      let resolveReady; let rejectReady; const ready = new Promise((resolve, reject) => { resolveReady=resolve;rejectReady=reject; });
      task = (async()=>{try{for await(const line of lines){const item=JSON.parse(line);
        if(item.kind==='error')throw new Error(item.error??'file_activity_helper_error');
        if(item.kind==='ready'){currentJournal=item.journal;const baseline=await ledger.ingest({source,journal:currentJournal,cursor:item.cursor,events:[],recordedAt:item.occurredAt});
          if(baseline.state==='rescan_required')throw new Error('file_activity_rescan_required');resolveReady({state:'running',cursor:item.cursor});continue;}
        const normalized=normalize(item);if(!normalized)continue;
        if(normalized.gap){await ledger.markGap({source,journal:currentJournal,cursor:normalized.cursor,reason:normalized.reason,
          recordedAt:item.occurredAt??new Date().toISOString()});continue;}
        await ledger.ingest({source,journal:currentJournal,cursor:String(item.eventId??item.usn),events:[normalized],recordedAt:item.occurredAt});
      }const code=await new Promise((resolve)=>current.once('close',resolve));if(code!==0&&!stopping)throw new Error(`file activity helper exited ${code}`);
      }catch(error){rejectReady(error);onError(error);}finally{if(child===current)child=null;}})();return ready;},
    async stop(){if(!child)return{state:'stopped'};stopping=true;child.kill('SIGTERM');await task;stopping=false;return{state:'stopped'};},
    async wait(){await task;return{state:'stopped'};}
  });
}

export function makeMacOSFSEventsAdapter(options = {}) {
  return makeLineAdapter({ ...options, platform: 'darwin', source: 'macos_fsevents', normalize: normalizeMacOSFSEvent });
}
export function makeWindowsUSNAdapter(options = {}) {
  return makeLineAdapter({ ...options, platform: 'win32', source: 'windows_usn', normalize: normalizeWindowsUSNRecord });
}
