// L0 · 자가 정체성 (P-ID-1) — T5 는 어떤 모델이 붙든 자기가 무엇인지 안다.
//
// 왜(오너 실사용 2026-07-26 실측): 모델에게 준 자기 소개가 "너는 사용자의 작업 비서다" 한 줄뿐이라
// 빈칸을 모델이 자기 출신으로 채웠다 — "저는 ChatGPT예요" / 자기가 OS 인 줄 모름 / 자기 이름을
// GPT-5 로 오해. 헌법 §5(자기파악)가 요구하는 다섯 가지 중 절반이 모델에 도달하지 않았다.
//
// 정본: 아래 정체 문장은 **계획서 v3.0 §0·§0.1 오너 원문**이다(오너 지시로 요약·재작성 금지).
import { PRODUCT_NAME, SOUL_SEED } from './soul-seed.js';

export { PRODUCT_NAME };

/** 사용자가 이름을 지어주기 전의 기본 정체. */
export const DEFAULT_IDENTITY = Object.freeze({ name: PRODUCT_NAME, named: false, soul: SOUL_SEED });

/**
 * 매 턴 프롬프트 맨 앞에 실릴 정체 사실. **짧게** 유지한다(계획서 Phase 2 다이어트) —
 * 깊은 내용은 CAPABILITIES 문서에서 필요할 때만 꺼낸다.
 * @param {{name?:string, named?:boolean, soul?:string}} [identity]
 * @param {{model?:string, ready?:number, needsApproval?:number, blocked?:number}} [state]
 */
export function buildIdentityFacts(identity = DEFAULT_IDENTITY, state = {}) {
  const name = identity?.name || PRODUCT_NAME;
  const lines = [
    `너의 이름은 ${name}다. 너는 AI 모델이 아니라 ${PRODUCT_NAME}, 사용자의 일을 실제로 처리하는 AI 운영체제다.`,
    '모델은 추론·문장·판단·창작을 하고, 너(OS)는 현재 요청 보존·맥락 반영·자기 상태 파악·도구와 권한 구분·'
    + '실행 가능성 판정·외부 효과 승인·기록·실패 복구·학습·세션 지속을 맡는다.',
  ];
  if (identity?.named && name !== PRODUCT_NAME) {
    lines.push(`${name}는 사용자가 지어 준 이름이고 제품 이름은 ${PRODUCT_NAME}다.`);
  }
  if (state.model) {
    lines.push(
      `지금 네 생각을 돌리는 모델은 ${state.model}다. 그건 네가 쓰는 두뇌일 뿐 네 이름도 정체도 아니다.`
      + ' 이름·정체를 물으면 위 이름으로 답하고, 어떤 모델을 쓰는지 물을 때만 모델명을 답한다.'
      + ' 모델 제공자의 이름을 네 이름처럼 말하지 마라.',
    );
  }
  // 지금 상태 한 줄 — "무엇을 어디까지"의 요약(상세는 필요할 때 문서에서).
  const counts = [];
  if (state.ready != null) counts.push(`지금 바로 할 수 있는 일 ${state.ready}가지`);
  if (state.needsApproval != null && state.needsApproval > 0) counts.push(`확인받고 할 수 있는 일 ${state.needsApproval}가지`);
  if (state.blocked != null && state.blocked > 0) counts.push(`지금은 막힌 일 ${state.blocked}가지`);
  if (counts.length) lines.push(`네가 지금 할 수 있는 범위: ${counts.join(' · ')}. 자세한 건 아래 사실을 본다.`);
  return lines;
}

/** 화면·응답에 쓸 표시 이름. */
export function displayName(identity = DEFAULT_IDENTITY) {
  return identity?.name || PRODUCT_NAME;
}
