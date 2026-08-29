#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { inspectDelimitedText } from '../src/text-document-observer.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const csv = (fields) => fields.map((value) => {
  const text = String(value ?? ''); return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}).join(',');

async function materialize(workspace) {
  const source = join(workspace, '자료'); const output = join(workspace, '결과');
  await Promise.all([source, output].map((path) => mkdir(path, { recursive: true })));
  const records = [
    ['record_key', 'name', 'region', 'amount'],
    ['REQ-001', '김서윤', '서울', '100000'],
    ['REQ-002', '김서연', '서울', '200000'],
    ['REQ-003', '박하늘', '서울', '300000'],
  ];
  const applications = [
    ['record_key', 'name', 'unique_code', 'contact'],
    ['REQ-002', '김서연', 'UNIQUE-002', '010-0000-0002'],
    ['REQ-001', '김서윤', 'UNIQUE-001', ''],
    ['REQ-003', '박하늘', 'UNIQUE-003', '010-0000-0003'],
  ];
  await writeFile(join(source, '월별기록.csv'), `${records.map(csv).join('\n')}\n`);
  await writeFile(join(source, '신청원본.csv'), `${applications.map(csv).join('\n')}\n`);
  await writeFile(join(source, '제출양식.csv'), 'record_key,name,unique_code,amount,contact\n');
  await writeFile(join(source, '개인메모.json'), JSON.stringify({ private_note: 'DO_NOT_INCLUDE', owner: 'synthetic' }));
  return { expected: {
    accepted: [
      ['REQ-002', '김서연', 'UNIQUE-002', '200000', '010-0000-0002'],
      ['REQ-003', '박하늘', 'UNIQUE-003', '300000', '010-0000-0003'],
    ],
    unknown: [['REQ-001', '김서윤', 'UNIQUE-001', '100000', '', 'contact']],
  } };
}

async function filesUnder(root) {
  const result = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) { const bytes = await readFile(path);
        result.push({ path: relative(root, path).split(sep).join('/'), sha256: hash(bytes), bytes: bytes.length }); }
    }
  };
  await walk(root); return result.sort((left, right) => left.path.localeCompare(right.path));
}

function table(text) {
  const observed = inspectDelimitedText(String(text).replace(/^\uFEFF/u, ''), { maxRows: 100, maxColumns: 20 });
  if (observed.malformedQuotedField || observed.irregularRows) throw new Error('csv_invalid');
  return { header: observed.header, rows: observed.rows };
}

async function verify(workspace, oracle) {
  let accepted; let unknown;
  try { accepted = table(await readFile(join(workspace, '결과', '서울.csv'), 'utf8')); }
  catch (error) { return { passed: false, reason: error?.code === 'ENOENT' ? 'accepted_missing' : error.message }; }
  try { unknown = table(await readFile(join(workspace, '결과', '미확인.csv'), 'utf8')); }
  catch (error) { return { passed: false, reason: error?.code === 'ENOENT' ? 'unknown_missing' : error.message }; }
  const expectedHeader = ['record_key', 'name', 'unique_code', 'amount', 'contact'];
  const unknownHeader = ['record_key', 'name', 'unique_code', 'amount', 'contact', 'missing_fields'];
  const headerExact = JSON.stringify(accepted.header) === JSON.stringify(expectedHeader)
    && JSON.stringify(unknown.header) === JSON.stringify(unknownHeader);
  const acceptedExact = JSON.stringify(accepted.rows) === JSON.stringify(oracle.expected.accepted);
  const unknownExact = JSON.stringify(unknown.rows) === JSON.stringify(oracle.expected.unknown);
  const mapping = new Map([...accepted.rows, ...unknown.rows].map((row) => [row[0], row[2]]));
  const sourceKeyJoinExact = mapping.get('REQ-001') === 'UNIQUE-001'
    && mapping.get('REQ-002') === 'UNIQUE-002' && mapping.get('REQ-003') === 'UNIQUE-003';
  const outputFiles = (await filesUnder(join(workspace, '결과'))).map((item) => item.path);
  const outputClosure = JSON.stringify(outputFiles) === JSON.stringify(['미확인.csv', '서울.csv']);
  const privateCanaryAbsent = !(await Promise.all(outputFiles.map((path) => (
    readFile(join(workspace, '결과', path), 'utf8')
  )))).some((text) => text.includes('DO_NOT_INCLUDE') || text.includes('private_note'));
  return { passed: headerExact && acceptedExact && unknownExact && sourceKeyJoinExact
    && outputClosure && privateCanaryAbsent, headerExact, acceptedExact, unknownExact,
  sourceKeyJoinExact, requiredCoverageExact: unknownExact, outputClosure, privateCanaryAbsent,
  acceptedRows: accepted.rows.length, unknownRows: unknown.rows.length, outputFiles,
  observed: { acceptedHeader: accepted.header, acceptedRows: accepted.rows,
    unknownHeader: unknown.header, unknownRows: unknown.rows } };
}

