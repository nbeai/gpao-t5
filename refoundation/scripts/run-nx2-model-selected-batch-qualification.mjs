#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { consoleInstructions, makeConsoleModelAccess } from '../src/console-model-factory.js';
import { discoverComputerEnvironment, publicComputerFacts } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { prepareModelSelectedBatchObservation } from '../test/helpers/nx-model-selected-batch-observation.js';

const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') {
  throw new Error('exact secret-backed gpt-5.5 ChatGPT OAuth connection is required');
}

const room = await mkdtemp(join(tmpdir(), 't5-nx2-selected-live-'));
const home = join(room, 'home'); const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([home, stateDir, workspace].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
await writeFile(join(workspace, '매출기록.csv'), [
  'month,client,item,revenue_manwon', '2026-03,한빛상사,위젯,100', '2026-03,미래상사,서비스,50',
  '2026-04,한빛상사,위젯,100', '2026-04,미래상사,서비스,50',
].join('\n'));
await writeFile(join(workspace, '직원계약현황.csv'), [
  'employee,end_date,signed', '김민수,2026-09-15,yes', '이서연,2026-12-31,no',
].join('\n'));
await writeFile(join(workspace, '미수금현황.csv'), [
  'customer,invoice,amount_manwon,due_date,paid_manwon',
  '한빛상사,A-1,120,2026-08-15,0', '미래상사,B-2,80,2026-08-20,80',
  '새봄상사,C-3,50,2026-09-10,0',
].join('\n'));
await writeFile(join(workspace, '재고현황.csv'), [
  'item,system_qty,physical_qty', '위젯,100,90', '볼트,50,50', '너트,30,30',
].join('\n'));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: source.version, activeId: selected.id,
  roleBindings: {}, connections: [selected] }), { mode: 0o600 });
const computer = publicComputerFacts(discoverComputerEnvironment({ userHome: home }));
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });

const scenarios = [
  {
    id: 'receivables', request: '이번 달 받을 돈 뭐가 안 맞는지 봐줘.',
    required: [/한빛/u, /A-1/u, /120/u, /2026-08-15|8월\s*15/u],
    excluded: [/미래상사/u, /새봄상사/u], expectedFile: '미수금현황.csv',
  },
  {
    id: 'receivables_clear', request: '받기로 한 날짜가 지났는데 아직 못 받은 돈만 찾아줘.',
    required: [/한빛/u, /A-1/u, /120/u, /2026-08-15|8월\s*15/u],
    excluded: [/미래상사/u, /새봄상사/u], expectedFile: '미수금현황.csv',
  },
  {
    id: 'direct', request: '매출이 뭔지 한 문장으로 설명해줘.',
    required: [/매출/u], excluded: [], expectedFile: null,
  },
];
const selectedScenarioIds = new Set(String(process.env.T5_NX2_SCENARIOS ?? 'receivables,direct')
  .split(',').map((item) => item.trim()).filter(Boolean));

try {
  const results = [];
  for (const scenario of scenarios.filter((item) => selectedScenarioIds.has(item.id))) {
    const batch = await prepareModelSelectedBatchObservation({ workspace });
    const baseModel = await access.model({ sessionId: `nx2-${scenario.id}`, workspace, computer,
      instructionsOverride: consoleInstructions(workspace, computer) });
    let calls = 0;
    const model = { ...baseModel, respond: (request) => {
      calls += 1;
      return baseModel.respond({ ...request, runtimeContext: [request.runtimeContext,
        calls === 1 ? '[T5 CURRENT LOCAL TIME — observed now]\nlocal=2026-09-01 10:00:00\ntimeZone=Asia/Seoul' : '',
        calls === 1 ? batch.context : ''].filter(Boolean).join('\n\n') });
    } };
    const started = performance.now(); let result; let error = null;
    try { result = await runAgent({ request: scenario.request, model, tools: [batch.tool], maxModelTurns: 4 }); }
    catch (caught) { error = caught?.message ?? String(caught); result = { status: 'failed', answer: '', receipts: [], modelCalls: [], modelTurns: 0 }; }
    await baseModel.close?.();
    const answer = String(result.answer ?? '');
    const selectedRefs = result.receipts.flatMap((receipt) => receipt.actualCall?.name === 'bounded_reality'
      ? receipt.actualCall.args.selectedCandidateRefs : []);
    const selectedNames = selectedRefs.map((ref) => batch.candidates.find((item) => item.candidateRef === ref)?.displayIdentity)
      .filter(Boolean);
    const tokenUsage = result.modelCalls.reduce((totals, call) => ({
      input: totals.input + Number(call.usage?.input_tokens ?? 0),
      output: totals.output + Number(call.usage?.output_tokens ?? 0),
    }), { input: 0, output: 0 });
    const passed = result.status === 'completed'
      && scenario.required.every((pattern) => pattern.test(answer))
      && scenario.excluded.every((pattern) => !pattern.test(answer))
      && (scenario.expectedFile == null
        ? result.receipts.length === 0 : selectedNames.includes(scenario.expectedFile));
    results.push({ id: scenario.id, passed, wallMs: Number((performance.now() - started).toFixed(3)),
      modelCalls: result.modelTurns, toolCalls: result.receipts.length, tokenUsage,
      selectedNames, answerExcerpt: answer.slice(0, 1600), error });
  }
  const passed = results.every((result) => result.passed);
  process.stdout.write(`${JSON.stringify({ schema: 't5.nx2.model-selected-batch-qualification.v1',
    model: selected.modelId, provider: 'chatgpt_oauth', actualUserData: false, externalWrites: 0,
    results, passed, productChanges: 0 }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  access.close?.(); await rm(room, { recursive: true, force: true });
}
