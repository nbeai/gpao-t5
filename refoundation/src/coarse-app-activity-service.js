import { CoarseAppActivityLedger } from './coarse-app-activity-ledger.js';

export function makeCoarseAppActivityService({ ledger, adapterFactory = null, onError = () => {} } = {}) {
  if (!(ledger instanceof CoarseAppActivityLedger)) throw new TypeError('coarse app activity ledger is required');
  let adapter = null; let running = false; let watch = null; let generation = 0;
  let queue = Promise.resolve(); let degradedReason = null;
  const serialize = (work) => {
    const next = queue.then(work, work); queue = next.catch(() => {}); return next;
  };
  const report = (error) => { try { onError(error); } catch {} };

  async function status() {
    const state = await ledger.status();
    const degraded = state.enabled && !state.privateMode && !running;
    return {
      available: Boolean(adapterFactory), ...state,
      enabled: state.enabled && running && !state.privateMode,
      desiredEnabled: state.enabled,
      degraded,
      degradedReason: degraded ? degradedReason ?? 'collector_not_running' : null,
      userSafeSummary: !state.configured ? '앱 활동 기록은 꺼져 있어요.'
        : state.privateMode ? 'private mode로 기록을 멈췄어요.'
          : state.enabled && running ? '허용한 앱의 사용 시간과 자리 비움만 기록하고 있어요.'
            : degraded ? '앱 활동 기록을 다시 시작하지 못했어요. 기록 설정은 그대로 보존했어요.'
              : '앱 활동 기록을 멈춰 두었어요.',
    };
  }

  async function stopRuntime() {
    generation += 1;
    const current = adapter; const currentWatch = watch;
    adapter = null; watch = null; running = false;
    if (current) await current.stop().catch(report);
    await currentWatch?.catch(() => {});
  }

  async function startRuntime() {
    if (!adapterFactory) {
      throw Object.assign(new Error('이 운영체제의 앱 활동 기록은 아직 준비되지 않았어요.'), { status: 503 });
    }
    const current = await adapterFactory();
    if (!current || ['start', 'stop', 'wait'].some((name) => typeof current[name] !== 'function')) {
      throw new TypeError('coarse app adapter is invalid');
    }
    const currentGeneration = ++generation; adapter = current;
    try {
      const started = await current.start({ seconds: 86_400, interval: 1, afkSeconds: 300 });
      if (started?.state !== 'running') throw new Error('coarse app collector did not start');
      running = true; degradedReason = null;
    } catch (error) {
      if (adapter === current) adapter = null;
      running = false; await current.stop().catch(report); throw error;
    }
    watch = Promise.resolve().then(() => current.wait()).then(async (result) => {
      if (adapter !== current || generation !== currentGeneration) return;
      adapter = null; running = false;
      const state = await ledger.status();
      if (result?.state === 'stopped' && state.enabled && !state.privateMode) {
        queueMicrotask(() => {
          serialize(async () => {
            if (generation !== currentGeneration || adapter) return;
            const latest = await ledger.status();
            if (!latest.enabled || latest.privateMode) return;
            try { await startRuntime(); } catch (error) {
              degradedReason = error?.code ?? error?.message ?? 'collector_restart_failed'; report(error);
            }
          }).catch(report);
        });
      } else {
        if (state.enabled && !state.privateMode) degradedReason = result?.reason ?? 'collector_failed';
        if (result?.state === 'failed') report(new Error('coarse_app_collector_failed'));
      }
    }).catch((error) => {
      degradedReason = error?.code ?? error?.message ?? 'collector_failed'; report(error);
    });
  }

  return Object.freeze({
    status,
    async configure(input = {}) {
      return serialize(async () => {
        await stopRuntime(); degradedReason = null;
        await ledger.configure({ ...input, recordedAt: input.recordedAt ?? new Date().toISOString() });
        return status();
      });
    },
    async enable() {
      return serialize(async () => {
        await ledger.setEnabled({ enabled: true, recordedAt: new Date().toISOString() });
        const state = await ledger.status(); if (state.privateMode) return status();
        try { await startRuntime(); } catch (error) {
          await ledger.setEnabled({ enabled: false, recordedAt: new Date().toISOString() });
          degradedReason = null; throw error;
        }
        return status();
      });
    },
    async pause() {
      return serialize(async () => {
        await stopRuntime(); degradedReason = null; const state = await ledger.status();
        if (state.configured) await ledger.setEnabled({ enabled: false, recordedAt: new Date().toISOString() });
        return status();
      });
    },
    async setPrivate({ privateMode } = {}) {
      return serialize(async () => {
        if (privateMode === true) await stopRuntime();
        await ledger.setPrivate({ privateMode: privateMode === true, recordedAt: new Date().toISOString() });
        const state = await ledger.status();
        if (privateMode !== true && state.enabled) await startRuntime();
        return status();
      });
    },
    async resumeConfigured() {
      return serialize(async () => {
        const state = await ledger.status(); if (!state.enabled || state.privateMode) return status();
        try { await startRuntime(); } catch (error) {
          degradedReason = error?.code ?? error?.message ?? 'collector_resume_failed'; throw error;
        }
        return status();
      });
    },
    async history({ limit } = {}) { return { items: await ledger.query({ limit }) }; },
    async export() {
      const items = await ledger.exportAll();
      return { schema: 't5.coarse-app-activity-export.v1', coverage: 'complete', itemCount: items.length, items };
    },
    async excludeApp({ appHandle } = {}) {
      return serialize(async () => {
        const prior = await ledger.status(); await stopRuntime();
        const result = await ledger.excludeObservedApp({ appHandle, recordedAt: new Date().toISOString() });
        if (prior.enabled && !prior.privateMode) {
          await ledger.setEnabled({ enabled: true, recordedAt: new Date().toISOString() }); await startRuntime();
        }
        return { ...result, status: await status() };
      });
    },
    async includeAll() {
      return serialize(async () => {
        const prior = await ledger.status(); await stopRuntime();
        const result = await ledger.includeAll({ recordedAt: new Date().toISOString() });
        if (prior.enabled && !prior.privateMode) {
          await ledger.setEnabled({ enabled: true, recordedAt: new Date().toISOString() }); await startRuntime();
        }
        return { ...result, status: await status() };
      });
    },
    async forget() {
      return serialize(async () => {
        await stopRuntime(); degradedReason = null;
        return ledger.forgetAll({ recordedAt: new Date().toISOString() });
      });
    },
    async close() { await serialize(stopRuntime); },
  });
}
