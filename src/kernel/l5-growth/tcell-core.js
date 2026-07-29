// L5 · T-cell 핵심 계약 (TG-0, 명세 §4·§5.2) — **세 축은 절대 합치지 않는다.**
//   MaturityLevel  = 이 원리가 얼마나 검증됐는가
//   InfluenceRole  = 이번 판단에 어떤 방식으로 쓰이는가
//   AuthorityTier  = 그 판단이 실제로 어떤 행동을 할 수 있는가 (기존 A0~A3 그대로 — 별도 체계 없음)
// 불변식(명세 §4.3):
//   · 높은 maturity 가 A2/A3 를 자동 승인하지 않는다.
//   · 사용자 승인이 낮은 maturity 를 사실로 만들지 않는다.
//   · 높은 confidence/activation 이 현재 요청 또는 authority 를 덮지 않는다.
// 검증 실패는 예외로 라이브 턴을 죽이지 않는다 — 후보를 quarantined 로 두고 영향 0.
import { randomUUID } from 'node:crypto';

/**
 * @typedef {'M0_observed'|'M1_candidate'|'M2_replayed'|'M3_limited'|'M4_stable'|'M5_compressed'|'softened'|'quarantined'|'rolled_back'} MaturityLevel
 * @typedef {'none'|'candidate_context'|'supporting_context'|'plan_hint'|'default_value'|'answer_anchor'} InfluenceRole
 * @typedef {'turn'|'task'|'project'|'profile'|'global'} GeometryRadius
 *
 * @typedef {Object} TCellCore
 * @property {string} id
 * @property {number} schemaVersion
 * @property {MaturityLevel} state
 * @property {{statement:string, type:string, hypothesisConfidence:number}} principle hypothesisConfidence 0..1 — 권한 아님
 * @property {{point:string, axis:string, horizontalSignals:string[]}} center
 * @property {{workspace:string|null, project:string|null, surface:string|null, subject:string|null, createdAt:number, lastObservedAt:number}} anchor
 * @property {{validWhen:string[], invalidWhen:string[], needsReviewWhen:string[], mustNotOverride:string[]}} boundary
 * @property {{radius:GeometryRadius, depth:number, sphereStability:number}} geometry
 * @property {{allowedInfluence:InfluenceRole[], requiresUserConfirmation:boolean, mustNotOverrideCurrentRequest:boolean, prohibitedActionKinds:string[]}} authority
 * @property {{observationRefs:string[], rawSourceRefs:string[], derivedFrom:string[], corrections:Object[]}} trace
 * @property {{status:'untested'|'passed_basic'|'passed_transfer'|'failed', caseRefs:string[], lastRunAt:number|null}} replay
 * @property {{eligibleCount:number, successCount:number, failureCount:number, userCorrectionCount:number, wilsonLowerBound:number, sameFailureRecurrenceCount:number, authorityViolationCount:number}} effect
 * @property {{mutationRefs:string[], rollbackAvailable:boolean, previousVersionId:string|null, lastAuditAt:number|null}} growth
 */

export const TCELL_SCHEMA_VERSION = 1;

export const MATURITY_LEVELS = Object.freeze([
  'M0_observed', 'M1_candidate', 'M2_replayed', 'M3_limited', 'M4_stable',
  'M5_compressed', 'softened', 'quarantined', 'rolled_back',
]);

export const INFLUENCE_ROLES = Object.freeze([
  'none', 'candidate_context', 'supporting_context', 'plan_hint', 'default_value', 'answer_anchor',
]);

export const PRINCIPLE_TYPES = Object.freeze([
  'context_selection', 'planning', 'execution', 'recovery',
  'workflow', 'automation', 'authority', 'communication',
]);

export const GEOMETRY_RADII = Object.freeze(['turn', 'task', 'project', 'profile', 'global']);

// 성숙도별 영향 상한(명세 §4.2) — confidence 는 이 표에 **등장하지 않는다.** 그게 계약이다.
const INFLUENCE_CEILING = Object.freeze({
  M0_observed: ['none'],
  M1_candidate: ['none', 'candidate_context'],
  M2_replayed: ['none', 'candidate_context', 'supporting_context'],
  M3_limited: ['none', 'candidate_context', 'supporting_context', 'plan_hint', 'default_value'],
  M4_stable: INFLUENCE_ROLES,
  M5_compressed: INFLUENCE_ROLES,
  softened: ['none', 'candidate_context'],
  quarantined: ['none'],
  rolled_back: ['none'],
});

