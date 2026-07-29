// L1 · 데이터면 — **게시된 원리 스냅샷**(결정문 §10). 사용자 턴이 T-cell 에서 보는 유일한 것.
//
// 왜 이 층이 생겼나(실측 2026-07-30): 예전엔 사용자 턴이 `buildAdmissionSnapshot()` 을 `await` 했다.
// 그 함수는 registry 파일을 열어 전수 검증하고, 관찰 참조를 조회하고, 확인 원장과 권한 원장까지
// 읽었다. **모델 호출 앞에서**. 그리고 그 결과는 `principleTrace` 로만 나가고 답에는 들어가지도
// 않았다 — 이득 0, 대기만. 성장이 자랄수록 대화가 느려지는 구조였다.
//
// 이제 판정은 뒤에서 끝난다. 전경은 **서버 메모리에 게시된 한 벌**을 동기로 읽고, 없으면 없는 대로
// 간다. 대화는 절대 스냅샷을 기다리지 않는다.
//
// 계약(§10.1):
//   · `principles` 는 현재 scope 에 입장 가능한 M2/M3 최대 5개다. M1 은 여기 오지 않는다.
//   · A2/A3 권한·새 외부 대상·비밀 원문·사용자 원문·모델 자격은 싣지 않는다.
//   · 게시본은 동결되고 제자리 수정되지 않는다. 새 revision 은 **완성된 한 벌을 원자 교체**한다.

import { normalizeStatement } from './statement-text.js';
import { judgeRoleAuthority, rolesForStage, ROLE_ORDER } from './tcell-admission.js';

export const PRINCIPLE_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * 전경이 쓸 수 있는 역할 — 현재 요청보다 낮은 보조 역할만(§6 데이터면 4).
 * **순서는 손으로 적지 않고 `ROLE_ORDER` 에서 가져온다.** 손으로 적었더니 `default_value` 와
 * `plan_hint` 의 높낮이가 계약과 뒤바뀌어 "가장 높은 역할"이 실제로는 아니었다(실측 2026-07-30).
 * 같은 순서를 두 곳에 적으면 언젠가 갈라진다.
 */
const 전경역할 = new Set(['supporting_context', 'default_value', 'plan_hint']);
export const SNAPSHOT_ROLES = Object.freeze(ROLE_ORDER.filter((r) => 전경역할.has(r)));

/** 한 scope 에 실릴 수 있는 최대 개수. 이 상한은 성능이 아니라 **영향 상한**이다. */
export const SNAPSHOT_MAX = 5;

/**
 * scope 열쇠 — **자리를 모르면 열쇠가 없다(`null`)**.
 *
 * 예전 초안은 미상을 `project:unknown` 이라는 **공용 칸**으로 보냈다. 그러면 자리를 확정하지 못한
 * A 프로젝트의 턴이, 역시 자리를 확정하지 못한 B 프로젝트에서 자란 원리를 읽게 된다 — 범위 격리가
 * 이름만 남고 실제로는 섞인다. 미상은 칸을 공유할 근거가 아니라 **모른다는 사실**이다.
 * 그래서 미상이면 게시도 조회도 하지 않는다(§0-C-1: 모르면 null, 명세 §6: 범위 밖은 읽지 않는다).
 */
export function scopeKeyOf(scope = {}) {
  const project = typeof scope.project === 'string' && scope.project ? scope.project : null;
  return project ? `project:${project}` : null;
}

/** 미스·손상·불일치일 때 쓰는 **빈 한 벌**. 대화를 막지 않는다 — 도움이 0 일 뿐이다. */
export function emptySnapshot(scopeKey = 'project:unknown', reason = 'snapshot_miss') {
  return Object.freeze({
    schemaVersion: PRINCIPLE_SNAPSHOT_SCHEMA_VERSION,
    revision: 0,
    scopeKey,
    publishedAt: 0,
    sourceRegistryRevision: null,
    principles: Object.freeze([]),
    reason,
  });
}

/**
 * 서버 수명 동안 사는 게시 저장소. **파일이 아니다** — 전경이 동기로 읽어야 하기 때문이다.
 * 게시는 뒤에서만 일어나고, 읽기는 앞에서만 일어난다.
 */
export function makePrincipleSnapshotStore() {
  /** @type {Map<string, object>} scopeKey → 동결된 한 벌 */
  const 게시본 = new Map();
  return {
    /** 완성된 한 벌을 원자 교체한다. 부분 갱신은 없다. */
    publish(scopeKey, snapshot) {
      if (typeof scopeKey !== 'string' || !scopeKey) return null;   // 미상은 게시하지 않는다
      const s = snapshot ?? emptySnapshot(scopeKey, 'empty_publish');
      게시본.set(scopeKey, s);
      return s;
    },
    /** **동기 조회.** 여기서 await 가 생기면 데이터면 계약이 깨진다. */
    read(scopeKey) {
      if (typeof scopeKey !== 'string' || !scopeKey) return null;   // 미상은 조회하지 않는다
      return 게시본.get(scopeKey) ?? null;
    },
    revisionOf(scopeKey) {
      return 게시본.get(scopeKey)?.revision ?? 0;
    },
    /** rollback·pause·archive 가 그 scope 를 비울 때. */
    retire(scopeKey) {
      게시본.delete(scopeKey);
    },
    get size() { return 게시본.size; },
  };
}

