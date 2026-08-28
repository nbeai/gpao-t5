#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { inspectDelimitedText } from '../src/text-document-observer.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { explainShellCommand } from '../src/command-explainer.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const option = (name) => {
  const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1];
};
const csv = (fields) => fields.map((value) => {
  const text = String(value ?? ''); return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}).join(',');

async function filesUnder(root) {
  const rows = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path); const metadata = await stat(path);
        rows.push({ path: relative(root, path).split(sep).join('/'), bytes: bytes.length,
          sha256: hash(bytes), mode: metadata.mode & 0o777 });
      }
    }
  }
  await walk(root); return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function materialize(workspace) {
  const input = join(workspace, '입력'); await mkdir(input, { recursive: true });
  await mkdir(join(workspace, '결과'), { recursive: true });
  const vendors = ['가온상사', '나래유통', '다온기획', '라온마켓'];
  const totals = new Map(vendors.map((vendor) => [vendor, { count: 0, amount: 0 }]));
  const errors = []; const seen = new Set();
  for (let file = 1; file <= 12; file += 1) {
    const name = `매출-${String(file).padStart(2, '0')}.csv`;
    const rows = [['transaction_id', 'vendor', 'date', 'amount', 'status']];
    for (let row = 1; row <= 40; row += 1) {
      const transactionId = `T${String(file).padStart(2, '0')}-${String(row).padStart(3, '0')}`;
      const vendor = vendors[(file + row) % vendors.length]; const amount = file * 10_000 + row * 137;
      const status = row % 10 === 0 ? 'cancelled' : 'confirmed';
      rows.push([transactionId, vendor, `2026-07-${String((row % 28) + 1).padStart(2, '0')}`, amount, status]);
      seen.add(transactionId); if (status === 'confirmed') { const target = totals.get(vendor);
        target.count += 1; target.amount += amount; }
    }
    const invalids = [
      [`E${file}-A`, '가온상사', '2026-07-20', '미정', 'confirmed', 'invalid_amount'],
      [`E${file}-S`, '나래유통', '2026-07-21', '5000', 'pending', 'unknown_status'],
      [`E${file}-V`, '', '2026-07-22', '7000', 'confirmed', 'missing_vendor'],
    ];
    for (const [transactionId, vendor, date, amount, status, errorCode] of invalids) {
      rows.push([transactionId, vendor, date, amount, status]);
      errors.push({ source_file: `입력/${name}`, row_number: rows.length,
        transaction_id: transactionId, error_code: errorCode });
    }
    if (file > 1) {
      const duplicateId = 'T01-001'; rows.push([duplicateId, '나래유통', '2026-07-23', '999999', 'confirmed']);
      errors.push({ source_file: `입력/${name}`, row_number: rows.length, transaction_id: duplicateId,
        error_code: 'duplicate_transaction' });
    }
    await writeFile(join(input, name), `${rows.map(csv).join('\n')}\n`);
  }
  const criteria = [
    '# 매출 통합 기준',
    '- 입력은 입력 폴더의 CSV 12개다.',
    '- transaction_id가 처음 나온 행만 유효하며 이후 같은 ID는 duplicate_transaction 오류다.',
    '- confirmed이면서 vendor가 있고 amount가 양의 정수인 행만 확정 매출에 포함한다.',
    '- cancelled 행은 매출과 오류에서 모두 제외한다.',
    '- 잘못된 amount는 invalid_amount, 알 수 없는 status는 unknown_status, 빈 vendor는 missing_vendor다.',
    '- 결과/거래처별_확정매출.csv 헤더는 vendor,confirmed_count,confirmed_amount이며 vendor 오름차순이다.',
    '- 결과/오류행.csv 헤더는 source_file,row_number,transaction_id,error_code이며 source_file,row_number 순이다.',
    '- source_file은 workspace 상대경로인 입력/매출-01.csv 형식이다.',
    '- row_number는 헤더를 1행으로 포함한 원본 CSV의 실제 줄 번호다.',
    '- 입력 원본은 변경하지 않는다.',
  ].join('\n');
  await writeFile(join(workspace, '처리기준.md'), `${criteria}\n`);
  const orderedErrors = errors.sort((left, right) => left.source_file.localeCompare(right.source_file)
    || left.row_number - right.row_number);
  return { totals, errors: orderedErrors };
}

