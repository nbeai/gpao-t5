// L1 · 말귀 / Input Kernel — 입력을 IntentPacket 으로 해석한다(§2).
// 슬라이스-1 은 결정적(deterministic) 1차 분류를 한다: answerMode·권한경계·확인필요.
// 이 1차 분류는 일반 신호(범주)로만 판단하며, 밀도화 단계에서 모델 분류가 이를 정교화한다.
// 특정 대화 하나에 맞춘 규칙을 넣지 않는다(절대원칙 4: 누더기 금지).
import { TIER } from '../contracts.js';

// 외부효과·도구가 필요한 일반 동사 범주(예시 전용이 아니라 범주 신호).
const ACTION_SIGNALS = /보내|발송|전송|올려|게시|삭제|지워|결제|구매|정리|이동|옮겨|조사|검색|수집|가져와|불러와|분석|만들|작성|바꿔|편집/;
// 강한 권한(A3) 범주.
const A3_SIGNALS = /삭제|지워|결제|구매|공개.?게시|권한|내보내/;
// 짧은 승인(A2) 범주: 외부 전송·쓰기.
const A2_SIGNALS = /보내|발송|전송|올려|게시|메일|슬랙|텔레그램/;
// 지시대상이 불명확한 대명사(확인 필요 후보).
const VAGUE_REF = /^(그거|이거|저거|그것|이것|그거요|그것 좀)/;

/**
 * @param {string} currentRequest  사용자 원문(보존)
 * @param {Object} [opts]
 * @param {import('../contracts.js').SelfStateSnapshot} [opts.selfState]
 * @returns {import('../contracts.js').IntentPacket}
 */
export function interpret(currentRequest, opts = {}) {
  const text = String(currentRequest ?? '');
  const trimmed = text.trim();

  const looksActionable = ACTION_SIGNALS.test(trimmed);
  const answerMode = looksActionable ? 'complex_work' : 'fast_chat';

  // 권한 경계 1차 추정(확정은 ActionPlan/Authority).
  let authorityBoundary = TIER.A0;
  if (A3_SIGNALS.test(trimmed)) authorityBoundary = TIER.A3;
  else if (A2_SIGNALS.test(trimmed)) authorityBoundary = TIER.A2;

  // 확인 필요: 짧고 지시대상이 대명사뿐인데 행동을 요구 → 실행 전 멈추고 묻는다(절대원칙 5).
  const isShort = trimmed.length <= 12;
  const needsClarification = looksActionable && isShort && VAGUE_REF.test(trimmed);

  return {
    currentRequest: text, // 원문 그대로, 요약·왜곡 금지
    desiredOutcome: needsClarification ? '불명확(확인 필요)' : trimmed,
    authorityBoundary,
    answerMode,
    needsClarification,
    neededTools: looksActionable ? inferTools(trimmed) : undefined,
  };
}

/**
 * 필요한 도구 후보(범주 신호). 실행 가능 판정은 SelfState 가 한다.
 * @param {string} t
 */
function inferTools(t) {
  const tools = [];
  if (/메일|이메일/.test(t)) tools.push('mail.send');
  if (/슬랙|slack/i.test(t)) tools.push('slack.post');
  if (/파일|폴더|정리|이동|옮겨/.test(t)) tools.push('local.file');
  if (/조사|검색|수집|가져와|불러와|뉴스|환율/.test(t)) tools.push('web.collect');
  return tools.length ? tools : undefined;
}
