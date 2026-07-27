// P5-B-1B · Connector Operating Layer — 연결 실행(4단계) + 도구 편입(5단계)
//
// 실측(오너 대화, 2026-07-27): "붙여줘" 에 T5 가 **남의 도구 설정으로 사용자를 보냈다.**
// 이유는 정확했다 — 연결을 실행하는 손이 없었다. 이 검사는 그 손을 불변식으로 고정한다.
//
// 불변식(문구 매칭 아님):
//   ① 연결의 성공 = **부를 수 있는 손이 올라온 순간** (토큰·악수만으로 성공이라 하지 않는다)
//   ② 편입은 세 자리를 함께 — 손·선언·selfState. 하나라도 빠지면 유령이 생긴다
//   ③ 해제는 셋을 함께 걷어낸다
//   ④ 러너는 서비스를 모른다 — 지어낸 서비스도 선언만 맞으면 그대로 돈다
//   ⑤ 실패를 성공으로 기록하지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConnectorConnectTool } from '../src/runtime/connector-connect.js';
import { admitMcpTools, revokeAdmitted, mcpToolId } from '../src/runtime/tool-admission.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';

/** 진짜 JSON-RPC 를 말하는 가짜 MCP 서버 — 프로토콜을 실제로 태운다(모킹이 아니라 대역). */
function 가짜서버({ tools = [{ name: 'search', description: '찾는다', inputSchema: { type: 'object' } }], failInit = false } = {}) {
  const listeners = { data: [], error: [], exit: [] };
  const stdout = {
    setEncoding() {},
    on(ev, fn) { if (ev === 'data') listeners.data.push(fn); },
  };
  const proc = {
    stdout, stderr: { on() {}, setEncoding() {} },
    stdin: {
      write(line) {
        const msg = JSON.parse(line);
        if (msg.method === 'notifications/initialized') return;
        const reply = (result) => listeners.data.forEach((f) => f(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result })}\n`));
        if (msg.method === 'initialize') {
          if (failInit) return listeners.data.forEach((f) => f(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { message: '악수 실패' } })}\n`));
          return reply({ serverInfo: { name: '가짜', version: '1' } });
        }
        if (msg.method === 'tools/list') return reply({ tools });
        if (msg.method === 'tools/call') return reply({ content: [{ type: 'text', text: `${msg.params.name} 실행함` }] });
        return reply({});
      },
    },
    on(ev, fn) { if (listeners[ev]) listeners[ev].push(fn); },
    kill() {},
  };
  return () => proc;
}

function 빈컨텍스트() {
  return { tools: { tools: {} }, descriptors: [], env: { model: { id: 'x', authSignal: 'ok' }, connections: [] } };
}

async function 설정파일(server, body) {
  const dir = await mkdtemp(join(tmpdir(), 'mcpcfg-'));
  const p = join(dir, 'config.json');
  await writeFile(p, JSON.stringify({ mcpServers: { [server]: body } }));
  return p;
}

// ── ①·② 연결 = 손이 올라온 순간, 세 자리 동시 갱신 ────────────────────────
test('연결하면 손·선언·selfState 가 함께 생기고 모델 schema 에 나타난다', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'svc', label: '가상서비스', connected: false, userJobs: ['찾는다'] });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const cfg = await 설정파일('svc', { command: 'node', args: ['x'] });
  const tool = makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg], spawnImpl: 가짜서버(),
  });

  const r = await tool.handler({ connector: 'svc' });
  const id = mcpToolId('svc', 'search');
  assert.equal(r.result?.connected, true, `연결 실패: ${r.userSafeSummary}`);
  assert.ok(ctx.tools.tools[id], '① 손이 실제로 올라와야 한다');
  assert.ok(ctx.descriptors.some((d) => d.id === id), '② 선언도');
  assert.ok(ctx.env.connections.some((x) => x.id === id), '③ selfState 가 읽는 자리도');

  const selfState = buildSelfState(ctx.env, { tools: ctx.tools });
  assert.ok(toolSchemasFor(selfState).some((t) => t.name === id), '모델에게 보여야 쓸 수 있다');
  assert.equal(selfState.connectedTools.find((t) => t.id === id)?.executable, true);
});

