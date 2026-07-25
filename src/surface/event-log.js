// L4 · EventLog (P6-12) — durable truth. 스트림이 끊겨도 여기 남은 것으로 lastEventId 재접속 복구한다.
// 세션별 파일. durable 이벤트만 남긴다(비지속 answer_delta/heartbeat은 연결 전용). eventId는 세션 단조 증가.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isDurable } from '../kernel/l0-evidence/turn-event.js';

function defaultDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}
const SAFE_ID = /^[a-f0-9-]{36}$/;

export class EventLog {
  constructor(dir = defaultDir()) {
    this.dir = dir;
  }

  _file(sessionId) {
    if (!SAFE_ID.test(sessionId)) throw new Error('bad sessionId'); // 경로 traversal 방지
    return join(this.dir, `events-${sessionId}.json`);
  }

  async _load(sessionId) {
    const file = this._file(sessionId); // 경로 검증은 try 밖 — 잘못된 id는 삼키지 않고 던진다.
    try {
      const a = JSON.parse(await readFile(file, 'utf8'));
      return { seq: a.seq ?? 0, events: a.events ?? [] };
    } catch {
      return { seq: 0, events: [] };
    }
  }

  async _save(sessionId, state) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this._file(sessionId), JSON.stringify(state), 'utf8');
  }

  /** 다음 eventId(세션 단조). 이벤트를 만들기 전에 부여받는다. */
  async nextEventId(sessionId) {
    const s = await this._load(sessionId);
    return s.seq + 1;
  }

  /** durable 이벤트를 남긴다(비지속은 무시). seq를 이벤트의 eventId까지 끌어올린다. */
  async append(sessionId, event) {
    const s = await this._load(sessionId);
    s.seq = Math.max(s.seq, event.eventId);
    if (isDurable(event.type)) s.events.push(event);
    await this._save(sessionId, s);
    return event;
  }

  /** lastEventId 이후의 durable 이벤트(재접속 복구). lastEventId 없으면 전체. */
  async since(sessionId, lastEventId = 0) {
    const s = await this._load(sessionId);
    return s.events.filter((e) => e.eventId > (Number(lastEventId) || 0));
  }

  /** 이 세션의 마지막 durable 이벤트가 종료(complete/blocked)인가 — 미종료면 UI가 "복구 중"을 표시한다. */
  async lastIsTerminal(sessionId) {
    const s = await this._load(sessionId);
    const last = s.events.at(-1);
    return last ? (last.type === 'complete' || last.type === 'blocked') : true;
  }
}