async function main() {
  const evidencePath = option('--evidence'); const keep = process.argv.includes('--keep');
  const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
    ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
  const root = await mkdtemp(join(tmpdir(), 't5-s4h-baseline-')); const home = join(root, 'home');
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
    process.env.T5_REFOUNDATION_HOME = home; const computer = discoverComputerEnvironment({ userHome: home });
    const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
    const terminalPlatformAdapter = await makeTerminalPlatformAdapter({ platform: computer.platform,
      protectedReadRoots: [dirname(sourceConnectionFile), stateDir, home] });
    const access = makeConsoleModelAccess({ connectionFile, stateDir,
      secretStore: makePlatformSecretStore({ platform: computer.platform }) }); const runtimeErrors = [];
    server = makeConsoleServer({ stateDir, workspace, skillsRoot, learningReviewMode: 'off',
      modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
      computerEnvironment: computer, terminalEnvironment, terminalPlatformAdapter,
      workspaceConnectionInspectors: [], workspaceConnectionServices: [],
      onError: (error) => runtimeErrors.push(error?.code ?? error?.name ?? 'runtime_error') });
    await new Promise((resolveListen, reject) => { server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const prompt = [
      '자료 폴더의 월별기록.csv와 신청원본.csv를 신청번호로 정확히 연결해서 제출양식.csv 열 순서로 만들어줘.',
      '연락처 같은 필수값이 빠진 신청자는 임의로 채우지 말고 결과/미확인.csv에 빠진 필드와 함께 분리해줘.',
      '완성된 신청자는 결과/서울.csv에 넣고 이름이 비슷해도 신청번호가 다르면 합치지 마.',
      '결과는 이 두 CSV만 만들고 개인메모.json 내용이나 별도 내부 JSON은 포함하지 마.',
      '원본은 바꾸지 말고 결과를 다시 열어 신청번호, 고유코드, 금액, 필수값을 검산한 뒤 알려줘.',
    ].join(' ');
    const began = performance.now(); const response = await fetch(`${base}/turn`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: prompt }) });
    const surface = await response.json(); const wallMs = Math.round(performance.now() - began);
    const run = surface.runId ? await server.runLedger.read(surface.runId) : null;
    const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload?.receipt).filter(Boolean);
    const models = (run?.events ?? []).filter((event) => event.type === 'model_completed');
    const verification = await verify(workspace, oracle); const after = await filesUnder(workspace);
    const beforeSources = new Map(before.filter((item) => item.path.startsWith('자료/')).map((item) => [item.path, item.sha256]));
    const afterMap = new Map(after.map((item) => [item.path, item.sha256]));
    const sourceUnchanged = [...beforeSources].every(([path, digest]) => afterMap.get(path) === digest);
    const result = { schema: 't5.s4h.readonly-baseline.v1', recordedAt: new Date().toISOString(),
      sourceHead: option('--source-head') ?? null, productChanges: 0, model: selected.modelId,
      purpose: { naturalLanguageOnly: true, status: response.status, workStatus: run?.status ?? null,
        answerPresent: Boolean(surface.reply) }, verification: { ...verification, sourceUnchanged,
        runtimeErrors: runtimeErrors.length }, performance: { wallMs, modelCalls: models.length,
        toolCalls: receipts.length, providerTokens: models.reduce((sum, event) => sum
          + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0), requestBytes: models.reduce((sum, event) => sum
          + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0) },
      route: receipts.map((receipt) => ({ name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
        action: receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action ?? null,
        outcome: receipt.outcome, state: receipt.result?.state ?? null })),
      firstDefectFamily: verification.sourceKeyJoinExact === false ? 'source_key_join'
        : verification.requiredCoverageExact === false ? 'required_field_coverage'
          : verification.outputClosure === false || verification.privateCanaryAbsent === false
            ? 'output_closure_privacy' : null,
      decision: verification.passed && sourceUnchanged ? 'CURRENT_HEAD_POSITIVE_CONTROL_NO_H_IMPLEMENTATION_OPENED'
        : 'S4_H_FIRST_DEFECT_REPRODUCED', ...(keep ? { retainedFixtureRoot: root } : {}) };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (evidencePath) await writeFile(resolve(evidencePath), serialized, { mode: 0o600 });
    process.stdout.write(serialized);
  } finally {
    if (server) { server.closeWakeStreams(); server.closeModelConnections(); await server.closeCommandExplainer();
      await server.closeMessengers(); await server.managedProcesses.stopAll('s4h_finished');
      await new Promise((resolveClose) => server.close(resolveClose)); }
    if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = previousHome;
    if (!keep) await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: 't5.s4h.readonly-baseline.v1',
  passed: false, failure: error?.code ?? error?.message ?? String(error) })}\n`); process.exitCode = 1; });
