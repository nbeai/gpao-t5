const MODES = new Set(['O0_off', 'O1_clock_only', 'O2_full_shadow']);
const PHASES = new Set([
  'state_read_replay', 'context_compilation', 'provider_wait_combined_unknown',
  'model_generation_combined_unknown', 'tool_execution', 'verification',
  'surface_publication',
]);

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeClock(nowNs, diagnostics) {
  try {
    const value = nowNs();
    if (typeof value !== 'bigint' || value < 0n) throw new TypeError('invalid monotonic clock');
    return value;
  } catch {
    diagnostics.clockFailures += 1;
    return null;
  }
}

function boundedFacts(facts = {}) {
  return {
    attempt: safeInteger(facts.attempt),
    bytesIn: safeInteger(facts.bytesIn),
    bytesOut: safeInteger(facts.bytesOut),
    itemCount: safeInteger(facts.itemCount),
  };
}

export function makeS3aPerformanceObserver({
  mode = 'O0_off', nowNs = () => process.hrtime.bigint(), maxSpans = 128,
} = {}) {
  if (!MODES.has(mode)) throw new TypeError('invalid S3-A observer mode');
  if (!Number.isSafeInteger(maxSpans) || maxSpans < 1 || maxSpans > 4096) {
    throw new TypeError('maxSpans must be between 1 and 4096');
  }
  const spans = [];
  const diagnostics = { clockFailures: 0, droppedSpans: 0, writerFailures: 0 };
  let sequence = 0;

  async function measure(phase, operation, facts = {}) {
    if (!PHASES.has(phase)) throw new TypeError('invalid S3-A phase');
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    if (mode === 'O0_off') return operation();
    const startedNs = safeClock(nowNs, diagnostics);
    let status = 'succeeded';
    try {
      return await operation();
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      const endedNs = safeClock(nowNs, diagnostics);
      if (mode === 'O2_full_shadow') {
        if (spans.length >= maxSpans) diagnostics.droppedSpans += 1;
        else {
          sequence += 1;
          spans.push({
            schema: 't5.s3a.performance-span.v1', sequence, phase, status,
            monotonicStartNs: startedNs?.toString() ?? null,
            monotonicEndNs: endedNs?.toString() ?? null,
            durationNs: startedNs != null && endedNs != null && endedNs >= startedNs
              ? (endedNs - startedNs).toString() : null,
            ...boundedFacts(facts),
          });
        }
      }
    }
  }

  function snapshot() {
    return structuredClone({ mode, spans, diagnostics });
  }

  async function flush(writer) {
    if (mode !== 'O2_full_shadow') return { state: 'not_applicable', bytes: 0 };
    if (typeof writer !== 'function') return { state: 'not_configured', bytes: 0 };
    const payload = JSON.stringify(snapshot());
    try {
      await writer(payload);
      return { state: 'written', bytes: Buffer.byteLength(payload, 'utf8') };
    } catch {
      diagnostics.writerFailures += 1;
      return { state: 'degraded', bytes: 0 };
    }
  }

  return { mode, measure, snapshot, flush };
}
