// L4 · 세션 저장소 — 파일 기반 지속성. 의존성 0(node 내장만).
// 세션 = 자기 완결 대화 컨텍스트: transcript + 자기 원장(ledgerEntries). env/model/tools는 프로세스
// 공유이므로 세션에 담지 않는다 — P6 Project/Profile 격리가 그 위를 감싸는 seam(계약 정합).
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** 세션 데이터 기본 경로 — 소스 트리 밖(환경헌장). env로 override(테스트는 temp dir). */
export function defaultSessionDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

// 클라이언트가 준 id로 파일 경로를 만들기 전에 검증한다(경로 탈출 방지 — 보안).
const SAFE_ID = /^[a-f0-9-]{36}$/;

// P2-4a 목록 정리성. 제목은 사용자 입력이므로 손질한다 — 제어문자·줄바꿈이 목록을 깨뜨린다.
const MAX_TITLE = 60;
export const DEFAULT_TITLE = '새 대화';
// 지운 대화는 바로 없애지 않는다(복구 가능). 다만 **영원히 두지도 않는다** — 그러면 "지웠는데
// 디스크는 안 준다"가 된다(§18). 파일 손발의 휴지통 상한과 같은 원리.
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30일

/** 사용자가 준 제목을 목록에 안전한 한 줄로. 빈 제목은 "새 대화"로 보인다. */
export function sanitizeTitle(raw) {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return DEFAULT_TITLE;
  return cleaned.length > MAX_TITLE ? cleaned.slice(0, MAX_TITLE) : cleaned;
}

/** 목록 정렬: 고정 먼저 → 각 묶음 안에서 최근순. */
export function sortSessions(list) {
  return list.sort((a, b) => (Boolean(b.pinned) - Boolean(a.pinned)) || (b.updatedAt - a.updatedAt));
}

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
    const session = {
      id: randomUUID(), title, createdAt: now, updatedAt: now,
      transcript: [], ledgerEntries: [], pendingApprovals: {},
      // P2-4a 목록 메타. 대화 내용·모델·승인·기억에 영향을 주지 않는 순수 목록 정보다.
      manualTitle: false, pinned: false, archivedAt: null, deletedAt: null, groupId: null,
    };
    await writeFile(this._path(session.id), JSON.stringify(session), 'utf8');
    return session;
  }

  /**
   * 세션 로드. **지운 대화는 없는 것처럼 굴린다** — 목록에서만 빼면 주소로 다시 들어온다.
   * 아카이브는 숨김일 뿐이라 그대로 열린다.
   * @param {string} id
   * @param {{includeDeleted?:boolean}} [opts] 복구·정리 경로만 true(내부용)
   * @returns {Promise<object|null>}
   */
  async load(id, opts = {}) {
    try {
      const s = JSON.parse(await readFile(this._path(id), 'utf8'));
      if (s?.deletedAt && !opts.includeDeleted) return null;
      return s;
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

  /** 전체 세션(transcript 포함) 로드 — 세션 검색(P6-17)용. 손상 파일은 조용히 제외. */
  async loadAll() {
    await this._ensure();
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && SAFE_ID.test(f.slice(0, -5)));
    const out = [];
    for (const f of files) {
      try { out.push(JSON.parse(await readFile(join(this.dir, f), 'utf8'))); } catch { /* 손상 제외 */ }
    }
    return out;
  }

  /**
   * 사이드바용 목록. 기본은 **지운 것·숨긴 것을 뺀** 목록이고, 고정이 먼저 온다.
   * @param {{archived?:boolean, deleted?:boolean}} [opts] 별도 보기(복원 화면)에서만 true
   */
  async list(opts = {}) {
    await this._ensure();
    // UUID 세션 파일만 읽는다 — memory.json 등 다른 저장물이 세션 목록에 섞이지 않게(감사 보정).
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && SAFE_ID.test(f.slice(0, -5)));
    const out = [];
    for (const f of files) {
      try {
        const s = JSON.parse(await readFile(join(this.dir, f), 'utf8'));
        if (s.deletedAt && !opts.deleted) continue;
        if (!s.deletedAt && opts.deleted) continue;      // 휴지통 보기는 지운 것만
        if (s.archivedAt && !opts.archived && !opts.deleted) continue;
        if (!s.archivedAt && opts.archived) continue;    // 보관함 보기는 숨긴 것만
        out.push({
          id: s.id, title: s.title || DEFAULT_TITLE, updatedAt: s.updatedAt, createdAt: s.createdAt,
          pinned: Boolean(s.pinned), archivedAt: s.archivedAt ?? null, deletedAt: s.deletedAt ?? null,
          groupId: s.groupId ?? null,
          // 정리 메뉴가 "빈 대화"를 고르려면 대화가 비었는지 알아야 한다(내용은 싣지 않는다).
          turns: (s.transcript ?? []).length,
        });
      } catch {
        // 손상 파일은 목록에서 조용히 제외(전체 목록을 막지 않는다).
      }
    }
    return sortSessions(out);
  }

  /**
   * 목록 메타만 바꾼다(제목·고정·그룹). 대화 내용·원장·승인은 건드리지 않는다.
   * @param {string} id
   * @param {{title?:string, pinned?:boolean, groupId?:string|null}} patch
   */
  async updateMeta(id, patch = {}) {
    const s = await this.load(id);
    if (!s) return null;
    if (patch.title !== undefined) {
      s.title = sanitizeTitle(patch.title);
      // 사용자가 직접 붙인 이름은 첫 발화 자동 제목이 덮어쓰지 않는다.
      s.manualTitle = true;
    }
    if (patch.pinned !== undefined) s.pinned = Boolean(patch.pinned);
    if (patch.groupId !== undefined) s.groupId = patch.groupId ?? null;
    return this.save(s);
  }

  /** 숨기기/되돌리기. 삭제가 아니라 목록에서 빼는 것이다("정리"의 기본 동작). */
  async setArchived(id, archived) {
    const s = await this.load(id);
    if (!s) return null;
    s.archivedAt = archived ? Date.now() : null;
    return this.save(s);
  }

  /** 지우기 — 파일을 바로 없애지 않고 표시만 한다(복구 가능). */
  async softDelete(id) {
    const s = await this.load(id);
    if (!s) return null;
    s.deletedAt = Date.now();
    return this.save(s);
  }

  /** 휴지통에서 되살리기. */
  async restore(id) {
    const s = await this.load(id, { includeDeleted: true });
    if (!s) return null;
    s.deletedAt = null;
    return this.save(s);
  }

  /**
   * 보관 기한이 지난 휴지통을 실제로 비운다. 부팅·목록 조회처럼 값싼 시점에 부른다.
   * @returns {Promise<number>} 지운 개수
   */
  async purgeExpired(now = Date.now(), retentionMs = TRASH_RETENTION_MS) {
    await this._ensure();
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && SAFE_ID.test(f.slice(0, -5)));
    let purged = 0;
    for (const f of files) {
      try {
        const s = JSON.parse(await readFile(join(this.dir, f), 'utf8'));
        if (s?.deletedAt && now - s.deletedAt > retentionMs) {
          await rm(join(this.dir, f));
          purged += 1;
        }
      } catch { /* 손상 파일은 건너뛴다 */ }
    }
    return purged;
  }
}
