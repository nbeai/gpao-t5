#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const selectedPurpose = option('--purpose');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;

async function development(workspace) {
  const input = join(workspace, 'project', 'logs'); await mkdir(input, { recursive: true });
  const codes = ['E_PARSE', 'E_TIMEOUT', 'E_SCHEMA']; const expected = new Map(codes.map((code) => [code, 0]));
  const files = new Set();
  for (let index = 0; index < 8; index += 1) {
    const rows = Array.from({ length: 50 }, (_, row) => { const code = codes[(index + row) % codes.length];
      const file = `src/module-${(index + row) % 11}.js`; expected.set(code, expected.get(code) + 1); files.add(file);
      return { code, file, line: row + 1 }; });
    await writeFile(join(input, `log-${index + 1}.json`), JSON.stringify(rows));
  }
  return { prompt: [
    'project/logs의 JSON 로그 8개를 전부 처리해 결과/error-summary.csv와 결과/affected-files.txt를 만들어줘.',
    'CSV는 code,count 헤더와 code 오름차순, txt는 영향 파일을 중복 없이 오름차순 한 줄씩 써줘.',
    '원본은 바꾸지 말고 결과를 다시 확인한 뒤 이 대화에서 파일로 전달해줘.',
  ].join(' '), outputs: ['결과/error-summary.csv', '결과/affected-files.txt'], verify: async () => {
    const summary = (await readFile(join(workspace, '결과', 'error-summary.csv'), 'utf8')).trim().split(/\r?\n/u);
    const actual = new Map(summary.slice(1).map((line) => { const [code, count] = line.split(','); return [code, Number(count)]; }));
    const listed = (await readFile(join(workspace, '결과', 'affected-files.txt'), 'utf8')).trim().split(/\r?\n/u);
    return summary[0] === 'code,count' && JSON.stringify([...actual]) === JSON.stringify([...expected].sort())
      && JSON.stringify(listed) === JSON.stringify([...files].sort()); } };
}

async function personal(workspace) {
  const input = join(workspace, '자료'); await mkdir(input, { recursive: true });
  const tasks = ['공과금 확인', '병원 예약', '사진 정리', '책 반납', '화분 물주기'];
  const expected = new Map(tasks.map((task) => [task, 0]));
  for (let index = 0; index < 10; index += 1) {
    const lines = Array.from({ length: 50 }, (_, row) => tasks[(index * 3 + row) % tasks.length]);
    for (const task of lines) expected.set(task, expected.get(task) + 1);
    await writeFile(join(input, `메모-${index + 1}.txt`), `${lines.join('\n')}\n`);
  }
  return { prompt: [
    '자료 폴더의 메모 10개를 전부 정리해 결과/항목별_빈도.csv와 결과/요약.txt를 만들어줘.',
    'CSV는 item,count 헤더와 item 가나다순, 요약은 total=500과 unique=5를 각각 한 줄로 써줘.',
    '원본은 바꾸지 말고 결과를 다시 확인한 뒤 이 대화에서 파일로 전달해줘.',
  ].join(' '), outputs: ['결과/항목별_빈도.csv', '결과/요약.txt'], verify: async () => {
    const summary = (await readFile(join(workspace, '결과', '항목별_빈도.csv'), 'utf8')).trim().split(/\r?\n/u);
    const actual = new Map(summary.slice(1).map((line) => { const split = line.lastIndexOf(',');
      return [line.slice(0, split), Number(line.slice(split + 1))]; }));
    const text = await readFile(join(workspace, '결과', '요약.txt'), 'utf8');
    return summary[0] === 'item,count' && JSON.stringify([...actual]) === JSON.stringify([...expected].sort())
      && /total=500/u.test(text) && /unique=5/u.test(text); } };
}

async function runPurpose(name, stored, selectedConnection) {
  const root = await mkdtemp(join(tmpdir(), `t5-s4g-${name}-`)); const workspace = join(root, 'workspace');
  const stateDir = join(root, 'state'); const skillsRoot = join(root, 'skills'); const home = join(root, 'home');
  await Promise.all([workspace, stateDir, skillsRoot, home, join(workspace, '결과')]
    .map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
  const fixture = await (name === 'development' ? development(workspace) : personal(workspace));
  const entries = await readdir(workspace, { recursive: true });
  const before = await Promise.all(entries.filter((item) => !String(item).startsWith('결과/')).map(async (item) => {
    const path = join(workspace, item); try { return [item, sha(await readFile(path))]; } catch { return null; }
  })); const sourceBefore = new Map(before.filter(Boolean));
  const connectionFile = join(root, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify({ ...stored,
    activeId: selectedConnection.id, connections: [selectedConnection] }), { mode: 0o600 });
  const previousHome = process.env.T5_REFOUNDATION_HOME; process.env.T5_REFOUNDATION_HOME = home;
  const computer = discoverComputerEnvironment({ userHome: home });
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: computer.platform }) });
  const server = makeConsoleServer({ stateDir, workspace, skillsRoot, computerEnvironment: computer,
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    workspaceConnectionInspectors: [], workspaceConnectionServices: [], learningReviewMode: 'off' });
  await new Promise((resolveListen, reject) => { server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const began = performance.now(); const response = await fetch(`${base}/turn`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text: fixture.prompt }) });
    const surface = await response.json(); const run = surface.runId ? await server.runLedger.read(surface.runId) : null;
    const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt); const models = (run?.events ?? []).filter((event) => event.type === 'model_completed');
    const sourceAfter = await Promise.all([...sourceBefore].map(async ([item, digest]) => (
      sha(await readFile(join(workspace, item))) === digest)));
    return { purpose: name, passed: response.status === 200 && await fixture.verify()
      && sourceAfter.every(Boolean) && (surface.artifacts?.length ?? 0) === 2,
    httpStatus: response.status, wallMs: Math.round(performance.now() - began),
    modelCalls: models.length, toolCalls: receipts.length,
    providerTokens: models.reduce((sum, event) => sum + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    snapshotExecutions: receipts.filter((receipt) => receipt.result?.state === 'published_verified_cleaned').length,
    attachmentCalls: receipts.filter((receipt) => receipt.requestedCall?.name === 'attachment').length,
    artifactCount: surface.artifacts?.length ?? 0, sourceUnchanged: sourceAfter.every(Boolean) };
  } finally {
    server.closeWakeStreams(); server.closeModelConnections(); await server.closeCommandExplainer();
    await server.closeMessengers(); await server.managedProcesses.stopAll('s4g_final_purpose');
    await new Promise((resolveClose) => server.close(resolveClose));
    if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}

const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selectedConnection = stored.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? stored.connections?.find((item) => item.id === stored.activeId);
if (!selectedConnection) throw new Error('qualified gpt-5.5 connection unavailable');
const purposes = selectedPurpose ? [selectedPurpose] : ['development', 'personal'];
if (purposes.some((purpose) => !['development', 'personal'].includes(purpose))) throw new Error('unsupported purpose');
const results = [];
for (const purpose of purposes) { const result = await runPurpose(purpose, stored, selectedConnection);
  results.push(result); if (!result.passed) break; }
const evidence = { schema: 't5.s4g.final-two-purpose.v1', recordedAt: new Date().toISOString(),
  model: selectedConnection.modelId, actualUserData: false, externalWrites: 0, results,
  passed: results.length === purposes.length && results.every((result) => result.passed) };
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (evidencePath) await writeFile(evidencePath, serialized, { mode: 0o600 });
process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
