#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makeRemoteMcpConnection } from '../src/remote-mcp-connection.js';

const room = await mkdtemp(join(tmpdir(), 't5-r9-remote-mcp-live-')); const workspace = join(room, 'workspace'); await mkdir(workspace);
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE ?? join(homedir(), '.local/state/gpao-t5/sessions/model-connection.json'));
const access = makeConsoleModelAccess({ connectionFile, stateDir: join(room, 'model') }); const modelStatus = await access.status();
if (!modelStatus.connected) throw new Error('actual model connection required');
const values = new Map(); const store = { async get(k) { return structuredClone(values.get(k) ?? null); }, async set(k, v) { values.set(k, structuredClone(v)); }, async clear(k) { values.delete(k); } };
const metadata = { issuer: 'https://auth.linear.test', authorization_endpoint: 'https://auth.linear.test/authorize', token_endpoint: 'https://auth.linear.test/token', registration_endpoint: 'https://auth.linear.test/register', code_challenge_methods_supported: ['S256'], scopes_supported: ['read', 'write'] };
const fetchImpl = async (url) => {
  if (String(url).includes('oauth-protected-resource')) return new Response(JSON.stringify({ authorization_servers: ['https://auth.linear.test'] }));
  if (String(url).includes('oauth-authorization-server')) return new Response(JSON.stringify(metadata));
  if (String(url).endsWith('/register')) return new Response(JSON.stringify({ client_id: 'client' }), { status: 201 });
  if (String(url).endsWith('/token')) return new Response(JSON.stringify({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600 }));
  throw new Error(`unexpected ${url}`);
};
let remoteCalls = 0;
const runtimeFactory = () => ({ async listTools() { return [{ name: 'list_issues', description: 'List current issues including due dates', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]; },
  async callTool() { remoteCalls += 1; return { content: [{ type: 'text', text: '{"issues":[{"title":"견적 검토","due":"today"}]}' }], isError: false }; }, invalidate() {}, async close() {} });
const linear = makeRemoteMcpConnection({ id: 'linear', label: 'Linear', serverUrl: 'https://mcp.linear.app/mcp', resource: 'https://mcp.linear.app/mcp', secretStore: store, fetchImpl, runtimeFactory, callbackPort: 0 });
const errors = [];
const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, workspaceConnectionServices: [linear], connectionPollIntervalMs: 25,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(), onError: (error) => errors.push(error?.message ?? String(error)) });
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, input = {}) => { const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; };
try {
  const session = await post('/sessions'); const prompt = 'Linear를 연결해서 오늘 마감 업무를 찾아줘. 연결이 끝나면 내가 다시 말하지 않아도 이어서 알려줘.';
  const started = await post('/turn', { sessionId: session.id, text: prompt });
  const auth = new URL(started.connectionHandoff?.authorizeUrl); const callback = new URL(auth.searchParams.get('redirect_uri'));
  const awaiting = post('/connections/linear/await', { sessionId: session.id, handoffId: started.runId });
  await fetch(`${callback}?code=CODE&state=${encodeURIComponent(auth.searchParams.get('state'))}`); await awaiting;
  const deadline = Date.now() + 30_000; let detail;
  while (Date.now() < deadline) { detail = await fetch(`${base}/sessions/${session.id}`).then((r) => r.json()); if ((detail.transcript ?? []).some((e) => /견적 검토/u.test(e.result?.reply ?? ''))) break; await new Promise((r) => setTimeout(r, 50)); }
  const reply = [...(detail?.transcript ?? [])].reverse().find((e) => e.role === 'assistant')?.result?.reply ?? '';
  const runs = await server.runLedger.list({ sessionId: session.id }); const handoff = (await server.capabilityHandoffLedger.read()).handoffs.find((h) => h.handoffId === started.runId);
  const evidence = { schema: 't5.r9-remote-mcp-live.v1', model: { provider: modelStatus.provider, modelId: modelStatus.modelId }, prompt,
    checks: { handoffStarted: started.connectionHandoff?.connectionId === 'linear', connected: (await linear.inspect()).state === 'connected', resumed: handoff?.state === 'resumed', remoteReadOnce: remoteCalls === 1, goalCompleted: /견적 검토/u.test(reply), noRuntimeErrors: errors.length === 0 },
    counts: { runs: runs.length, remoteCalls, errors: errors.length }, finalReply: reply };
  evidence.passed = Object.values(evidence.checks).every(Boolean); process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`); if (!evidence.passed) process.exitCode = 1;
} finally { server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections(); await new Promise((r) => server.close(r)); await rm(room, { recursive: true, force: true }); }
