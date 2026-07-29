// L3 · 성장 입력 신뢰경계(결정문 §11.2) — **사용자 문장이 성장 모델 앞에 설 수 있는가**를 여기 한 곳이 정한다.
//
// 왜 경계가 필요한가(실측 2026-07-29~30):
//   · 예전엔 정규식(`detectCandidate`)이 "운영 원리"라고 분류한 문장만 추출에 실렸다. 그래서
//     사람이 "앞으로 이런 건 다른 방법부터 찾아줘"라고 **직접 말한 턴**에서도 모델은 관찰만 받고
//     사람 문장을 한 글자도 못 봤다 — 정규식이 말귀의 관문이었다.
//   · 그걸 고치려고 `input.text` 를 그대로 번들에 복사했더니, 이번엔 저장층의 비밀 경계
//     (`observeUserRequest`)를 지나지 않고 원문이 외부 모델로 나갔다. 저장은 막히는데 송신은
//     안 막히는 비대칭이었다.
//
// 그래서 판정은 **자격 신분**으로 한다. 대화를 처리한 자격과 성장을 처리할 자격이 같으면, 그 문장은
// 이미 그 자격 앞에 있었던 문장이다 — 새 노출이 아니다. 다르면 원문은 0 이고 근거 번들만 간다.
// 어느 경우에도 **저장되는 것은 없다**: 여기서 나온 문장은 휘발성이고, 세포에는 모델이 스스로 쓴
// 문장과 근거 참조만 남는다.
import { looksLikeSecret } from '../kernel/l0-evidence/tcell-observation.js';

/** 휘발성 원문 상한 — 대화 원문을 통째로 나르는 뒷문이 되지 않게(관찰 요약과 같은 자릿수). */
export const GROWTH_TEXT_MAX = 300;

/** 자격이 같은가 — `connectionId` 하나가 provider·model·키를 함께 가리킨다. */
function 같은자격(a, b) {
  if (!a || !b) return false;
  if (a.connectionId && b.connectionId) return a.connectionId === b.connectionId;
  // 연결이 없는 구성(개발자 env·stub·시험): provider 와 model 이 모두 같아야 같은 자격이다.
  if (a.connectionId || b.connectionId) return false;
  return Boolean(a.provider) && a.provider === b.provider && (a.modelId ?? null) === (b.modelId ?? null);
}

/**
 * @param {{text?:string, sourceModelIdentity?:object, growthModelIdentity?:object}} p
 * @returns {{ephemeralText:string, sameCredential:boolean, reason:string}}
 *   `reason` 은 사람에게 띄우는 문장이 아니라 추적용 코드다(카드를 만들지 않는다).
 */
export function buildGrowthInput({ text, sourceModelIdentity, growthModelIdentity } = {}) {
  const 원문 = typeof text === 'string' ? text.trim() : '';
  const same = 같은자격(sourceModelIdentity, growthModelIdentity);
  if (!원문) return { ephemeralText: '', sameCredential: same, reason: 'no_text' };
  // 신분을 모르면 **다른 자격으로 취급한다.** 모를 때 안전한 쪽은 안 보내는 쪽이다.
  if (!same) return { ephemeralText: '', sameCredential: false, reason: 'cross_credential' };
  // 비밀 모양이면 같은 자격이어도 싣지 않는다 — 자격이 같다는 사실이 비밀을 나를 이유가 되지 않는다.
  if (looksLikeSecret(원문)) return { ephemeralText: '', sameCredential: true, reason: 'secret_shaped' };
  return {
    ephemeralText: 원문.replace(/\s+/g, ' ').slice(0, GROWTH_TEXT_MAX),
    sameCredential: true,
    reason: 'same_credential',
  };
}
