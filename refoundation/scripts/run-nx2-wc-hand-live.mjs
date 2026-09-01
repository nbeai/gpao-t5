#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { deriveRunPerformanceTimeline } from '../src/run-speed-receipt.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';

const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') throw new Error('gpt-5.5 connection is required');

const allCases = [
  { id: 'direct', prompt: '매출이 무엇인지 한 문장으로 설명해줘.', route: [] },
  { id: 'search', prompt: '최근 공개된 소상공인 지원사업 자료를 찾아줘.', route: ['web_search', 'web_read'] },
  { id: 'url', prompt: '이 링크 내용을 짧게 요약해줘. https://www.iana.org/help/example-domains', route: ['web_read'] },
  { id: 'url_search', prompt: '이 링크를 읽고 비슷한 공식 사례도 찾아줘. https://www.iana.org/help/example-domains',
    route: ['web_read', 'web_search'] },
  { id: 'weather', prompt: '서울 오늘 날씨 알려줘.', route: ['web_research'] },
];
const selectedCaseIds = new Set(String(process.env.T5_WC_HAND_CASES ?? allCases.map((item) => item.id).join(','))
  .split(',').map((item) => item.trim()).filter(Boolean));
const cases = allCases.filter((item) => selectedCaseIds.has(item.id));
if (!cases.length) throw new Error('at least one known Web Hand case is required');
const room = await mkdtemp(join(tmpdir(), 't5-wc-hand-live-')); const stateDir = join(room, 'state');
const workspace = join(room, 'workspace'); const home = join(room, 'home');
await Promise.all([stateDir, workspace, home].map((path) => mkdir(path, { recursive: true })));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: source.version, activeId: selected.id,
  roleBindings: {}, connections: [selected] }), { mode: 0o600 });
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });
const server = makeConsoleServer({ stateDir, workspace,
  computerEnvironment: discoverComputerEnvironment({ userHome: home }),
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  capabilitySurfaceMode: 'directory-first-v1', workAdmissionMode: 'action-v1',
  learningReviewMode: 'off', memoryFlushMode: 'off',
  webSearchProviders: [makeNaverSearchProvider(), makeDuckDuckGoSearchProvider(), makeBingSearchProvider()],
  workspaceConnectionInspectors: [], workspaceConnectionServices: [],
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const base = `http://127.0.0.1:${server.address().port}`;
async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }); const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'failed'}`); return value;
}
try {
  const results = [];
  for (const definition of cases) {
    let observed;
    try {
      const session = await post('/sessions', {}); const result = await post('/turn', {
        sessionId: session.id, text: definition.prompt,
      });
      const run = await fetch(`${base}/runs/${result.runId}`, { signal: AbortSignal.timeout(10_000) })
        .then((response) => response.json());
      const timeline = deriveRunPerformanceTimeline(run);
      const tools = timeline.tools.map((tool) => tool.name);
      const withoutToolSearch = !tools.includes('tool_search');
      const ordered = (left, right) => tools.includes(left) && tools.includes(right)
        && tools.indexOf(left) < tools.indexOf(right);
      const routeOrder = definition.id === 'search'
        ? tools.includes('web_research') || ordered('web_search', 'web_read')
        : definition.id === 'url_search'
          ? tools[0] === 'web_read' && (tools.slice(1).includes('web_search')
            || tools.slice(1).includes('web_research'))
          : definition.route.every((name, index) => tools.indexOf(name)
            >= 0 && (index === 0 || tools.indexOf(definition.route[index - 1]) < tools.indexOf(name)));
      const extrasOkay = definition.id === 'direct' ? tools.length === 0
        : definition.id === 'url' ? !tools.includes('web_search')
          : definition.id === 'weather' ? !tools.includes('web_search') : true;
      observed = { id: definition.id, passed: withoutToolSearch && routeOrder && extrasOkay,
        tools, performance: timeline.totals, answer: String(result.reply ?? '').slice(0, 1_200) };
    } catch (error) {
      observed = { id: definition.id, passed: false, tools: [], performance: null,
        error: error?.name === 'TimeoutError' ? 'qualification_timeout' : 'qualification_transport_failed' };
    }
    results.push(observed); process.stdout.write(`${JSON.stringify({ case: observed })}\n`);
  }
  const payload = { schema: 't5.nx2-wc-hand-live.v1', sourceCommit: process.env.T5_WC_SOURCE_COMMIT ?? null,
    model: selected.modelId, actualUserData: false, externalWrites: 0, results,
    passed: results.every((item) => item.passed) };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!payload.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); server.closeModelConnections(); await server.closeAutomations();
  await server.managedProcesses.stopAll('wc_hand_live_shutdown');
  await new Promise((done) => server.close(done)); await rm(room, { recursive: true, force: true });
}
