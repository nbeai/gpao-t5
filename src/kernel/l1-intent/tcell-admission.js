// L1 · T-cell Context Admission (TG-5A, 명세 §11 + 감사 승인 조건 2026-07-29)
//
// **이 단계는 shadow 다 — 영향은 0이다.** admission 을 계산하고 principleTrace 를 남기지만,
// 어떤 결과도 모델 입력·계획·실행에 들어가지 않는다(주입은 TG-5B).
//
// 여섯 계약이 이 파일의 뼈대다:
//  A. 입력의 신분 — 세포는 **ID 로 저장소에서 조회**한다. 호출자가 세포·확인·권한 불리언을
//     건네도 쓰지 않는다. 사용자 원문은 휘발성 재료이고 trace 에는 **사유 코드만** 남는다.
//  B. 역할은 세 집합(세포 허용 ∩ 성숙도 상한 ∩ 이번 단계 허용)의 **결정적 최대값**이다.
//  C. 경계·범위는 **3값 판정**(matched/not_matched/unknown)이다. unknown 은 입장 근거도,
//     단독 거절 근거도 아니다 — 과잉 차단과 근거 없는 입장을 함께 막는다.
//  D. `authorityAllowed` 는 **판단 참고 가능**이지 실행 승인이 아니다. 일회성 승인은 재사용 불가.
//  E. 실패는 빈 성공으로 위장하지 않는다 — status ok|degraded, 후보는 정확히 한 번 나타난다.
//  F. 영향 0 은 말이 아니라 관통 검사로 증명한다(모델 메시지·스키마·호출·실행·registry 동일).
import { influenceCeilingFor, INFLUENCE_ROLES } from '../l5-growth/tcell-core.js';

/** 역할의 고정 순서 — `max` 는 이 위의 결정적 최대값이지 휴리스틱이 아니다. */
export const ROLE_ORDER = Object.freeze([
  'none', 'candidate_context', 'supporting_context', 'plan_hint', 'default_value', 'answer_anchor',
]);

/** 이번 단계가 허용하는 역할 — `answer_anchor` 는 **집합에 없다**(TG-5C 이후 논의). */
export const STAGE_ALLOWED_ROLES = Object.freeze([
  'none', 'candidate_context', 'supporting_context', 'plan_hint', 'default_value',
]);

/** 입장 후보가 될 수 있는 성숙도 — M2 이상, 종착·약화 상태 제외. */
const 후보가능상태 = Object.freeze(['M2_replayed', 'M3_limited', 'M4_stable', 'M5_compressed']);

/**
 * 사유는 **코드**다(자유 문장 금지) — 사용자 원문이 trace 로 새는 통로를 없앤다(계약 A).
 */
export const ADMISSION_REASONS = Object.freeze({
  admitted: 'admitted',
  notFound: 'cell_not_found',
  corrupt: 'cell_corrupt',
  maturity: 'maturity_below_m2',
  terminal: 'state_terminal_or_softened',
  roleEmpty: 'role_not_allowed',
  scope: 'scope_mismatch',
  stale: 'scope_stale',
  conflict: 'current_request_conflict',
  boundary: 'boundary_not_satisfied',
  invalidWhen: 'invalid_condition_matched',
  needsReview: 'needs_review',
  authority: 'authority_not_allowed',
  confirmation: 'user_confirmation_missing',
  trace: 'trace_not_descendable',
});

const 문자열 = (v) => (typeof v === 'string' && v ? v : null);
const 정규화 = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** 저장소 조회 — get 이 없으면 조회 불가(빈 결과가 아니라 불가다). */
function 조회(store, key) {
  if (!store || typeof store.get !== 'function' || !문자열(key)) return undefined;
  try { return store.get(key) ?? null; } catch { return null; }
}

/**
 * 계약 C · 3값 경계 판정 — 이번 턴의 **구조화된 사실 집합**과 대조한다.
 *  matched     = 그 절이 사실 집합에 있다
 *  not_matched = 명시적 부정(`!절`)이 사실 집합에 있다
 *  unknown     = 그 외(모른다) — 입장 근거도, 단독 거절 근거도 아니다
 * @returns {{clause:string, verdict:'matched'|'not_matched'|'unknown', evidenceRef:string|null}}
 */
export function judgeClause(clause, facts = []) {
  const c = 정규화(clause);
  const list = Array.isArray(facts) ? facts : [];
  for (const f of list) {
    const nf = 정규화(f?.fact ?? f);
    const ref = 문자열(f?.ref) ?? null;
    if (nf === c) return { clause, verdict: 'matched', evidenceRef: ref };
    if (nf === `!${c}`) return { clause, verdict: 'not_matched', evidenceRef: ref };
  }
  return { clause, verdict: 'unknown', evidenceRef: null };
}

