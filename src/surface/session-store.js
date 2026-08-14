// L4 · 세션 저장소 — 파일 기반 지속성. 의존성 0(node 내장만).
// 세션 = 자기 완결 대화 컨텍스트: transcript + 자기 원장(ledgerEntries). env/model/tools는 프로세스
// 공유이므로 세션에 담지 않는다 — P6 Project/Profile 격리가 그 위를 감싸는 seam(계약 정합).
import { readdir, readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** 세션 데이터 기본 경로 — 소스 트리 밖(환경헌장). env로 override(테스트는 temp dir). */
export function defaultSessionDir() {
  return process.env.GPAO_T5_DATA_DIR ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions');
}

// 클라이언트가 준 id로 파일 경로를 만들기 전에 검증한다(경로 탈출 방지 — 보안).
const SAFE_ID = /^[a-f0-9-]{36}$/;
const saveQueues = new Map();

function serializeSession(path, task) {
  const previous = saveQueues.get(path) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  saveQueues.set(path, current);
  return current.finally(() => {
    if (saveQueues.get(path) === current) saveQueues.delete(path);
  });
}

function durableSession(session) {
  // SessionStore 의 기존 직렬화와 같은 JSON 정의역을 먼저 만든다. pending plan 안에는
  // 실행 중에만 쓰는 함수가 있을 수 있어 structuredClone 정의역은 더 좁다.
  const durable = JSON.parse(JSON.stringify(session));
  const terminalResumeArgs = (args) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
    const { probeResult, ...resumeArgs } = args;
    return resumeArgs;
  };
  // terminal probe 와 실패 원문은 같은 턴의 모델 관측이지 세션 기억은 아니다. 승인으로 턴이
  // 쪼개지면 같은 객체가 intent·sendArgs·이미 한 걸음 세 자리에 봉인되므로, 디스크 투영에서
  // 그 terminal 자리들을 함께 걷는다. command·cwd·changes·granted 는 재시작 뒤 사용자가
  // 승인한 바로 그 호출을 실행하는 봉인이므로 그대로 둔다.
  for (const pending of Object.values(durable.pendingApprovals ?? {})) {
    if (pending?.sendArgs?.['local.terminal']) {
      pending.sendArgs['local.terminal'] = terminalResumeArgs(pending.sendArgs['local.terminal']);
    }
    if (pending?.intent?.toolArgs?.['local.terminal']) {
      pending.intent.toolArgs['local.terminal'] = terminalResumeArgs(
        pending.intent.toolArgs['local.terminal'],
      );
    }
    if (pending?.intent?.terminalOp) {
      pending.intent.terminalOp = terminalResumeArgs(pending.intent.terminalOp);
    }
    if (Array.isArray(pending?.이미한걸음)) {
      pending.이미한걸음 = pending.이미한걸음.map((step) => {
        if (step?.actualCall?.tool !== 'local.terminal' || (step.failureState ?? 'none') === 'none') {
          return step;
        }
        const { result, ...durableFailure } = step;
        return durableFailure;
      });
    }
  }
  return durable;
}

// P2-4a 목록 정리성. 제목은 사용자 입력이므로 손질한다 — 제어문자·줄바꿈이 목록을 깨뜨린다.
export const MAX_TITLE = 60;
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

/**
 * 조각 C · 차수를 붙인 제목. `n<=1` 이면 원본 그대로 — **안 겹치는데 번호를 붙이지 않는다.**
 * 상한 60자를 넘으면 앞을 줄여서라도 **번호를 살린다**(번호가 잘리면 구별이 죽는다).
 */
function 차수제목(base, n) {
  if (n <= 1) return base;
  const 꼬리 = ` (${n})`;
  const 남는자리 = Math.max(1, MAX_TITLE - 꼬리.length);
  return base.length + 꼬리.length <= MAX_TITLE ? base + 꼬리 : `${base.slice(0, 남는자리)}${꼬리}`;
}

/**
 * 조각 C · **목록에서 같은 제목이 나란히 뜨지 않게** 한다.
 *
 * 왜 발화에서 뽑거나 모델에게 짓게 하지 않는가 — 오너 실물 실측(2026-08-12)이 기각했다.
 * 안 지운 세션 95개 중 81개가 제목이 바이트 단위로 같은 12묶음에 있는데, 그 12묶음 **전부
 * 첫 발화 전문이 1종**이다(30자 절단 탓이 아니라 입력이 정말로 같다). 결정적 함수든 모델이든
 * **같은 입력에서 갈릴 근거가 없다** — 왕복만 늘고 구별은 0이다.
 * 실제로 갈리는 축은 "그 대화가 몇 번째인가" 하나뿐이라 차수를 붙인다. 왕복 0 · 모델 0.
 *
 * @param {string} raw 첫 발화에서 뽑은 제목 후보
 * @param {string[]} used 이미 쓰이는 제목들(숨긴 것·지운 것 포함 — 되살리면 다시 겹친다)
 */