/** 이 성숙도에서 허용되는 영향 역할 — confidence·승인 여부와 무관하다(불변식). */
export function influenceCeilingFor(state) {
  return INFLUENCE_CEILING[state] ?? ['none'];
}

/**
 * 반경 상한 — **통계가 곧 권한이 되지 않는다**(감사 2026-07-29). 관찰이 아무리 쌓여도
 * 근거 수만으로는 task 를 넘지 못한다. project/profile 은 transfer replay 통과가,
 * global 은 거기에 M4 이상 성숙까지 필요하다. 한 번의 정정은 언제나 task 까지다(§8).
 */
export function radiusCeilingFor(cell) {
  const 관찰수 = new Set((Array.isArray(cell?.trace?.observationRefs) ? cell.trace.observationRefs : [])).size;
  if (관찰수 <= 1) return 'task';
  if (cell?.replay?.status !== 'passed_transfer') return 'task'; // 확대는 제안까지 — 승인은 replay 뒤
  if (cell?.state === 'M4_stable' || cell?.state === 'M5_compressed') return 'global';
  return 'profile';
}

/** @deprecated TG-0 감사로 대체 — 근거 수만으로 반경을 열지 않는다. */
export function radiusCeilingForEvidence(trace) {
  return radiusCeilingFor({ trace, replay: { status: 'untested' } });
}

const RADIUS_ORDER = { turn: 0, task: 1, project: 2, profile: 3, global: 4 };

/** 원리 후보 생성 — 언제나 M1·영향 none·되돌리기 가능에서 시작한다. */
export function makeTCellCandidate(input = {}) {
  return {
    id: input.id ?? randomUUID(),
    schemaVersion: TCELL_SCHEMA_VERSION,
    state: 'M1_candidate',
    principle: {
      statement: String(input.principle?.statement ?? '').trim(),
      type: input.principle?.type,
      hypothesisConfidence: input.principle?.hypothesisConfidence ?? 0,
    },
    center: {
      point: input.center?.point ?? '',
      axis: input.center?.axis ?? '',
      horizontalSignals: [...(input.center?.horizontalSignals ?? [])],
    },
    anchor: {
      workspace: input.anchor?.workspace ?? null,
      project: input.anchor?.project ?? null,
      surface: input.anchor?.surface ?? null,
      subject: input.anchor?.subject ?? null,
      createdAt: input.anchor?.createdAt ?? 0,
      lastObservedAt: input.anchor?.lastObservedAt ?? 0,
    },
    boundary: {
      validWhen: [...(input.boundary?.validWhen ?? [])],
      invalidWhen: [...(input.boundary?.invalidWhen ?? [])],
      needsReviewWhen: [...(input.boundary?.needsReviewWhen ?? [])],
      mustNotOverride: [...(input.boundary?.mustNotOverride ?? [])],
    },
    geometry: {
      radius: input.geometry?.radius ?? 'turn',
      depth: input.geometry?.depth ?? 0,
      sphereStability: input.geometry?.sphereStability ?? 0,
    },
    authority: {
      allowedInfluence: [...(input.authority?.allowedInfluence ?? ['none'])],
      requiresUserConfirmation: input.authority?.requiresUserConfirmation ?? true,
      mustNotOverrideCurrentRequest: true, // 사용자 원문·현재 목적은 어떤 원리보다 우선 — 끌 수 없다
      prohibitedActionKinds: [...(input.authority?.prohibitedActionKinds ?? [])],
    },
    trace: {
      observationRefs: [...(input.trace?.observationRefs ?? [])],
      rawSourceRefs: [...(input.trace?.rawSourceRefs ?? [])],
      derivedFrom: [...(input.trace?.derivedFrom ?? [])],
      corrections: [...(input.trace?.corrections ?? [])],
    },
    replay: {
      status: input.replay?.status ?? 'untested',
      caseRefs: [...(input.replay?.caseRefs ?? [])],
      lastRunAt: input.replay?.lastRunAt ?? null,
    },
    effect: {
      eligibleCount: 0, successCount: 0, failureCount: 0, userCorrectionCount: 0,
      wilsonLowerBound: 0, sameFailureRecurrenceCount: 0, authorityViolationCount: 0,
      ...(input.effect ?? {}),
    },
    growth: {
      mutationRefs: [...(input.growth?.mutationRefs ?? [])],
      rollbackAvailable: input.growth?.rollbackAvailable ?? true,
      previousVersionId: input.growth?.previousVersionId ?? null,
      lastAuditAt: input.growth?.lastAuditAt ?? null,
    },
  };
}

