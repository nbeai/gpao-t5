import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';

import { makeS3aPerformanceObserver } from '../test/helpers/s3a-performance-observer.js';

const MODES = ['O0_off', 'O1_clock_only', 'O2_full_shadow'];
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function one(mode) {
  const observer = makeS3aPerformanceObserver({ mode });
  const product = { request: digest({ user: 'fixture', tools: ['observe'] }), calls: [], effect: null, surface: null };
  for (const phase of [
    'state_read_replay', 'context_compilation', 'provider_wait_combined_unknown',
    'tool_execution', 'verification', 'model_generation_combined_unknown', 'surface_publication',
  ]) {
    await observer.measure(phase, async () => {
      if (phase === 'tool_execution') product.calls.push('observe');
      if (phase === 'verification') product.effect = 'verified';
      if (phase === 'surface_publication') product.surface = 'three files';
    }, { itemCount: 1, bytesIn: 32, bytesOut: 16, attempt: 1 });
  }
  return { observer, productDigest: digest(product) };
}

const room = await mkdtemp(join(tmpdir(), 't5-s3a-observer-'));
const sidecar = join(room, 'shadow.jsonl');
const samples = Object.fromEntries(MODES.map((mode) => [mode, []]));
const cpuSamples = Object.fromEntries(MODES.map((mode) => [mode, []]));
const rssDeltaSamples = Object.fromEntries(MODES.map((mode) => [mode, []]));
const digests = new Set();
let traceBytes = 0;
let flushNs = 0n;
const eventLoop = monitorEventLoopDelay({ resolution: 1 });
eventLoop.enable();
try {
  for (let block = 0; block < 5; block += 1) {
    const order = [...MODES.slice(block % MODES.length), ...MODES.slice(0, block % MODES.length)];
    for (const mode of order) {
      const cpuStarted = process.cpuUsage();
      const rssStarted = process.memoryUsage().rss;
      const started = process.hrtime.bigint();
      let last;
      for (let iteration = 0; iteration < 250; iteration += 1) last = await one(mode);
      const ended = process.hrtime.bigint();
      samples[mode].push(Number(ended - started) / 250 / 1e3);
      const cpu = process.cpuUsage(cpuStarted);
      cpuSamples[mode].push((cpu.user + cpu.system) / 250);
      rssDeltaSamples[mode].push(Math.max(0, process.memoryUsage().rss - rssStarted));
      digests.add(last.productDigest);
      if (mode === 'O2_full_shadow') {
        const flushStarted = process.hrtime.bigint();
        const result = await last.observer.flush(async (payload) => appendFile(sidecar, `${payload}\n`));
        flushNs += process.hrtime.bigint() - flushStarted;
        traceBytes += result.bytes;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  eventLoop.disable();
  const writtenBytes = (await readFile(sidecar)).byteLength;
  const mediansUs = Object.fromEntries(MODES.map((mode) => [mode, median(samples[mode])]));
  const baseline = mediansUs.O0_off;
  const result = {
    schema: 't5.s3a.observer-countertest-result.v1',
    blocks: 5,
    deterministicJourneysPerModePerBlock: 250,
    productDigestCount: digests.size,
    foregroundMedianMicrosecondsPerJourney: mediansUs,
    foregroundDeltaMicroseconds: {
      O1_clock_only: mediansUs.O1_clock_only - baseline,
      O2_full_shadow: mediansUs.O2_full_shadow - baseline,
    },
    cpuMedianMicrosecondsPerJourney: Object.fromEntries(
      MODES.map((mode) => [mode, median(cpuSamples[mode])]),
    ),
    maxBlockRssDeltaBytes: Object.fromEntries(
      MODES.map((mode) => [mode, Math.max(...rssDeltaSamples[mode])]),
    ),
    eventLoopDelayMilliseconds: {
      mean: Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1e6 : null,
      max: Number.isFinite(eventLoop.max) ? eventLoop.max / 1e6 : null,
    },
    postProductFlushMilliseconds: Number(flushNs) / 1e6,
    tracePayloadBytes: traceBytes,
    actualSidecarBytes: writtenBytes,
    blockingWritesBeforeProductTerminal: 0,
    pass: digests.size === 1 && writtenBytes > 0,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  eventLoop.disable();
  await rm(room, { recursive: true, force: true });
}
