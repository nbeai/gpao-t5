// L3 · 선언형 HTTP 도구 (P5-B-1B, API 키 커넥터의 도구 편입)
//
// **API 키에는 발견 통로가 없다.** MCP 는 `tools/list` 로 손을 물어보지만, API 키 서비스는
// 물어볼 데가 없다. 그래서 손을 **커넥터가 선언하고** 여기는 선언을 실행할 뿐이다
// (previewOf·localSigns·verify 와 같은 계약 패턴).
//
// 이게 없으면 키 확인은 성공하는데 손이 하나도 안 올라온다 — 우리 기준으로 그건 연결이 아니다
// ("연결됐다고 말하기 전에 실제 도구가 올라왔는지 확인하는가").
//
// 비밀 경계: 자격값은 **요청을 만들 때만** 쓰인다. 도구 인자로 덮어쓸 수 없고, 결과·미리보기·
// 원장 어디에도 실리지 않는다.
import { defineTool, toConnection } from '../kernel/l2-plan/tool-descriptor.js';

/** 선언한 자리에 값을 끼운다. URL 자리에는 인코딩해서 넣는다(따옴표·공백이 주소를 깨뜨린다). */
function 채우기(틀, 값들, { encode = false } = {}) {
  if (typeof 틀 !== 'string') return 틀;
  return 틀.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in 값들)) return '';
    const v = String(값들[k]);
    return encode ? encodeURIComponent(v) : v;
  });
}

export const httpToolId = (connectorId, name) => `${connectorId}.${name}`;

/**
 * 받침에 따라 을/를을 붙인다. 작아 보이지만 "키워드 트렌드 을(를) 했어요" 같은 문장은
 * 사용자를 멈칫하게 한다 — 기계가 말하는 티가 나는 자리다(오너 실측 2026-07-28).
 */
function 을를(말) {
  const s = String(말 ?? '');
  const 끝 = s[s.length - 1] ?? '';
  if (!/[가-힣]/.test(끝)) return `${s}를`;
  return `${s}${(끝.charCodeAt(0) - 0xac00) % 28 ? '을' : '를'}`;
}

/**
 * 선언 하나 → T5 ToolDescriptor. 종류(toolKind)는 커넥터가 말한 대로 쓰되,
 * **말하지 않았으면 `unknown_kind`** 로 둔다 — 모르면 승인 쪽으로 떨어지는 기존 계약 그대로다.
 */
export function httpToolDescriptor({ connector, tool }) {
  return defineTool({
    id: httpToolId(connector.id, tool.name),
    label: tool.label ?? tool.name,
    owner: 'connector',
    connector: connector.id,
    availability: [{ kind: 'connected' }],
    toolKind: tool.toolKind ?? 'unknown_kind',
    needsApproval: tool.toolKind === 'read' ? false : true,
    reversible: tool.toolKind === 'read' ? true : undefined,
    capability: tool.capability ?? `${connector.label} 의 ${tool.label ?? tool.name}`,
    schema: {
      description: tool.description ?? tool.capability ?? tool.name,
      parameters: tool.parameters ?? { type: 'object', properties: {} },
    },
  });
}

/**
 * 선언된 손 하나를 실제로 부르는 실행기.
 * @param {object} p.tool      커넥터가 선언한 도구
 * @param {object} p.secrets   0600 저장소에서 온 자격값 — **이 함수 밖으로 나가지 않는다**
 */
