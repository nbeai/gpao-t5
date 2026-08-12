// L3 · 도구 편입 (P5-B-1B, 층의 5단계 Tool Admission)
//
// **"연결됐다"고 말만 하지 않는다.** 연결의 성공은 토큰을 받은 순간이 아니라
// **실제로 부를 수 있는 손이 T5 에 올라온 순간**이다. 그래서 이 파일이 따로 있다.
//
// 편입은 진실층(P5-B-0)의 세 자리를 **함께** 갱신해야 한다. 하나라도 빠지면 어긋난다:
//   ① 손 레지스트리 (ctx.tools.tools)      — 실제 실행
//   ② descriptor 목록                       — 이름·능력 문장·schema·소속
//   ③ env.connections                        — selfState 가 읽는 자리(executable 판정)
// 셋이 같이 움직이므로 `schema ⊆ executable ⊆ 손` 불변식이 저절로 유지된다 —
// 게이트를 새로 만들지 않는다(기존 게이트가 그대로 이걸 검사한다).
//
// **커널은 서비스를 모른다.** 여기 오는 것은 이미 정규화된 손이고, 어느 서비스인지는
// `connector` 필드 한 줄로만 남는다.
import { defineTool, toConnection } from '../kernel/l2-plan/tool-descriptor.js';

// MCP 도구 하나 → T5 도구 id. 서버 이름을 앞에 붙여 서로 안 부딪히게 한다.
//
// **이름이 없는 경우가 있다.** 설정에 등록된 서버는 이름으로 붙지만, 주소로 붙은 원격 MCP 는
// 서버 이름이 없다. 실측(2026-07-28): 원장에 `mcp.undefined.ask_question` 이 남았다.
// 보기 흉한 것으로 끝나지 않는다 — 주소로 붙은 서비스가 둘이 되면 **id 가 겹쳐** 나중 것이
// 앞의 손을 덮어쓴다. 그래서 커넥터 id 로 떨어진다(그것도 없으면 그때만 `unknown`).
export const mcpToolId = (server, name, connector) => `mcp.${server ?? connector ?? "unknown"}.${name}`;

/**
 * 기계 말을 걷어내되 **몇 건인지는 버리지 않는다.**
 *
 * 실측(오너 라이브 2026-07-28): 노션 조회가 `{"results":[],...}` 를 돌려줬고 T5 는 그걸
 * 그대로 원장에 실었다. JSON 을 빼기만 하면 이번엔 "실행했어요"만 남아 **0건이라는 사실이
 * 사라진다** — 모델은 못 찾은 것도 모른 채 같은 도구를 다시 시도하고, 사용자는 승인 카드만
 * 계속 누른다(그날 네 번 눌렀다). 없음도 사실이고, 사실은 사람 말로 남아야 한다.
 */
function 건수(t) {
  try {
    const v = JSON.parse(t);
    const arr = Array.isArray(v) ? v
      : [v?.results, v?.items, v?.data, v?.content].find(Array.isArray);
    return Array.isArray(arr) ? arr.length : undefined;
  } catch { return undefined; }
}

/**
 * MCP 가 돌려준 글이 **사람이 읽을 말인가.** 많은 서버가 JSON 을 text 로 담아 준다 —
 * 그건 모델이 읽을 것이지 사용자가 읽을 것이 아니다. 아니면 undefined 를 준다(부르는 쪽이 대신 말한다).
 */
function 사람말(text) {
  const t = String(text ?? '').trim();
  if (!t) return undefined;
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      const n = 건수(t);
      // 기계 말은 버리되, 세어지는 것은 세어서 준다. 0 건도 사실이다.
      return n === undefined ? undefined : n === 0 ? '찾은 게 없어요.' : `${n}건을 찾았어요.`;
    } catch { /* JSON 이 아니면 사람 말이다 */ }
  }
  return t.slice(0, 400);
}

/**
 * **도구가 스스로 밝힌 것만 읽는다** — 종류 파생의 정의역(F2 · 2026-08-12).
 *
 * MCP 규약의 tool annotations 에는 `readOnlyHint` 가 있다. 서버가 그걸 `true` 로 **밝히면**
 * 그건 짐작이 아니라 **선언**이고, 선언은 사실이다. 밝힌 손을 `read` 로 두면 자동성 헌장이
 * 그대로 통과시킨다 — 조회는 헌장 넷(비밀값·되돌릴 수 없는 파괴·새 상대 첫 전송·돈)에 안 닿는다.
 *
 * **안 하는 것 셋**(전부 「지어내기」다):
 *   ① 이름으로 짐작하지 않는다. `search_*`·`get_*`·`list_*` 는 이름이지 선언이 아니다 —
 *      `search-slot.js:21` 이 이미 못 박은 규율이다(*"이름으로 짐작하면 … 그게 곧 코어를
 *      고치는 일이다"*). 이름으로 낮추면 `search_and_delete` 하나에 그 규칙이 무너진다.
 *   ② `readOnlyHint:false` 를 다른 종류로 승격하지 않는다. "읽기가 아니다"는 무엇인지를
 *      말해 주지 않는다 — 그건 여전히 미상이다.
 *   ③ 불리언이 아닌 값(`"true"`·1)을 참으로 읽지 않는다. 규약이 정한 모양이 아니면
 *      서버가 무엇을 뜻했는지 우리가 모른다.
 *
 * @returns {{toolKind:string, needsApproval:boolean, 근거:string|null}}
 */