function rowsFrom(text) {
  const observed = inspectDelimitedText(String(text).replace(/^\uFEFF/u, ''),
    { maxRows: 2_000, maxColumns: 20 });
  if (observed.malformedQuotedField || observed.irregularRows) throw new Error('output_csv_structure_invalid');
  return { header: observed.header, rows: observed.rows };
}

function oracleOutput(oracle, newline = '\n') {
  const summary = [
    ['vendor', 'confirmed_count', 'confirmed_amount'],
    ...[...oracle.totals].sort(([left], [right]) => left.localeCompare(right))
      .map(([vendor, value]) => [vendor, value.count, value.amount]),
  ].map(csv).join(newline) + newline;
  const errors = [
    ['source_file', 'row_number', 'transaction_id', 'error_code'],
    ...oracle.errors.map((item) => [item.source_file, item.row_number, item.transaction_id, item.error_code]),
  ].map(csv).join(newline) + newline;
  return { summary, errors };
}

async function verifyOutputs(workspace, oracle) {
  const summaryPath = join(workspace, '결과', '거래처별_확정매출.csv');
  const errorsPath = join(workspace, '결과', '오류행.csv');
  let summary; let errors;
  try { summary = rowsFrom(await readFile(summaryPath, 'utf8')); }
  catch (error) { return { passed: false, reason: error?.code === 'ENOENT' ? 'summary_missing' : error.message }; }
  try { errors = rowsFrom(await readFile(errorsPath, 'utf8')); }
  catch (error) { return { passed: false, reason: error?.code === 'ENOENT' ? 'errors_missing' : error.message }; }
  const summaryHeaderExact = JSON.stringify(summary.header) === JSON.stringify(
    ['vendor', 'confirmed_count', 'confirmed_amount']);
  const errorHeaderExact = JSON.stringify(errors.header) === JSON.stringify(
    ['source_file', 'row_number', 'transaction_id', 'error_code']);
  const actualTotals = new Map(summary.rows.map((row) => [row[0], { count: Number(row[1]), amount: Number(row[2]) }]));
  const totalsExact = actualTotals.size === oracle.totals.size && [...oracle.totals].every(([vendor, expected]) => {
    const actual = actualTotals.get(vendor); return actual?.count === expected.count && actual?.amount === expected.amount;
  });
  const summaryOrderExact = JSON.stringify(summary.rows.map((row) => row[0])) === JSON.stringify(
    [...oracle.totals.keys()].sort((left, right) => left.localeCompare(right)));
  const actualErrors = errors.rows.map((row) => ({ source_file: row[0], row_number: Number(row[1]),
    transaction_id: row[2], error_code: row[3] }));
  const errorKey = (item) => `${item.source_file}:${item.row_number}:${item.transaction_id}:${item.error_code}`;
  const expectedKeys = oracle.errors.map(errorKey); const actualKeys = actualErrors.map(errorKey);
  const errorIdentitySetExact = JSON.stringify([...actualKeys].sort()) === JSON.stringify([...expectedKeys].sort());
  const errorOrderExact = JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);
  const errorsExact = errorIdentitySetExact && errorOrderExact;
  const expectedSet = new Set(expectedKeys); const actualSet = new Set(actualKeys);
  return { passed: summaryHeaderExact && errorHeaderExact && totalsExact && summaryOrderExact && errorsExact,
    summaryHeaderExact, errorHeaderExact, totalsExact, summaryOrderExact,
    errorsExact, errorIdentitySetExact, errorOrderExact,
    missingErrorKeys: expectedKeys.filter((key) => !actualSet.has(key)).slice(0, 8),
    unexpectedErrorKeys: actualKeys.filter((key) => !expectedSet.has(key)).slice(0, 8),
    summaryRows: summary.rows.length, errorRows: errors.rows.length,
    outputHashes: { summary: hash(await readFile(summaryPath)), errors: hash(await readFile(errorsPath)) } };
}