/** total-function 도우미 — 임의 JSON 이 와도 던지지 않는다(감사 1). */
const arr = (v) => (Array.isArray(v) ? v : null);
const num이상 = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** 경계 4묶음이 전부 **배열로** 존재해야 한다(비어 있는 경계는 "어디서나 유효"가 되기 쉽다). */
export function assertBoundaryComplete(cell) {
  const errors = [];
  const b = cell?.boundary;
  if (!b || typeof b !== 'object') return ['boundary 가 없어요'];
  if (!arr(b.validWhen)?.length) errors.push('validWhen 이 비어 있어요');
  if (!arr(b.invalidWhen)?.length) errors.push('invalidWhen 이 비어 있어요 — 반례 없는 원리는 원리가 아니에요');
  if (!arr(b.needsReviewWhen)) errors.push('needsReviewWhen 이 없어요');
  if (!arr(b.mustNotOverride)) errors.push('mustNotOverride 가 없어요');
  return errors;
}

/** trace 로 근거까지 내려갈 수 있는가 — 근거 없는 원리는 격리 대상이다. */
export function assertTraceDescendable(cell, evidenceStore = null) {
  const errors = [];
  const refs = arr(cell?.trace?.observationRefs);
  if (!refs) return ['trace(observationRefs)가 배열이 아니에요'];
  if (!refs.length) errors.push('필수 trace(observationRefs)가 없어요');
  if (evidenceStore) {
    for (const ref of refs) {
      if (!evidenceStore.has?.(ref)) errors.push(`근거를 찾을 수 없어요: ${ref}`);
    }
  }
  return errors;
}

/**
 * 3축 분리 불변식 — confidence·성숙도·승인 어느 것도 authority 를 만들지 못한다.
 * 여기서 confidence 를 **읽지 않는 것 자체가 검사 대상**이다(반대시험이 1.0 을 넣어 확인).
 * 임의 입력(allowedInfluence: 7 등)에도 던지지 않는다 — 계약 위반은 전부 errors 로.
 */
export function assertAuthorityInvariant(cell) {
  const errors = [];
  const a = cell?.authority;
  if (!a || typeof a !== 'object') return ['authority 가 없어요'];
  const roles = arr(a.allowedInfluence);
  if (!roles) errors.push('allowedInfluence 가 배열이 아니에요');
  else {
    const ceiling = influenceCeilingFor(cell?.state);
    for (const role of roles) {
      if (!INFLUENCE_ROLES.includes(role)) errors.push(`영향 역할이 계약 밖이에요: ${role}`);
      else if (!ceiling.includes(role)) errors.push(`${cell?.state} 에서 ${role} 은 허용되지 않아요`);
    }
  }
  if (a.mustNotOverrideCurrentRequest !== true) errors.push('현재 요청 우선 계약은 끌 수 없어요');
  if (typeof a.requiresUserConfirmation !== 'boolean') errors.push('requiresUserConfirmation 은 불리언이에요');
  if (!arr(a.prohibitedActionKinds)) errors.push('prohibitedActionKinds 가 배열이 아니에요');
  const 상한 = radiusCeilingFor(cell);
  if ((RADIUS_ORDER[cell?.geometry?.radius] ?? 99) > RADIUS_ORDER[상한]) {
    errors.push(`지금 근거·replay·성숙도로는 반경 ${cell?.geometry?.radius} 를 만들 수 없어요(상한 ${상한})`);
  }
  return errors;
}

