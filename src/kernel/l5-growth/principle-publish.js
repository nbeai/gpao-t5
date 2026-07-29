// L5 · 제어면 — **게시 스냅샷 생산**(결정문 §10.2, §11).
//
// 여기 있는 것은 전부 **응답 뒤 백그라운드**의 일이다. 사용자 턴은 이 파일의 어떤 함수도 부르지 않는다.
// 예전엔 `buildAdmissionSnapshot()` 이 데이터면(`tcell-admission.js`)에 살면서 사용자 턴이 그것을
// `await` 했다 — 저장소 읽기가 모델 호출 앞에 서 있었다. 층을 옮긴 것이 곧 계약이다:
// **읽는 것은 뒤, 쓰는 것은 앞이 아니라 게시본**.
import { ADMISSION_REASONS, admitFromSnapshot, resolveRole } from '../l1-intent/tcell-admission.js';
import {
  PRINCIPLE_SNAPSHOT_SCHEMA_VERSION, SNAPSHOT_MAX, SNAPSHOT_ROLES, emptySnapshot, scopeKeyOf,
} from '../l1-intent/principle-snapshot.js';
import { normalizeStatement } from '../l1-intent/statement-text.js';
import { isFactAtom, FACT_ATOMS } from '../l1-intent/fact-atoms.js';
import { MATURITY_LEVELS, influenceCeilingFor } from './tcell-core.js';

const 문자열 = (v) => (typeof v === 'string' && v ? v : null);

/**
 * 게시 대상 성숙도 — **손으로 적지 않고 계약에서 유도한다.**
 * 규칙은 하나다: 그 성숙도의 영향 상한이 전경 역할(세 보조 역할) 중 하나라도 허용하면 게시 대상이다.
 * 실측(2026-07-30): 목록을 손으로 적었더니 `M3_scoped` 라는 **존재하지 않는 상태**가 섞였고,
 * 그 결과 M3 이상이 통째로, 그리고 **조용히** 버려졌다. 이름을 두 곳에 적으면 언젠가 갈라진다.
 * 이 유도는 M1(=none·candidate_context)과 softened·quarantined·rolled_back 을 자동으로 제외한다.
 */
const 게시가능성숙도 = new Set(
  MATURITY_LEVELS.filter((state) => influenceCeilingFor(state).some((r) => SNAPSHOT_ROLES.includes(r))),
);

/**
 * **턴에 따라 달라지는** 거절 사유 — 이 사유로 막힌 원리는 "지금 이 턴이 아니다"일 뿐이므로
 * 게시본에는 실린다(전경이 매 턴 결합된 원자로 다시 고른다).
 * 그 외 사유(성숙도·권한·확인·범위·근거·종착)는 **턴과 무관하게** 막힌 것이므로 아예 싣지 않는다.
 */
const 턴에따라달라지는사유 = new Set([
  ADMISSION_REASONS.boundary, ADMISSION_REASONS.invalidWhen,
  ADMISSION_REASONS.needsReview, ADMISSION_REASONS.conflict,
]);

/**
 * **실제 저장소 경계**(감사 지시 1~3) — 비동기 저장소를 여기서 한 번 읽어 불변 스냅샷을 만든다.
 * `admitPrinciples` 는 이 스냅샷만 소비하는 순수·동기 함수로 남는다.
 * 읽기 실패는 삼키지 않고 `status:'degraded'` + 코드로 남긴다.
 * @param {{registry?:{load:()=>Promise<object>}, observer?:{load:(scope:object)=>Promise<object>},
 *   confirmationStore?:object, grantStore?:object, sessionId?:string}} sources
 */