export function mcp종류판정(tool = {}) {
  if (tool?.annotations?.readOnlyHint === true) {
    return { toolKind: 'read', needsApproval: false, 근거: 'annotations.readOnlyHint' };
  }
  // 못 밝혔다 → 지금 그대로 미상. 미상은 자동으로 안 흘린다(`authority.js:186`).
  return { toolKind: 'unknown_kind', needsApproval: true, 근거: null };
}

/**
 * MCP 도구 선언 → T5 ToolDescriptor. **읽기/쓰기 판정은 지어내지 않는다** —
 * 서버가 밝힌 축(`annotations.readOnlyHint`)이 있으면 그것만 읽고, 없으면 `unknown_kind` 로
 * 둔다. 그러면 기존 권한 층이 "모르면 승인"으로 다룬다(안전 쪽으로 떨어지는 기존 계약 그대로).
 */
export function mcpToolDescriptor({ server, connector, tool }) {
  const 종류 = mcp종류판정(tool);
  return defineTool({
    id: mcpToolId(server, tool.name, connector),
    label: tool.title || tool.name,
    owner: 'mcp',
    connector,
    availability: [{ kind: 'connected' }],
    // 밝힌 만큼만 좁힌다. 안 밝혔으면 미상 → 승인 경계로.
    toolKind: 종류.toolKind,
    needsApproval: 종류.needsApproval,
    reversible: undefined,
    capability: tool.description || `${server ?? connector ?? '연결된 서비스'} 의 ${tool.name}`,
    schema: {
      description: tool.description || tool.name,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  });
}

/**
 * 승인 카드에 실릴 **인자를 사람이 읽을 모양으로.**
 *
 * 실측(오너 라이브 2026-07-28, D): 카드에 이렇게 떴다.
 *   `인자 {"filter":{"operator":"and","filters":[{"property":"created_time",…}]}}`
 * 비개발자가 이걸 읽고 무엇을 허락하는지 판단할 방법이 없다. 그런데 이게 **밖으로 나가는
 * 값**이라 가장 봐야 할 자리다(쓰기 도구면 여기 문서 내용이 실린다).
 *
 * 값을 바꾸거나 옮겨 적지 않는다 — 모델에게 사람 말로 다시 쓰게 하면 카드와 실제가 갈라진다.
 * 여기서 하는 일은 모양뿐이다: 칸 이름을 스키마가 준 이름으로 바꾸고, 중첩은 한 겹만 펴고,
 * 길면 접는다. 접었으면 접었다고 말한다.
 */
export function 읽는인자(args = {}, inputSchema = {}) {
  const props = inputSchema?.properties ?? {};
  const 이름 = (k) => props[k]?.title || k;
  const 값 = (v, 깊이 = 0) => {
    if (v == null) return '없음';
    if (Array.isArray(v)) return v.length ? `${v.length}개` : '없음';
    if (typeof v === 'object') {
      if (깊이 >= 1) return '…';
      const 안 = Object.entries(v).map(([k, x]) => `${k} ${값(x, 깊이 + 1)}`);
      return 안.length ? 안.join(', ') : '없음';
    }
    const s = String(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  };
  const 줄 = Object.entries(args ?? {}).map(([k, v]) => `${이름(k)}: ${값(v)}`);
  if (!줄.length) return undefined;
  const 다 = 줄.join(' · ');
  return 다.length > 220 ? `${다.slice(0, 220)}… (${줄.length}개 중 앞부분)` : 다;
}

/**
 * 붙은 MCP 세션의 도구들을 T5 손으로 편입한다.
 *
 * @param {{server:string, connector?:string, tools:Array, session:{callTool:Function}}} p
 * @param {{tools:{tools:object}, descriptors:Array, env:{connections:Array}}} ctx  살아 있는 배열·객체를 그대로 받는다
 * @returns {{admitted:string[], skipped:string[], 종류판정:Array<{id:string,toolKind:string,근거:string|null}>}}
 */
export function admitMcpTools(p, ctx) {
  const admitted = [];
  const skipped = [];
  // **무엇을 무슨 근거로 낮췄는가.** 승인을 한 칸이라도 내리는 판단은 자국을 남긴다 —
  // 남기지 않으면 나중에 "왜 이 손은 카드가 안 뜨지"를 코드를 읽어야만 알 수 있고,
  // 그건 판정을 못 미덥게 만든다. 근거가 없으면 `null` 로 **없다고 적는다**(빈칸 금지).
  const 종류판정 = [];
  for (const tool of p.tools ?? []) {
    if (!tool?.name) { skipped.push(String(tool?.name ?? '(이름 없음)')); continue; }
    const 종류 = mcp종류판정(tool);
    const d = mcpToolDescriptor({ server: p.server, connector: p.connector, tool });

    // ① 손 — 실제 실행. 결과는 사람 말로 요약해 돌려준다(원장은 ToolRunner 가 남긴다).
    //    **선언과 같은 값을 쓴다** — 두 곳에 따로 적으면 한쪽만 낮아져 갈라진다(§4.4 두 진실 금지).
    ctx.tools.tools[d.id] = {
      toolKind: d.toolKind,
      // 승인 카드가 무엇을 허락하는지 말해야 한다(게이트가 needsApproval 에 previewOf 를 요구).
      previewOf(args = {}) {
        // **어디에 붙었는지는 두 모양이다.** 설정에 등록된 서버는 이름으로, 주소로 붙은
        // 원격 MCP 는 이름이 없다. 실측(오너 라이브 2026-07-28): 주소로 붙은 서비스의
        // 승인 카드에 `ask_question 실행 — undefined` · `undefined 서버에서` 가 떴다.
        // 사용자는 무엇을 허락하는지 모르고, 그건 승인이 아니다.
        // 그리고 **사용자가 부르는 이름이 먼저다.** 서버 이름은 설정에 적힌 내부 이름이라
        // 카드에 `notion 에서` 처럼 뜬다 — 사용자가 아는 이름은 "노션"이다(실측 2026-07-28).
        const 어디 = p.connectorLabel ?? p.server ?? p.connector ?? '연결된 서비스';
        const 인자줄 = 읽는인자(args, tool.inputSchema);
        return {
          impact: `${어디}에서 ${d.label}`,
          // **밖으로 나가는 값이 여기 있다.** 쓰기 도구면 이 자리에 실제로 적힐 내용이 실린다 —
          // 파일 카드가 "무엇을"을 보여주는 것과 같은 자리다(오늘 아침에 세운 계약).
          ...(인자줄 ? { what: 인자줄 } : {}),
          scope: `${어디} 에서`,
          duration: '이번 한 번',
          cancel: '되돌리기는 이 서비스가 지원하는 범위에 따라요',
        };
      },
      async handler(args = {}) {
        const r = await p.session.callTool(tool.name, args);
        // MCP 결과는 content 배열이다. 사람이 읽을 글만 뽑는다(구조는 result 로 남는다).
        const text = (r?.content ?? [])
          .filter((c) => c?.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text).join('\n');
        if (r?.isError) {
          return { failed: true, userSafeSummary: 사람말(text) ?? `${d.label} 이(가) 실패했어요.`, result: r };
        }
        // **사람 말 자리에 기계 말을 넣지 않는다.** 실측(오너 라이브 2026-07-28): 노션 조회
        // 결과가 원장에 `{"results":[],"type":"workspace_search"}` 로 남았다. 구조는 result
        // 로 이미 모델에게 가고, 이 자리는 사용자가 읽는 자리다. 둘을 섞으면 원장이 로그가 된다.
        return { result: r, userSafeSummary: 사람말(text) ?? `${d.label} 을(를) 실행했어요.` };
      },
    };

    // ② 선언 — 이름·능력·schema. 중복 편입이면 제자리 교체(같은 서버를 다시 붙일 수 있다).
    const i = ctx.descriptors.findIndex((x) => x.id === d.id);
    if (i >= 0) ctx.descriptors[i] = d; else ctx.descriptors.push(d);

    // ③ selfState 가 읽는 자리 — 여기가 빠지면 손·선언이 있어도 **모델에게 안 보인다**
    //    (`session.search` 가 정확히 그렇게 새었다).
    const conn = { ...toConnection(d, { connected: true }), hasHandler: true };
    const ci = ctx.env.connections.findIndex((x) => x.id === d.id);
    if (ci >= 0) ctx.env.connections[ci] = conn; else ctx.env.connections.push(conn);

    admitted.push(d.id);
    종류판정.push({ id: d.id, toolKind: 종류.toolKind, 근거: 종류.근거 });
  }
  return { admitted, skipped, 종류판정 };
}

/** 편입 취소 — 셋을 **같이** 걷어낸다. 하나만 지우면 그 자리가 유령이 된다. */
export function revokeAdmitted(ids = [], ctx) {
  for (const id of ids) {
    delete ctx.tools.tools[id];
    const i = ctx.descriptors.findIndex((x) => x.id === id);
    if (i >= 0) ctx.descriptors.splice(i, 1);
    const ci = ctx.env.connections.findIndex((x) => x.id === id);
    if (ci >= 0) ctx.env.connections.splice(ci, 1);
  }
  return ids.length;
}
