import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRemoteMcpRuntime } from '../src/remote-mcp-runtime.js';

function json(id, result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  });
}

test('동시 401은 각 요청이 실제 사용한 generation에 결속되어 refresh 한 번과 exact retry로 끝난다', async () => {
  let generation = 1; let refreshCalls = 0; let oldCalls = 0; let releaseLate401;
  const late401 = new Promise((resolve) => { releaseLate401 = resolve; });
  const runtime = makeRemoteMcpRuntime({
    serverUrl: 'https://mcp.example.test/mcp',
    credential: async () => ({ accessToken: `TOKEN-${generation}`, generation }),
    onUnauthorized: async ({ failedGeneration }) => {
      if (generation === failedGeneration) { refreshCalls += 1; generation += 1; releaseLate401(); }
      return { accessToken: `TOKEN-${generation}`, generation };
    },
    fetchImpl: async (_url, init = {}) => {
      const message = JSON.parse(String(init.body)); const authorization = new Headers(init.headers).get('authorization');
      if (message.method === 'initialize') return json(message.id, {
        protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' },
      });
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') return json(message.id, { tools: [{ name: 'read',
        inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
      if (message.method === 'tools/call' && authorization === 'Bearer TOKEN-1') {
        oldCalls += 1; if (oldCalls === 2) await late401;
        return new Response('', { status: 401 });
      }
      if (message.method === 'tools/call' && authorization === 'Bearer TOKEN-2') {
        return json(message.id, { content: [{ type: 'text', text: 'ok' }], isError: false });
      }
      throw new Error(`unexpected ${message.method} ${authorization}`);
    },
  });
  await runtime.listTools();
  const results = await Promise.all([
    runtime.callTool({ name: 'read', arguments: { item: 1 } }),
    runtime.callTool({ name: 'read', arguments: { item: 2 } }),
  ]);
  assert.equal(refreshCalls, 1); assert.equal(oldCalls, 2);
  assert.deepEqual(results.map((result) => result.content[0].text), ['ok', 'ok']);
  await runtime.close();
});

test('403 insufficient_scope는 자동 재시도 없이 필요한 추가 scope를 구조적으로 올린다', async () => {
  let calls = 0; let refreshCalls = 0; const permission = [];
  const runtime = makeRemoteMcpRuntime({ serverUrl: 'https://mcp.example.test/mcp',
    credential: async () => ({ accessToken: 'TOKEN', generation: 1 }),
    onUnauthorized: async () => { refreshCalls += 1; },
    onAdditionalPermissionRequired: async (value) => { permission.push(value); },
    fetchImpl: async (_url, init = {}) => {
      const message = JSON.parse(String(init.body));
      if (message.method === 'initialize') return json(message.id, {
        protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' },
      });
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') return json(message.id, { tools: [{ name: 'read',
        inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
      calls += 1; return new Response('', { status: 403, headers: {
        'www-authenticate': 'Bearer error="insufficient_scope", scope="files:read"',
      } });
    } });
  await runtime.listTools();
  await assert.rejects(() => runtime.callTool({ name: 'read', arguments: {} }), (error) => (
    error.reason === 'needs_additional_permission' && error.requiredScopes[0] === 'files:read'
  ));
  assert.equal(calls, 1); assert.equal(refreshCalls, 0);
  assert.deepEqual(permission, [{ failedGeneration: 1, requiredScopes: ['files:read'] }]); await runtime.close();
});

test('refresh 뒤 두 번째 401은 반복하지 않고 credential state 하강 callback을 한 번 호출한다', async () => {
  let generation = 1; let requests = 0; let rejected = 0;
  const runtime = makeRemoteMcpRuntime({ serverUrl: 'https://mcp.example.test/mcp',
    credential: async () => ({ accessToken: `TOKEN-${generation}`, generation }),
    onUnauthorized: async () => { generation = 2; return { accessToken: 'TOKEN-2', generation: 2 }; },
    onAuthRejected: async () => { rejected += 1; },
    fetchImpl: async (_url, init = {}) => {
      const message = JSON.parse(String(init.body));
      if (message.method === 'initialize') return json(message.id, {
        protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' },
      });
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') return json(message.id, { tools: [{ name: 'read',
        inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
      requests += 1; return new Response('', { status: 401 });
    } });
  await runtime.listTools();
  await assert.rejects(() => runtime.callTool({ name: 'read', arguments: {} }), (error) => error.reason === 'reauth_required');
  assert.equal(requests, 2); assert.equal(rejected, 1); await runtime.close();
});

test('오래된 retry 401 뒤 더 최신 generation이 생기면 최신 credential을 강등하지 않는다', async () => {
  let generation = 1; let releaseRetry; let retryStarted;
  const retryAtServer = new Promise((resolve) => { retryStarted = resolve; });
  const retryGate = new Promise((resolve) => { releaseRetry = resolve; });
  const rejected = [];
  const runtime = makeRemoteMcpRuntime({ serverUrl: 'https://mcp.example.test/mcp',
    credential: async () => ({ accessToken: `TOKEN-${generation}`, generation }),
    onUnauthorized: async () => { generation = 2; return { accessToken: 'TOKEN-2', generation: 2 }; },
    onAuthRejected: async ({ failedGeneration }) => { rejected.push(failedGeneration);
      if (generation === failedGeneration) generation = -1; },
    fetchImpl: async (_url, init = {}) => {
      const message = JSON.parse(String(init.body)); const token = new Headers(init.headers).get('authorization');
      if (message.method === 'initialize') return json(message.id, {
        protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' },
      });
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (message.method === 'tools/list') return json(message.id, { tools: [{ name: 'read',
        inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] });
      if (token === 'Bearer TOKEN-1') return new Response('', { status: 401 });
      retryStarted(); await retryGate; return new Response('', { status: 401 });
    } });
  await runtime.listTools(); const call = runtime.callTool({ name: 'read', arguments: {} }); call.catch(() => {});
  await retryAtServer; generation = 3; releaseRetry();
  await assert.rejects(call, (error) => error.reason === 'reauth_required');
  assert.deepEqual(rejected, [2]); assert.equal(generation, 3); await runtime.close();
});
