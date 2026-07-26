// L2 · 도구 스키마 (P2-5b) — 모델이 **직접 고를 수 있게** 도구를 노출한다.
//
// 왜: 지금까지 어느 도구가 필요한지는 정규식(`inferTools`)이 정했다. 정규식이 못 알아들으면
// GPT-5.5 도 못 했다("오늘 날씨" → 검색 꺼짐 → "웹 조회가 연결되어 있지 않습니다").
// §24: **코드는 경계와 사실, 모델은 이해와 선택.** 선택을 모델에게 돌려준다.
//
// 불변(이게 핵심이다): 모델은 **고르기만** 한다. 실행·승인·기록은 지금 그대로 런타임이 한다.
//   모델이 `local.file{action:'delete'}` 를 골라도 `toolActionKind` 가 안전 바닥으로 판정해
//   승인 카드가 뜬다. Phase 0 에서 만든 경계가 여기서 값을 한다 — 유연해지되 안전은 안 풀린다.

/** 도구 id → 모델에게 보여줄 스키마. 라이브에 손이 있는 도구만 노출한다(선언 ⊆ 손). */
const SCHEMAS = {
  'local.file': {
    description: '정해진 작업 폴더 안의 파일을 보거나 읽거나 저장하거나 옮기거나 지운다. 되돌리기도 가능.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'write', 'move', 'delete', 'undo'] },
        path: { type: 'string', description: '대상 파일·폴더(작업 폴더 기준 상대 경로)' },
        to: { type: 'string', description: 'move 일 때 옮길 위치' },
        text: { type: 'string', description: 'write 일 때 저장할 내용' },
      },
      required: ['action'],
    },
  },
  'web.collect': {
    description: '웹에서 찾아 읽는다. 주소를 주면 그 페이지를, 없으면 검색해서 읽고 출처와 함께 준다.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: '찾을 것(검색어) 또는 읽을 주소' },
      },
      required: ['request'],
    },
  },
  'slack.post': {
    description: '슬랙에 메시지를 보낸다. 보내기 전에 사용자 승인을 받는다.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '보낼 내용' },
        target: { type: 'string', description: '채널·대상(없으면 기본 대상)' },
      },
      required: ['text'],
    },
  },
  'telegram.send': {
    description: '텔레그램으로 메시지를 보낸다. 보내기 전에 사용자 승인을 받는다.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '보낼 내용' },
        target: { type: 'string', description: '보낼 방(없으면 기본 대상)' },
      },
      required: ['text'],
    },
  },
};

/**
 * 지금 **실행 가능한** 도구만 모델에게 보여준다. 실행할 수 없는 것을 고르게 하면
 * 모델은 되는 줄 알고 약속하고, 사용자는 "된다더니 안 된다"를 겪는다.
 * @param {import('../contracts.js').SelfStateSnapshot} selfState
 * @returns {Array<{name:string, description:string, parameters:object}>}
 */
export function toolSchemasFor(selfState) {
  return (selfState?.connectedTools ?? [])
    .filter((t) => t.executable && SCHEMAS[t.id])
    .map((t) => ({ name: t.id, ...SCHEMAS[t.id] }));
}

/**
 * 모델이 고른 도구 호출 → 커널이 아는 형태(IntentPacket 조각). **판정하지 않는다** —
 * 승인·범위·실행은 기존 경로(buildActionPlan → authority → ToolRunner)가 그대로 한다.
 * @param {Array<{name:string, args:object}>} calls
 * @returns {{neededTools:string[], fileOp?:object, toolArgs:Record<string,object>}}
 */
export function callsToIntentParts(calls = []) {
  const neededTools = [];
  const toolArgs = {};
  let fileOp;
  for (const call of calls) {
    const id = call?.name;
    if (!id || !SCHEMAS[id]) continue; // 모르는 도구는 조용히 버린다(있는 척 금지)
    if (!neededTools.includes(id)) neededTools.push(id);
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    toolArgs[id] = { ...(toolArgs[id] ?? {}), ...args };
    // 파일 도구는 **작업 종류가 곧 권한 종류**다(fileKind). 그래서 fileOp 로 실어 보낸다 —
    // 이 한 줄이 없으면 권한 판정이 작업을 못 보고 unknown 으로 떨어진다.
    if (id === 'local.file') fileOp = { ...(fileOp ?? {}), ...args };
  }
  return { neededTools, fileOp, toolArgs };
}

export const TOOL_SCHEMAS = SCHEMAS;
