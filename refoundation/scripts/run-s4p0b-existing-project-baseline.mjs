#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const keep = process.argv.includes('--keep');
const candidate = process.argv.includes('--candidate');
const restartBeforeUndo = process.argv.includes('--restart-before-undo');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const requestedModel = option('--model-id') ?? 'chatgpt_oauth:gpt-5.5';
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));

async function walk(root, current = root) {
  const out = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, path));
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      out.push({ path: relative(root, path).split(sep).join('/'), bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function testExit(workspace) {
  return spawnSync('npm', ['test'], { cwd: workspace, encoding: 'utf8', timeout: 30_000 }).status;
}

function receipts(run) {
  return (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean);
}

function models(run) {
  return (run?.events ?? []).filter((event) => event.type === 'model_completed');
}

function metrics(run, wallMs) {
  const calls = models(run); const tools = receipts(run);
  return { wallMs, modelCalls: calls.length, toolCalls: tools.length,
    providerTokens: calls.reduce((sum, event) => sum + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    requestBytes: calls.reduce((sum, event) => sum + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0) };
}

function route(run) {
  return receipts(run).map((receipt) => ({
    name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
    action: receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action ?? null,
    outcome: receipt.outcome, state: receipt.result?.state ?? null,
    hasUndoHandle: Boolean(receipt.result?.undoHandle ?? receipt.result?.publication?.undoHandle),
    activatedTools: receipt.result?.activatedTools ?? [],
  }));
}

function browserActions(run) {
  return receipts(run).filter((receipt) => (
    (receipt.actualCall?.name ?? receipt.requestedCall?.name) === 'browser'))
    .map((receipt) => ({ action: receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action,
      outcome: receipt.outcome, state: receipt.result?.state ?? null,
      text: JSON.stringify(receipt.result ?? {}).slice(0, 20_000) }));
}

async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server, reason) {
  if (!server) return;
  server.closeWakeStreams(); server.closeModelConnections(); await server.closeCommandExplainer();
  await server.closeMessengers(); await server.closeBrowsers();
  await server.managedProcesses.stopAll(reason); await new Promise((done) => server.close(done));
}

const root = await mkdtemp(join(tmpdir(), 't5-s4p0b-existing-'));
const home = join(root, 'home'); const workspace = join(root, 'workspace');
const stateDir = join(root, 'state'); const skillsRoot = join(root, 'skills');
await Promise.all([home, workspace, stateDir, skillsRoot]
  .map((path) => mkdir(path, { recursive: true, mode: 0o700 })));

await Promise.all([
  mkdir(join(workspace, 'src'), { recursive: true }),
  mkdir(join(workspace, 'public'), { recursive: true }),
  mkdir(join(workspace, 'test'), { recursive: true }),
]);
await writeFile(join(workspace, 'package.json'), `${JSON.stringify({
  name: 'fixture-onboarding-app', private: true, type: 'module',
  scripts: { test: 'node --test', start: 'python3 -m http.server 4183 --bind 127.0.0.1' },
}, null, 2)}\n`);
await writeFile(join(workspace, 'src', 'onboarding.js'), [
  'export function nextStep(current) {',
  '  return Math.min(current, 3);',
  '}',
].join('\n'));
await writeFile(join(workspace, 'public', 'app.js'), [
  "import { nextStep } from '/src/onboarding.js';",
  "const state = document.querySelector('[data-step]');",
  "document.querySelector('#next').addEventListener('click', () => {",
  "  const next = nextStep(Number(state.dataset.step));",
  "  state.dataset.step = String(next);",
  "  state.textContent = `온보딩 단계 ${next}`;",
  '});',
].join('\n'));
await writeFile(join(workspace, 'public', 'index.html'), [
  '<!doctype html><html lang="ko"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>온보딩</title><link rel="stylesheet" href="/public/theme.css"></head>',
  '<body><main><h1>팀 시작하기</h1><p data-step="1">온보딩 단계 1</p>',
  '<button id="next" type="button">다음</button><a href="#help">도움말</a></main>',
  '<script type="module" src="/public/app.js"></script></body></html>',
].join(''));
await writeFile(join(workspace, 'public', 'theme.css'), 'body{background:#ffffff;color:#173f35;font-family:sans-serif}main{max-width:640px;margin:80px auto}');
await writeFile(join(workspace, 'test', 'onboarding.test.js'), [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { nextStep } from '../src/onboarding.js';",
  "test('next advances until step 3',()=>{assert.equal(nextStep(1),2);assert.equal(nextStep(2),3);assert.equal(nextStep(3),3)});",
].join('\n'));

execFileSync('git', ['init', '-q'], { cwd: workspace });
execFileSync('git', ['add', 'package.json', 'src/onboarding.js', 'public/index.html', 'public/app.js', 'public/theme.css', 'test/onboarding.test.js'], { cwd: workspace });
execFileSync('git', ['-c', 'user.name=T5 Fixture', '-c', 'user.email=t5-fixture@example.invalid', 'commit', '-qm', 'fixture baseline'], { cwd: workspace });
await writeFile(join(workspace, 'public', 'theme.css'), 'body{background:#f5e6c8;color:#173f35;font-family:sans-serif}main{max-width:640px;margin:80px auto}');

const originalBug = await readFile(join(workspace, 'src', 'onboarding.js'), 'utf8');
const userDirty = await readFile(join(workspace, 'public', 'theme.css'), 'utf8');
const before = await walk(workspace); const baselineExit = testExit(workspace);
const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selected = stored.connections?.find((item) => item.id === requestedModel)
  ?? stored.connections?.find((item) => item.id === stored.activeId);
if (!selected) throw new Error(`requested model connection unavailable: ${requestedModel}`);
const connectionFile = join(root, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ ...stored, activeId: selected.id, connections: [selected] }), { mode: 0o600 });