export async function buildAdmissionSnapshot(sources = {}) {
  const errorCodes = [];
  const cells = new Map();
  const observations = new Map();
  // **범위 격리**(명세 §6 · 흡수보충 §8): workspace/project 경계를 넘는 조회는 기본 차단이다.
  // 다른 작업 공간의 원리는 거절하는 것이 아니라 **읽지 않는다** — 범위판정까지 끌고 가면
  // 그 세포의 근거까지 읽게 되고, 그게 곧 경계를 넘는 열람이다.
  const 현재범위 = 문자열(sources.scope?.project);
  let scopeFiltered = 0;
  try {
    const a = await sources.registry?.load?.();
    for (const c of Array.isArray(a?.cells) ? a.cells : []) {
      if (!문자열(c?.id)) continue;
      const cp = 문자열(c?.anchor?.project);
      // anchor 가 없는 세포(범위 미상)는 거르지 않는다 — 범위판정이 `scope_unknown` 으로 정직하게 막는다.
      if (cp && 현재범위 && cp !== 현재범위) { scopeFiltered += 1; continue; }
      cells.set(c.id, c);
    }
    if (a?.error || a?.corrupted) errorCodes.push(ADMISSION_REASONS.storeError);
  } catch { errorCodes.push(ADMISSION_REASONS.storeError); }
  // **후보가 없으면 근거를 읽지 않는다.** 입장할 원리가 하나도 없는데 관찰 로그를 통째로 읽는 것은
  // 매 턴 낭비다(실측: 게이트 CPU 초과). 없는 것을 확인하는 데 드는 비용도 비용이다.
  // **근거는 참조로 조회한다**(감사 5): 장기 원리의 근거는 다른 세션에 있다. 현재 세션만 훑으면
  // 과거 대화에서 자란 원리가 영원히 거절된다 — T-cell 의 목적과 정면 충돌이다. 이미 가진 참조를
  // 확인하는 것이므로 범위 횡단 열람이 아니다.
  if (cells.size) {
    const 필요참조 = new Set();
    for (const c of cells.values()) {
      for (const r of Array.isArray(c?.trace?.observationRefs) ? c.trace.observationRefs : []) 필요참조.add(r);
    }
    try {
      const byRef = await sources.observer?.getByRefs?.([...필요참조]);
      for (const [r, e] of Object.entries(byRef?.found ?? {})) observations.set(r, e);
      if (byRef?.error) errorCodes.push(ADMISSION_REASONS.storeError);
    } catch { errorCodes.push(ADMISSION_REASONS.storeError); }
  }
  const 동기조회 = (m) => Object.freeze({ get: (k) => (m.has(k) ? m.get(k) : null) });
  const 빈조회 = Object.freeze({ get: () => null });
  // **없는 것을 확인하는 비용도 비용이다**(명세 §19: hot path 추가 동기 CPU p95 5ms).
  // 후보가 하나도 없으면 확인 원장·권한 원장을 **만들지도 않는다** — 지연 공급자를 부르지 않는다.
  const 지연 = async (v) => {
    if (!cells.size) return 빈조회;
    try {
      const s = (typeof v === 'function' ? await v() : v) ?? 빈조회;
      // §0-C-4: 원장이 부분 손상을 스스로 표시하면(degraded) 그 사실을 승계한다 —
      // 정상 줄은 그대로 쓰되, "전부 읽었다"는 거짓 ok 를 만들지 않는다.
      if (s?.degraded === true) errorCodes.push(ADMISSION_REASONS.storeError);
      return s;
    } catch { errorCodes.push(ADMISSION_REASONS.storeError); return 빈조회; }
  };
  const confirmationStore = await 지연(sources.confirmationStore);
  const grantStore = await 지연(sources.grantStore);
  return Object.freeze({
    principleStore: 동기조회(cells),
    evidenceStore: 동기조회(observations),
    confirmationStore,
    grantStore,
    candidateIds: [...cells.keys()],
    // 범위 밖이라 **읽지 않은** 수. 0 이 아니면 "그런 원리가 없었다"가 아니라 "여기 것이 아니었다"다.
    scopeFiltered,
    status: errorCodes.length ? 'degraded' : 'ok',
    errorCodes: Object.freeze(errorCodes),
  });
}

/**
 * 게시 자격 판정 — **데이터면과 같은 판정기**(`admitFromSnapshot`)를 쓴다.
 * 두 층이 각자의 필터를 만들면 "같은 사실을 두 층이 따로 계산하면 덜 아는 쪽이 이긴다"가 된다.
 * 여기서는 사실이 하나도 켜지지 않은 중립 턴으로 돌려, **턴과 무관한 관문**만 통과시킨다.
 * @returns {Set<string>} 게시해도 되는 세포 id
 */
export function publishableIds(snapshot, { now = 0, scope = {}, confirmationRefs = {} } = {}) {
  const out = new Set();
  if (!snapshot) return out;
  for (const id of snapshot.candidateIds ?? []) {
    const cell = snapshot.principleStore?.get?.(id) ?? null;
    if (!cell) continue;
    // **최선 턴**으로 묻는다: 이 원리의 결합된 유효 조건이 모두 성립한 턴. 빈 사실로 물으면
    // 경계에서 먼저 걸려 **그 뒤의 확인·권한 관문이 한 번도 실행되지 않는다**(실측 2026-07-30:
    // 확인이 필요한 원리가 확인 없이 게시됐다). 게시가 물어야 할 것은 "지금 들어오는가"가 아니라
    // "들어올 수 있는 턴이 하나라도 있는가"이고, 어느 턴인지는 전경이 매 턴 다시 고른다.
    const binding = (cell.binding && typeof cell.binding === 'object') ? cell.binding : {};
    const facts = [];
    for (const c of Array.isArray(cell.boundary?.validWhen) ? cell.boundary.validWhen : []) {
      const atom = typeof c === 'string' ? binding[c] : (c?.atom ?? binding[c?.text]);
      if (isFactAtom(atom)) facts.push({ fact: FACT_ATOMS[atom].fact, atom, ref: null, window: 'previous_turn' });
      else if (typeof c === 'string' && c) facts.push({ fact: c, atom: null, ref: null, window: 'previous_turn' });
    }
    let trace;
    try {
      ({ trace } = admitFromSnapshot(snapshot, {
        requestFacts: {
          facts, project: 문자열(scope.project), subject: cell?.anchor?.subject ?? null, sameTurn: false,
          // 확인은 **사용자 사실**이다(세션 사실이 아니다) — 게시 시점에 원장에서 찾아 넘긴다.
          confirmationRefs,
        },
        authorityFacts: { actionTier: 'A0', tierKnown: true, tierSource: 'plan' },
        now, stage: 'pre_model',
      }));
    } catch { continue; }
    const 사유 = (trace?.rejected ?? []).find((r) => r.id === id)?.reason;
    if (!사유 || 턴에따라달라지는사유.has(사유)) out.add(id);
  }
  return out;
}

