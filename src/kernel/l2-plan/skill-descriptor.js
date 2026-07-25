// L2 · SkillDescriptor (2.0-C-2 계약 초안). 스킬 = 작업 "방식"(도구 ≠ 스킬).
// 정본: T5-2.0-TOOLBOX-CONNECTION-CENTER-UX-REFERENCE §6.8(오너), 헌법 최상위 원칙(사용자를 덜 헤매게).
// 이 슬라이스는 계약 초안 + 후보 생성/표시 기준까지. UI·store·실행은 2.0-C-2 후속.
//
// 도구(ToolDescriptor)는 실행 수단, 스킬(SkillDescriptor)은 작업 방식이다. 스킬은 도구를 포함할 수 있지만
// 도구와 같지 않으며, 아래 다섯 축을 가진다:
//   말귀(understanding) · 절차(procedure) · 맥락(context) · 결과물 형식(outputShape) · replay 테스트.
// 추천은 설치·승격이 아니다: 사용자의 확인과 replay 게이트를 지나기 전에는 행동에 영향을 주지 않는다.

export const SKILL_TEST_STATES = Object.freeze(['untested', 'passed', 'failed']);

/**
 * @typedef {Object} SkillDescriptor
 * @property {string} id
 * @property {string} label                     사용자 언어 이름(예: "리뷰 분석", "주간 보고")
 * @property {string} understanding             말귀: 어떤 요청을 이 스킬로 볼지(트리거·의도)
 * @property {string[]} procedure               절차: 단계(사용자 언어). 도구를 참조할 수 있음
 * @property {string[]} usesTools               포함하는 도구 id(있으면). 스킬은 도구를 조합하되 도구가 아님
 * @property {string} contextNeeded             맥락: 필요한 입력·자료(무엇을 물어보거나 복원할지)
 * @property {string} outputShape               결과물 형식(예: "표+요약", "카드뉴스", "안내 메시지")
 * @property {'untested'|'passed'|'failed'} testState  replay 테스트 전에는 행동 영향 0
 */

/**
 * 스킬 계약 생성(초안). 등록됨 ≠ 사용 가능: replay 테스트 통과 전에는 executable 아님.
 * @param {Partial<SkillDescriptor>} p
 * @returns {SkillDescriptor}
 */
export function defineSkill(p = {}) {
  return {
    id: p.id,
    label: p.label ?? p.id,
    owner: 'personal',
    understanding: p.understanding ?? '',
    procedure: Array.isArray(p.procedure) ? p.procedure : [],
    usesTools: Array.isArray(p.usesTools) ? p.usesTools : [],
    contextNeeded: p.contextNeeded ?? '',
    outputShape: p.outputShape ?? '',
    testState: 'untested',
  };
}

// 스킬 후보 생성/표시 기준(초안): "이런 일을 이렇게 자주 한다"가 보이면 스킬 후보로 제안한다.
// 반복 작업(자동화)과 구분: 자동화=같은 실행을 반복, 스킬=같은 "방식"을 재사용(입력이 달라도).
const SKILL_SIGNAL = /(방식|방법|절차|템플릿|양식|포맷).*(기억|저장|등록|만들)|(늘|항상|매번) (이렇게|이 방식|같은 방식)/;

/**
 * 스킬 후보 감지(자동 생성 아님 — 후보만, 확인·replay 전 영향 0).
 * @returns {{label:string, requestText:string}|null}
 */
export function detectSkillRequest(text) {
  const t = String(text ?? '').trim();
  if (!SKILL_SIGNAL.test(t)) return null;
  return { label: t.slice(0, 40), requestText: t };
}

/** replay 테스트 통과분만 사용 가능(도구의 executable에 대응). */
export function isSkillReady(skill) {
  return skill.testState === 'passed';
}
