// L3 · 원격 MCP 전송 (Streamable HTTP + Bearer)
//
// stdio 와 **같은 대화**를 한다(initialize → tools/list → tools/call). 다른 건 배달 방식뿐이라
// 편입(tool-admission)·연결 손(connector-connect)은 어느 쪽인지 몰라도 된다 — 같은 모양을 돌려준다.
//
// 실측(2026-07-27, mcp.notion.com): 토큰 없이 POST 하면 401 + www-authenticate 로
// **어디서 로그인해야 하는지**를 알려준다. 그래서 우리가 주소를 짐작할 필요가 없다.
import { resourceMetadataUrl } from './oauth-pkce.js';

const PROTOCOL_VERSION = '2024-11-05';

/** 응답 본문 하나 → JSON-RPC 결과. SSE(text/event-stream)면 data: 줄을 모아 마지막 응답을 쓴다. */
async function readRpc(res) {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    let last;
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try { const m = JSON.parse(line.slice(5).trim()); if (m.id !== undefined) last = m; } catch { /* 조각은 버린다 */ }
    }
    return last;
  }
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * 원격 MCP 서버 하나와의 대화. `getToken()` 은 부를 때마다 유효한 토큰을 준다(만료 시 갱신).
 * @param {{url:string, getToken?:()=>Promise<string|null>, fetchImpl?:Function, timeoutMs?:number}} cfg
 */
export function openHttpMcp(cfg) {
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  let nextId = 1;
  let sessionId; // 서버가 mcp-session-id 를 주면 이후 요청에 실어야 한다

  async function rpc(method, params, { notify = false } = {}) {
    const token = await cfg.getToken?.();
    const body = { jsonrpc: '2.0', method, params: params ?? {} };
    if (!notify) body.id = nextId++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    timer.unref?.();
    let res;
    try {
      res = await fetchImpl(cfg.url, {
        method: 'POST', signal: ac.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': PROTOCOL_VERSION,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
    } finally { clearTimeout(timer); }

    if (res.status === 401) {
      // **인증이 필요하다는 사실 자체가 정보다** — 어디서 로그인하는지까지 실어 보낸다.
      throw Object.assign(new Error('mcp_unauthorized'), {
        unauthorized: true, resourceMetadataUrl: resourceMetadataUrl(res.headers.get('www-authenticate')),
      });
    }
    sessionId = res.headers.get('mcp-session-id') ?? sessionId;
    if (notify) return undefined;
    if (!res.ok) throw new Error(`mcp_http_${res.status}`);
    const msg = await readRpc(res);
    if (msg?.error) throw new Error(msg.error?.message ?? 'mcp_error');
    return msg?.result;
  }

  return {
    async initialize() {
      const r = await rpc('initialize', {
        protocolVersion: PROTOCOL_VERSION, capabilities: {},
        clientInfo: { name: 'GPAO-T5', version: '0' },
      });
      await rpc('notifications/initialized', {}, { notify: true }).catch(() => {});
      return r;
    },
    async listTools() {
      return (await rpc('tools/list'))?.tools ?? [];
    },
    async callTool(name, args) { return rpc('tools/call', { name, arguments: args ?? {} }); },
    close() { /* HTTP 는 붙들고 있는 프로세스가 없다 */ },
  };
}

/**
 * 토큰 없이 한 번 두드려 **로그인이 필요한지, 어디서 하는지**를 알아낸다.
 * 못 붙는 이유를 사람 말로 돌려주는 것이 이 함수의 일이다(추측 금지).
 * @returns {Promise<{needsAuth:true, resourceMetadataUrl?:string}|{needsAuth:false}>}
 */
export async function probeRemoteAuth(url, { fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'GPAO-T5', version: '0' } } }),
  }).catch(() => null);
  if (!res) return { needsAuth: false };
  if (res.status !== 401) return { needsAuth: false };
  return { needsAuth: true, resourceMetadataUrl: resourceMetadataUrl(res.headers.get('www-authenticate')) };
}