export function projectScopeSnapshot({ cells = [], scope = {}, now = 0, revision = 1, registryRevision = null, publishable = null } = {}) {
  const scopeKey = scopeKeyOf(scope);
  // 자리를 모르면 게시하지 않는다 — 미상끼리 한 칸을 공유하면 서로 다른 프로젝트가 섞인다.
  if (!scopeKey) return emptySnapshot('project:unknown', 'scope_unknown');
  const 현재범위 = 문자열(scope.project);
  const 절 = (arr) => Object.freeze((Array.isArray(arr) ? arr : [])
    .map((c) => (typeof c === 'string' ? { text: c, atom: null } : { text: 문자열(c?.text), atom: isFactAtom(c?.atom) ? c.atom : null }))
    .filter((c) => c.text && c.atom)
    .map((c) => Object.freeze(c)));
  const principles = [];
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (principles.length >= SNAPSHOT_MAX) break;
    if (!문자열(cell?.id)) continue;
    if (!게시가능성숙도.has(cell?.state)) continue;               // M1 은 게시하지 않는다
    // 턴과 무관한 관문(권한·확인·근거·종착)에서 막힌 원리는 아예 싣지 않는다.
    if (publishable && !publishable.has(cell.id)) continue;
    const cp = 문자열(cell?.anchor?.project);
    if (현재범위 && cp && cp !== 현재범위) continue;                // 다른 자리 것은 읽지도 싣지도 않는다
    // **역할은 허용된 것 중 가장 높은 것**이다(감사 TG5-CX-04).
    // 예전엔 세포의 `allowedInfluence` 배열에서 **처음 걸리는 값**을 썼다. 그 배열은 낮은 역할부터
    // 나열되므로 결과는 언제나 `supporting_context` 였고, M3·M4 가 검증돼도 `plan_hint`·
    // `default_value` 는 생산 게시본에서 **도달 불가능**했다.
    // 판정 자체는 새로 짜지 않는다 — 데이터면의 `resolveRole` 이 이미 "세포 허용 ∩ 성숙도 상한 ∩
    // 단계 허용의 고정 순서 최대값"을 계산한다. 여기서는 그것을 **게시 상한(세 보조 역할)** 안에서
    // 부를 뿐이다. 같은 판정을 두 곳에서 다르게 계산하면 덜 아는 쪽이 이긴다.
    // 게시본은 **자격 있는 역할 목록**을 싣는다. 하나로 접어 두면 "이번 턴의 권한 등급"이라는
    // 턴 사실을 게시 시점에 알 수 없어, A2 턴에서도 계획 역할이 그대로 실린다(감사 TG5-CX-04 를
    // 고치다 새로 만든 구멍 — 실측으로 잡았다). 자격은 게시가, 이번 턴 선택은 전경이 한다.
    const roles = SNAPSHOT_ROLES.filter((r) => resolveRole(cell, [r]) === r);
    if (!roles.length) continue;
    const role = roles[roles.length - 1];   // 표시용 최고 역할(계약 호환)
    const statement = 문자열(cell?.principle?.statement);
    if (!statement) continue;
    principles.push(Object.freeze({
      cellId: cell.id,
      cellVersion: cell?.version ?? cell?.candidateVersionId ?? null,
      role,
      roles: Object.freeze(roles),
      principle: statement,                                       // 모델이 스스로 쓴 문장(사용자 원문 아님)
      binding: Object.freeze(Object.entries(cell?.binding ?? {})
        .filter(([, a]) => isFactAtom(a)).map(([k, a]) => Object.freeze([k, a]))),
      validWhen: 절(cell?.boundary?.validWhen),
      invalidWhen: 절(cell?.boundary?.invalidWhen),
      sourceRefs: Object.freeze([...(cell?.trace?.observationRefs ?? [])]),
      // 모델이 "이 지시는 이 원리의 반대"라고 판정해 둔 지시들(§0-C-2). 전경은 이번 발화가
      // 여기 있으면 그 원리를 내린다 — 정규식 분류 성공 여부에 기대지 않는 현재 지시 우선.
      contradictedBy: Object.freeze(Object.entries(cell?.directiveRelations ?? {})
        .filter(([, r]) => r === 'contradicts').map(([k]) => normalizeStatement(k)).filter(Boolean)),
    }));
  }
  if (!principles.length) return emptySnapshot(scopeKey, 'nothing_published');
  return Object.freeze({
    schemaVersion: PRINCIPLE_SNAPSHOT_SCHEMA_VERSION,
    revision,
    scopeKey,
    publishedAt: now,
    sourceRegistryRevision: registryRevision,
    principles: Object.freeze(principles),
    reason: 'ok',
  });
}
