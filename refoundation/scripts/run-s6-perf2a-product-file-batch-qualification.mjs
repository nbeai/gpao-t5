#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') {
  throw new Error('exact secret-backed gpt-5.5 ChatGPT OAuth connection is required');
}

const room = await mkdtemp(join(tmpdir(), 't5-perf2a-product-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); const home = join(room, 'home');
await Promise.all([stateDir, workspace, home].map((path) => mkdir(path, { recursive: true })));
process.env.T5_REFOUNDATION_HOME = home; process.env.T5_REFOUNDATION_WORKSPACE = workspace;
const fixtures = [
  ['alpha-7391-report.txt', 'ALPHA-7391 current report'],
  ['beta-2846-plan.txt', 'BETA-2846 current plan'],
  ['gamma-9157-note.txt', 'GAMMA-9157 current note'],
];
for (const [name, content] of fixtures) await writeFile(join(workspace, name), content);
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({
  version: source.version, activeId: selected.id, roleBindings: {}, connections: [selected],
}), { mode: 0o600 });
const secretStore = makePlatformSecretStore({ platform: process.platform });
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore });
const computer = discoverComputerEnvironment({ userHome: home });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
const terminalPlatformAdapter = await makeTerminalPlatformAdapter({
  platform: computer.platform, managedWorkspace: workspace,
  protectedReadRoots: [stateDir, dirname(sourceFile), join(homedir(), 'Library', 'Keychains')],
});
const server = makeConsoleServer({
  stateDir, workspace, computerFileRoots: [workspace], restrictFileRealityToComputerRoots: true,
  computerEnvironment: computer, terminalEnvironment, terminalPlatformAdapter,
  capabilitySurfaceMode: 'directory-first-v1', workAdmissionMode: 'action-v1',
  learningReviewMode: 'off', memoryFlushMode: 'off',
  modelFactory: (input) => access.model(input), modelStatus: () => access.status(),
  workspaceConnectionInspectors: [], workspaceConnectionServices: [],
});
await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body) => {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
  return value;
};
try {
  const session = await post('/sessions', {}); const started = performance.now();
  const reply = await post('/turn', { sessionId: session.id, text: [
    '이 작업공간에서 ALPHA-7391, BETA-2846, GAMMA-9157 세 단서에 각각 해당하는 파일을 찾아',
    '정확한 파일명을 한 줄씩 알려줘. 세 검색은 서로 독립이고 파일 내용이나 이름을 추측하면 안 돼.',
  ].join(' ') });
  const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
  const modelGroups = run.events.filter((event) => event.type === 'model_completed').map((event) => ({
    turn: event.payload?.turn,
    calls: (event.payload?.response?.toolCalls ?? []).map((call) => ({
      name: call.name, action: call.args?.action ?? null, query: call.args?.query ?? null,
    })),
  }));
  const tools = run.events.filter((event) => event.type === 'tool_completed').map((event) => ({
    requestedName: event.payload?.receipt?.requestedCall?.name ?? null,
    actualName: event.payload?.receipt?.actualCall?.name ?? null,
    action: event.payload?.receipt?.actualCall?.args?.action ?? null,
    outcome: event.payload?.receipt?.outcome ?? null,
    state: event.payload?.receipt?.result?.state ?? null,
    reason: event.payload?.receipt?.result?.reason ?? null,
  }));
  const expected = fixtures.map(([name]) => name);
  const passed = expected.every((name) => String(reply.reply ?? '').includes(name));
  process.stdout.write(`${JSON.stringify({
    schema: 't5.s6-perf2a-product-file-batch-qualification.v1',
    model: selected.modelId, provider: 'chatgpt_oauth', actualUserData: false,
    externalWrites: 0, productDefaultChanged: false, passed,
    wallMs: Number((performance.now() - started).toFixed(3)),
    modelCalls: modelGroups.length, toolCalls: tools.length, modelGroups, tools,
    finalAnswerContainsAllExactNames: passed,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('perf2a_product_shutdown');
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
