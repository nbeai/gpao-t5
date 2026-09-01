#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { deriveRunPerformanceTimeline } from '../src/run-speed-receipt.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { summarizeExistingPathTrace } from '../test/helpers/nx-existing-path-trace.js';

const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') {
  throw new Error('exact secret-backed gpt-5.5 ChatGPT OAuth connection is required');
}

const room = await mkdtemp(join(tmpdir(), 't5-ng3a-')); const stateDir = join(room, 'state');
const workspace = join(room, 'workspace'); const home = join(room, 'home');
await Promise.all([stateDir, workspace, home].map((path) => mkdir(path, { recursive: true })));
process.env.T5_REFOUNDATION_HOME = home; process.env.T5_REFOUNDATION_WORKSPACE = workspace;
await writeFile(join(workspace, '매출기록.csv'), [
  'month,client,item,revenue_manwon',
  '2026-03,한빛상사,위젯,100', '2026-03,미래상사,서비스,50',
  '2026-04,한빛상사,위젯,100', '2026-04,미래상사,서비스,50',
  '2026-05,한빛상사,위젯,100', '2026-05,미래상사,서비스,50',
  '2026-06,한빛상사,위젯,100', '2026-06,미래상사,서비스,50',
  '2026-07,한빛상사,위젯,60', '2026-07,미래상사,서비스,50',
  '2026-08,한빛상사,위젯,40', '2026-08,미래상사,서비스,50',
].join('\n'));
await writeFile(join(workspace, '직원계약현황.csv'), [
  'employee,end_date,signed',
  '김민수,2026-09-15,yes',
  '이서연,2026-12-31,no',
  '박지훈,2026-10-05,yes',
].join('\n'));
await writeFile(join(workspace, '미수금현황.csv'), [
  'customer,invoice,amount_manwon,due_date,paid_manwon',
  '한빛상사,A-1,120,2026-08-15,0',
  '미래상사,B-2,80,2026-08-20,80',
  '새봄상사,C-3,50,2026-09-10,0',
].join('\n'));
await writeFile(join(workspace, '재고현황.csv'), [
  'item,system_qty,physical_qty',
  '위젯,100,90',
  '볼트,50,50',
  '너트,30,30',
].join('\n'));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({
  version: source.version, activeId: selected.id, roleBindings: {}, connections: [selected],
}), { mode: 0o600 });
const computer = discoverComputerEnvironment({ userHome: home });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
const terminalPlatformAdapter = await makeTerminalPlatformAdapter({
  platform: computer.platform, managedWorkspace: workspace,
  protectedReadRoots: [stateDir, dirname(sourceFile), join(homedir(), 'Library', 'Keychains')],
});
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });
const practicalLens = [
  '[T5 QUALIFICATION-ONLY PRACTICAL LENS — not canonical product truth]',
  'When the user asks to assess a current operational condition in the available workspace without specifying analysis details,',
  'inspect the smallest directly relevant current source before giving generic hypotheses.',
  'Answer the requested discrepancy or condition first. Do not open other files unless the direct source lacks a fact required for that result.',
  'Separate an observed discrepancy from a causal explanation.',
  'Do not activate this lens for definitions, general explanations, opinions, brainstorming, creative work, or requests already answerable without current workspace evidence.',
].join(' ');
const lensActive = process.env.T5_NG3A_PRACTICAL_LENS === '1';
const modelFactory = async (input) => {
  const baseModel = await access.model(input);
  if (!lensActive) return baseModel;
  return { ...baseModel,
    respond: (request) => baseModel.respond({ ...request,
      runtimeContext: [request.runtimeContext, practicalLens].filter(Boolean).join('\n\n') }),
    supersedeLastResponse: (...args) => baseModel.supersedeLastResponse?.(...args),
  };
};
const server = makeConsoleServer({
  stateDir, workspace, computerFileRoots: [workspace], restrictFileRealityToComputerRoots: true,
  computerEnvironment: computer, terminalEnvironment, terminalPlatformAdapter,
  capabilitySurfaceMode: 'directory-first-v1', workAdmissionMode: 'action-v1',
  learningReviewMode: 'off', memoryFlushMode: 'off',
  modelFactory, modelStatus: () => access.status(),
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
const scenarios = {
  sales: {
    oracle: { previousManwon: 450, recentManwon: 350, declineManwon: 100,
      declinePercent: 22.2, source: '한빛상사 위젯' },
    checks: [/450/u, /350/u, /100/u, /22\.2/u, /한빛/u, /위젯/u],
    variants: [
      { id: 'ordinary', text: '요즘 매출이 왜 별로인지 좀 봐줘.' },
      { id: 'nx2_ordinary', text: '이번 달 매출이 왜 줄었는지 봐줘.' },
      { id: 'expert', text: [
        '작업공간 매출기록에서 최근 3개월과 직전 3개월 총매출을 비교하고,',
        '거래처·품목별 감소 기여와 근거 숫자를 알려줘. 관측된 변화와 실제 인과 원인은 구분해.',
      ].join(' ') },
    ],
  },
  contracts: {
    oracle: { expiringWithin30Days: '김민수 2026-09-15', missingSignature: '이서연' },
    checks: [/김민수/u, /2026-09-15|9월\s*15/u, /이서연/u, /서명/u],
    variants: [
      { id: 'ordinary', text: '직원 계약들 지금 문제 없는지 좀 봐줘.' },
      { id: 'expert', text: '작업공간 직원계약현황에서 오늘 기준 30일 내 만료와 서명 누락만 찾아 근거 날짜와 함께 알려줘.' },
    ],
  },
  receivables: {
    oracle: { overdueUnpaid: '한빛상사 A-1 120만원', normalOrFutureExcluded: ['미래상사', '새봄상사'] },
    checks: [/한빛/u, /A-1/u, /120/u, /2026-08-15|8월\s*15/u],
    variants: [
      { id: 'ordinary', text: '이번 달 받을 돈 뭐가 안 맞는지 봐줘.' },
      { id: 'nx2_ordinary', text: '아직 돈 안 들어온 곳 정리해줘.' },
      { id: 'expert', text: '작업공간 미수금현황에서 오늘 기준 기한이 지났고 아직 안 받은 금액만 찾아 거래처·청구번호·금액·기한을 알려줘.' },
    ],
  },
  inventory: {
    oracle: { mismatch: '위젯 전산 100 실사 90 부족 10', normalItemsExcluded: ['볼트', '너트'] },
    checks: [/위젯/u, /100/u, /90/u, /10/u, /부족|차이/u],
    variants: [
      { id: 'ordinary', text: '재고가 왜 안 맞는지 좀 봐줘.' },
      { id: 'nx2_ordinary', text: '재고가 안 맞는데 원인 찾아줘.' },
      { id: 'expert', text: '작업공간 재고현황에서 전산수량과 실사수량이 다른 품목만 찾아 품목·두 수량·차이를 알려줘.' },
    ],
  },
  direct: {
    oracle: { toolCalls: 0, result: 'one-sentence explanation' },
    checks: [/매출/u],
    requireToolZero: true,
    variants: [
      { id: 'ordinary', text: '매출이 뭔지 한 문장으로 설명해줘.' },
    ],
  },
};
const selectedScenarioIds = String(process.env.T5_NG3A_SCENARIOS ?? 'sales').split(',')
  .map((item) => item.trim()).filter((item) => Object.hasOwn(scenarios, item));
if (!selectedScenarioIds.length) throw new Error('at least one known NG3A scenario is required');
const selectedVariantIds = new Set(String(process.env.T5_NG3A_VARIANTS ?? 'ordinary,expert').split(',')
  .map((item) => item.trim()).filter(Boolean));
if (!selectedVariantIds.size) throw new Error('at least one known NG3A variant is required');

try {
  const scenarioResults = [];
  for (const scenarioId of selectedScenarioIds) {
    const scenario = scenarios[scenarioId]; const results = [];
    for (const variant of scenario.variants.filter((item) => selectedVariantIds.has(item.id))) {
      const session = await post('/sessions', {}); const started = performance.now();
      const reply = await post('/turn', { sessionId: session.id, text: variant.text });
      const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
      const timeline = deriveRunPerformanceTimeline(run); const answer = String(reply.reply ?? '');
      const purposeMarkersPassed = scenario.checks.every((pattern) => pattern.test(answer));
      const tools = timeline.tools.map((item) => ({ name: item.name, outcome: item.outcome }));
      const runStarted = run.events.find((event) => event.type === 'run_started')?.recordedAt;
      const runEnded = run.events.find((event) => ['run_completed', 'run_failed', 'run_cancelled']
        .includes(event.type))?.recordedAt;
      const ledgerWall = Date.parse(runEnded ?? '') - Date.parse(runStarted ?? '');
      const passed = purposeMarkersPassed && (!scenario.requireToolZero || timeline.totals.toolCalls === 0);
      const trace = process.env.T5_NX2_EXISTING_PATH_TRACE === '1'
        ? await summarizeExistingPathTrace({ run, stateDir, sessionId: session.id,
          userRequest: variant.text, purposePassed: passed }) : null;
      results.push({
        id: variant.id, passed, wallMs: Number.isFinite(ledgerWall) ? ledgerWall
          : Number((performance.now() - started).toFixed(3)),
        modelCalls: timeline.totals.modelCalls, toolCalls: timeline.totals.toolCalls,
        requestBytes: timeline.totals.requestBytes, inputTokens: timeline.totals.inputTokens,
        outputTokens: timeline.totals.outputTokens, cachedInputTokens: timeline.totals.cachedInputTokens,
        tools, askedUserQuestionInsteadOfResult: !passed && /어느|어떤|기간|자료.*주/u.test(answer),
        observedCorrelationNotCausation: scenarioId !== 'sales'
          ? null : /인과|단정|자료(?:만|로)|확인.*필요/u.test(answer),
        answerExcerpt: answer.slice(0, 1200), ...(trace ? { trace } : {}),
      });
    }
    scenarioResults.push({ scenarioId, hiddenOracle: scenario.oracle, results,
      invariantParity: results.every((item) => item.passed) });
  }
  const invariantParity = scenarioResults.every((item) => item.invariantParity);
  const payload = {
    schema: 't5.s6-ng3a-expression-gap-baseline.v1', model: selected.modelId,
    provider: 'chatgpt_oauth', actualUserData: false, externalWrites: 0,
    scenarioOrder: selectedScenarioIds, variantOrder: [...selectedVariantIds],
    practicalLensActive: lensActive, scenarios: scenarioResults, invariantParity, productChanges: 0,
  };
  if (process.env.T5_NG3A_OUTPUT) await writeFile(resolve(process.env.T5_NG3A_OUTPUT),
    JSON.stringify(payload, null, 2));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!invariantParity) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('ng3a_shutdown');
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