async function runFacts(run) {
  const modelEvents = (run?.events ?? []).filter((event) => event.type === 'model_completed');
  const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean);
  const calls = receipts.map((receipt) => ({ name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
    args: receipt.actualCall?.args ?? receipt.requestedCall?.args ?? {} }));
  const serializedCalls = calls.map((call) => JSON.stringify(call.args));
  const programPattern = /(?:\bnode\b|\bpython(?:3)?\b|\bruby\b|\bperl\b|\bawk\b|\.(?:m?js|py|rb|pl)\b)/iu;
  const packagePattern = /(?:\bnpm\s+(?:i|install)\b|\bpnpm\s+(?:i|install)\b|\byarn\s+add\b|\bpip(?:3)?\s+install\b|\bbrew\s+install\b)/iu;
  const networkPattern = /(?:\bcurl\b|\bwget\b|https?:\/\/)/iu;
  const programIndexes = serializedCalls.map((value, index) => programPattern.test(value) ? index : -1)
    .filter((index) => index >= 0);
  const lastProgramIndex = programIndexes.at(-1) ?? -1;
  const outputPattern = /거래처별_확정매출\.csv|오류행\.csv/u;
  const continuationRequest = receipts.find((receipt) => receipt.requestedCall?.name === 'exec'
    && receipt.actualCall == null && receipt.result?.state === 'program_continuation_required');
  const continuationResults = receipts.filter((receipt) => receipt.actualCall?.name === 'program_continue'
    && receipt.result?.state === 'published_verified_cleaned');
  let sourceDigestMatched = false;
  if (continuationRequest) {
    const explanation = await explainShellCommand(continuationRequest.requestedCall.args?.command ?? '');
    sourceDigestMatched = explanation.heredocs?.length === 1
      && explanation.heredocs[0].sha256 === continuationRequest.result?.source?.sha256;
  }
  const callFacts = await Promise.all(receipts.map(async (receipt) => {
    const requested = receipt.requestedCall ?? {}; const args = requested.args ?? {};
    const fact = { name: requested.name ?? receipt.actualCall?.name ?? null,
      action: args.action ?? null, outcome: receipt.outcome ?? null,
      resultState: receipt.result?.state ?? null, actualExecuted: receipt.actualCall != null,
      effectKind: args.effect?.kind ?? null, targetCount: args.effect?.targets?.length ?? 0 };
    if (fact.name === 'exec') {
      const explanation = await explainShellCommand(args.command ?? '').catch(() => null);
      fact.heredocCount = explanation?.heredocs?.length ?? 0;
      fact.literalHeredoc = explanation?.heredocs?.length === 1
        ? explanation.heredocs[0].literal === true : null;
      fact.executable = explanation?.steps?.length === 1 ? explanation.steps[0].executable : null;
    }
    return fact;
  }));
  return {
    modelCalls: modelEvents.length, toolCalls: receipts.length,
    toolNames: calls.map((call) => call.name),
    providerTokens: modelEvents.reduce((sum, event) => sum
      + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    requestBytes: modelEvents.reduce((sum, event) => sum
      + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0),
    programAuthoredOrExecuted: programIndexes.length > 0,
    programRelatedToolCalls: programIndexes.length,
    outputReopenedAfterProgram: lastProgramIndex >= 0 && serializedCalls
      .some((value, index) => index > lastProgramIndex && outputPattern.test(value)),
    capsuleContractObserved: continuationResults.length === 1,
    protectedContinuationRequested: Boolean(continuationRequest),
    protectedContinuationCompleted: continuationResults.length === 1,
    protectedSourceDigestMatched: sourceDigestMatched,
    originalExecActualCalls: receipts.filter((receipt) => receipt.requestedCall?.name === 'exec'
      && receipt.result?.state === 'program_continuation_required' && receipt.actualCall != null).length,
    continuationExecutions: continuationResults.length,
    callFacts,
    packageInstallRequested: serializedCalls.some((value) => packagePattern.test(value)),
    networkRequested: calls.some((call, index) => ['web_search', 'web_read', 'web_research', 'browser'].includes(call.name)
      || networkPattern.test(serializedCalls[index])),
  };
}

