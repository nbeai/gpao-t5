// L4 · 세션 저장소 — 파일 기반 지속성. 의존성 0(node 내장만).
// 세션 = 자기 완결 대화 컨텍스트: transcript + 자기 원장(ledgerEntries). env/model/tools는 프로세스
// 공유이므로 세션에 담지 않는다 — P6 Project/Profile 격리가 그 위를 감싸는 seam(계약 정합).
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** 세션 데이터 기본 경로 — 소스 트리 밖(환경헌장). env로 override(테스트는 temp dir). */
export function defaultSessionDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

// 클라이언트가 준 id로 파일 경로를 만들기 전에 검증한다(경로 탈출 방지 — 보안).
const SAFE_ID = /^[a-f0-9-]{36}$/;

export class SessionStore {
  /** @param {string} [dir] */
  constructor(dir = defaultSessionDir()) {
    this.dir = dir;
  }

  async _ensure() {
    await mkdir(this.dir, { recursive: true });
  }

  _path(id) {
    if (!SAFE_ID.test(id)) throw new Error('invalid session id');
    return join(this.dir, `${id}.json`);
  }

  /** 새 세션 생성. @param {string} [title] */
  async create(title = '새 대화') {
    await this._ensure();
    const now = Date.now();
    // pendingApprovals: 승인 대기 계획을 세션에 지속(재시작 후 이어실행·만료 판정 가능).
    const session = { id: randomUUID(), title, createdAt: now, updatedAt: now, transcript: [], ledgerEntries: [], pendingApprovals: {} };
    await writeFile(this._path(session.id), JSON.stringify(session), 'utf8');
    return session;
  }

  /** 전체 세션 로드. @returns {Promise<object|null>} */
  async load(id) {
    try {
      return JSON.parse(await readFile(this._path(id), 'utf8'));
    } catch {
      return null;
    }
  }

  /** 세션 저장(updatedAt 갱신). */
  async save(session) {
    session.updatedAt = Date.now();
    await writeFile(this._path(session.id), JSON.stringify(session), 'utf8');
    return session;
  }

  /** 사이드바용 목록(최근 수정순). 실제 세션만 — 가짜 없음. */
  async list() {
    await this._ensure();
    // UUID 세션 파일만 읽는다 — memory.json 등 다른 저장물이 세션 목록에 섞이지 않게(감사 보정).
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && SAFE_ID.test(f.slice(0, -5)));
    const out = [];
    for (const f of files) {
      try {
        const s = JSON.parse(await readFile(join(this.dir, f), 'utf8'));
        out.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, createdAt: s.createdAt });
      } catch {
        // 손상 파일은 목록에서 조용히 제외(전체 목록을 막지 않는다).
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