test('편입된 손은 실제로 불린다(선언만 올리지 않는다)', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'svc', label: 'S', connected: false });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const cfg = await 설정파일('svc', { command: 'node', args: ['x'] });
  await makeConnectorConnectTool({ ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg], spawnImpl: 가짜서버() })
    .handler({ connector: 'svc' });
  const out = await ctx.tools.tools[mcpToolId('svc', 'search')].handler({ q: '정산' });
  assert.match(out.userSafeSummary, /search 실행함/, 'MCP 서버까지 실제로 왕복해야 한다');
});

test('승인이 필요한 편입 손은 미리보기를 낸다(게이트 계약)', async () => {
  const ctx = 빈컨텍스트();
  admitMcpTools({ server: 'svc', connector: 'svc', tools: [{ name: 'search' }], session: { callTool: async () => ({}) } }, ctx);
  const t = ctx.tools.tools[mcpToolId('svc', 'search')];
  const d = ctx.descriptors[0];
  assert.equal(d.needsApproval, true, '종류 미상은 승인으로 — 지어내지 않는다');
  assert.ok(typeof t.previewOf === 'function', '무엇을 허락하는지 모르는 승인은 승인이 아니다');
  assert.match(t.previewOf({ q: 'x' }).impact, /svc/);
});

// ── ③ 해제 ────────────────────────────────────────────────────────────────
test('연결을 끊으면 손·선언·schema 에서 함께 사라진다', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'svc', label: 'S', connected: false });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const cfg = await 설정파일('svc', { command: 'node', args: ['x'] });
  const tool = makeConnectorConnectTool({ ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg], spawnImpl: 가짜서버() });
  await tool.handler({ connector: 'svc' });
  const id = mcpToolId('svc', 'search');
  assert.ok(ctx.tools.tools[id]);

  const off = await tool.handler({ connector: 'svc', action: 'disconnect' });
  assert.equal(off.result.connected, false);
  assert.equal(ctx.tools.tools[id], undefined, '손이 남으면 유령이다');
  assert.equal(ctx.descriptors.length, 0);
  assert.equal(ctx.env.connections.length, 0);
  assert.ok(!toolSchemasFor(buildSelfState(ctx.env, { tools: ctx.tools })).some((t) => t.name === id));
});

// ── ④ 러너는 서비스를 모른다 ──────────────────────────────────────────────
test('지어낸 서비스도 선언만 맞으면 그대로 연결된다(서비스 분기 없음)', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: '없는가게', label: '없는가게', connected: false });
  c.authMethods = [{ kind: 'mcp', server: '없는가게' }];
  const cfg = await 설정파일('없는가게', { command: 'node', args: ['x'] });
  const r = await makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg],
    spawnImpl: 가짜서버({ tools: [{ name: '주문조회', description: '주문을 본다' }] }),
  }).handler({ connector: '없는가게' });
  assert.equal(r.result?.connected, true);
  assert.ok(ctx.tools.tools[mcpToolId('없는가게', '주문조회')]);
});

// ── ⑤ 실패를 성공으로 기록하지 않는다 ────────────────────────────────────
test('설정이 없으면 연결됐다고 하지 않는다', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'svc', label: 'S', connected: false });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const r = await makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [join(tmpdir(), '없는파일.json')], spawnImpl: 가짜서버(),
  }).handler({ connector: 'svc' });
  assert.equal(r.blocked, true);
  assert.equal(c.connected, false);
  assert.equal(ctx.descriptors.length, 0, '실패했는데 선언이 남으면 유령이다');
  assert.ok(r.nextSafeAction, '막다른 답으로 끝내지 않는다');
});

test('악수가 실패하면 연결이 아니다', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'svc', label: 'S', connected: false });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const cfg = await 설정파일('svc', { command: 'node', args: ['x'] });
  const r = await makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg], spawnImpl: 가짜서버({ failInit: true }),
  }).handler({ connector: 'svc' });
  assert.equal(r.blocked, true);
  assert.equal(ctx.env.connections.length, 0);
});

test('붙었는데 쓸 도구가 하나도 없으면 연결이라 부르지 않는다', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'svc', label: 'S', connected: false });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const cfg = await 설정파일('svc', { command: 'node', args: ['x'] });
  const r = await makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg], spawnImpl: 가짜서버({ tools: [] }),
  }).handler({ connector: 'svc' });
  assert.equal(r.blocked, true, '토큰·악수만으로 성공이라 하지 않는다');
});