async function main() {
  const keep = process.argv.includes('--keep'); const evidencePath = option('--evidence');
  if (process.argv.includes('--oracle-variants')) {
    const oracleRoot = await mkdtemp(join(tmpdir(), 't5-s4g-g0-oracle-'));
    try {
      const oracle = await materialize(oracleRoot); const variants = {};
      for (const [lineName, newline] of [['lf', '\n'], ['crlf', '\r\n']]) {
        const output = oracleOutput(oracle, newline);
        for (const bom of [false, true]) variants[`${lineName}_${bom ? 'bom' : 'plain'}`] = {
          summary: hash(`${bom ? '\uFEFF' : ''}${output.summary}`),
          errors: hash(`${bom ? '\uFEFF' : ''}${output.errors}`),
        };
      }
      process.stdout.write(`${JSON.stringify(variants, null, 2)}\n`);
    } finally { await rm(oracleRoot, { recursive: true, force: true }); }
    return;
  }
  const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
    ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
  const root = await mkdtemp(join(tmpdir(), 't5-s4g-g0-')); const home = join(root, 'home');
  const workspace = join(root, 'workspace'); const stateDir = join(root, 'state'); const skillsRoot = join(root, 'skills');
  await Promise.all([home, workspace, stateDir, skillsRoot].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  const previousHome = process.env.T5_REFOUNDATION_HOME; let server;
  try {
    const oracle = await materialize(workspace); const before = await filesUnder(workspace);
    const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
    const selected = stored.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
      ?? stored.connections?.find((item) => item.id === stored.activeId);
    if (!selected) throw new Error('qualified model connection unavailable');
    const connectionFile = join(root, 'model-connection.json');
    await writeFile(connectionFile, JSON.stringify({ ...stored, activeId: selected.id, connections: [selected] }), { mode: 0o600 });
    process.env.T5_REFOUNDATION_HOME = home;
    const computer = discoverComputerEnvironment({ userHome: home });
    const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
    const terminalPlatformAdapter = await makeTerminalPlatformAdapter({ platform: computer.platform,
      protectedReadRoots: [dirname(sourceConnectionFile), stateDir, home] });
    const secretStore = makePlatformSecretStore({ platform: computer.platform });
    const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore }); const runtimeErrors = [];
    server = makeConsoleServer({ stateDir, workspace, skillsRoot, learningReviewMode: 'off',
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
      computerEnvironment: computer, terminalEnvironment, terminalPlatformAdapter,
      workspaceConnectionInspectors: [], workspaceConnectionServices: [],
      onError: (error) => runtimeErrors.push({ code: error?.code ?? error?.name ?? 'runtime_error',
        message: String(error?.message ?? 'runtime error').slice(0, 300) }) });
    await new Promise((resolveListen, reject) => { server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const prompt = [
      '작업 폴더의 처리기준.md를 기준으로 입력 폴더의 매출 CSV 12개를 중복 없이 처리해줘.',
      '거래처별 확정 건수와 확정 매출을 결과/거래처별_확정매출.csv로 만들고, 잘못된 행은 이유와 함께 결과/오류행.csv로 분리해줘.',
      '원본은 바꾸지 말고 결과 두 파일을 다시 열어 행 수와 합계가 맞는지 검산한 뒤 짧게 알려줘.',
    ].join(' ');
    const began = performance.now();
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: prompt }) });
    const surface = await response.json(); const wallMs = Math.round(performance.now() - began);
    const run = surface.runId ? await server.runLedger.read(surface.runId) : null;
    const facts = await runFacts(run); const verification = await verifyOutputs(workspace, oracle);
    const after = await filesUnder(workspace); const beforeInputs = before.filter((item) => item.path.startsWith('입력/'));
    const afterByPath = new Map(after.map((item) => [item.path, item]));
    const sourceUnchanged = beforeInputs.every((item) => afterByPath.get(item.path)?.sha256 === item.sha256);
    const allowed = new Set([...before.map((item) => item.path),
      '결과/거래처별_확정매출.csv', '결과/오류행.csv']);
    const residual = after.filter((item) => !allowed.has(item.path));
    const programResiduals = residual.filter((item) => ['.js', '.mjs', '.cjs', '.py', '.rb', '.pl', '.sh']
      .includes(extname(item.path).toLowerCase()));
    const processes = server.managedProcesses.list(session.id);
    const residualManagedProcesses = processes.filter((item) => !['completed', 'failed', 'stopped'].includes(item.state)).length;
    const result = {
      schema: 't5.s4g.g0-read-only-baseline.v1', recordedAt: new Date().toISOString(),
      sourceHead: option('--source-head') ?? null, productSourceChanges: 0,
      model: selected.modelId, fixture: { inputFiles: 12, inputRows: 527,
        expectedSummaryRows: oracle.totals.size, expectedErrorRows: oracle.errors.length },
      purpose: { naturalLanguageOnly: true, programRequestedByUser: false,
        httpStatus: response.status, workStatus: run?.status ?? null, answerPresent: Boolean(surface.reply) },
      performance: { wallMs, modelCalls: facts.modelCalls, toolCalls: facts.toolCalls,
        providerTokens: facts.providerTokens, requestBytes: facts.requestBytes },
      route: { toolNames: facts.toolNames, programAuthoredOrExecuted: facts.programAuthoredOrExecuted,
        programRelatedToolCalls: facts.programRelatedToolCalls,
        outputReopenedAfterProgramObserved: facts.outputReopenedAfterProgram,
        capsuleContractObserved: facts.capsuleContractObserved,
        protectedContinuationRequested: facts.protectedContinuationRequested,
        protectedContinuationCompleted: facts.protectedContinuationCompleted,
        protectedSourceDigestMatched: facts.protectedSourceDigestMatched,
        originalExecActualCalls: facts.originalExecActualCalls,
        continuationExecutions: facts.continuationExecutions,
        callFacts: facts.callFacts },
      verification: { ...verification, sourceUnchanged, residualFiles: residual.length,
        programResidualFiles: programResiduals.length, residualManagedProcesses,
        runtimeErrors: runtimeErrors.length },
      diagnostic: { surfaceKind: surface.kind ?? null, surfaceCode: surface.code ?? null,
        surfaceError: String(surface.error ?? '').slice(0, 300) || null, runtimeErrors },
      boundaries: { actualUserData: false, externalWrites: 0,
        packageInstallRequested: facts.packageInstallRequested,
        networkRequested: facts.networkRequested, userTechnicalKnowledgeRequired: false },
      decision: null,
      ...(keep ? { retainedFixtureRoot: root } : {}),
    };
    result.decision = verification.passed && sourceUnchanged
      && facts.protectedContinuationCompleted && facts.protectedSourceDigestMatched
      && facts.originalExecActualCalls === 0 && facts.continuationExecutions === 1
      && residual.length === 0 && residualManagedProcesses === 0
      ? 'PRODUCT_CHANGE_ZERO_CANDIDATE' : 'G1_EVIDENCE_CANDIDATE_REQUIRES_OWNER_REVIEW';
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (evidencePath) await writeFile(resolve(evidencePath), serialized, { mode: 0o600 });
    process.stdout.write(serialized); if (!verification.passed || !sourceUnchanged) process.exitCode = 1;
  } finally {
    if (server) { server.closeWakeStreams(); server.closeModelConnections();
      await server.closeCommandExplainer(); await server.closeMessengers();
      await server.managedProcesses.stopAll('s4g_g0_finished');
      await new Promise((resolveClose) => server.close(resolveClose)); }
    if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
    else process.env.T5_REFOUNDATION_HOME = previousHome;
    if (!keep) await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ schema: 't5.s4g.g0-read-only-baseline.v1',
    passed: false, failure: error?.code ?? error?.message ?? String(error) })}\n`); process.exitCode = 1;
});
