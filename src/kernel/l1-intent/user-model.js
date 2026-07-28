// L1 · User Model Separation (P6-17 Slice-3). 두 가지를 kind/schema/lane에서 분리한다:
//   - inferred_trait(추정된 성향): **관찰만.** 영향 0. admittedContext/TaskContextPacket에 절대 안 들어간다.
//     observed 레인에 살고, context-mesh isInfluenceEligible이 kind로 한 번 더 거부한다(방어적 이중화).
//   - operating_preference(승인된 운영 선호): userConfirmed + admission 이후에만 좁게 입장(context-mesh 재사용,
//     candidates→promoted 레인). 관련될 때만 좁게(broad memory, narrow influence).
// 핵심 경계: **추정을 승인으로 자동 승격하지 않는다.** 추정은 관찰일 뿐, 사용자가 명시 확인해야 운영 선호가 된다.
import { promote } from './context-mesh.js';

export const USER_MODEL_KINDS = Object.freeze(['inferred_trait', 'operating_preference']);

/**
 * 추정된 성향 — 관찰 후보. **영향 0, 승격 대상 아님.** observed 레인에만 산다.
 * @param {string} id
 * @param {string} statement  추정 내용(사용자 언어)
 * @param {string[]} [evidence]  무엇을 보고 추정했나(관찰 근거)
 */
export function makeInferredTrait(id, statement, evidence = []) {
  return {
    traitId: id,
    kind: 'inferred_trait',
    statement,
    evidence,
    observedOnly: true, // 관찰 전용 표식 — 영향 경로에 들어가지 않는다
    admitted: false,
    userConfirmed: false,
  };
}

/**
 * 승인된 운영 선호 후보 — context-mesh 승격 흐름과 정합(userConfirmed 후 promoted → admittedContext).
 * 생성 시점엔 후보(영향 0). 확인해야 영향.
 * @param {string} id
 * @param {string} statement
 */
export function makeOperatingPreference(id, statement) {
  return {
    candidateId: id,
    kind: 'operating_preference',
    statement,
    admitted: false,
    replayPassed: false,
    userConfirmed: false,
    rollbackable: true,
  };
}

/**
 * 운영 선호 승인(admission) — 사용자 확인으로 승격한다(context-mesh promote 재사용). 추정과 달리 승격 대상.
 * @returns {{ok:boolean, entry?:object, reason?:string}}
 */
export function confirmOperatingPreference(pref) {
  return promote(pref, { userConfirmed: true });
}

// 사용자 확인으로 반영되는 모든 기억 종류 — **투영의 단일 진실**(H 감사 2026-07-29).
// 예전엔 operating_preference 만 투영해서, 대화에서 생긴 preference/operating_principle 후보는
// 저장소에 있어도 사용자가 볼 자리가 없었다(승인·철회 불가 — 죽은 후보로 쌓였다).
// recalled_context 는 기억 검색의 반영분으로 overview 의 "기억" 절이 따로 그린다.
const CONFIRMABLE_KINDS = new Set(['preference', 'operating_principle', 'operating_preference']);

/**
 * 사용자 모델을 표면용으로 투영 — **"추정됨"과 "반영 중"을 분명히 분리**(P6-18에서 다르게 보여주기 위함).
 *   추정 성향: 항상 admitted:false, influence:'none'. 확인 대상 기억: 확인 대기 / 반영 중.
 *   이 함수가 기억 대기·반영 상태의 **단일 투영**이다 — 표면이 저장소를 직접 읽고 추측하지 않는다.
 * @param {{observed?:object[], candidates?:object[], promoted?:object[]}} memory
 */
export function projectUserModel(memory) {
  const inferredTraits = (memory?.observed ?? [])
    .filter((t) => t.kind === 'inferred_trait')
    .map((t) => ({ statement: t.statement, evidence: t.evidence ?? [], admitted: false, influence: 'none' }));
  const pending = (memory?.candidates ?? [])
    .filter((c) => CONFIRMABLE_KINDS.has(c.kind))
    .map((c) => ({ id: c.candidateId, kind: c.kind, statement: c.statement, status: 'pending_confirm', admitted: false }));
  const admitted = (memory?.promoted ?? [])
    .filter((p) => CONFIRMABLE_KINDS.has(p.kind))
    .map((p) => ({ id: p.candidateId, kind: p.kind, statement: p.statement, status: 'admitted', admitted: true })); // id: 되돌리기용
  return { inferredTraits, operatingPreferences: [...pending, ...admitted] };
}
