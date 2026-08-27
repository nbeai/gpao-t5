import { ScopedFileActivityLedger } from './scoped-file-activity-ledger.js';

export function makeScopedFileActivityService({ ledger, adapterFactory = null, onError = () => {} } = {}) {
  if (!(ledger instanceof ScopedFileActivityLedger)) throw new TypeError('activity ledger is required');
  let adapter = null; let runtimeRunning = false; let stopping = false; let watchTask = null;
  let generation = 0; let queue = Promise.resolve();
  const serialize = (work) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };
  const reportError = (error) => { try { onError(error); } catch {} };
  async function status() {
    const state = await ledger.status(); return { available: Boolean(adapterFactory), ...state,
      enabled: state.enabled && runtimeRunning, desiredEnabled: state.enabled,
      userSafeSummary: !state.configured ? '파일 활동 기록은 꺼져 있어요.'
        : state.enabled && runtimeRunning ? '허용한 폴더의 metadata 변화만 기록하고 있어요.'
          : state.gap ? '파일 변화 기록에 빈 구간이 있어 다시 확인이 필요해요.' : '파일 활동 기록을 멈춰 두었어요.' };
  }
  async function stopRuntime() {
    stopping = true; generation += 1; const current = adapter; const currentWatch = watchTask;
    adapter = null; runtimeRunning = false; watchTask = null;
    if (current) await current.stop().catch(reportError); await currentWatch?.catch(() => {}); stopping = false;
  }
  async function startRuntime() {
    if (!adapterFactory) throw Object.assign(new Error('이 운영체제의 파일 활동 기록은 아직 준비되지 않았어요.'), { status: 503 });
    const current = await adapterFactory();
    if (!current || ['start', 'stop', 'wait'].some((name) => typeof current[name] !== 'function')) {
      throw new TypeError('file activity adapter is invalid');
    }
    const currentGeneration = ++generation; adapter = current;
    try {
      const started = await current.start({ seconds: 86_400 });
      if (started?.state !== 'running') throw new Error('file activity collector did not start');
      if (adapter !== current || currentGeneration !== generation) throw new Error('file activity collector start became stale');
      runtimeRunning = true;
    } catch (error) {
      if (adapter === current) adapter = null; runtimeRunning = false;
      await current.stop().catch(reportError); throw error;
    }
    watchTask = Promise.resolve().then(() => current.wait()).then(async (result) => {
      if (adapter !== current || currentGeneration !== generation) return;
      adapter = null; runtimeRunning = false;
      if (!stopping) {
        const state = await ledger.status();
        if (state.enabled) await ledger.setEnabled({ enabled: false, recordedAt: new Date().toISOString() });
        if (result?.state === 'failed') reportError(new Error('file_activity_collector_failed'));
      }
    }).catch(async (error) => {
      if (adapter === current && currentGeneration === generation) {
        adapter = null; runtimeRunning = false;
        const state = await ledger.status().catch(() => null);
        if (state?.enabled) await ledger.setEnabled({ enabled: false, recordedAt: new Date().toISOString() }).catch(() => {});
      }
      if (!stopping) reportError(error);
    });
  }
  return Object.freeze({
    status,
    async configure({ roots, recordedAt = new Date().toISOString() } = {}) {
      return serialize(async () => { await stopRuntime(); await ledger.configure({ roots, platform: process.platform, recordedAt }); return status(); });
    },
    async enable({ recordedAt = new Date().toISOString() } = {}) {
      return serialize(async () => {
        await ledger.setEnabled({ enabled: true, recordedAt });
        try { await startRuntime(); } catch (error) {
          await ledger.setEnabled({ enabled: false, recordedAt: new Date().toISOString() }); throw error;
        }
        return status();
      });
    },
    async pause({ recordedAt = new Date().toISOString() } = {}) {
      return serialize(async () => { await stopRuntime(); const state = await ledger.status();
        if (state.configured) await ledger.setEnabled({ enabled: false, recordedAt }); return status(); });
    },
    async resumeConfigured() {
      return serialize(async () => { const state = await ledger.status(); if (!state.enabled) return status();
        try { await startRuntime(); } catch (error) {
          await ledger.setEnabled({ enabled: false, recordedAt: new Date().toISOString() }); throw error;
        }
        return status(); });
    },
    async history({ limit } = {}) { return { items: await ledger.query({ limit }) }; },
    async forget({ recordedAt = new Date().toISOString() } = {}) {
      return serialize(async () => { await stopRuntime(); return ledger.forgetAll({ recordedAt }); });
    },
    async close() { await serialize(stopRuntime); },
  });
}
