// L2 · **손 제시 계측 — 무엇을 줬고 무엇을 왜 걸렀는가.**
//
// 왜 필요한가(오너 지시 2026-08-05, S7 착수 전 조건):
//   *"안 준 손은 흔적이 없다. 손 22개 중 6개를 주고, 16개는 안 준 사실이 어디에도 안 남는다.
//     S0 가 S1 을 살린 것과 같은 자리다. 계측 없이 S7 을 하면 나중에 원인 없이 뒤지게 된다."*
//
// S7 은 **손 집합을 상황에서 계산하는** 칸이다. 틀려도 화면에 안 나타난다 —
// "모델이 요즘 좀 이상한데"로만 보인다. S6 은 틀리면 216칸 표가 잡았지만
// 여기는 잡을 표가 없다. 그래서 **거른 사실 자체를 기록으로 만든다.**
//
// 이 파일은 **판정하지 않는다.** 누구를 줄지는 `selfState` 가 이미 정했다(`executable`).
// 여기서 하는 일은 그 결정을 **볼 수 있게 만드는 것**뿐이다 — 두 진실을 만들지 않는다.
//
// 그래서 준 목록을 **모델이 실제로 받는 그 목록에서 파생한다**(`toolSchemasFor`).
// 처음엔 여기에 `executable && schema` 를 한 벌 더 적었다 — 이번 단계 내내 없앤 바로 그 병이다.
// 기준이 두 벌이면 계측기가 실제와 다른 것을 재고, **거짓말하는 계측기는 없느니만 못하다.**
import { toolSchemasFor } from './tool-schema.js';

/** 손 선언이 말하는 "왜 못 쓰나". 없으면 지어내지 않는다. */
const 이유말 = (t) => {
  if (t?.reason) return t.reason;          // needs_connection · needs_setup · needs_permission · planned · disabled · error
  if (t?.executable && !t?.schema) return 'no_schema';  // 실행은 되는데 부를 방법을 안 밝혔다
  return 'unknown';                        // **모르면 모른다고 적는다** — 그럴듯한 이유를 만들지 않는다
};

/**
 * 이번 계산에서 **모델에게 준 손**과 **거른 손(이유)**.
 *
 * `toolSchemasFor` 와 같은 기준을 쓴다(`executable && schema`). 기준을 여기 다시 적지 않는다 —
 * 두 벌이 되면 계측기가 실제와 다른 것을 재고, **계측기가 거짓말하면 없느니만 못하다.**
 *
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 * @returns {{준것: string[], 거른것: Array<{id:string, 이유:string}>, 전부: number}}
 */
export function 손제시(selfState) {
  const 전부 = selfState?.connectedTools ?? [];
  // **모델이 실제로 받는 그 목록**이 준 것의 정의다. 여기서 다시 거르지 않는다.
  const 준것 = toolSchemasFor(selfState).map((t) => t.name).filter(Boolean);
  const 준집합 = new Set(준것);
  const 거른것 = 전부
    .filter((t) => t?.id && !준집합.has(t.id))
    .map((t) => ({ id: t.id, 이유: 이유말(t) }));
  return { 준것, 거른것, 전부: 전부.length };
}

/**
 * 계측 기록 한 줄. 덤프에 그대로 실린다.
 *
 * **손 이름은 비밀이 아니다** — 이름·이유만 남기고 인자나 결과는 담지 않는다.
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 * @param {string[]} [통제채널] 모델에게 함께 준 통제 채널 이름
 */
export function 손제시기록(selfState, 통제채널 = []) {
  const { 준것, 거른것, 전부 } = 손제시(selfState);
  return {
    전부,
    준수: 준것.length,
    거른수: 거른것.length,
    준것,
    거른것,
    ...(통제채널.length ? { 통제채널 } : {}),
    // 이유별 개수 — "왜 손이 줄었나"를 한눈에 본다(S7 이 이 숫자를 움직인다).
    이유별: 거른것.reduce((acc, x) => ({ ...acc, [x.이유]: (acc[x.이유] ?? 0) + 1 }), {}),
  };
}
