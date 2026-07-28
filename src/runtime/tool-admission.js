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
 * MCP 도구 선언 → T5 ToolDescriptor. **읽기/쓰기 판정은 지어내지 않는다** —
 * MCP 는 그 축을 안 주므로 `unknown_kind` 로 둔다. 그러면 기존 권한 층이
 * "모르면 승인"으로 다룬다(안전 쪽으로 떨어지는 기존 계약 그대로).
 */
export function mcpToolDescriptor({ server, connector, tool }) {
  return defineTool({
    id: mcpToolId(server, tool.name, connector),
    label: tool.title || tool.name,
    owner: 'mcp',
    connector,
    availability: [{ kind: 'connected' }],
    // 종류 미상 → 승인 경계로. MCP 서버가 나중에 축을 주면 그때 좁힌다.
    toolKind: 'unknown_kind',
    needsApproval: true,
    reversible: undefined,
    capability: tool.description || `${server ?? connector ?? '연결된 서비스'} 의 ${tool.name}`,
    schema: {
      description: tool.description || tool.name,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  });
}

/**
 * 붙은 MCP 세션의 도구들을 T5 손으로 편입한다.
 *
 * @param {{server:string, connector?:string, tools:Array, session:{callTool:Function}}} p
 * @param {{tools:{tools:object}, descriptors:Array, env:{connections:Array}}} ctx  살아 있는 배열·객체를 그대로 받는다
 * @returns {{admitted:string[], skipped:string[]}}
 */
export function admitMcpTools(p, ctx) {
  const admitted = [];
  const skipped = [];
  for (const tool of p.tools ?? []) {
    if (!tool?.name) { skipped.push(String(tool?.name ?? '(이름 없음)')); continue; }
    const d = mcpToolDescriptor({ server: p.server, connector: p.connector, tool });

    // ① 손 — 실제 실행. 결과는 사람 말로 요약해 돌려준다(원장은 ToolRunner 가 남긴다).
    ctx.tools.tools[d.id] = {
      toolKind: 'unknown_kind',
      // 승인 카드가 무엇을 허락하는지 말해야 한다(게이트가 needsApproval 에 previewOf 를 요구).
      previewOf(args = {}) {
        const 인자 = JSON.stringify(args ?? {});
        // **어디에 붙었는지는 두 모양이다.** 설정에 등록된 서버는 이름으로, 주소로 붙은
        // 원격 MCP 는 이름이 없다. 실측(오너 라이브 2026-07-28): 주소로 붙은 서비스의
        // 승인 카드에 `ask_question 실행 — undefined` · `undefined 서버에서` 가 떴다.
        // 사용자는 무엇을 허락하는지 모르고, 그건 승인이 아니다.
        const 어디 = p.server ?? p.connectorLabel ?? p.connector ?? '연결된 서비스';
        return {
          impact: `${d.label} 실행 — ${어디}`,
          scope: `${어디} 에서 · 인자 ${인자.length > 200 ? `${인자.slice(0, 200)}…` : 인자}`,
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
          return { failed: true, userSafeSummary: text || `${d.label} 이(가) 실패했어요.`, result: r };
        }
        return { result: r, userSafeSummary: text ? text.slice(0, 400) : `${d.label} 을(를) 실행했어요.` };
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
  }
  return { admitted, skipped };
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