test('원격 MCP 는 아직 실행기가 없다고 정직하게 말한다(있는 척 금지)', async () => {
  const ctx = 빈컨텍스트();
  const c = defineConnector({ id: 'notion', label: '노션', connected: false });
  c.authMethods = [{ kind: 'mcp', server: 'notion' }];
  const cfg = await 설정파일('notion', { url: 'https://mcp.notion.com/mcp' });
  const r = await makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c], mcpConfigPaths: [cfg], spawnImpl: 가짜서버(),
  }).handler({ connector: 'notion' });
  assert.equal(r.blocked, true);
  assert.match(r.userSafeSummary, /인증을 대신 실행하는 손이 T5 에 없어요/, "왜 못 하는지를 사람 말로 — 없는 화면을 약속하지 않게");
});

test('모르는 서비스는 아는 척하지 않는다', async () => {
  const r = await makeConnectorConnectTool({ ctx: () => 빈컨텍스트(), connectors: () => [] })
    .handler({ connector: '듣도보도못한서비스' });
  assert.equal(r.blocked, true);
  assert.ok(r.nextSafeAction);
});

// ── UX 불변식: 사용자가 배워야 하는 말이 카드에 없다 ──────────────────────
// 오너 기준: "사용자가 배워야 하는가, 아니면 T5 가 대신 다뤄주는가?"
// 리모컨에 적외선 프로토콜을 적지 않는다. 연결 방식(mcp·oauth·api_key)은 T5 안쪽 일이다.
// 사용자가 판단할 것은 **무엇을 허락하는가**이지 무슨 방식으로 붙는가가 아니다.
test('연결 승인 카드에 내부 용어가 없다', () => {
  const c = defineConnector({ id: 'svc', label: '노션', connected: false, userJobs: ['문서를 읽어와 정리해요'] });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const p = makeConnectorConnectTool({ connectors: () => [c] }).previewOf({ connector: '노션' });
  // **값만** 본다 — scope·impact 같은 필드 이름은 계약이지 사용자에게 가는 말이 아니다
  // (화면은 그걸 "어디에:" 로 그린다). 키까지 훑으면 검사가 거짓 경보를 낸다.
  const 카드 = Object.values(p).join(" ");
  // 방식 이름(MCP)은 **뒤에 사실로** 남긴다 — 숨기는 것과 앞세우지 않는 것은 다르다(오너 판단).
  // 막는 것은 사용자가 배워야만 뜻이 통하는 날것들이다.
  for (const 내부어 of ['api_key', 'transport', 'JSON-RPC', 'stdio', 'oauth_pkce', 'access_token']) {
    assert.ok(!카드.includes(내부어), `사용자가 배워야 하는 말이 카드에 있다: ${내부어}`);
  }
  assert.doesNotMatch(p.impact, /MCP|OAuth/, '주 문장은 방식이 아니라 무엇을 하는지로 시작한다');
  assert.match(p.scope, /MCP/, '방식은 판단 정보 뒤에 사실로 남는다');
});

test('카드는 "무엇을 허락하는가"와 "무엇이 가능해지는가"를 말한다', () => {
  const c = defineConnector({ id: 'svc', label: '노션', connected: false, userJobs: ['문서를 읽어와 정리해요'] });
  c.authMethods = [{ kind: 'mcp', server: 'svc' }];
  const p = makeConnectorConnectTool({ connectors: () => [c] }).previewOf({ connector: '노션' });
  assert.match(p.scope, /연결하면.*할 수 있어요/, '연결하면 뭐가 되는지');
  assert.match(p.what, /허락/, '무엇을 허락하는 건지');
  assert.match(p.cancel, /끊/, '어떻게 되돌리는지');
});

test('조사가 이름에 맞는다(작지만 멈칫하게 만든다)', () => {
  const 만들기 = (label) => {
    const c = defineConnector({ id: 'x', label, connected: false });
    c.authMethods = [{ kind: 'mcp', server: 'x' }];
    return makeConnectorConnectTool({ connectors: () => [c] }).previewOf({ connector: label }).impact;
  };
  assert.match(만들기('노션'), /노션을/);
  assert.match(만들기('구글'), /구글을/);
  assert.match(만들기('카카오'), /카카오를/);
});