/**
 * 계약 B · 역할 결정 — 세 집합의 교집합에서 고정 순서의 최대값. 교집합이 비면 'none'.
 * 가장 높은 역할을 임의로 고르지 않고, 단계 밖 역할로 자동 상승하지 않는다.
 */
export function resolveRole(cell, stageAllowed = STAGE_ALLOWED_ROLES) {
  if (!cell || typeof cell !== 'object') return 'none';
  const 세포허용 = Array.isArray(cell?.authority?.allowedInfluence) ? cell.authority.allowedInfluence : [];
  const 상한 = influenceCeilingFor(cell?.state);
  const 단계 = Array.isArray(stageAllowed) ? stageAllowed : [];
  const 교집합 = ROLE_ORDER.filter((r) => INFLUENCE_ROLES.includes(r)
    && 세포허용.includes(r) && 상한.includes(r) && 단계.includes(r));
  return 교집합.length ? 교집합[교집합.length - 1] : 'none';
}

/**
 * 계약 C · 범위 판정 — **시간이 아니라 식별자로** 본다.
 * 같은 project 에서 시간만 지난 것은 범위 불일치가 아니다.
 */
function 범위판정(cell, requestFacts) {
  const cp = cell?.anchor?.project ?? null;
  const cs = cell?.anchor?.subject ?? null;
  const rp = requestFacts?.project ?? null;
  const rs = requestFacts?.subject ?? null;
  if (cell?.anchor?.stale === true) return { ok: false, code: ADMISSION_REASONS.stale };
  if (cp !== null && rp !== null && cp !== rp) return { ok: false, code: ADMISSION_REASONS.scope };
  if (cs !== null && rs !== null && cs !== rs) return { ok: false, code: ADMISSION_REASONS.scope };
  // radius 가 turn 이면 이번 턴에서 만들어진 것만, task 이상이면 현재 범위를 덮는다.
  if (cell?.geometry?.radius === 'turn' && requestFacts?.sameTurn !== true) {
    return { ok: false, code: ADMISSION_REASONS.scope };
  }
  return { ok: true, code: null };
}

/**
 * 계약 D · 권한 판정 — `authorityAllowed` 는 **판단 참고 가능**이다. 실행 승인이 아니다.
 * A0/A1 은 허용. A2/A3 는 **행동·대상·범위·만료가 모두 일치하는 유효한 bounded grant** 가
 * 조회될 때만 참고 가능이며, 그때도 실제 실행 경계에서 다시 검증한다.
 */
function 권한판정(cell, authorityFacts, grantStore, now, role) {
  // **등급은 세포의 속성이 아니라 이번 턴 행동의 사실이다**(설계 정정 2026-07-29).
  // 세포가 스스로 "나는 A0" 이라고 말하게 두면 원리가 자기 권한을 주장하게 된다.
  const tier = 문자열(authorityFacts?.actionTier) ?? 'A0';
  if (tier === 'A0' || tier === 'A1') return { allowed: true, code: null, grantRef: null };
  // A2/A3 인 턴이라도, 계획·값에 관여하지 않는 역할(맥락 제공)은 권한을 여는 것이 아니다.
  if (!['plan_hint', 'default_value', 'answer_anchor'].includes(role)) {
    return { allowed: true, code: null, grantRef: null };
  }
  const need = {
    action: 문자열(authorityFacts?.actionKind),
    target: 문자열(authorityFacts?.target),
    scope: 문자열(authorityFacts?.scope),
  };
  const ref = 문자열(authorityFacts?.grantRef);
  const g = 조회(grantStore, ref);
  if (!g) return { allowed: false, code: ADMISSION_REASONS.authority, grantRef: null };
  const 일회성 = g.kind === 'once'; // 과거의 일회성 승인은 이후 권한이 아니다
  const 만료 = typeof g.expiresAt === 'number' ? g.expiresAt <= (typeof now === 'number' ? now : 0) : true;
  const 일치 = g.action === need.action && g.target === need.target && g.scope === need.scope;
  if (일회성 || 만료 || !일치) return { allowed: false, code: ADMISSION_REASONS.authority, grantRef: null };
  return { allowed: true, code: null, grantRef: ref };
}

