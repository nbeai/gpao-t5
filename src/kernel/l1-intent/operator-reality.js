// L1 · T5 운영 현실
//
// 말귀와 엔지니어링을 한 몸처럼 쓰게 하는 공통 입력이다. 사용자 발화의 종류를 분류하거나
// 다음 행동을 정하지 않는다. 지금 실제로 쓸 수 있는 손이 사용자를 대신해 무엇을 먼저
// 확인·실행할 수 있는지만, ToolDescriptor가 선언한 사실에서 꺼낸다.
//
// 새 손의 역할을 여기서 추측하면 또 다른 진실이 생긴다. 그래서 operatorFact를 선언하지 않은
// 손은 이 현실에 나타나지 않는다. 판단은 모델, 실행과 경계는 런타임의 자리다.

/**
 * @param {{connectedTools?:Array}} selfState
 * @returns {{hands:Array<{label:string, operation:string}>}|undefined}
 */
export function operatorReality(selfState = {}) {
  const hands = (selfState.connectedTools ?? [])
    .filter((tool) => tool.executable && typeof tool.operatorFact === 'string' && tool.operatorFact.trim())
    .map((tool) => ({ label: tool.label ?? tool.id, operation: tool.operatorFact.trim() }));
  return hands.length ? { hands } : undefined;
}
