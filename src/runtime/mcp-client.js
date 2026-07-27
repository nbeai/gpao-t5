// L3 · MCP 클라이언트 (P5-B-1B Connector Operating Layer)
//
// **의존성 0.** MCP 는 JSON-RPC 2.0 을 줄바꿈으로 흘려보내는 것뿐이라 SDK 가 필요 없다.
// 여기는 **전송과 규약**만 안다 — 어떤 서비스인지, 무엇을 할지는 모른다(층의 원칙).
//
// 전송 두 가지가 실제로 쓰인다(이 컴퓨터 실측):
//   stdio  — `command`/`args` 로 프로세스를 띄우고 stdin/stdout 으로 말한다(playwright)
//   http   — 원격 서버 주소로 말한다(notion·figma). 대개 OAuth 가 붙는다 → mcp-http.js
// 이 파일은 stdio 만 안다. 두 통로가 **같은 모양**(initialize·listTools·callTool)을 돌려주므로
// 편입(tool-admission)과 연결 손은 어느 쪽으로 붙었는지 몰라도 된다.
import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = '2024-11-05';

/**
 * stdio MCP 서버 하나와의 대화. 열고 → 악수하고 → 도구 목록을 받고 → 부른다.
 * @param {{command:string, args?:string[], env?:object, spawnImpl?:Function, timeoutMs?:number}} cfg
 */
export function openStdioMcp(cfg) {
  const timeoutMs = cfg.timeoutMs ?? 20_000;
  const proc = (cfg.spawnImpl ?? spawn)(cfg.command, cfg.args ?? [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(cfg.env ?? {}) },
  });
  let nextId = 1;
  const waiting = new Map();
  let buf = '';
  let closed = false;

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    // 줄 단위 JSON-RPC. 서버가 로그를 stdout 에 섞어 보내도 파싱 실패한 줄은 그냥 버린다.
    for (;;) {
      const nl = buf.indexOf('\n');
      if (nl < 0) break;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const w = waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error?.message ?? 'mcp_error'));
      else w.resolve(msg.result);
    }
  });
  const 죽음 = (why) => {
    closed = true;
    for (const w of waiting.values()) w.reject(new Error(why));
    waiting.clear();
  };
  proc.on('error', () => 죽음('mcp_spawn_failed'));
  proc.on('exit', () => 죽음('mcp_exited'));

  function send(method, params) {
    if (closed) return Promise.reject(new Error('mcp_closed'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('mcp_timeout')); }, timeoutMs);
      timer.unref?.();
      waiting.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`);
    });
  }
  function notify(method, params) {
    if (!closed) proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} })}\n`);
  }

  return {
    /** 악수. 서버가 자기 이름·능력을 알려준다. */
    async initialize() {
      const r = await send('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'GPAO-T5', version: '0' },
      });
      notify('notifications/initialized');
      return r;
    },
    /** 이 서버가 주는 도구들. **여기 없는 것은 T5 도 없는 것이다**(도구 편입의 유일한 근거). */
    async listTools() {
      const r = await send('tools/list');
      return r?.tools ?? [];
    },
    async callTool(name, args) {
      return send('tools/call', { name, arguments: args ?? {} });
    },
    close() { closed = true; try { proc.kill(); } catch { /* 이미 죽음 */ } },
  };
}

/**
 * 등록된 MCP 서버 설정 하나 → 열어서 도구 목록까지. **실패는 실패로 돌려준다** —
 * 못 붙었는데 붙었다고 말하지 않는다(연결 실패를 성공으로 기록하면 게이트가 막는다).
 * @returns {Promise<{ok:true, serverInfo:object, tools:Array, session:object}|{ok:false, reason:string}>}
 */
export async function probeMcpServer(cfg, deps = {}) {
  // 여기는 stdio 전용이다. 원격은 mcp-http.js + oauth-pkce.js 가 맡는다(connector-connect 가 가른다) —
  // **"인증할 손이 없다"고 말하던 자리였다. 이제 있다.** 그 문장을 지운 것이 이번 작업의 핵심이다.
  if (cfg?.url) return { ok: false, reason: '원격 주소는 이 통로가 아니라 원격 통로로 열어야 해요' };
  if (!cfg?.command) return { ok: false, reason: 'no_transport' };
  let session;
  try {
    session = openStdioMcp({ ...cfg, spawnImpl: deps.spawnImpl, timeoutMs: deps.timeoutMs });
    const info = await session.initialize();
    const tools = await session.listTools();
    return { ok: true, serverInfo: info?.serverInfo ?? {}, tools, session };
  } catch (e) {
    session?.close();
    return { ok: false, reason: e?.message ?? 'mcp_failed' };
  }
}
