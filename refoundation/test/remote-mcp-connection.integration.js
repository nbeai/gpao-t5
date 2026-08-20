import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRemoteMcpConnection } from '../src/remote-mcp-connection.js';

test('범용 Remote MCP는 DCR·사용자 OAuth·tools/list 확인 뒤에만 연결과 도구를 연다', async () => {
  const values = new Map(); const store = { async get(k) { return structuredClone(values.get(k) ?? null); },
    async set(k, v) { values.set(k, structuredClone(v)); }, async clear(k) { values.delete(k); } };
  const calls = [];
  const metadata = { issuer: 'https://auth.linear.test', authorization_endpoint: 'https://auth.linear.test/authorize',
    token_endpoint: 'https://auth.linear.test/token', registration_endpoint: 'https://auth.linear.test/register',
    code_challenge_methods_supported: ['S256'], scopes_supported: ['read', 'write'] };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET', body: options.body ?? null });
    if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://auth.linear.test'] }));
    if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
    if (String(url).endsWith('/register')) return new Response(JSON.stringify({ client_id: 'linear-dcr-client' }), { status: 201 });
    if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600, scope: 'read write' }));
    throw new Error(`unexpected ${url}`);
  };
  const runtimeCalls = [];
  const runtimeFactory = ({ serverUrl, credential }) => ({
    async listTools() { assert.equal(serverUrl, 'https://mcp.linear.app/mcp'); assert.equal((await credential()).accessToken, 'ACCESS');
      return [{ name: 'list_issues', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]; },
    async callTool(call) { runtimeCalls.push(call); return { content: [{ type: 'text', text: '{"issues":["오늘 견적 확인"]}' }], isError: false }; },
    invalidate() {}, async close() {},
  });
  const connection = makeRemoteMcpConnection({ id: 'linear', label: 'Linear', serverUrl: 'https://mcp.linear.app/mcp',
    resource: 'https://mcp.linear.app/mcp', secretStore: store, fetchImpl, runtimeFactory, callbackPort: 0, now: () => 1_000 });
  assert.equal((await connection.inspect()).state, 'needs_connection');
  const started = await connection.start(); const auth = new URL(started.authorizeUrl);
  assert.equal(auth.searchParams.get('client_id'), 'linear-dcr-client'); assert.equal(auth.searchParams.get('resource'), 'https://mcp.linear.app/mcp');
  const callback = new URL(auth.searchParams.get('redirect_uri'));
  const completion = connection.awaitConnection();
  const response = await fetch(`${callback}?code=LINEAR-CODE&state=${encodeURIComponent(auth.searchParams.get('state'))}`);
  assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /LINEAR-CODE|ACCESS|REFRESH/u);
  assert.equal((await completion).connected, true); assert.equal((await connection.inspect()).state, 'connected');
  const tool = await connection.makeTool({ authorizeEffect: async () => ({ allowed: true }) });
  const listed = await tool.execute({ action: 'list_tools', toolName: null, argumentsJson: null, effect: null });
  assert.equal(listed.tools[0].name, 'list_issues');
  const result = await tool.execute({ action: 'call', toolName: 'list_issues', argumentsJson: '{}', effect: null });
  assert.match(result.content[0].text, /오늘 견적 확인/u); assert.deepEqual(runtimeCalls, [{ name: 'list_issues', arguments: {} }]);
  assert.equal(calls.some((call) => call.url.endsWith('/register')), true);
  assert.doesNotMatch(JSON.stringify(await connection.inspect()), /ACCESS|REFRESH|LINEAR-CODE/u);
  await connection.close();
});