/** 수치·enum·불리언 총체 검증(감사 2) — 범위 밖 통계는 통계가 아니라 오염이다. */
export function assertRangesValid(cell) {
  const errors = [];
  if (!num이상(cell?.principle?.hypothesisConfidence, 0, 1)) errors.push('confidence 는 0..1 이에요');
  if (!num이상(cell?.geometry?.depth, 0, Number.MAX_SAFE_INTEGER)) errors.push('depth 는 0 이상이에요');
  if (!num이상(cell?.geometry?.sphereStability, 0, 1)) errors.push('sphereStability 는 0..1 이에요');
  const REPLAY_STATUSES = ['untested', 'passed_basic', 'passed_transfer', 'failed'];
  if (!REPLAY_STATUSES.includes(cell?.replay?.status)) errors.push(`replay 상태가 계약 밖이에요: ${cell?.replay?.status}`);
  if (!arr(cell?.replay?.caseRefs)) errors.push('replay.caseRefs 가 배열이 아니에요');
  const e = cell?.effect ?? {};
  for (const k of ['eligibleCount', 'successCount', 'failureCount', 'userCorrectionCount', 'sameFailureRecurrenceCount', 'authorityViolationCount']) {
    if (!(Number.isInteger(e[k]) && e[k] >= 0)) errors.push(`effect.${k} 는 0 이상의 정수예요`);
  }
  if (!num이상(e.wilsonLowerBound, 0, 1)) errors.push('wilsonLowerBound 는 0..1 이에요');
  if (typeof cell?.growth?.rollbackAvailable !== 'boolean') errors.push('rollbackAvailable 은 불리언이에요');
  return errors;
}

/** 압축(M5) 안전: 원본 세포들의 trace 가 압축본에서 끊기지 않아야 한다. */
export function assertCompressionSafe(cell, sourceCells = []) {
  const errors = [];
  if (cell?.state !== 'M5_compressed') return errors;
  const derived = new Set(arr(cell?.trace?.derivedFrom) ?? []);
  if (!derived.size) errors.push('압축본(M5)에 원본 trace(derivedFrom)가 없어요');
  for (const src of sourceCells) {
    if (!derived.has(src?.id)) errors.push(`압축이 원본 trace 를 잃었어요: ${src?.id}`);
  }
  return errors;
}

/**
 * 전체 검증 — **임의 JSON 에도 던지지 않는 total function**(감사 1). 실패는 quarantined
 * 사본(영향 none·현재 요청 우선 강제)으로 돌아가고 라이브 턴은 계속된다.
 * @param {*} cell
 * @param {{has?:(ref:string)=>boolean}|null} [evidenceStore]
 * @param {{sourceCells?:object[]}} [opts] M5 압축 검증용 원본 세포들
 * @returns {{ok:boolean, errors:string[], cell:object}}
 */
export function validateTCell(cell, evidenceStore = null, opts = {}) {
  let errors = [];
  try {
    if (!cell || typeof cell !== 'object') errors.push('세포가 비어 있어요');
    else {
      if (!MATURITY_LEVELS.includes(cell.state)) errors.push(`상태가 계약 밖이에요: ${cell.state}`);
      if (!PRINCIPLE_TYPES.includes(cell.principle?.type)) errors.push('원리 종류가 계약 밖이에요');
      if (!(typeof cell.principle?.statement === 'string' && cell.principle.statement)) errors.push('원리 문장이 비어 있어요');
      if (!GEOMETRY_RADII.includes(cell.geometry?.radius)) errors.push('반경이 계약 밖이에요');
      if (cell.schemaVersion !== TCELL_SCHEMA_VERSION) errors.push('schemaVersion 불일치');
      errors.push(...assertTraceDescendable(cell, evidenceStore));
      errors.push(...assertBoundaryComplete(cell));
      errors.push(...assertAuthorityInvariant(cell));
      errors.push(...assertRangesValid(cell));
      errors.push(...assertCompressionSafe(cell, opts?.sourceCells ?? []));
    }
  } catch (e) {
    // 마지막 방어선 — 어떤 경로로든 던졌다면 그 자체가 격리 사유다(계약: 턴을 죽이지 않는다).
    errors = [...errors, `검증기 내부 오류: ${e?.message ?? e}`];
  }
  if (errors.length === 0) return { ok: true, errors, cell };
  return {
    ok: false,
    errors,
    cell: {
      ...(cell && typeof cell === 'object' ? cell : {}),
      state: 'quarantined',
      authority: {
        ...(cell && typeof cell === 'object' && typeof cell.authority === 'object' ? cell.authority : {}),
        allowedInfluence: ['none'],
        mustNotOverrideCurrentRequest: true,
      },
    },
  };
}
