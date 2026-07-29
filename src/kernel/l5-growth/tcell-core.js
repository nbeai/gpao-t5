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
 * 근거 규모가 허용하는 반경 상한 — **한 번의 정정으로 project/global 원리가 생기지 않는다**
 * (명세 §8: 한 사례 전역화 차단). 반경 확장은 서로 다른 관찰이 쌓여야 한다.
 */
export function radiusCeilingForEvidence(trace) {
  const 관찰수 = new Set(trace?.observationRefs ?? []).size;
  if (관찰수 <= 1) return 'task';
  if (관찰수 < 5) return 'project';
  return 'global';
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

/** 경계 4묶음이 전부 존재해야 한다(비어 있는 경계는 "어디서나 유효"라는 뜻이 되기 쉽다). */
export function assertBoundaryComplete(cell) {
  const errors = [];
  const b = cell?.boundary;
  if (!b) return ['boundary 가 없어요'];
  if (!(b.validWhen?.length)) errors.push('validWhen 이 비어 있어요');
  if (!(b.invalidWhen?.length)) errors.push('invalidWhen 이 비어 있어요 — 반례 없는 원리는 원리가 아니에요');
  if (!Array.isArray(b.needsReviewWhen)) errors.push('needsReviewWhen 이 없어요');
  if (!Array.isArray(b.mustNotOverride)) errors.push('mustNotOverride 가 없어요');
  return errors;
}

/** trace 로 근거까지 내려갈 수 있는가 — 근거 없는 원리는 격리 대상이다. */
export function assertTraceDescendable(cell, evidenceStore = null) {
  const errors = [];
  const refs = cell?.trace?.observationRefs ?? [];
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
 */
export function assertAuthorityInvariant(cell) {
  const errors = [];
  const ceiling = influenceCeilingFor(cell?.state);
  for (const role of cell?.authority?.allowedInfluence ?? []) {
    if (!INFLUENCE_ROLES.includes(role)) errors.push(`영향 역할이 계약 밖이에요: ${role}`);
    else if (!ceiling.includes(role)) errors.push(`${cell.state} 에서 ${role} 은 허용되지 않아요`);
  }
  if (cell?.authority?.mustNotOverrideCurrentRequest !== true) {
    errors.push('현재 요청 우선 계약은 끌 수 없어요');
  }
  const 반경상한 = radiusCeilingForEvidence(cell?.trace);
  if ((RADIUS_ORDER[cell?.geometry?.radius] ?? 99) > RADIUS_ORDER[반경상한]) {
    errors.push(`근거 규모로는 반경 ${cell?.geometry?.radius} 를 만들 수 없어요(상한 ${반경상한})`);
  }
  return errors;
}

/** 압축(M5) 안전: 원본 세포들의 trace 가 압축본에서 끊기지 않아야 한다. */
export function assertCompressionSafe(cell, sourceCells = []) {
  const errors = [];
  if (cell?.state !== 'M5_compressed') return errors;
  const derived = new Set(cell?.trace?.derivedFrom ?? []);
  for (const src of sourceCells) {
    if (!derived.has(src.id)) errors.push(`압축이 원본 trace 를 잃었어요: ${src.id}`);
  }
  if (!sourceCells.length) errors.push('압축본에 원본 세포가 없어요');
  return errors;
}

/**
 * 전체 검증. 실패는 던지지 않는다 — **quarantined 사본**을 돌려주고 영향 0 으로 둔다
 * (명세 §5.2: 검증 실패가 라이브 턴을 죽이지 않는다).
 * @returns {{ok:boolean, errors:string[], cell:object}}
 */
export function validateTCell(cell, evidenceStore = null) {
  const errors = [];
  if (!MATURITY_LEVELS.includes(cell?.state)) errors.push(`상태가 계약 밖이에요: ${cell?.state}`);
  if (!PRINCIPLE_TYPES.includes(cell?.principle?.type)) errors.push('원리 종류가 계약 밖이에요');
  if (!cell?.principle?.statement) errors.push('원리 문장이 비어 있어요');
  if (!GEOMETRY_RADII.includes(cell?.geometry?.radius)) errors.push('반경이 계약 밖이에요');
  if (cell?.schemaVersion !== TCELL_SCHEMA_VERSION) errors.push('schemaVersion 불일치');
  errors.push(...assertTraceDescendable(cell, evidenceStore));
  errors.push(...assertBoundaryComplete(cell));
  errors.push(...assertAuthorityInvariant(cell));
  if (errors.length === 0) return { ok: true, errors, cell };
  return {
    ok: false,
    errors,
    cell: { ...cell, state: 'quarantined', authority: { ...cell?.authority, allowedInfluence: ['none'], mustNotOverrideCurrentRequest: true } },
  };
}
