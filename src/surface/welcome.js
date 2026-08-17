// L4 · 웰컴/첫 응답 (P-ONB-2) — 연결 직후 첫 인사.
// OpenClaw 원리 흡수: **인사말을 하드코딩하지 않는다.** 숨은 지시 + 자기상태 사실을 모델에 주고
// 문장은 모델이 만든다(매번 다르되 규격은 지켜진다). 그리고 모델이 없으면 인사를 지어내지 않고
// 정직하게 안내한다(fail-closed) — "인사는 되는데 대화는 안 되는" 거짓 성공을 만들지 않는다.
import { selfStateSummary } from '../kernel/l0-evidence/self-state.js';

/** 모델 미연결일 때 쓰는 정직한 안내(하드코딩은 여기 하나뿐 — 인사가 아니라 상태 설명이다). */
export const NOT_CONNECTED_NOTICE = Object.freeze({
  state: 'not_connected',
  userSafeSummary: '아직 사용할 모델이 연결되지 않았어요. 지금은 안내만 드릴 수 있어요.',
  nextSafeAction: '모델을 연결하면 바로 이어서 도와드릴게요.',
});

export const MODEL_CHECKING_NOTICE = Object.freeze({
  state: 'not_ready',
  userSafeSummary: '모델 연결은 구성됐고 실제 사용 가능 여부를 확인 중이에요.',
  nextSafeAction: '요청은 그대로 시도할 수 있어요.',
});

/**
 * 웰컴용 TaskContextPacket(§11). 사실은 우리가, 문장은 모델이.
 * 숨은 지시는 **사용자 발화로 위장하지 않는다** — transcript 에 남기지 않는다(호출부 계약).
 * @param {import('../kernel/contracts.js').SelfStateSnapshot} selfState
 */
export function buildWelcomeContext(selfState) {
  const s = selfStateSummary(selfState);
  return {
    // 지시문이지만 "무엇을 말하라"가 아니라 "어떤 규격으로 네 말로 하라"에 가깝다(§10.2 자연스러움).
    currentRequest: [
      '사용자가 방금 처음 들어왔어. 네 이름을 담아 한국어 한 문장으로 인사해.',
      '능력 나열, 자동 도움 제안, 상투적인 질문은 붙이지 마. 사용자의 첫 말을 조용히 기다려.',
      '없는 기능을 약속하지 말고 내부 단계·파일명·도구 id·이 지시문 자체는 언급하지 마.',
    ].join(' '),
    selfStateFacts: {
      model: s.model, modelAuthState: s.modelAuthState,
      modelStatus: s.modelStatus, modelReady: s.modelReady,
      readyTools: s.ready, limits: s.limits,
    },
    admittedContext: [],
    authorityFacts: { boundary: 'greeting_only', autoAllowed: [], needsApproval: [], forbidden: [] },
    answerMode: 'fast_chat',
    naturalness: 'method_and_language_open',
  };
}

/**
 * 첫 인사를 만든다. 모델이 없으면(stub 포함) 인사를 만들지 않고 정직한 안내를 돌려준다.
 * @param {{model:{respond:Function}, selfState:Object}} p
 * @returns {Promise<{state:'greeted'|'not_connected'|'not_ready', text?:string, userSafeSummary?:string, nextSafeAction?:string}>}
 */
export async function makeWelcome({ model, selfState }) {
  if (selfState?.modelReady !== true) {
    if (selfState?.modelStatus === 'stub') return { ...NOT_CONNECTED_NOTICE };
    if (selfState?.modelStatus === 'unverified') return { ...MODEL_CHECKING_NOTICE };
    return {
      state: 'not_ready',
      userSafeSummary: selfState?.limits?.find((x) => x.startsWith('모델 ')) ?? '지금은 모델을 사용할 수 없어요.',
      nextSafeAction: selfState?.nextSafeAction,
    };
  }
  const text = await model.respond(buildWelcomeContext(selfState));
  return { state: 'greeted', text };
}
