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
import { normalizeStatement } from './statement-text.js';

/** 역할의 고정 순서 — `max` 는 이 위의 결정적 최대값이지 휴리스틱이 아니다. */
export const ROLE_ORDER = Object.freeze([
  'none', 'candidate_context', 'supporting_context', 'plan_hint', 'default_value', 'answer_anchor',
]);

/**
 * 행렬 3 · **단계별 허용 역할** — 재료가 다르면 열 수 있는 역할도 다르다.
 *
 * `pre_model` 은 모델 호출 **앞**이다. 계획이 없고 등급은 `intent.js` 의 정규식 추정뿐이므로
 * **맥락 역할만** 연다. 계획·값에 관여하는 역할을 여기서 열면 추정 위에서 권한을 판정하게 된다.
 * `post_plan` 은 `buildActionPlan` 뒤·실행 앞이다. 커널이 판정한 등급과 실제 도구·대상이 있다.
 *
 * `answer_anchor` 는 **어느 단계에도 없다**(TG-5C 이후 논의).
 */
export const STAGE_ROLES = Object.freeze({
  pre_model: Object.freeze(['none', 'candidate_context', 'supporting_context']),
  post_plan: Object.freeze(['none', 'candidate_context', 'supporting_context', 'plan_hint', 'default_value']),
});

/** 알 수 없는 단계는 **가장 좁은 집합**으로 떨어진다(모르면 덜 연다). */
export const rolesForStage = (stage) => STAGE_ROLES[stage] ?? STAGE_ROLES.pre_model;

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
  storeError: 'store_read_failed',
  scopeUnknown: 'scope_unknown',
  authorityUnknown: 'authority_tier_unknown',
});

const 문자열 = (v) => (typeof v === 'string' && v ? v : null);
const 정규화 = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 저장소 조회 — **부재와 오류를 구분한다**(감사 재현: 저장소가 던져도 status 가 ok 였다).
 * 오류는 `errors` 에 코드를 남겨 호출자가 degraded 로 올린다.
 */
function 조회(store, key, errors) {
  if (!store || typeof store.get !== 'function' || !문자열(key)) return undefined;
  try { return store.get(key) ?? null; } catch {
    if (Array.isArray(errors) && !errors.includes(ADMISSION_REASONS.storeError)) errors.push(ADMISSION_REASONS.storeError);
    return undefined; // 오류는 "없음"이 아니다 — 판정 불가다
  }
}

/**
 * 계약 C · 3값 경계 판정 — 이번 턴의 **구조화된 사실 집합**과 대조한다.
 *  matched     = 그 절이 사실 집합에 있다 (문구 일치 **또는** 결합된 원자 일치)
 *  not_matched = 명시적 부정(`!절`)이 사실 집합에 있다
 *  unknown     = 그 외(모른다) — 입장 근거도, 단독 거절 근거도 아니다
 *
 * **원자 결합**(§0-C-2): `atom` 은 추출 시점에 **모델**이 자유문 절을 OS 사실 어휘에 결합해
 * 세포에 저장한 것이다(`cell.binding`). 여기서는 그 결합을 조회해 대조만 한다 — 핫패스에
 * 의미 판정(모델·정규식)이 없다. 결합이 없는 절은 문구 일치로만 판정된다(기존 세포 호환).
 * @returns {{clause:string, verdict:'matched'|'not_matched'|'unknown', evidenceRef:string|null, via?:'text'|'atom'}}
 */
export function judgeClause(clause, facts = [], atom = null) {
  const c = 정규화(clause);
  const boundAtom = 문자열(atom);
  const list = Array.isArray(facts) ? facts : [];
  for (const f of list) {
    const nf = 정규화(f?.fact ?? f);
    const ref = 문자열(f?.ref) ?? null;
    if (nf === c) return { clause, verdict: 'matched', evidenceRef: ref, via: 'text' };
    if (nf === `!${c}`) return { clause, verdict: 'not_matched', evidenceRef: ref, via: 'text' };
    if (boundAtom && 문자열(f?.atom) === boundAtom) {
      return { clause, verdict: 'matched', evidenceRef: ref, via: 'atom' };
    }
  }
  return { clause, verdict: 'unknown', evidenceRef: null };
}