export function distinctTitle(raw, used = []) {
  const base = sanitizeTitle(raw);
  const 이미쓴다 = new Set((used ?? []).map((t) => String(t ?? '')));
  if (!이미쓴다.has(base)) return base;
  // **첫 빈자리가 아니라 가장 큰 차수 다음**을 준다. 가운데를 지운 자리에 번호를 다시 쓰면
  // 휴지통에서 되살리는 순간 또 겹친다(지금 고치는 그 병이 되돌아온다).
  let 최대 = 1;
  for (const t of 이미쓴다) {
    const m = /^(.*) \((\d+)\)$/.exec(t);
    if (!m) continue;
    const n = Number(m[2]);
    // 사람이 제목에 손으로 넣은 "(3)" 을 차수로 오해하지 않는다 — 우리가 지을 문자열과
    // **정확히 같을 때만** 우리 차수로 센다.
    if (n > 최대 && 차수제목(base, n) === t) 최대 = n;
  }
  return 차수제목(base, 최대 + 1);
}

/** 목록 정렬: 고정 먼저 → 각 묶음 안에서 최근순. */
export function sortSessions(list) {
  return list.sort((a, b) => (Boolean(b.pinned) - Boolean(a.pinned)) || (b.updatedAt - a.updatedAt));
}

/**
 * 세션 파일을 **원자적으로** 쓴다. 제자리 writeFile 은 원자적이지 않다 — 큰 세션은 여러 번에
 * 나눠 쓰이고, 그 틈에 읽으면 잘린 JSON 이 보인다(실측: 400회 읽기 중 79회). 그 순간 크래시하면
 * 대화가 통째로 못 읽는 상태로 남는다.
 * 임시 파일에 다 쓴 뒤 rename 한다 — rename 은 같은 파일시스템 안에서 원자적이다.
 * 임시 이름은 `.json.tmp-*` 라 목록·검색의 `.json` + SAFE_ID 필터에 걸리지 않는다(유령 대화 방지).
 */