const previousHome = process.env.T5_REFOUNDATION_HOME; process.env.T5_REFOUNDATION_HOME = home;
let server;
try {
  const computer = discoverComputerEnvironment({ userHome: home });
  const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
  const terminalPlatformAdapter = await makeTerminalPlatformAdapter({ platform: computer.platform,
    protectedReadRoots: [dirname(sourceConnectionFile), stateDir, home] });
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: computer.platform }) });
  const runtimeErrors = [];
  const makeProductServer = () => makeConsoleServer({ stateDir, workspace, skillsRoot, computerEnvironment: computer,
    terminalEnvironment, terminalPlatformAdapter, learningReviewMode: 'off',
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    workspaceConnectionInspectors: [], workspaceConnectionServices: [], webReadOptions: { allowPrivateUrls: true },
    browserDriverFactory: (sessionId) => makeAgentBrowserDriver({ ownerId: sessionId,
      outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts') }),
    onError: (error) => runtimeErrors.push(error?.code ?? error?.message ?? String(error)),
  });
  server = makeProductServer();
  let base = await listen(server);
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const firstPrompt = [
    '이 프로젝트의 온보딩 화면에서 다음 버튼을 눌러도 첫 단계에 머물러 있어.',
    '원인을 찾아 고치고 전체 테스트를 실행한 뒤 실제 로컬 화면에서 다음 버튼을 눌러 단계 2로 바뀌는지 확인해줘.',
    '내가 이미 바꿔둔 배경색은 유지하고 다른 파일을 불필요하게 바꾸지 마.',
    '수정은 나중에 되돌릴 수 있게 하고 외부에는 공개하지 마.',
  ].join(' ');
  const firstBegan = performance.now();
  const firstResponse = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: firstPrompt }), signal: AbortSignal.timeout(300_000) });
  const firstSurface = await firstResponse.json();
  const firstRun = firstSurface.runId ? await server.runLedger.read(firstSurface.runId) : null;
  const firstWallMs = Math.round(performance.now() - firstBegan);
  const fixedSource = await readFile(join(workspace, 'src', 'onboarding.js'), 'utf8');
  const dirtyAfterFix = await readFile(join(workspace, 'public', 'theme.css'), 'utf8');
  const afterFixExit = testExit(workspace);
  const firstBrowser = browserActions(firstRun);
  const undoHandleCreated = receipts(firstRun).some((receipt) => Boolean(
    receipt.result?.undoHandle ?? receipt.result?.publication?.undoHandle));

  if (restartBeforeUndo) {
    await closeServer(server, 's4p1_runtime_restart');
    server = makeProductServer();
    base = await listen(server);
  }

  const secondPrompt = '방금 T5가 수정한 온보딩 코드만 되돌려줘. 내가 바꾼 배경색은 그대로 두고 실제로 원래 코드가 복원됐는지 확인해줘.';
  const secondBegan = performance.now();
  const secondResponse = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: secondPrompt }), signal: AbortSignal.timeout(180_000) });
  const secondSurface = await secondResponse.json();
  const secondRun = secondSurface.runId ? await server.runLedger.read(secondSurface.runId) : null;
  const secondWallMs = Math.round(performance.now() - secondBegan);
  const restoredSource = await readFile(join(workspace, 'src', 'onboarding.js'), 'utf8');
  const dirtyAfterUndo = await readFile(join(workspace, 'public', 'theme.css'), 'utf8');
  const afterUndoExit = testExit(workspace); const after = await walk(workspace);
  const rollbackReceipt = receipts(secondRun).find((receipt) => receipt.requestedCall?.name === 'workspace_patch'
    && receipt.requestedCall?.args?.action === 'rollback');
  const managedAtDelivery = server.managedProcesses.list(session.id);
  await server.managedProcesses.stopAll('s4p0b_settlement');
  const afterSettlement = server.managedProcesses.list(session.id);
  const checks = {
    baselineFailed: baselineExit !== 0,
    firstTurnCompleted: firstResponse.status === 200 && firstRun?.status === 'completed',
    sourceFixed: /current\s*\+\s*1/u.test(fixedSource),
    testsPassedAfterFix: afterFixExit === 0,
    userDirtyPreservedAfterFix: dirtyAfterFix === userDirty,
    browserNavigated: firstBrowser.some((item) => item.action === 'navigate' && item.outcome === 'succeeded'),
    browserClickedNext: firstBrowser.some((item) => item.action === 'click' && item.outcome === 'succeeded'),
    browserObservedStep2: firstBrowser.some((item) => /온보딩 단계 2/u.test(item.text)),
    undoHandleCreated,
    secondTurnCompleted: secondResponse.status === 200 && secondRun?.status === 'completed',
    durableRollbackUsed: rollbackReceipt?.outcome === 'succeeded',
    sourceExactRestored: restoredSource === originalBug,
    userDirtyPreservedAfterUndo: dirtyAfterUndo === userDirty,
    originalFailureRestored: afterUndoExit !== 0,
    runtimeErrorsZero: runtimeErrors.length === 0,
    managedProcessStopped: afterSettlement.every((item) => item.state !== 'running'),
    runtimeRestartedBeforeUndo: restartBeforeUndo,
  };
  const firstDefectFamily = !checks.firstTurnCompleted || !checks.sourceFixed || !checks.testsPassedAfterFix
    ? 'project_edit_build_loop' : !checks.userDirtyPreservedAfterFix ? 'dirty_change_preservation'
      : !checks.browserNavigated || !checks.browserClickedNext || !checks.browserObservedStep2
        ? 'existing_project_browser_regression' : !checks.undoHandleCreated || !checks.durableRollbackUsed
          ? 'durable_project_undo_activation' : !checks.sourceExactRestored || !checks.userDirtyPreservedAfterUndo
            ? 'project_undo_scope' : null;
  const evidence = { schema: 't5.s4p0b.existing-project-baseline.v1', recordedAt: new Date().toISOString(),
    sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve('.'), encoding: 'utf8' }).trim(),
    productChanges: candidate ? 1 : 0, actualUserData: false, actualExternalAccount: false, model: selected.modelId,
    runtimeRestartedBeforeUndo: restartBeforeUndo,
    checks, firstDefectFamily, purposePassed: firstDefectFamily == null,
    firstTurn: { prompt: firstPrompt, answer: firstSurface.reply ?? null, performance: metrics(firstRun, firstWallMs),
      route: route(firstRun), browser: firstBrowser.map(({ text, ...item }) => item) },
    secondTurn: { prompt: secondPrompt, answer: secondSurface.reply ?? null, performance: metrics(secondRun, secondWallMs),
      route: route(secondRun) },
    files: { before: before.map((item) => item.path), after: after.map((item) => item.path),
      userDirtySha256: sha(userDirty), sourceOriginalSha256: sha(originalBug), sourceFixedSha256: sha(fixedSource),
      sourceRestoredSha256: sha(restoredSource) },
    process: { atDelivery: managedAtDelivery.map((item) => ({ processId: item.processId, state: item.state })),
      afterSettlement: afterSettlement.map((item) => ({ processId: item.processId, state: item.state,
        terminationConfirmed: item.terminationConfirmed ?? null })) }, runtimeErrors,
    decision: firstDefectFamily == null ? 'CURRENT_PRODUCT_EXISTING_PROJECT_POSITIVE_CONTROL'
      : 'S4_P0B_FIRST_BINDING_DEFECT_REPRODUCED', ...(keep ? { retainedFixtureRoot: root } : {}) };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, serialized, { mode: 0o600 }); }
  process.stdout.write(serialized);
} finally {
  if (server) await closeServer(server, 's4p0b_finally');
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME; else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (keep) process.stderr.write(`kept ${root}\n`);
  else await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