/**
 * 이번 턴에 실제로 실을 것을 고른다 — **순수 함수, I/O 0**.
 *
 * 여기서 하는 일은 판정이 아니라 **충돌 제거**다. 성숙도·경계·권한 판정은 게시 시점에 끝났다.
 * 전경이 다시 판정하면 "같은 사실을 두 층이 따로 계산하면 덜 아는 쪽이 이긴다"가 된다.
 *
 * @param {object|null} snapshot 게시본
 * @param {{atoms?:Set<string>|string[], explicitStatements?:string[], max?:number}} turn
 * @returns {{principles:object[], trace:object}}
 */
export function selectPrinciples(snapshot, turn = {}) {
  // 열쇠는 **이번 턴이 실제로 가진 것**이다. 미상이면 null 이고, 그 null 이 곧 사실이다 —
  // 여기서 `project:unknown` 같은 이름을 만들어 채우면 미상이 공용 칸처럼 보인다.
  const scopeKey = turn.scopeKey ?? snapshot?.scopeKey ?? null;
  if (!snapshot || snapshot.schemaVersion !== PRINCIPLE_SNAPSHOT_SCHEMA_VERSION) {
    return { principles: [], trace: { scopeKey, revision: 0, admitted: [], skipped: [], reason: snapshot ? 'schema_mismatch' : 'snapshot_miss' } };
  }
  const atoms = turn.atoms instanceof Set ? turn.atoms : new Set(turn.atoms ?? []);
  // 사용자가 **지금** 밝힌 말은 과거에 배운 원리보다 언제나 위다(§3·§12 금지 4항).
  //
  // 판정 근거는 **정규식이 이번 발화를 '운영 원리'로 분류했는가**가 아니다. 그러면 분류에
  // 실패한 발화에서 과거 원리가 그대로 살아남는다 — 말귀를 정규식에 맡기는 그 병이다.
  // 대신 **모델이 판정해 저장해 둔 지시–원리 관계**(§0-C-2 directiveRelations)를 본다.
  // 이번 발화가 그 원리를 반대한다고 이미 판정돼 있으면, 분류 성공 여부와 무관하게 내려간다.
  const 지금발화 = normalizeStatement(turn.utterance ?? '');
  const admitted = [];
  const skipped = [];
  for (const p of snapshot.principles ?? []) {
    if (admitted.length >= (turn.max ?? SNAPSHOT_MAX)) { skipped.push({ cellId: p.cellId, reason: 'over_limit' }); continue; }
    // 무효 조건이 이번 턴 사실과 맞으면 싣지 않는다(게시 때 이미 결합이 검증된 atom 만 있다).
    if ((p.invalidWhen ?? []).some((c) => c.atom && atoms.has(c.atom))) {
      skipped.push({ cellId: p.cellId, reason: 'invalid_now' }); continue;
    }
    // 유효 조건이 있는데 하나도 안 맞으면 이번 턴 것이 아니다.
    const 유효 = p.validWhen ?? [];
    if (유효.length && !유효.some((c) => !c.atom || atoms.has(c.atom))) {
      skipped.push({ cellId: p.cellId, reason: 'not_now' }); continue;
    }
    if (지금발화 && (p.contradictedBy ?? []).includes(지금발화)) {
      skipped.push({ cellId: p.cellId, reason: 'superseded_by_current' }); continue;
    }
    // **이번 턴이 허용하는 최고 역할**을 고른다. 게시본은 자격(성숙도·경계)을 말하고,
    // 단계와 권한 등급은 **이번 턴의 사실**이라 여기서만 알 수 있다. 판정은 새로 짜지 않고
    // 데이터면의 권한 판정기를 그대로 부른다 — 같은 사실을 두 곳에서 다르게 계산하지 않는다.
    const 단계허용 = rolesForStage(turn.stage);
    const 후보역할 = (p.roles ?? [p.role]).filter((r) => r && 단계허용.includes(r));
    let 고른역할 = null;
    for (let i = 후보역할.length - 1; i >= 0; i -= 1) {
      const r = 후보역할[i];
      const 판정 = judgeRoleAuthority({
        cell: null, authorityFacts: turn.authorityFacts, grantStore: turn.grantStore,
        now: turn.now ?? 0, role: r,
      });
      if (판정.allowed) { 고른역할 = r; break; }
    }
    if (!고른역할) { skipped.push({ cellId: p.cellId, reason: 'authority_not_allowed' }); continue; }
    admitted.push({ ...p, role: 고른역할 });
  }
  return {
    principles: admitted,
    trace: {
      scopeKey, revision: snapshot.revision ?? 0,
      admitted: admitted.map((p) => p.cellId), skipped,
      reason: admitted.length ? 'ok' : 'nothing_applies',
    },
  };
}