/**
 * 계약 B · 역할 결정 — 세 집합의 교집합에서 고정 순서의 최대값. 교집합이 비면 'none'.
 * 가장 높은 역할을 임의로 고르지 않고, 단계 밖 역할로 자동 상승하지 않는다.
 */
export function resolveRole(cell, stageAllowed = STAGE_ROLES.pre_model) {
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
  const rp = 문자열(requestFacts?.project);
  const rs = 문자열(requestFacts?.subject);
  if (cell?.anchor?.stale === true) return { ok: false, code: ADMISSION_REASONS.stale };
  // **현재 범위 식별자가 없으면 범위를 확인할 수 없다** — 확인 못 한 것은 입장 근거가 아니다(감사).
  if (cp !== null && rp === null) return { ok: false, code: ADMISSION_REASONS.scopeUnknown };
  if (cs !== null && rs === null) return { ok: false, code: ADMISSION_REASONS.scopeUnknown };
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
function 권한판정(cell, authorityFacts, grantStore, now, role, errors) {
  // **등급은 세포의 속성이 아니라 이번 턴 행동의 사실이다**(설계 정정 2026-07-29).
  // 세포가 스스로 "나는 A0" 이라고 말하게 두면 원리가 자기 권한을 주장하게 된다.
  // **모르는 권한을 저위험으로 간주하지 않는다**(감사 2026-07-29). 커널이 등급을 판정하지
  // 않았으면 A0 가 아니라 **판정 불가**다 — 계획·값에 관여하는 역할은 막는다.
  const 관여역할 = ['plan_hint', 'default_value', 'answer_anchor'].includes(role);
  const 판정됨 = authorityFacts?.tierKnown === true;
  const tier = 문자열(authorityFacts?.actionTier);
  if (!판정됨 || tier === null) {
    return 관여역할 ? { allowed: false, code: ADMISSION_REASONS.authorityUnknown, grantRef: null }
      : { allowed: true, code: null, grantRef: null };
  }
  if (tier === 'A0' || tier === 'A1') return { allowed: true, code: null, grantRef: null };
  // A2/A3 인 턴이라도, 계획·값에 관여하지 않는 역할(맥락 제공)은 권한을 여는 것이 아니다.
  if (!관여역할) return { allowed: true, code: null, grantRef: null };
  const need = {
    action: 문자열(authorityFacts?.actionKind),
    // 감사 P0: **실제 행동 종류**까지 같아야 같은 권한이다. 같은 손이라도 write 와 delete 는
    // 다른 행동이고, 다른 등급이다(A2 승인이 A3 를 열면 안 된다).
    operation: 문자열(authorityFacts?.actionOperation),
    target: 문자열(authorityFacts?.target),
    scope: 문자열(authorityFacts?.scope),
  };
  const ref = 문자열(authorityFacts?.grantRef);
  // 행렬 4: 조회 대상은 **실제로 부여된 권한 원장**이다. `pendingApprovals`(아직 누르지 않은 카드)를
  // grant 로 읽던 경로는 제거했다 — 대기 목록에 있다는 사실은 권한이 아니다(매듭: 승인 전 계획 ≠ 실행).
  const g = 조회(grantStore, ref, errors);
  if (!g || typeof g !== 'object') return { allowed: false, code: ADMISSION_REASONS.authority, grantRef: null };
  // **정확히 bounded 만** 인정한다(감사 재현: 임의 kind 가 통과했다).
  // 제품의 `grantScope.kind` 는 `once|session|persist` 다. 그중 **재사용 가능한 범위를 가진**
  // session/persist 만 원장이 `bounded` 로 승격해 담는다. `once` 는 소비돼도 권한이 아니다 —
  // 명세 §0.1 「bounded grant 안의 반복 실행은 다시 묻지 않는다」의 반대쪽 경계다.
  const 유효종류 = g.kind === 'bounded';
  const 철회됨 = g.revoked === true || g.active === false;
  const 만료 = typeof g.expiresAt === 'number' ? g.expiresAt <= (typeof now === 'number' ? now : 0) : true;
  const 일치 = 문자열(g.action) === need.action && 문자열(g.operation) === need.operation
    && 문자열(g.target) === need.target && 문자열(g.scope) === need.scope
    && need.action !== null && need.operation !== null && need.target !== null && need.scope !== null;
  if (!유효종류 || 철회됨 || 만료 || !일치) return { allowed: false, code: ADMISSION_REASONS.authority, grantRef: null };
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
  // **후보 ID 는 중복 제거한다**(감사 재현: 같은 세포가 두 번 입장했다).
  const ids = [...new Set(Array.isArray(input.candidateIds) ? input.candidateIds.filter(문자열) : [])];
  const trace = {
    status: 'ok', errorCodes: [], retrievedIds: [...ids],
    // 행렬 3: **어느 단계의 판정인지**가 trace 에 남아야 감사가 두 통과를 구분할 수 있다.
    stage: 문자열(input.stage) ?? 'pre_model',
    admitted: [], rejected: [], influencedPlan: [], influencedAnswer: [],
  };
  const admissions = [];
  const facts = Array.isArray(input.requestFacts?.facts) ? input.requestFacts.facts : [];

  for (const id of ids) {
    let 판정;
    const errors = [];
    try {
      판정 = 하나판정(id, input, facts, errors);
    } catch {
      // 계약 E: 손상 후보 하나가 나머지를 막지 않는다. 실패는 degraded 로 남긴다.
      trace.status = 'degraded';
      if (!trace.errorCodes.includes(ADMISSION_REASONS.corrupt)) trace.errorCodes.push(ADMISSION_REASONS.corrupt);
      판정 = { admitted: false, reason: ADMISSION_REASONS.corrupt, admission: null };
    }
    // 저장소 오류는 "없음"이 아니다 — 계산이 실패한 것이므로 degraded 다.
    for (const code of errors) {
      trace.status = 'degraded';
      if (!trace.errorCodes.includes(code)) trace.errorCodes.push(code);
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

function 하나판정(id, input, facts, errors) {
  const 거절 = (reason) => ({ admitted: false, reason, admission: null });
  // 계약 A: 세포는 **저장소에서 ID 로 조회**한다(호출자가 건넨 객체는 쓰지 않는다).
  const cell = 조회(input.principleStore, id, errors);
  if (cell === undefined || cell === null) return 거절(ADMISSION_REASONS.notFound);
  if (typeof cell !== 'object' || !문자열(cell.state)) return 거절(ADMISSION_REASONS.corrupt);

  if (!후보가능상태.includes(cell.state)) {
    const 종착 = ['quarantined', 'rolled_back', 'softened'].includes(cell.state);
    return 거절(종착 ? ADMISSION_REASONS.terminal : ADMISSION_REASONS.maturity);
  }
  // 계약 B + 행렬 3: 역할이 비면 입장 자체가 없다. 허용 집합은 **단계**가 정한다.
  const role = resolveRole(cell, rolesForStage(input.stage));
  if (role === 'none') return 거절(ADMISSION_REASONS.roleEmpty);

  // 우선순위 1 + 행렬 2: 현재 지시가 이 원리를 **부정**하면 즉시 거절(원리는 현재 요청을 덮지 못한다).
  // `reinforces`·`unknown` 은 통과한다 — 같은 지시를 반복한 사용자가 자기 원칙을 죽이지 않는다.
  const 지시관계 = judgeDirective(cell, input.requestFacts, facts);
  if (지시관계.relation === 'contradicts') return 거절(ADMISSION_REASONS.conflict);

  const 범위 = 범위판정(cell, input.requestFacts);
  if (!범위.ok) return 거절(범위.code);

  // 계약 C: 3값 경계 판정 — unknown 은 세지 않고, 기록만 한다.
  // 절마다 추출 시점의 원자 결합(`cell.binding`)을 함께 넘긴다 — 자유문과 사실 어휘가 다르더라도
  // 모델이 이미 결합해 뒀으면 매칭된다(§0-C-2). 결합이 없으면 문구 일치로만 본다.
  const 결합 = (cell.binding && typeof cell.binding === 'object') ? cell.binding : {};
  const boundaryChecks = [
    ...(Array.isArray(cell.boundary?.validWhen) ? cell.boundary.validWhen : [])
      .map((c) => ({ kind: 'validWhen', ...judgeClause(c, facts, 결합[c]) })),
    ...(Array.isArray(cell.boundary?.invalidWhen) ? cell.boundary.invalidWhen : [])
      .map((c) => ({ kind: 'invalidWhen', ...judgeClause(c, facts, 결합[c]) })),
    ...(Array.isArray(cell.boundary?.needsReviewWhen) ? cell.boundary.needsReviewWhen : [])
      .map((c) => ({ kind: 'needsReviewWhen', ...judgeClause(c, facts, 결합[c]) })),
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
    const rec = 조회(input.confirmationStore, 문자열(input.requestFacts?.confirmationRefs?.[id]), errors);
    // TG-4 계보검사와 **같은 계약**: kind·tcellId·시각·sourceRefs·계보가 모두 맞아야 한다.
    const 계보 = new Set(Array.isArray(cell.trace?.observationRefs) ? cell.trace.observationRefs : []);
    const refs = Array.isArray(rec?.sourceRefs) ? rec.sourceRefs.filter(문자열) : [];
    const ok = rec && typeof rec === 'object' && rec.kind === 'user_confirmation' && rec.tcellId === cell.id
      && rec.confirmed === true && typeof rec.at === 'number' && Number.isFinite(rec.at)
      && refs.length > 0 && refs.every((r) => 계보.has(r));
    if (!ok) return 거절(ADMISSION_REASONS.confirmation);
  }

  // trace 하강 가능성 — 근거가 실제로 있어야 한다.
  const refs = Array.isArray(cell.trace?.observationRefs) ? cell.trace.observationRefs : [];
  if (!refs.length || refs.some((r) => !조회(input.evidenceStore, r, errors))) return 거절(ADMISSION_REASONS.trace);

  // 계약 D: 참고 가능 여부(실행 승인 아님).
  const 권한 = 권한판정(cell, input.authorityFacts ?? input.requestFacts, input.grantStore, input.now, role, errors);
  if (!권한.allowed) return { ...거절(권한.code), boundaryChecks };

  return {
    admitted: true,
    reason: ADMISSION_REASONS.admitted,
    admission: {
      tcellId: id,
      role,
      reason: ADMISSION_REASONS.admitted,   // 코드만 — 사용자 원문 없음
      stage: 문자열(input.stage) ?? 'pre_model',
      sourceRefs: [...refs],
      boundaryChecks,
      // 행렬 2: 세 값을 그대로 남긴다. `reinforces` 는 입장을 **막지 않았다**는 사실의 기록이고,
      // `unknown` 은 "몰랐다"의 기록이다 — 둘을 같은 칸에 뭉개면 다음 감사가 구분할 수 없다.
      directiveRelation: 지시관계.relation,
      currentRequestConflict: false,
      authorityAllowed: true,               // **판단 참고 가능**이지 실행 승인이 아니다
      grantRef: 권한.grantRef,
      reverifyAtExecution: true,            // 실행 경계에서 반드시 다시 검증한다
    },
  };
}

/**
 * 행렬 2 · **현재 지시와의 관계는 세 값이다.**
 *
 * 감사 재현: 예전에는 이번 턴의 지시가 있으면 문장이 **같아도** 충돌로 보고 거절했다.
 * 사용자가 자기 원칙을 다시 말할수록 그 원칙이 죽는 구조였고, 명세 §21 이
 * 「사용자가 명시한 선호를 같은 범위에서 다시 확인받기」를 금지 구현으로 못박은 바로 그 병이다.
 *
 *  `reinforces`  = 이번 턴 지시가 이 원리와 같다 → **충돌이 아니다**(오히려 근거가 는다)
 *  `contradicts` = 이번 턴 지시가 이 원리를 부정한다 → 즉시 거절(현재 요청 우선)
 *  `unknown`     = 관계를 모른다 → 거절 근거도, 입장 근거도 아니다
 *
 * @returns {{relation:'reinforces'|'contradicts'|'unknown', ref:string|null}}
 */
export function judgeDirective(cell, requestFacts = {}, facts = []) {
  const stmt = 정규화(cell?.principle?.statement);
  const 지시 = Array.isArray(requestFacts?.directives) ? requestFacts.directives : [];
  if (stmt) {
    for (const d of 지시) {
      const ds = 정규화(d?.statement ?? d);
      if (!ds) continue;
      const ref = 문자열(d?.ref) ?? null;
      if (ds === stmt) return { relation: 'reinforces', ref };          // 같은 지시는 충돌이 아니다
      if (ds === `!${stmt}` || stmt === `!${ds}`) return { relation: 'contradicts', ref }; // 명시적 부정
    }
  }
  // **의미 수준의 반대 지시**(§0-C-2): 자연어 부정("보낼 땐 확인하지 마")은 글자 비교로 잡히지
  // 않는다. 그 의미 판정은 **모델이 있는 자리**(추출기의 관계 판정)에서 내려졌고, 결과는
  // 세포에 **지시 문장을 열쇠로** 저장돼 있다(`directiveRelations`). 경계 절의 `binding` 과
  // 같은 모양이다 — 모델이 뜻을 잇고, 여기서는 조회만 한다(핫패스에 의미 판정 없음).
  //
  // **이번 턴의 지시에만 적용된다**(감사 P1 · 2026-07-29). 예전에는 correction 이 하나라도
  // 있으면 이후 무관한 턴까지 영원히 막았다 — 모델의 관계 판정 한 번이 사용자의 일회성
  // 변심인지 장기 철회인지 구분하지 않고 세포를 조용히 죽였다. 수명은 **지시가 정한다**:
  //   · 일회성 — 그 턴에만 지시가 오므로 그 턴만 막힌다
  //   · 범위 한정 — 세포 anchor(project)가 이미 범위를 가른다(다른 자리 세포는 조회조차 안 된다)
  //   · 장기 철회 — 사용자가 확정한 운영 원리는 관련 턴마다 지시로 다시 공급된다
  const 관계표 = (cell?.directiveRelations && typeof cell.directiveRelations === 'object')
    ? cell.directiveRelations : null;
  if (관계표) {
    for (const d of 지시) {
      // 열쇠는 저장할 때와 **같은 정규화**여야 한다(단일 자리 `statement-text.js`).
      const key = normalizeStatement(d?.statement ?? d);
      if (key && 관계표[key] === 'contradicts') return { relation: 'contradicts', ref: 문자열(d?.ref) };
      if (key && 관계표[key] === 'reinforces') return { relation: 'reinforces', ref: 문자열(d?.ref) };
    }
  }
  // 원리가 스스로 "이건 덮지 않는다"고 선언한 것이 이번 턴 사실에 있고, 사용자가 지시한 턴이면 충돌이다.
  // 이 경로는 문장 비교가 아니라 **세포 자신의 선언**이므로 3값 판정과 독립적으로 유효하다.
  const 금지 = Array.isArray(cell?.boundary?.mustNotOverride) ? cell.boundary.mustNotOverride : [];
  if (requestFacts?.userDirective === true) {
    const hit = 금지.map((m) => judgeClause(m, facts)).find((r) => r.verdict === 'matched');
    if (hit) return { relation: 'contradicts', ref: hit.evidenceRef };
  }
  return { relation: 'unknown', ref: null };
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
    [ADMISSION_REASONS.authorityUnknown]: '이번 일의 권한 범위를 아직 확인하지 못했어요.',
    [ADMISSION_REASONS.scopeUnknown]: '지금 작업 범위를 확인하지 못했어요.',
    [ADMISSION_REASONS.confirmation]: '아직 확인하지 않은 원칙이에요.',
    [ADMISSION_REASONS.trace]: '근거를 찾을 수 없어 쓰지 않았어요.',
  };
  return map[decision?.reason] ?? '이 원칙은 이번에 쓰지 않았어요.';
}

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
 * 스냅샷 + 이번 턴 사실 → admission. 스냅샷의 degraded 는 trace 로 승계된다.
 * **같은 스냅샷을 두 단계가 재사용한다**(행렬 3) — 저장소를 다시 읽지 않으므로 비용은 한 번뿐이다.
 */
export function admitFromSnapshot(snapshot, { requestFacts, authorityFacts, now, stage } = {}) {
  const snap = snapshot ?? {};
  const out = admitPrinciples({
    candidateIds: snap.candidateIds ?? [],
    principleStore: snap.principleStore, evidenceStore: snap.evidenceStore,
    confirmationStore: snap.confirmationStore, grantStore: snap.grantStore,
    requestFacts, authorityFacts, now, stage,
  });
  // 범위 밖이라 읽지 않은 수는 판정이 아니라 **사실**이므로 그대로 승계한다.
  out.trace.scopeFiltered = snap.scopeFiltered ?? 0;
  if (snap.status === 'degraded') {
    out.trace.status = 'degraded';
    for (const c of snap.errorCodes ?? []) if (!out.trace.errorCodes.includes(c)) out.trace.errorCodes.push(c);
  }
  return out;
}
