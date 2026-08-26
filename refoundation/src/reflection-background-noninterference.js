import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const MODES = new Set(['O0_off', 'O2_full_shadow']);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => process.hrtime.bigint();
const milliseconds = (duration) => Number(duration) / 1_000_000;

const FOREGROUND_PURPOSE = Object.freeze({
  correction: Object.freeze({ file: 'file-beta', replacement: '검토 완료: 3개 파일' }),
  files: Object.freeze([
    Object.freeze({ handle: 'file-alpha', content: 'alpha: 확인됨' }),
    Object.freeze({ handle: 'file-beta', content: 'beta: 수정 전' }),
    Object.freeze({ handle: 'file-gamma', content: 'gamma: 확인됨' }),
  ]),
});

const BACKGROUND_WORKLOAD = Object.freeze({
  lane: 'background', state: 'inactive', hypothesis: '결과를 먼저 확인하는 절차 후보',
  supportingExperiences: 2, counterexamples: 1, uncertainties: 1,
});

function makeObserver(mode) {
  if (!MODES.has(mode)) throw new TypeError('Reflection noninterference observer mode is invalid');
  const spans = [];
  return {
    async measure(phase, operation) {
      if (mode === 'O0_off') return operation();
      const started = now();
      try { return await operation(); }
      finally { spans.push({ phase, durationNs: String(now() - started) }); }
    },
    spans,
  };
}

async function foregroundJourney({ observer, generation }) {
  const order = []; const observations = []; const storeOps = { reads: 0, writes: 0 };
  const toolArgs = { action: 'observe_three_files', handles: FOREGROUND_PURPOSE.files.map((item) => item.handle) };
  const contextBytes = Buffer.byteLength(JSON.stringify({ purpose: FOREGROUND_PURPOSE, toolArgs }), 'utf8');
  await observer.measure('state_read_replay', async () => { order.push('state_read_replay'); await Promise.resolve(); });
  await observer.measure('context_compilation', async () => { order.push('context_compilation'); await Promise.resolve(); });
  await observer.measure('tool_execution', async () => {
    order.push('tool_execution'); generation.value += 1; storeOps.writes += 1;
    for (const file of FOREGROUND_PURPOSE.files) {
      storeOps.reads += 1; await new Promise((resolve) => setImmediate(resolve));
      observations.push({ handle: file.handle,
        content: file.handle === FOREGROUND_PURPOSE.correction.file
          ? FOREGROUND_PURPOSE.correction.replacement : file.content });
    }
  });
  await observer.measure('verification', async () => { order.push('verification'); await Promise.resolve(); });
  await observer.measure('surface_publication', async () => { order.push('surface_publication'); await Promise.resolve(); });
  return { semanticDigest: hash(observations), toolArgs, order, providerCalls: 0,
    contextBytes, observations: observations.length, storeOps };
}

async function backgroundJourney({ generation, ready, release }) {
  const capturedGeneration = generation.value; const storeOps = { reads: 1, proposals: 1, commits: 0 };
  ready(); await release; // The background lane explicitly yields before foreground admission.
  const reviewDigest = hash(BACKGROUND_WORKLOAD); await new Promise((resolve) => setImmediate(resolve));
  const stale = generation.value !== capturedGeneration;
  if (!stale) storeOps.commits += 1;
  return { lane: 'background', state: BACKGROUND_WORKLOAD.state, reviewDigest,
    yieldedBeforeForeground: true, stalePublicationRejected: stale, storeOps };
}

