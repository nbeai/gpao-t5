import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeRemoteMcpConnection } from '../src/remote-mcp-connection.js';

test('사용자는 Linear를 한 번 요청하고 로그인 허용 뒤 원래 오늘 마감 업무를 자동으로 받는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-linear-human-'));
  const values = new Map(); const store = { async get(k) { return structuredClone(values.get(k) ?? null); },
    async set(k, v) { values.set(k, structuredClone(v)); }, async clear(k) { values.delete(k); } };
  const metadata = { issuer: 'https://auth.linear.test', authorization_endpoint: 'https://auth.linear.test/authorize',
    token_endpoint: 'https://auth.linear.test/token', registration_endpoint: 'https://auth.linear.test/register',
    code_challenge_methods_supported: ['S256'], scopes_supported: ['read', 'write'] };
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://auth.linear.test'] }));
    if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
    if (String(url).endsWith('/register')) return new Response(JSON.stringify({ client_id: 'client' }), { status: 201 });
    if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600 }));
    throw new Error(`unexpected ${url}`);
  };
  let remoteCalls = 0;
  const runtimeFactory = () => ({ async listTools() { return [{ name: 'list_issues', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]; },
    async callTool() { remoteCalls += 1; return { content: [{ type: 'text', text: '{"issues":[{"title":"견적 검토","due":"today"}]}' }], isError: false }; },
    invalidate() {}, async close() {} });
  const linear = makeRemoteMcpConnection({ id: 'linear', label: 'Linear', serverUrl: 'https://mcp.linear.app/mcp',
    resource: 'https://mcp.linear.app/mcp', secretStore: store, fetchImpl, runtimeFactory, callbackPort: 0 });
  let turn = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    workspaceConnectionServices: [linear], connectionPollIntervalMs: 5,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'connections', name: 'connection', args: { action: 'list', id: null, actionId: null } }] };
      if (turn === 2) return { text: '', toolCalls: [{ id: 'connect-linear', name: 'connection', args: { action: 'start', id: 'linear', actionId: null } }] };
      if (turn === 3) return { text: 'Linear 로그인 화면에서 허용해 주세요. 끝나면 원래 부탁을 이어갈게요.', toolCalls: [] };
      assert.ok(input.tools.some((tool) => tool.name === 'linear'));
      if (turn === 4) return { text: '', toolCalls: [{ id: 'list-tools', name: 'linear', args: { action: 'list_tools', toolName: null, argumentsJson: null, effect: null } }] };
      if (turn === 5) return { text: '', toolCalls: [{ id: 'issues', name: 'linear', args: { action: 'call', toolName: 'list_issues', argumentsJson: '{}', effect: null } }] };
      return { text: '오늘 마감 업무는 견적 검토예요.', toolCalls: [] };
    } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, input = {}) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); return response.json(); };
  try {
    const session = await post('/sessions');
    const started = await post('/turn', { sessionId: session.id, text: 'Linear를 연결해서 오늘 마감 업무를 찾아줘. 연결이 끝나면 내가 다시 말하지 않아도 이어서 알려줘.' });
    assert.equal(started.connectionHandoff.connectionId, 'linear');
    const auth = new URL(started.connectionHandoff.authorizeUrl); const callback = new URL(auth.searchParams.get('redirect_uri'));
    const awaiting = post('/connections/linear/await', { sessionId: session.id, handoffId: started.runId });
    await fetch(`${callback}?code=CODE&state=${encodeURIComponent(auth.searchParams.get('state'))}`);
    assert.equal((await awaiting).connected, true);
    const deadline = Date.now() + 2_000; let detail;
    while (Date.now() < deadline) { detail = await fetch(`${base}/sessions/${session.id}`).then((r) => r.json());
      if ((detail.transcript ?? []).some((entry) => /오늘 마감 업무는 견적 검토/u.test(entry.result?.reply ?? ''))) break;
      await new Promise((resolve) => setTimeout(resolve, 10)); }
    assert.equal((detail.transcript ?? []).filter((entry) => /오늘 마감 업무는 견적 검토/u.test(entry.result?.reply ?? '')).length, 1);
    assert.equal(remoteCalls, 1);
  } finally { server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});