/**
 * 계약 A·E · 입장 판정 — **모든 후보는 정확히 한 번** admitted 또는 rejected 에 나타난다.
 * 후보 하나가 손상돼도 다른 후보 판정은 계속되고, 손상 후보는 정확히 거절된다.
 *
 * @param {{
 *   candidateIds:string[], principleStore:{get:(id:string)=>object|null},
 *   evidenceStore?:{get:(ref:string)=>object|null}, confirmationStore?:{get:(ref:string)=>object|null},
 *   grantStore?:{get:(ref:string)=>object|null},
 *   requestFacts?:object, authorityFacts?:object, stageAllowedRoles?:string[], now?:number
 * }} input
 * @returns {{admissions:object[], trace:object}}
 */
export function admitPrinciples(rawInput = {}) {
  const input = (rawInput && typeof rawInput === 'object') ? rawInput : {};
  const ids = Array.isArray(input.candidateIds) ? input.candidateIds.filter(문자열) : [];
  const trace = {
    status: 'ok', errorCodes: [], retrievedIds: [...ids],
    admitted: [], rejected: [], influencedPlan: [], influencedAnswer: [],
  };
  const admissions = [];
  const facts = Array.isArray(input.requestFacts?.facts) ? input.requestFacts.facts : [];

  for (const id of ids) {
    let 판정;
    try {
      판정 = 하나판정(id, input, facts);
    } catch {
      // 계약 E: 손상 후보 하나가 나머지를 막지 않는다. 실패는 degraded 로 남긴다.
      trace.status = 'degraded';
      if (!trace.errorCodes.includes(ADMISSION_REASONS.corrupt)) trace.errorCodes.push(ADMISSION_REASONS.corrupt);
      판정 = { admitted: false, reason: ADMISSION_REASONS.corrupt, admission: null };
    }
    if (판정.admitted && 판정.admission) {
      admissions.push(판정.admission);
      trace.admitted.push({ id, role: 판정.admission.role, reason: 판정.admission.reason });
    } else {
      trace.rejected.push({ id, reason: 판정.reason });
      if (판정.reason === ADMISSION_REASONS.corrupt || 판정.reason === ADMISSION_REASONS.notFound) {
        trace.status = 'degraded';
        if (!trace.errorCodes.includes(판정.reason)) trace.errorCodes.push(판정.reason);
      }
    }
  }
  return { admissions, trace };
}

function 하나판정(id, input, facts) {
  const 거절 = (reason) => ({ admitted: false, reason, admission: null });
  // 계약 A: 세포는 **저장소에서 ID 로 조회**한다(호출자가 건넨 객체는 쓰지 않는다).
  const cell = 조회(input.principleStore, id);
  if (cell === undefined || cell === null) return 거절(ADMISSION_REASONS.notFound);
  if (typeof cell !== 'object' || !문자열(cell.state)) return 거절(ADMISSION_REASONS.corrupt);

  if (!후보가능상태.includes(cell.state)) {
    const 종착 = ['quarantined', 'rolled_back', 'softened'].includes(cell.state);
    return 거절(종착 ? ADMISSION_REASONS.terminal : ADMISSION_REASONS.maturity);
  }
  // 계약 B: 역할이 비면 입장 자체가 없다.
  const role = resolveRole(cell, input.stageAllowedRoles ?? STAGE_ALLOWED_ROLES);
  if (role === 'none') return 거절(ADMISSION_REASONS.roleEmpty);

  // 우선순위 1: 현재 사용자 원문과 충돌하면 즉시 거절(원리는 현재 요청을 덮지 못한다).
  const conflict = 충돌판정(cell, input.requestFacts, facts);
  if (conflict) return 거절(ADMISSION_REASONS.conflict);

  const 범위 = 범위판정(cell, input.requestFacts);
  if (!범위.ok) return 거절(범위.code);

  // 계약 C: 3값 경계 판정 — unknown 은 세지 않고, 기록만 한다.
  const boundaryChecks = [
    ...(Array.isArray(cell.boundary?.validWhen) ? cell.boundary.validWhen : [])
      .map((c) => ({ kind: 'validWhen', ...judgeClause(c, facts) })),
    ...(Array.isArray(cell.boundary?.invalidWhen) ? cell.boundary.invalidWhen : [])
      .map((c) => ({ kind: 'invalidWhen', ...judgeClause(c, facts) })),
    ...(Array.isArray(cell.boundary?.needsReviewWhen) ? cell.boundary.needsReviewWhen : [])
      .map((c) => ({ kind: 'needsReviewWhen', ...judgeClause(c, facts) })),
  ];
  if (boundaryChecks.some((b) => b.kind === 'invalidWhen' && b.verdict === 'matched')) {
    return { ...거절(ADMISSION_REASONS.invalidWhen), boundaryChecks };
  }
  if (boundaryChecks.some((b) => b.kind === 'needsReviewWhen' && b.verdict === 'matched')) {
    return { ...거절(ADMISSION_REASONS.needsReview), boundaryChecks };
  }
  if (!boundaryChecks.some((b) => b.kind === 'validWhen' && b.verdict === 'matched')) {
    return { ...거절(ADMISSION_REASONS.boundary), boundaryChecks }; // unknown 은 입장 근거가 아니다
  }

  // 계약 A: 사용자 확인은 **조회된 기록**이어야 한다(호출자 불리언 금지).
  if (cell.authority?.requiresUserConfirmation === true) {
    const rec = 조회(input.confirmationStore, 문자열(input.requestFacts?.confirmationRefs?.[id]));
    const ok = rec && rec.kind === 'user_confirmation' && rec.tcellId === cell.id
      && rec.confirmed === true && typeof rec.at === 'number';
    if (!ok) return 거절(ADMISSION_REASONS.confirmation);
  }

  // trace 하강 가능성 — 근거가 실제로 있어야 한다.
  const refs = Array.isArray(cell.trace?.observationRefs) ? cell.trace.observationRefs : [];
  if (!refs.length || refs.some((r) => !조회(input.evidenceStore, r))) return 거절(ADMISSION_REASONS.trace);

  // 계약 D: 참고 가능 여부(실행 승인 아님).
  const 권한 = 권한판정(cell, input.authorityFacts ?? input.requestFacts, input.grantStore, input.now, role);
  if (!권한.allowed) return { ...거절(권한.code), boundaryChecks };

  return {
    admitted: true,
    reason: ADMISSION_REASONS.admitted,
    admission: {
      tcellId: id,
      role,
      reason: ADMISSION_REASONS.admitted,   // 코드만 — 사용자 원문 없음
      sourceRefs: [...refs],
      boundaryChecks,
      currentRequestConflict: false,
      authorityAllowed: true,               // **판단 참고 가능**이지 실행 승인이 아니다
      grantRef: 권한.grantRef,
      reverifyAtExecution: true,            // 실행 경계에서 반드시 다시 검증한다
    },
  };
}