async function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {}); // 실패한 임시본을 남기지 않는다
    throw e;
  }
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

  /**
   * 새 세션 생성.
   * @param {string} [title]
   * @param {{origin?:{channel:string, chatId?:string}}} [meta] 어디서 시작된 대화인가(메신저 등)
   */
  async create(title = DEFAULT_TITLE, meta = {}) {
    await this._ensure();
    const now = Date.now();
    // pendingApprovals: 승인 대기 계획을 세션에 지속(재시작 후 이어실행·만료 판정 가능).
    const session = {
      id: randomUUID(), title, createdAt: now, updatedAt: now,
      transcript: [], ledgerEntries: [], pendingApprovals: {},
      // P2-4a 목록 메타. 대화 내용·모델·승인·기억에 영향을 주지 않는 순수 목록 정보다.
      manualTitle: false, pinned: false, archivedAt: null, deletedAt: null, groupId: null,
      // 어디서 시작된 대화인가 — 메신저에서 온 대화는 목록에서 구분되어야 한다(오너 지적).
      origin: meta.origin ?? null,
      // S3 · 누구의 작업인가(§4.7). 승계는 이 신분이 같을 때만 공급된다. payload 가 주장하는
      // 값이 아니라 **생성 시점에 서버가 정한 값**만 남는다(위조 무효).
      principalRef: meta.principalRef ?? null,
    };
    await writeAtomic(this._path(session.id), JSON.stringify(session));
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
    const path = this._path(session.id);
    return serializeSession(path, async () => {
      let current = null;
      try { current = JSON.parse(await readFile(path, 'utf8')); } catch {}
      const durableDeliveries = (current?.transcript ?? []).filter(
        (entry) => entry?.source === 'automation' && typeof entry.deliveryRef === 'string',
      );
      const durableByRef = new Map(durableDeliveries.map((entry) => [entry.deliveryRef, entry]));
      session.transcript = (session.transcript ?? []).map((entry) => (
        durableByRef.has(entry?.deliveryRef) ? structuredClone(durableByRef.get(entry.deliveryRef)) : entry
      ));
      const known = new Set(session.transcript.map((entry) => entry?.deliveryRef).filter(Boolean));
      session.transcript.push(...durableDeliveries
        .filter((entry) => !known.has(entry.deliveryRef)).map((entry) => structuredClone(entry)));
      session.updatedAt = Date.now();
      await writeAtomic(path, JSON.stringify(durableSession(session)));
      return session;
    });
  }

  async appendAutomationDelivery(id, entry, expected = {}) {
    const path = this._path(id);
    return serializeSession(path, async () => {
      let session;
      try { session = JSON.parse(await readFile(path, 'utf8')); } catch { return { ok: false, reason: 'session_missing' }; }
      if (session.deletedAt || session.archivedAt
        || session.principalRef !== expected.principalRef
        || session.createdAt !== expected.conversationCreatedAt) {
        return { ok: false, reason: 'delivery_target_changed' };
      }
      const matches = (session.transcript ?? []).filter((item) => item?.deliveryRef === entry.deliveryRef);
      if (matches.length > 1) return { ok: false, reason: 'delivery_duplicate' };
      if (matches.length === 1) return JSON.stringify(matches[0]) === JSON.stringify(entry)
        ? { ok: true, appended: false, entry: matches[0] }
        : { ok: false, reason: 'delivery_identity_mismatch' };
      session.transcript = [...(session.transcript ?? []), structuredClone(entry)];
      session.updatedAt = Date.now();
      await writeAtomic(path, JSON.stringify(session));
      const readback = JSON.parse(await readFile(path, 'utf8'));
      const exact = readback.transcript.filter((item) => item?.deliveryRef === entry.deliveryRef);
      return exact.length === 1 && JSON.stringify(exact[0]) === JSON.stringify(entry)
        ? { ok: true, appended: true, entry: exact[0] }
        : { ok: false, reason: 'delivery_readback_mismatch' };
    });
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
   * 조각 C · **이미 저장된 겹침을 한 번 푼다.** 앞으로 만드는 대화만 갈라 놓으면 오너가
   * 지금 열어 보는 목록은 그대로다 — 밟은 그 자리(반대시험 ①)가 안 고쳐진다.
   * 실측 2026-08-12: 오너 실물 95개 중 69개가 겹쳐 있었다.
   *
   * 규율 셋:
   *  · **사람이 붙인 이름(`manualTitle`)은 한 글자도 안 건드린다.** 그 이름을 **먼저 전부
   *    잡아 두고** 자동 제목을 그 밖에서 고른다 — 사람이 고른 이름이 언제나 이긴다
   *  · 자동 제목끼리는 **먼저 만든 대화가 원래 제목을 갖는다**(생성순)
   *  · **`updatedAt` 을 안 건드린다** — 손대면 목록 순서가 통째로 뒤집힌다(고치려다 더 헷갈린다)
   * 두 번 돌려도 결과가 같다(겹침이 없어지면 아무것도 안 쓴다).
   * @returns {Promise<number>} 이름이 바뀐 대화 수
   */
  async repairDuplicateTitles() {
    await this._ensure();
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && SAFE_ID.test(f.slice(0, -5)));
    const rows = [];
    for (const f of files) {
      try { rows.push({ f, s: JSON.parse(await readFile(join(this.dir, f), 'utf8')) }); } catch { /* 손상 제외 */ }
    }
    rows.sort((a, b) => (a.s.createdAt ?? 0) - (b.s.createdAt ?? 0));
    // 사람이 붙인 이름을 **먼저 전부** 잡는다. 자동 제목은 그 밖에서만 고른다.
    const 쓰는중 = rows.filter(({ s }) => s.manualTitle).map(({ s }) => s.title || DEFAULT_TITLE);
    let 고친수 = 0;
    for (const { f, s } of rows) {
      if (s.manualTitle) continue;
      const 지금제목 = s.title || DEFAULT_TITLE;
      const 새제목 = distinctTitle(지금제목, 쓰는중);
      쓰는중.push(새제목);
      if (새제목 === 지금제목) continue;
      const path = join(this.dir, f);
      // eslint-disable-next-line no-await-in-loop
      await serializeSession(path, async () => {
        // 다시 읽는다 — 세는 동안 누가 이름을 바꿨으면 그 사람이 이긴다.
        let 지금 = null;
        try { 지금 = JSON.parse(await readFile(path, 'utf8')); } catch { return; }
        if (지금.manualTitle || (지금.title || DEFAULT_TITLE) !== 지금제목) return;
        지금.title = 새제목; // updatedAt 은 그대로 둔다
        await writeAtomic(path, JSON.stringify(지금));
        고친수 += 1;
      }).catch(() => {}); // 한 파일이 안 써져도 나머지는 고친다
    }
    return 고친수;
  }

  /**
   * 조각 C · 지금 쓰이고 있는 제목 전부. **숨긴 것·지운 것도 센다** — 보관함에서 꺼내거나
   * 휴지통에서 되살리면 그 제목이 목록으로 돌아오기 때문이다.
   * 제목만 필요하므로 목록 메타를 만들지 않는다.
   * @returns {Promise<string[]>}
   */
  async usedTitles() {
    await this._ensure();
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json') && SAFE_ID.test(f.slice(0, -5)));
    const out = [];
    for (const f of files) {
      try {
        const s = JSON.parse(await readFile(join(this.dir, f), 'utf8'));
        out.push(s.title || DEFAULT_TITLE);
      } catch { /* 손상 파일은 건너뛴다 — 제목 짓기가 목록 조회보다 엄격할 이유가 없다 */ }
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
          origin: s.origin ?? null,
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
