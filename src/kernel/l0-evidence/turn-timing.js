// L0 · P90-2 턴 성능 사실. 원문·답변·도구 인자를 저장하지 않고 시간·종류·결합 신분만 남긴다.
import { performance } from 'node:perf_hooks';

export const TURN_TIMING_SCHEMA_VERSION = 1;
export const MAX_TURN_TIMING_MS = 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVER_EVENTS = Object.freeze([
  'input_received',
  'stream_connected',
  'queue_entered',
  'queue_started',
  'first_feedback_emitted',
  'first_answer_emitted',
  'server_committed',
  'complete_emitted',
]);
const BROWSER_EVENTS = Object.freeze([
  'first_feedback_visible',
  'first_grounded_content',
  'turn_complete',
]);
const WAIT_KINDS = Object.freeze(['model', 'tool', 'network', 'service']);
const SURFACES = new Set(['web', 'api', 'channel', 'automation']);
const PATH_CLASSES = new Set(['unknown', 'chat', 'local', 'web', 'agent', 'mixed']);
const WARMTH = new Set(['unknown', 'cold', 'warm', 'first_turn', 'continued']);
const OUTCOMES = new Set(['pending', 'reply', 'approval', 'blocked', 'error']);
const VISIBILITY = new Set(['visible', 'hidden', 'prerender']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (!plainObject(value)) throw new Error(`${label}은 객체여야 한다`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}.${key}: 허용되지 않은 필드`);
  }
}

function finiteMs(value, label, { nullable = true } = {}) {
  if (value === null && nullable) return;
  if (!Number.isFinite(value) || value < 0 || value > MAX_TURN_TIMING_MS) {
    throw new Error(`${label}은 0 이상 ${MAX_TURN_TIMING_MS} 이하의 시간이어야 한다`);
  }
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

/** 브라우저가 보낼 수 있는 유일한 갱신 형태. 서버·outcome·path 필드는 애초에 받을 자리가 없다. */
export function assertBrowserTimingUpdate(update) {
  exactKeys(update, ['event', 'elapsedMs', 'visibilityState'], 'browserTimingUpdate');
  if (!BROWSER_EVENTS.includes(update.event)) throw new Error(`알 수 없는 브라우저 timing 사건: ${update.event}`);
  finiteMs(update.elapsedMs, `browserTimingUpdate.${update.event}`, { nullable: false });
  if (!VISIBILITY.has(update.visibilityState)) throw new Error(`알 수 없는 visibility: ${update.visibilityState}`);
  return update;
}

function assertOrdered(values, names, label) {
  let previous = -1;
  for (const name of names) {
    const value = values[name];
    if (value === null || value === undefined) continue;
    if (value < previous) throw new Error(`${label} 사건 시간이 단조 증가하지 않는다: ${name}`);
    previous = value;
  }
}

function unionDuration(intervals) {
  if (!intervals.length) return 0;
  const sorted = intervals.map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
  let [start, end] = sorted[0];
  let total = 0;
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else { total += end - start; start = nextStart; end = nextEnd; }
  }
  return rounded(total + end - start);
}

/** 저장 가능한 계측 기록인지 엄격히 검사한다. 알 수 없는 필드는 버리지 않고 거부한다. */
export function assertTurnTimingRecord(record) {
  exactKeys(record, [
    'schemaVersion', 'measurementId', 'turnRef', 'surface', 'pathClass',
    'processWarmth', 'sessionWarmth', 'outcome', 'server', 'browser', 'externalWait',
  ], 'turnTiming');
  if (record.schemaVersion !== TURN_TIMING_SCHEMA_VERSION) throw new Error('지원하지 않는 turn timing schemaVersion');
  if (!UUID.test(record.measurementId ?? '')) throw new Error('measurementId는 UUID여야 한다');

  exactKeys(record.turnRef, ['sessionId', 'turnSeq'], 'turnTiming.turnRef');
  if (!UUID.test(record.turnRef.sessionId ?? '')) throw new Error('turnRef.sessionId는 UUID여야 한다');
  if (!Number.isInteger(record.turnRef.turnSeq) || record.turnRef.turnSeq < 0) throw new Error('turnRef.turnSeq는 음이 아닌 정수여야 한다');
  if (!SURFACES.has(record.surface)) throw new Error('알 수 없는 surface');
  if (!PATH_CLASSES.has(record.pathClass)) throw new Error('알 수 없는 pathClass');
  if (!WARMTH.has(record.processWarmth) || !WARMTH.has(record.sessionWarmth)) throw new Error('알 수 없는 warmth');
  if (!OUTCOMES.has(record.outcome)) throw new Error('알 수 없는 outcome');

  exactKeys(record.server, [...SERVER_EVENTS, 't5_overhead'], 'turnTiming.server');
  for (const key of [...SERVER_EVENTS, 't5_overhead']) finiteMs(record.server[key], `turnTiming.server.${key}`);
  if (record.server.input_received !== 0) throw new Error('input_received는 서버 단조 시계의 0 원점이어야 한다');
  assertOrdered(record.server, SERVER_EVENTS, 'server');

  exactKeys(record.browser, [...BROWSER_EVENTS, 'source', 'visibility'], 'turnTiming.browser');
  if (record.browser.source !== 'browser_report') throw new Error('browser source는 browser_report여야 한다');
  for (const key of BROWSER_EVENTS) finiteMs(record.browser[key], `turnTiming.browser.${key}`);
  exactKeys(record.browser.visibility, BROWSER_EVENTS, 'turnTiming.browser.visibility');
  for (const key of BROWSER_EVENTS) {
    const value = record.browser.visibility[key];
    if (value !== null && !VISIBILITY.has(value)) throw new Error(`알 수 없는 visibility: ${value}`);
  }
  assertOrdered(record.browser, BROWSER_EVENTS, 'browser');

  exactKeys(record.externalWait, ['unionMs', 'counts'], 'turnTiming.externalWait');
  finiteMs(record.externalWait.unionMs, 'turnTiming.externalWait.unionMs', { nullable: false });
  exactKeys(record.externalWait.counts, WAIT_KINDS, 'turnTiming.externalWait.counts');
  for (const kind of WAIT_KINDS) {
    if (!Number.isInteger(record.externalWait.counts[kind]) || record.externalWait.counts[kind] < 0) {
      throw new Error(`externalWait.counts.${kind}는 음이 아닌 정수여야 한다`);
    }
  }
  if (record.server.server_committed !== null
      && record.externalWait.unionMs > record.server.server_committed) {
    throw new Error('external wait는 server_committed보다 길 수 없다');
  }
  return record;
}

/** 같은 measurement의 브라우저 사건 하나만 채운다. 이미 찬 슬롯과 서버 확정값은 불변이다. */
export function mergeBrowserTiming(record, update) {
  assertTurnTimingRecord(record);
  assertBrowserTimingUpdate(update);
  if (record.browser[update.event] !== null) return { updated: false, record };
  const next = {
    ...record,
    browser: {
      ...record.browser,
      [update.event]: rounded(update.elapsedMs),
      visibility: {
        ...record.browser.visibility,
        [update.event]: update.visibilityState,
      },
    },
  };
  return { updated: true, record: assertTurnTimingRecord(next) };
}

/**
 * 한 턴 안에서만 사는 단조 계측기. 저장본에는 span 원시 구간도, 모델/도구 입력도 남기지 않는다.
 */
export class TurnTiming {
  constructor({ measurementId, turnRef, surface = 'web', origin, clock = () => performance.now() }) {
    if (typeof clock !== 'function') throw new Error('performance.now 계열 clock이 필요하다');
    this.clock = clock;
    this.measurementId = measurementId;
    this.turnRef = turnRef;
    this.surface = surface;
    this.server = Object.fromEntries(SERVER_EVENTS.map((name) => [name, null]));
    this.browser = Object.fromEntries(BROWSER_EVENTS.map((name) => [name, null]));
    this.browserVisibility = Object.fromEntries(BROWSER_EVENTS.map((name) => [name, null]));
    this.intervals = [];
    this.openIntervals = new Set();
    this.counts = Object.fromEntries(WAIT_KINDS.map((kind) => [kind, 0]));
    const sampled = Number(this.clock());
    if (!Number.isFinite(sampled) || sampled < 0) throw new Error('단조 시계 값은 음수가 아닌 유한값이어야 한다');
    const selectedOrigin = origin === undefined ? sampled : Number(origin);
    if (!Number.isFinite(selectedOrigin) || selectedOrigin < 0) throw new Error('단조 시계 origin은 0 이상의 유한값이어야 한다');
    if (sampled < selectedOrigin) throw new Error('단조 시계 현재값이 origin보다 뒤로 갔다');
    this.origin = selectedOrigin;
    this.lastClock = sampled;
    this.server.input_received = 0;
  }

  _offset() {
    const current = this._sampleClock();
    return this._offsetFromAbsolute(current);
  }

  _sampleClock() {
    const current = Number(this.clock());
    if (!Number.isFinite(current) || current < 0) throw new Error('단조 시계 값은 음수가 아닌 유한값이어야 한다');
    if (current < this.lastClock) throw new Error('단조 시계가 뒤로 갔다');
    this.lastClock = current;
    return current;
  }

  _offsetFromAbsolute(absoluteMonotonic) {
    if (!Number.isFinite(absoluteMonotonic)) throw new Error('절대 단조 시각은 유한값이어야 한다');
    if (absoluteMonotonic < this.origin) throw new Error('절대 단조 시각은 origin보다 이를 수 없다');
    const offset = rounded(absoluteMonotonic - this.origin);
    finiteMs(offset, 'turn timing offset', { nullable: false });
    return offset;
  }

  markServer(name) {
    if (!SERVER_EVENTS.includes(name)) throw new Error(`알 수 없는 서버 timing 사건: ${name}`);
    if (name === 'input_received') return 0;
    if (this.server[name] !== null) return this.server[name];
    const current = this._sampleClock();
    return this._markServerAt(name, current, current);
  }

  markServerAt(name, absoluteMonotonic) {
    if (!SERVER_EVENTS.includes(name)) throw new Error(`알 수 없는 서버 timing 사건: ${name}`);
    if (name === 'input_received') return 0;
    if (this.server[name] !== null) return this.server[name];
    const sampled = this._sampleClock();
    return this._markServerAt(name, Number(absoluteMonotonic), sampled);
  }

  _markServerAt(name, absoluteMonotonic, sampled) {
    if (!Number.isFinite(absoluteMonotonic)) throw new Error('절대 단조 시각은 유한값이어야 한다');
    if (absoluteMonotonic > sampled) throw new Error('절대 단조 시각은 현재 sampled 시각보다 늦을 수 없다');
    const offset = this._offsetFromAbsolute(absoluteMonotonic);
    const index = SERVER_EVENTS.indexOf(name);
    for (let i = 0; i < index; i += 1) {
      const previous = this.server[SERVER_EVENTS[i]];
      if (previous !== null && previous > offset) throw new Error(`서버 사건 순서가 단조 증가하지 않는다: ${name}`);
    }
    for (let i = index + 1; i < SERVER_EVENTS.length; i += 1) {
      const next = this.server[SERVER_EVENTS[i]];
      if (next !== null && next < offset) throw new Error(`서버 사건 순서가 단조 증가하지 않는다: ${name}`);
    }
    this.server[name] = offset;
    return offset;
  }

  reportBrowser(name, elapsedMs, visibilityState) {
    if (!BROWSER_EVENTS.includes(name)) throw new Error(`알 수 없는 브라우저 timing 사건: ${name}`);
    if (!VISIBILITY.has(visibilityState)) throw new Error(`알 수 없는 visibility: ${visibilityState}`);
    finiteMs(elapsedMs, `browser.${name}`, { nullable: false });
    if (this.browser[name] !== null) return this.browser[name];
    this.browser[name] = rounded(elapsedMs);
    this.browserVisibility[name] = visibilityState;
    return this.browser[name];
  }

  beginExternalWait(kind) {
    if (!WAIT_KINDS.includes(kind)) throw new Error(`알 수 없는 외부 대기 종류: ${kind}`);
    const interval = { kind, start: this._offset(), end: null };
    this.openIntervals.add(interval);
    this.counts[kind] += 1;
    return {
      end: () => {
        if (interval.end !== null) return rounded(interval.end - interval.start);
        interval.end = this._offset();
        this.openIntervals.delete(interval);
        this.intervals.push(interval);
        return rounded(interval.end - interval.start);
      },
    };
  }

  finalize({ outcome = 'pending', pathClass = 'unknown', processWarmth = 'unknown', sessionWarmth = 'unknown' } = {}) {
    if (this.openIntervals.size) throw new Error('열린 외부 대기가 있어 timing을 닫을 수 없다');
    const unionMs = unionDuration(this.intervals);
    const committed = this.server.server_committed;
    if (unionMs > 0 && committed === null) throw new Error('external wait가 있으면 server_committed가 필요하다');
    if (committed !== null && this.intervals.some((interval) => interval.end > committed)) {
      throw new Error('external wait는 server_committed 뒤까지 이어질 수 없다');
    }
    if (committed !== null && unionMs > committed) throw new Error('external wait는 server_committed보다 길 수 없다');

    const record = {
      schemaVersion: TURN_TIMING_SCHEMA_VERSION,
      measurementId: this.measurementId,
      turnRef: this.turnRef,
      surface: this.surface,
      pathClass,
      processWarmth,
      sessionWarmth,
      outcome,
      server: {
        ...this.server,
        t5_overhead: committed === null ? null : rounded(committed - unionMs),
      },
      browser: {
        ...this.browser,
        source: 'browser_report',
        visibility: { ...this.browserVisibility },
      },
      externalWait: { unionMs, counts: { ...this.counts } },
    };
    return assertTurnTimingRecord(record);
  }
}