/** 현재 요청과의 충돌 — 사용자가 이번 턴에 명시적으로 반대한 것은 즉시 이긴다. */
function 충돌판정(cell, requestFacts, facts) {
  const 반대 = Array.isArray(requestFacts?.contradicts) ? requestFacts.contradicts : [];
  const stmt = 정규화(cell?.principle?.statement);
  if (반대.some((c) => 정규화(c) === stmt)) return true;
  // 원리가 "덮지 않는다"고 선언한 것이 이번 턴 사실에 있으면 충돌이다.
  const 금지 = Array.isArray(cell?.boundary?.mustNotOverride) ? cell.boundary.mustNotOverride : [];
  return 금지.some((m) => judgeClause(m, facts).verdict === 'matched' && requestFacts?.userDirective === true);
}

/** 사람 말 설명 — 사유 코드를 사용자 언어로. 원문·점수는 담지 않는다. */
export function explainAdmission(decision) {
  const map = {
    [ADMISSION_REASONS.admitted]: '이 원칙을 참고할 수 있어요.',
    [ADMISSION_REASONS.notFound]: '그 원칙을 찾지 못했어요.',
    [ADMISSION_REASONS.corrupt]: '그 원칙 기록이 손상돼 쓰지 않았어요.',
    [ADMISSION_REASONS.maturity]: '아직 충분히 검증되지 않은 원칙이에요.',
    [ADMISSION_REASONS.terminal]: '되돌렸거나 보류된 원칙이에요.',
    [ADMISSION_REASONS.roleEmpty]: '지금 단계에서 쓸 수 있는 역할이 없어요.',
    [ADMISSION_REASONS.scope]: '이 작업 범위의 원칙이 아니에요.',
    [ADMISSION_REASONS.stale]: '지금 범위에서는 오래된 원칙이에요.',
    [ADMISSION_REASONS.conflict]: '지금 하신 말씀이 우선이에요.',
    [ADMISSION_REASONS.boundary]: '이 상황에 맞는 원칙인지 확인되지 않았어요.',
    [ADMISSION_REASONS.invalidWhen]: '이 상황에서는 쓰지 않기로 한 원칙이에요.',
    [ADMISSION_REASONS.needsReview]: '한 번 더 살펴봐야 하는 상황이에요.',
    [ADMISSION_REASONS.authority]: '이 원칙이 여는 행동은 따로 승인이 필요해요.',
    [ADMISSION_REASONS.confirmation]: '아직 확인하지 않은 원칙이에요.',
    [ADMISSION_REASONS.trace]: '근거를 찾을 수 없어 쓰지 않았어요.',
  };
  return map[decision?.reason] ?? '이 원칙은 이번에 쓰지 않았어요.';
}
