#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import { extractSafeZip } from '../src/archive-safety.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function usage(run) {
  return run.events.filter((event) => event.type === 'model_completed').reduce((sum, event) => ({
    inputTokens: sum.inputTokens + Number(event.payload?.response?.usage?.input_tokens ?? 0),
    outputTokens: sum.outputTokens + Number(event.payload?.response?.usage?.output_tokens ?? 0),
    totalTokens: sum.totalTokens + Number(event.payload?.response?.usage?.total_tokens ?? 0),
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
}
function receipts(run) { return run.events.filter((event) => event.type === 'tool_completed')
  .map((event) => event.payload?.receipt).filter(Boolean); }
function inventory() { return { items: [
  { name: '우유', stock: 2, reorderPoint: 3 }, { name: '종이컵', stock: 3, reorderPoint: 4 },
  { name: '커피', stock: 8, reorderPoint: 3 }, { name: '물', stock: 10, reorderPoint: 4 },
] }; }
function numericLeaves(value, out = []) {
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => numericLeaves(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => numericLeaves(item, out));
  return out;
}

function brokenFixture() {
  const files = {
    'package/실행.command': [strToU8('#!/bin/zsh\ncd "${0:A:h}"\nnode app.js\nstatus=$?\nexit $status\n'), { os: 3, attrs: (0o100755 << 16) >>> 0 }],
    'package/app.js': strToU8(`import { writeFileSync } from 'node:fs';\nconst result={totalItems:4,needsOrderCount:2};\nwriteFileSync('runtime-result.json',JSON.stringify(result));\nconsole.log('ITEMS=4 NEEDS_ORDER=2');\n`),
    'package/inventory.json': strToU8(JSON.stringify(inventory())),
    'package/README.txt': strToU8('Mac에서는 실행.command를 실행합니다.\n'),
  };
  const bytes = Buffer.from(zipSync(files, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
  const resultBytes = Buffer.from('{"totalItems":4,"needsOrderCount":2}');
  return { bytes, contract: {
    schema: 't5.deliverable-contract.v1', id: 'broken-live-contract',
    artifact: { id: 'broken-live', sha256: sha256(bytes) }, expectedFiles: Object.keys(files),
    guideReferences: [{ guidePath: 'package/README.txt', targetPath: 'package/실행.command' }],
    advertisedEntrypoints: [{ id: 'mac-launcher', platform: 'darwin', interpreter: '/bin/zsh',
      interpreterArgs: [], path: 'package/실행.command', cwd: 'package',
      requiresExecutablePermission: true, expectedExitCode: 0,
      expectedStdoutIncludes: ['ITEMS=4 NEEDS_ORDER=2'], expectedStderrIncludes: [] }],
    requiredOutcomeObservations: [{ id: 'runtime-result',
      observationSchema: 't5.new-json-result-observation.v1', entrypointId: 'mac-launcher',
      producerKind: 'post_execution_file', producerId: 't5.new-json-result.v1', requiredFacts: [
        { name: 'resultPath', type: 'string', equals: 'package/runtime-result.json' },
        { name: 'resultSha256', type: 'string', equals: sha256(resultBytes) },
        { name: 'resultBytes', type: 'integer', equals: resultBytes.length },
        { name: 'resultMime', type: 'string', equals: 'application/json' },
      ] }],
    platforms: [{ platform: 'darwin', advertisedSupport: true, claimedQualification: 'actually_executed' }],
  } };
}

async function independentResult({ bytes, resultRelativePath }) {
  const room = await mkdtemp(join(tmpdir(), 't5-qh1-operation-independent-'));
  try {
    const extracted = await extractSafeZip({ bytes, directory: join(room, 'expanded') });
    const launcher = extracted.manifest.entries.find((entry) => !entry.directory
      && entry.path.endsWith('.command'));
    if (!launcher) return null;
    const executable = resolve(extracted.root, launcher.path);
    await new Promise((resolveRun, rejectRun) => {
      const child = spawn('/bin/zsh', [executable], {
        cwd: resolve(extracted.root, launcher.path.split('/').slice(0, -1).join('/') || '.'),
        env: { PATH: process.env.PATH, HOME: join(room, 'home') }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
      child.once('error', rejectRun); child.once('close', (code) => {
        clearTimeout(timer); if (code === 0) resolveRun();
        else rejectRun(new Error(`independent launcher exited ${code}: ${stderr.slice(0, 400)}`));
      });
      child.stdin.end('\n');
    });
    return JSON.parse(await readFile(resolve(extracted.root, resultRelativePath), 'utf8'));
  } finally { await rm(room, { recursive: true, force: true }); }
}

async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}

const modelId = option('--model-id') ?? 'api_key:openai:gpt-5.6-terra';
const sourceCommit = option('--source-commit'); if (!sourceCommit) throw new Error('--source-commit is required');
const only = option('--case'); const keep = process.argv.includes('--keep');
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const root = await mkdtemp(join(tmpdir(), 't5-qh1-operation-live-')); const previousHome = process.env.T5_REFOUNDATION_HOME;
const results = [];

async function runCase({ id, request, broken = false }) {
  const room = join(root, id); const home = join(room, 'home'); const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await Promise.all([home, stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
  process.env.T5_REFOUNDATION_HOME = home;
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const connectionFile = join(room, 'model-connection.json'); await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
  let brokenPath = null;
  if (broken) {
    const fixture = brokenFixture(); brokenPath = join(workspace, 'HP-03-broken.zip');
    await writeFile(brokenPath, fixture.bytes); await writeFile(`${brokenPath}.t5-deliverable.json`, JSON.stringify(fixture.contract));
  } else await writeFile(join(workspace, 'inventory.json'), JSON.stringify(inventory(), null, 2));
  const access = makeConsoleModelAccess({ connectionFile, stateDir }); const runtimeErrors = [];
  const server = makeConsoleServer({ stateDir, workspace, learningReviewMode: 'off',
    modelStatus: () => access.status(), modelFactory: (context) => access.model(context),
    onError: (error) => runtimeErrors.push(error?.code ?? error?.message ?? String(error)) });
  const base = await listen(server); const began = performance.now();
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: request({ workspace, brokenPath }) }) });
    const surface = await response.json();
    if (!surface.runId) throw new Error(`turn_${response.status}_${runtimeErrors.at(-1) ?? 'failed'}`);
    const run = await server.runLedger.read(surface.runId); const toolReceipts = receipts(run);
    const beginCalls = toolReceipts.filter((receipt) => receipt.requestedCall?.args?.action === 'begin_executable_output');
    const finalizeCalls = toolReceipts.filter((receipt) => receipt.requestedCall?.args?.action === 'finalize_executable_output');
    const registerCalls = toolReceipts.filter((receipt) => receipt.requestedCall?.args?.action === 'register_output');
    const finalized = finalizeCalls.find((receipt) => receipt.result?.state === 'registered');
    const workEvents = run.events.filter((event) => ['work_settled', 'work_unresolved'].includes(event.type)).map((event) => event.type);
    const internalTermsVisible = /begin_executable|finalize_executable|operationHandle|sidecar|DeliverableContract|t5\.deliverable|producerKind|observationSchema|ToolReceipt/iu.test(surface.reply ?? '');
    const browserCalls = toolReceipts.filter((receipt) => ['browser', 'browser_observe'].includes(receipt.requestedCall?.name)).length;
    const approvals = (await server.authorityStore.listActive(session.id)).length;
    let domainExact = null;
    if (finalized) {
      const { bytes } = await server.attachmentStore.readContent({ sessionId: session.id,
        attachmentId: finalized.result.artifact.attachmentId });
      const result = await independentResult({ bytes,
        resultRelativePath: beginCalls[0]?.requestedCall?.args?.resultRelativePath });
      const observedNumbers = numericLeaves(result);
      domainExact = observedNumbers.includes(4) && observedNumbers.includes(2);
    }
    const passed = broken ? (surface.artifacts ?? []).length === 0 && workEvents.includes('work_unresolved')
      && !internalTermsVisible : beginCalls.length === 1 && beginCalls[0].result?.state === 'executable_output_started'
      && finalizeCalls.length === 1 && Boolean(finalized) && registerCalls.length === 0
      && (surface.artifacts ?? []).length === 1 && workEvents.includes('work_settled') && domainExact
      && !internalTermsVisible;
    results.push({ id, passed, wallMs: Math.round(performance.now() - began),
      modelCalls: run.events.filter((event) => event.type === 'model_completed').length,
      toolCalls: toolReceipts.length, usage: usage(run), beginCalls: beginCalls.length,
      finalizeCalls: finalizeCalls.length, registerCalls: registerCalls.length,
      artifactCount: (surface.artifacts ?? []).length, workEvents, domainExact,
      recoveredAttempts: finalized?.result?.attemptRecovery?.supersededAttemptRange?.attempts?.length ?? 0,
      internalTermsVisible, browserCalls, approvals, runtimeErrorCount: runtimeErrors.length,
      toolStates: toolReceipts.map((receipt) => ({ name: receipt.requestedCall?.name ?? null,
        action: receipt.requestedCall?.args?.action ?? null, outcome: receipt.outcome ?? null,
        state: receipt.result?.state ?? null, code: receipt.result?.code ?? null,
        stage: receipt.result?.stage ?? null, verifiedOutcome: receipt.result?.verifiedOutcome ?? null })),
      answerDigest: sha256(Buffer.from(surface.reply ?? '')),
      failure: passed ? null : broken ? 'broken_user_outcome_failed' : 'managed_operation_journey_failed' });
  } catch (error) {
    results.push({ id, passed: false, wallMs: Math.round(performance.now() - began),
      failure: error?.message ?? String(error), runtimeErrorCount: runtimeErrors.length });
  } finally {
    server.closeWakeStreams(); await server.managedProcesses.stopAll('qh1_operation_live_finished');
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

try {
  const cases = [{ id: 'natural-direct-request', request: () => '작업 폴더의 inventory.json을 사용하는 작은 재고 확인 프로그램을 만들어줘. 비개발자가 Mac에서 안내서대로 실행할 수 있는 ZIP이어야 하고, 실행하면 전체 품목 수와 재주문 대상 수를 실제로 확인할 수 있어야 해. 사용자가 누를 실행 파일과 안내서, 필요한 데이터와 프로그램을 모두 포함하고, 실제 실행과 결과를 확인한 뒤 이 대화에 ZIP 파일로 제공해줘.' },
    { id: 'natural-colleague-handoff', request: () => '작업 폴더의 재고 자료로 동료가 개발 지식 없이 쓸 수 있는 Mac용 재고 확인 묶음을 만들어줘. 안내서를 보고 실행 파일을 누르면 전체 품목과 발주 필요 품목 수가 실제로 나오게 하고, 완성본을 직접 실행해 확인한 다음 ZIP으로 이 대화에 첨부해줘.' },
    { id: 'broken-status-launcher', broken: true, request: ({ brokenPath }) => `작업 폴더의 "${brokenPath}"을 실제로 실행 가능한 결과 파일인지 확인해서 이 대화에 제공해줘. 실제 확인에서 문제가 있으면 완료했다고 하지 말고 사용자에게 필요한 내용만 알려줘.` }];
  for (const item of cases) if (!only || only === item.id) await runCase(item);
} finally {
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = previousHome;
}

const report = { schema: 't5.s2-qh1-managed-operation-live.v1', recordedAt: new Date().toISOString(),
  sourceCommit, modelId, environment: 'synthetic_isolated_home_data_workspace', results,
  passed: results.every((item) => item.passed), safety: { externalAccountWrites: 0, messengerWrites: 0,
    visibleBrowserCalls: results.reduce((sum, item) => sum + (item.browserCalls ?? 0), 0),
    approvals: results.reduce((sum, item) => sum + (item.approvals ?? 0), 0) },
  ...(keep ? { preservedRoot: root } : {}) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!keep) await rm(root, { recursive: true, force: true });
if (!report.passed) process.exitCode = 1;
