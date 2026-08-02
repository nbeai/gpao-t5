// L4 · P90-2 턴 계측 저장소. 사용자 원문 없이 엄격한 TurnTimingRecord만 bounded 지속한다.
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  assertBrowserTimingUpdate,
  assertTurnTimingRecord,
  mergeBrowserTiming,
  TURN_TIMING_SCHEMA_VERSION,
} from '../kernel/l0-evidence/turn-timing.js';

export const DEFAULT_TURN_TIMING_LIMIT = 500;

function defaultDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

function exactState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('turn timing 저장소는 객체여야 한다');
  for (const key of Object.keys(value)) {
    if (!['schemaVersion', 'records'].includes(key)) throw new Error(`turn timing 저장소.${key}: 허용되지 않은 필드`);
  }
  if (value.schemaVersion !== TURN_TIMING_SCHEMA_VERSION) throw new Error('지원하지 않는 turn timing 저장소 버전');
  if (!Array.isArray(value.records)) throw new Error('turn timing records는 배열이어야 한다');
  value.records.forEach(assertTurnTimingRecord);
  return value;
}

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export class TurnTimingStore {
  constructor(dir = defaultDir(), { limit = DEFAULT_TURN_TIMING_LIMIT, now = () => Date.now() } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('turn timing limit은 양의 정수여야 한다');
    if (typeof now !== 'function') throw new Error('turn timing store now가 필요하다');
    this.dir = dir;
    this.file = join(dir, 'turn-timings.json');
    this.limit = limit;
    this.now = now;
    this.queue = Promise.resolve();
  }

  _empty() {
    return { schemaVersion: TURN_TIMING_SCHEMA_VERSION, records: [] };
  }

  async _quarantine(reason) {
    const quarantinePath = `${this.file}.corrupt-${this.now()}`;
    try {
      await rename(this.file, quarantinePath);
      return { ...this._empty(), corrupted: true, corruptionReason: reason, quarantinePath, quarantined: true };
    } catch (error) {
      return {
        ...this._empty(), corrupted: true, corruptionReason: reason,
        quarantinePath, quarantined: false, quarantineError: error?.code ?? 'quarantine_failed',
      };
    }
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return this._empty();
      return { ...this._empty(), corrupted: true, corruptionReason: error?.code ?? 'read_failed', quarantined: false };
    }
    try {
      const state = exactState(JSON.parse(raw));
      return { ...state, records: state.records.slice(-this.limit) };
    } catch (error) {
      return this._quarantine(error?.message ?? 'parse_failed');
    }
  }

  append(record) {
    assertTurnTimingRecord(record);
    const run = this.queue.catch(() => {}).then(async () => {
      const state = await this.load();
      if (state.corrupted && !state.quarantined) {
        throw new Error(`turn timing 저장소 손상을 격리하지 못했다: ${state.corruptionReason}`);
      }
      const existing = state.records.find((entry) => entry.measurementId === record.measurementId);
      if (existing) {
        if (!isDeepStrictEqual(existing, record)) {
          throw new Error('같은 measurementId의 서버 확정 레코드는 불변이다 — 전체 덮어쓰기를 거부한다');
        }
        return { inserted: false, record: existing };
      }
      const records = [...state.records, record].slice(-this.limit);
      await mkdir(this.dir, { recursive: true });
      await atomicWrite(this.file, JSON.stringify({ schemaVersion: TURN_TIMING_SCHEMA_VERSION, records }));
      return { inserted: true, record };
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** 브라우저 표시 사건 하나만 merge한다. 서버·outcome·pathClass는 이 API로 바꿀 수 없다. */
  mergeBrowser(measurementId, update) {
    const run = this.queue.catch(() => {}).then(async () => {
      assertBrowserTimingUpdate(update);
      const state = await this.load();
      if (state.corrupted && !state.quarantined) {
        throw new Error(`turn timing 저장소 손상을 격리하지 못했다: ${state.corruptionReason}`);
      }
      const index = state.records.findIndex((entry) => entry.measurementId === measurementId);
      if (index < 0) throw new Error('브라우저 timing이 결합할 measurementId를 찾지 못했다');
      const merged = mergeBrowserTiming(state.records[index], update);
      if (!merged.updated) return merged;
      const records = state.records.slice();
      records[index] = merged.record;
      await mkdir(this.dir, { recursive: true });
      await atomicWrite(this.file, JSON.stringify({ schemaVersion: TURN_TIMING_SCHEMA_VERSION, records }));
      return merged;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