export function makeHttpToolHandler({ tool, secrets, connector, fetchImpl = globalThis.fetch, timeoutMs = 20_000 }) {
  return async function handler(args = {}) {
    const req = tool.request ?? {};
    // **자격값이 인자보다 강하다.** 모델이 같은 이름의 인자를 넘겨도 자격을 덮어쓰지 못한다.
    const 값들 = { ...(tool.defaults ?? {}), ...args, ...secrets };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    timer.unref?.();
    let res;
    try {
      res = await fetchImpl(채우기(req.url, 값들, { encode: true }), {
        method: req.method ?? 'GET',
        signal: ac.signal,
        headers: Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k, 채우기(v, 값들)])),
        ...(req.body ? { body: 채우기(req.body, 값들) } : {}),
      });
    } catch {
      return { failed: true, userSafeSummary: `${connector.label}에 닿지 못했어요.`,
        nextSafeAction: '잠시 뒤 다시 해볼까요?' };
    } finally { clearTimeout(timer); }

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      // 응답 본문을 그대로 옮기지 않는다 — 자격이 되비쳐 오는 서비스가 있다.
      return {
        failed: true,
        userSafeSummary: res.status === 401 || res.status === 403
          ? `${connector.label} 쪽에서 이 요청을 거절했어요. 연결을 다시 확인해 볼까요?`
          : `${connector.label} 이 지금은 응답하지 못했어요.`,
        nextSafeAction: '다른 방법으로 이어가 볼까요?',
      };
    }
    let result;
    try { result = JSON.parse(text); } catch { result = { text }; }
    return { result, userSafeSummary: `${connector.label}에서 ${을를(tool.label ?? tool.name)} 봤어요.` };
  };
}

/**
 * 선언된 손들을 T5 에 편입한다. **MCP 와 똑같이 세 자리를 함께** 갱신한다 —
 * 통로가 달라도 편입은 하나여야 `schema ⊆ executable ⊆ 손` 이 저절로 유지된다.
 * @returns {string[]} 올라온 손 id
 */
/**
 * 손 하나를 **실제로 한 번 두드려 본다.** 사용자가 그 서비스에서 어떤 기능을 켜 뒀는지는
 * 사용자가 알아야 할 일이 아니라 T5 가 확인할 일이다(오너 실측 2026-07-27: 검색을 켠 줄 알고
 * 검색을 두드렸는데 사용자가 켠 것은 다른 기능이었다 — 그래서 "값이 틀렸다"고 잘못 말했다).
 * @returns {Promise<{ok:boolean, status?:number}>}
 */
export async function probeHttpTool({ tool, secrets, fetchImpl = globalThis.fetch, timeoutMs = 15_000 }) {
  if (!tool?.probeArgs || !tool?.request?.url) return { ok: true }; // 두드릴 방법을 선언 안 했으면 통과
  const handler = makeHttpToolHandler({ tool, secrets, connector: { label: tool.label ?? tool.name }, fetchImpl, timeoutMs });
  const r = await handler(tool.probeArgs);
  return { ok: !r.failed };
}

export function admitHttpTools({ connector, tools, secrets, fetchImpl }, ctx) {
  const admitted = [];
  for (const tool of tools ?? []) {
    if (!tool?.name) continue;
    const d = httpToolDescriptor({ connector, tool });

    ctx.tools.tools[d.id] = {
      toolKind: d.toolKind,
      previewOf(args = {}) {
        const 인자 = JSON.stringify(args ?? {});
        return {
          impact: `${connector.label}에서 ${을를(d.label)} 해요`,
          scope: `${connector.label} · 보낼 내용 ${인자.length > 200 ? `${인자.slice(0, 200)}…` : 인자}`,
          duration: '이번 한 번',
          cancel: '되돌리기는 이 서비스가 지원하는 범위에 따라요',
        };
      },
      handler: makeHttpToolHandler({ tool, secrets, connector, fetchImpl }),
    };

    const i = ctx.descriptors.findIndex((x) => x.id === d.id);
    if (i >= 0) ctx.descriptors[i] = d; else ctx.descriptors.push(d);

    const conn = { ...toConnection(d, { connected: true }), hasHandler: true };
    const ci = ctx.env.connections.findIndex((x) => x.id === d.id);
    if (ci >= 0) ctx.env.connections[ci] = conn; else ctx.env.connections.push(conn);

    admitted.push(d.id);
  }
  return admitted;
}
