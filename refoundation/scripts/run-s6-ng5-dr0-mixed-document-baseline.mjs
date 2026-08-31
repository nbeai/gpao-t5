#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { deriveRunPerformanceTimeline } from '../src/run-speed-receipt.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const repository = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const fixtureRoot = join(repository, 'refoundation', 'fixtures', 's6-ng5-dr0');
const oraclePath = join(repository, 'refoundation', 'evidence', 's6-ng5-dr0-hidden-oracle-2026-08-31.json');
const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
const sourceFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = source.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? source.connections?.find((item) => item.id === source.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') {
  throw new Error('exact secret-backed gpt-5.5 ChatGPT OAuth connection is required');
}

const helperCandidate = resolve(process.env.T5_NG5_IMAGE_OCR_HELPER
  ?? '/Applications/GPAO-T5.app/Contents/Resources/runtime/bin/t5-docx-page-renderer');
let helper = null;
try {
  const helperStat = await lstat(helperCandidate);
  if (helperStat.isFile() && !helperStat.isSymbolicLink()) helper = helperCandidate;
} catch { /* image purpose will remain honestly unqualified when the helper is absent */ }

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compact = (value) => String(value ?? '').replaceAll(',', '').replace(/\s+/gu, ' ');
const hasAll = (answer, patterns) => patterns.every((pattern) => pattern.test(compact(answer)));
const scenarioChecks = {
  purchase_reconciliation: {
    purpose: [/(?:120).*(?:118)|(?:118).*(?:120)/u, /(?:2\s*(?:개|units?)|shortage)/iu,
      /3000000/u, /2950000/u, /50000/u],
    source: [/purchase-order|PO-2026-104/iu, /receiving-ledger|Receiving/iu,
      /tax-invoice|IV-991/iu, /supplier-statement|statement/iu],
    forbidden: [/PO-2026-105.*(?:누락|차이|불일치)/u, /PO-2026-106.*(?:누락|차이|불일치)/u],
  },
  contract_revision: {
    purpose: [/4500000/u, /5100000/u, /600000/u, /2026-12-31/u, /2027-02-28/u,
      /weekly|주간/iu, /monthly|월간/iu, /provider.*(?:blank|pending)|(?:공급자|제공자).*(?:공란|미서명|대기|blank)/iu],
    source: [/contract-v1|1판/iu, /contract-v2|2판/iu, /responsibility-matrix|Revision Control|책임표/iu,
      /signature-page|서명.*이미지/iu],
    forbidden: [/법적.*유효|enforceable/iu],
  },
  expense_evidence: {
    purpose: [/C-101/iu, /R-101-A/iu, /duplicate|중복/iu, /C-102/iu,
      /42000/u, /41000/u, /1000/u, /C-103/iu, /15500/u, /missing|누락/iu],
    source: [/card-ledger|Card Ledger|카드 원장/iu, /receipt-C101/iu, /tax-invoice-C102|TI-C102|세금계산서 PDF/iu],
    forbidden: [/C-104.*(?:누락|불일치|중복)/u],
  },
};

async function runScenario(definition) {
  const room = await mkdtemp(join(tmpdir(), `t5-ng5-${definition.id}-`));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); const home = join(room, 'home');
  await Promise.all([stateDir, workspace, home].map((path) => mkdir(path, { recursive: true })));
  const before = {}; const copied = [];
  for (const sourceRecord of definition.sources) {
    const sourcePath = join(fixtureRoot, sourceRecord.path); const target = join(workspace, basename(sourceRecord.path));
    await copyFile(sourcePath, target); const bytes = await readFile(target);
    before[basename(sourceRecord.path)] = hash(bytes); copied.push(target);
  }
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
  const fileOcrProbe = helper ? makeLocalImageOcr({ platform: 'darwin', helper }) : null;
  const server = makeConsoleServer({
    stateDir, workspace, computerFileRoots: [workspace], restrictFileRealityToComputerRoots: true,
    computerEnvironment: computer, terminalEnvironment, terminalPlatformAdapter,
    capabilitySurfaceMode: 'directory-first-v1', workAdmissionMode: 'action-v1',
    learningReviewMode: 'off', memoryFlushMode: 'off', fileOcrProbe,
    modelFactory: (input) => access.model(input), modelStatus: () => access.status(),
    workspaceConnectionInspectors: [], workspaceConnectionServices: [],
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (pathname, body) => {
    const response = await fetch(`${base}${pathname}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
    return value;
  };
  try {
    const session = await post('/sessions', {}); const wallStarted = performance.now();
    const reply = await post('/turn', { sessionId: session.id, text: definition.userPrompt });
    const wallMs = Number((performance.now() - wallStarted).toFixed(3));
    const run = await fetch(`${base}/runs/${reply.runId}`).then((response) => response.json());
    const timeline = deriveRunPerformanceTimeline(run); const answer = String(reply.reply ?? '');
    const checks = scenarioChecks[definition.id];
    const after = Object.fromEntries(await Promise.all(copied.map(async (file) => [basename(file), hash(await readFile(file))])));
    const sourceMutation = Object.keys(before).some((name) => before[name] !== after[name]);
    const purposePassed = hasAll(answer, checks.purpose);
    const sourceTracePassed = hasAll(answer, checks.source);
    const forbiddenConclusion = checks.forbidden.some((pattern) => pattern.test(compact(answer)));
    return {
      id: definition.id,
      passed: purposePassed && sourceTracePassed && !forbiddenConclusion && !sourceMutation,
      checks: { purposePassed, sourceTracePassed, forbiddenConclusionAbsent: !forbiddenConclusion,
        sourceUnchanged: !sourceMutation },
      performance: { wallMs, modelCalls: timeline.totals.modelCalls, toolCalls: timeline.totals.toolCalls,
        requestBytes: timeline.totals.requestBytes, inputTokens: timeline.totals.inputTokens,
        outputTokens: timeline.totals.outputTokens, cachedInputTokens: timeline.totals.cachedInputTokens },
      tools: timeline.tools.map((item) => ({ name: item.name, outcome: item.outcome })),
      answer,
      sourceBefore: before,
      sourceAfter: after,
    };
  } finally {
    server.closeWakeStreams(); server.closeModelConnections();
    await server.managedProcesses.stopAll('ng5_dr0_shutdown');
    await new Promise((done) => server.close(done));
    await rm(room, { recursive: true, force: true });
  }
}

const selectedIds = new Set(String(process.env.T5_NG5_SCENARIOS
  ?? oracle.scenarios.map((scenario) => scenario.id).join(',')).split(',').map((item) => item.trim()).filter(Boolean));
const definitions = oracle.scenarios.filter((scenario) => selectedIds.has(scenario.id));
if (!definitions.length) throw new Error('at least one known NG5 DR-0 scenario is required');
const results = [];
for (const definition of definitions) results.push(await runScenario(definition));
const helperBytes = helper ? await readFile(helper) : null;
const payload = {
  schema: 't5.s6-ng5-dr0-mixed-document-baseline.v1', recordedOn: '2026-08-31',
  model: selected.modelId, provider: 'chatgpt_oauth', actualUserData: false, externalWrites: 0,
  productChanges: 0, oracleProjectedToModel: 0,
  imageOcr: helperBytes ? { state: 'available', helperSha256: hash(helperBytes) }
    : { state: 'unavailable', reason: 'qualified_helper_absent' },
  results, passed: results.every((result) => result.passed),
};
if (process.env.T5_NG5_OUTPUT) await writeFile(resolve(process.env.T5_NG5_OUTPUT), JSON.stringify(payload, null, 2));
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
