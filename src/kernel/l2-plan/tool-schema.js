// L2 · 도구 스키마 (P2-5b) — 모델이 **직접 고를 수 있게** 도구를 노출한다.
//
// 왜: 지금까지 어느 도구가 필요한지는 정규식(`inferTools`)이 정했다. 정규식이 못 알아들으면
// GPT-5.5 도 못 했다("오늘 날씨" → 검색 꺼짐 → "웹 조회가 연결되어 있지 않습니다").
// §24: **코드는 경계와 사실, 모델은 이해와 선택.** 선택을 모델에게 돌려준다.
//
// 불변(이게 핵심이다): 모델은 **고르기만** 한다. 실행·승인·기록은 지금 그대로 런타임이 한다.
//   모델이 `local.file{action:'delete'}` 를 골라도 `toolActionKind` 가 안전 바닥으로 판정해
//   승인 카드가 뜬다. Phase 0 에서 만든 경계가 여기서 값을 한다 — 유연해지되 안전은 안 풀린다.
//
// 1축(단일 진실화, 2026-07-27): 예전엔 이 파일에 `SCHEMAS` **수동 맵**이 있었다. 그래서 도구를
// 만들어도 여기 안 적으면 모델이 존재를 몰랐다 — 오너 실사용에서 실제로 났다:
//   "내가 팔식당 물어본 세션 찾을 수 있어?" → "찾아볼 수 없어요"  (session.search 는 있었다)
// 이제 스키마는 **ToolDescriptor 가 든다.** 이 파일은 그것을 고르고 옮길 뿐이다.

/**
 * 지금 **실행 가능한** 도구만 모델에게 보여준다. 실행할 수 없는 것을 고르게 하면
 * 모델은 되는 줄 알고 약속하고, 사용자는 "된다더니 안 된다"를 겪는다.
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 * @returns {Array<{name:string, description:string, parameters:object}>}
 */
export function toolSchemasFor(selfState) {
  return (selfState?.connectedTools ?? [])
    .filter((t) => t.executable && t.schema)
    .map((t) => ({ name: t.id, ...t.schema }));
}

/**
 * 모델이 고른 도구 호출 → 커널이 아는 형태(IntentPacket 조각). **판정하지 않는다** —
 * 승인·범위·실행은 기존 경로(buildActionPlan → authority → ToolRunner)가 그대로 한다.
 * @param {Array<{name:string, args:object}>} calls
 * @param {import('../contracts.js').SelfStateSnapshot} [selfState]
 * @returns {{neededTools:string[], fileOp?:object, toolArgs:Record<string,object>}}
 */
export function callsToIntentParts(calls = [], selfState) {
  // 우리가 **실제로 보여준** 도구만 받아들인다. 예전엔 수동 맵으로 걸렀는데, 맵과 실제 노출이
  // 어긋나면 안 보여준 도구를 받아들이거나 보여준 도구를 버렸다(1축: 한 자리에서 나온다).
  const known = new Set(toolSchemasFor(selfState).map((t) => t.name));
  const neededTools = [];
  const toolArgs = {};
  let fileOp;
  for (const call of calls) {
    const id = call?.name;
    if (!id || !known.has(id)) continue; // 안 보여준 도구는 조용히 버린다(있는 척 금지)
    if (!neededTools.includes(id)) neededTools.push(id);
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    toolArgs[id] = { ...(toolArgs[id] ?? {}), ...args };
    // 파일 도구는 **작업 종류가 곧 권한 종류**다(fileKind). 그래서 fileOp 로 실어 보낸다 —
    // 이 한 줄이 없으면 권한 판정이 작업을 못 보고 unknown 으로 떨어진다.
    if (id === 'local.file') fileOp = { ...(fileOp ?? {}), ...args };
  }
  return { neededTools, fileOp, toolArgs };
}

/** 게이트·테스트가 선언 전체를 훑을 수 있게. **파생**이다 — 여기에 맵을 다시 만들지 않는다. */
export function allToolSchemas(selfState) {
  const out = {};
  for (const t of selfState?.connectedTools ?? []) if (t.schema) out[t.id] = t.schema;
  return out;
}