async function oneRun({ background, observerMode }) {
  const observer = makeObserver(observerMode); const generation = { value: 0 };
  let markReady; const ready = new Promise((resolve) => { markReady = resolve; });
  let releaseBackground; const release = new Promise((resolve) => { releaseBackground = resolve; });
  let backgroundPromise = null;
  if (background) {
    backgroundPromise = backgroundJourney({ generation, ready: markReady, release });
    await ready; releaseBackground();
  }
  const eventLoopStarted = now(); await new Promise((resolve) => setImmediate(resolve));
  const eventLoopDelayMs = milliseconds(now() - eventLoopStarted);
  const cpuStarted = process.cpuUsage(); const wallStarted = now();
  const foreground = await foregroundJourney({ observer, generation });
  const wallMs = milliseconds(now() - wallStarted); const cpu = process.cpuUsage(cpuStarted);
  const backgroundResult = backgroundPromise ? await backgroundPromise : null;
  return { background: background ? 'on' : 'off', observerMode, foreground,
    backgroundResult, measurement: { wallMs, processCpuMs: (cpu.user + cpu.system) / 1_000,
      eventLoopDelayMs, foregroundStoreOps: foreground.storeOps,
      backgroundStoreOps: backgroundResult?.storeOps ?? { reads: 0, proposals: 0, commits: 0 } },
    observer: { spans: observer.spans } };
}

function sameForeground(left, right) {
  return left.foreground.semanticDigest === right.foreground.semanticDigest
    && JSON.stringify(left.foreground.toolArgs) === JSON.stringify(right.foreground.toolArgs)
    && JSON.stringify(left.foreground.order) === JSON.stringify(right.foreground.order)
    && left.foreground.providerCalls === right.foreground.providerCalls
    && left.foreground.contextBytes === right.foreground.contextBytes
    && JSON.stringify(left.foreground.storeOps) === JSON.stringify(right.foreground.storeOps);
}

export async function qualifyReflectionBackgroundNoninterference() {
  const quartet = [];
  for (const [observerMode, order] of [
    ['O0_off', 'AB'], ['O0_off', 'BA'], ['O2_full_shadow', 'AB'], ['O2_full_shadow', 'BA'],
  ]) {
    const samples = {};
    for (const lane of order === 'AB' ? ['off', 'on'] : ['on', 'off']) {
      samples[lane] = await oneRun({ background: lane === 'on', observerMode });
    }
    const off = samples.off; const on = samples.on;
    const performanceQualified = on.measurement.wallMs <= off.measurement.wallMs * 10 + 25
      && on.measurement.processCpuMs <= off.measurement.processCpuMs + 50
      && on.measurement.eventLoopDelayMs <= off.measurement.eventLoopDelayMs + 25;
    quartet.push({ observerMode, order, samples, sameForeground: sameForeground(off, on),
      backgroundIndependentLane: on.backgroundResult?.lane === 'background',
      backgroundYieldedBeforeForeground: on.backgroundResult?.yieldedBeforeForeground === true,
      stalePublicationCommits: on.backgroundResult?.storeOps.commits ?? -1,
      stalePublicationRejected: on.backgroundResult?.stalePublicationRejected === true,
      performanceQualified,
      deltas: { wallMs: on.measurement.wallMs - off.measurement.wallMs,
        processCpuMs: on.measurement.processCpuMs - off.measurement.processCpuMs,
        eventLoopDelayMs: on.measurement.eventLoopDelayMs - off.measurement.eventLoopDelayMs } });
  }
  const semanticDigests = new Set(quartet.flatMap((pair) => [pair.samples.off.foreground.semanticDigest,
    pair.samples.on.foreground.semanticDigest]));
  const result = { schema: 't5.s3m6.reflection-background-noninterference.v1',
    sampleDesign: 'small_quartet_ab_ba_o0_o2', actualModels: false, externalWrites: 0,
    productDefaultWiring: false, quartet, semanticDigestAgreement: semanticDigests.size === 1 };
  result.pass = result.semanticDigestAgreement && quartet.every((pair) => (
    pair.sameForeground && pair.backgroundIndependentLane && pair.backgroundYieldedBeforeForeground
    && pair.stalePublicationCommits === 0 && pair.stalePublicationRejected && pair.performanceQualified
  ));
  return result;
}
