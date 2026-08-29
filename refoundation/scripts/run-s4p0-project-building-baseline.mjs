#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const keep = process.argv.includes('--keep');
const candidate = process.argv.includes('--candidate');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const requestedModel = option('--model-id') ?? 'chatgpt_oauth:gpt-5.5';
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));

async function filesUnder(root, current = root) {
  const out = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(root, path));
    else if (entry.isFile()) {
      try {
        const bytes = await readFile(path);
        out.push({ path: relative(root, path).split(sep).join('/'), bytes: bytes.length, sha256: hash(bytes) });
      } catch (error) {
        if (!['ENOENT', 'EISDIR'].includes(error?.code)) throw error;
      }
    }
  }
  return out.sort((left, right) => left.path.localeCompare(right.path));
}

function browserUrl(result) {
  return result?.tab?.url ?? result?.observation?.refScope?.url
    ?? result?.after?.refScope?.url ?? result?.navigation?.to ?? null;
}

function textContains(result, pattern) {
  return pattern.test(JSON.stringify(result ?? {}));
}

async function stopUnmanagedFixturePid(workspace, paths) {
  const candidates = paths.filter((path) => /(?:^|\/)server\.pid$/u.test(path));
  const observations = [];
  for (const relativePath of candidates) {
    let pid;
    try { pid = Number.parseInt((await readFile(join(workspace, relativePath), 'utf8')).trim(), 10); }
    catch { continue; }
    if (!Number.isInteger(pid) || pid <= 1) continue;
    let cwd = null;
    try {
      const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
      cwd = output.split(/\r?\n/u).find((line) => line.startsWith('n'))?.slice(1) ?? null;
    } catch {}
    const exactFixtureOwner = cwd === workspace || cwd?.startsWith(`${workspace}${sep}`) === true;
    let stopped = false;
    if (exactFixtureOwner) {
      try { process.kill(pid, 'SIGTERM'); stopped = true; } catch (error) { if (error?.code !== 'ESRCH') throw error; }
    }
    observations.push({ pid, cwd, exactFixtureOwner, stopped });
  }
  return observations;
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const root = await mkdtemp(join(tmpdir(), 't5-s4p0-project-'));
const home = join(root, 'home');
const workspace = join(root, 'workspace');
const stateDir = join(root, 'state');
const skillsRoot = join(root, 'skills');
await Promise.all([home, workspace, stateDir, skillsRoot]
  .map((path) => mkdir(path, { recursive: true, mode: 0o700 })));

await writeFile(join(workspace, '회사자료.md'), [
  '# 해솔공간',
  '',
  '해솔공간은 작은 팀이 더 편안하게 일하도록 사무공간을 설계하고 정리하는 회사입니다.',
  '',
  '## 주요 서비스',
  '- 소형 사무실 공간 진단',
  '- 가구 배치와 동선 개선',
  '- 이전 후 정리와 운영 가이드',
  '',
  '상담 전화: 02-555-0180',
  '상담 이메일: hello@haesol.example',
  '운영 시간: 평일 09:00~18:00',
].join('\n'), 'utf8');
await writeFile(join(workspace, '브랜드-기준.txt'), [
  '느낌: 따뜻하고 차분하며 과장되지 않게',
  '주색: 짙은 초록',
  '보조색: 모래색',
  '금지: 외부 이미지와 외부 폰트 의존',
].join('\n'), 'utf8');

const sourceBefore = new Map((await filesUnder(workspace)).map((item) => [item.path, item.sha256]));
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve('.'), encoding: 'utf8' }).trim();
let productSourceDirty = false;
try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', 'refoundation/src'], { cwd: resolve('.') }); }
catch { productSourceDirty = true; }

const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selected = stored.connections?.find((item) => item.id === requestedModel)
  ?? stored.connections?.find((item) => item.id === stored.activeId);
if (!selected) throw new Error(`requested model connection unavailable: ${requestedModel}`);
const connectionFile = join(root, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ ...stored, activeId: selected.id, connections: [selected] }), { mode: 0o600 });

const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = home;
let server;
let session;
try {
  const computer = discoverComputerEnvironment({ userHome: home });
  const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
  const terminalPlatformAdapter = await makeTerminalPlatformAdapter({
    platform: computer.platform,
    protectedReadRoots: [dirname(sourceConnectionFile), stateDir, home],
  });
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: computer.platform }) });
  const runtimeErrors = [];
  server = makeConsoleServer({
    stateDir, workspace, skillsRoot, computerEnvironment: computer,
    terminalEnvironment, terminalPlatformAdapter, learningReviewMode: 'off',
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    workspaceConnectionInspectors: [], workspaceConnectionServices: [],
    webReadOptions: { allowPrivateUrls: true },
    browserDriverFactory: (sessionId) => makeAgentBrowserDriver({
      ownerId: sessionId,
      outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts'),
    }),
    onError: (error) => runtimeErrors.push(error?.code ?? error?.message ?? String(error)),
  });
  const base = await listen(server);
  session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const prompt = [
    '우리 회사 소개와 상담 신청이 있는 홈페이지를 만들어줘.',
    '작업 폴더의 회사 자료와 브랜드 기준을 사용하고 외부 이미지나 외부 폰트에 의존하지 마.',
    '우선 내 컴퓨터에서 실제로 실행해서 화면을 확인하고, 상담자 이름과 연락처를 입력해 신청했을 때',
    '접수 결과가 화면에 나타나는지 직접 확인해줘. 외부에는 공개하지 마.',
    '확인이 끝나면 내가 바로 볼 수 있는 결과와 현재 실행 상태를 알려줘.',
  ].join(' ');
  const began = performance.now();
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: prompt }),
    signal: AbortSignal.timeout(300_000),
  });
  const surface = await response.json();
  const wallMs = Math.round(performance.now() - began);
  const run = surface.runId ? await server.runLedger.read(surface.runId) : null;
  const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean);
  const models = (run?.events ?? []).filter((event) => event.type === 'model_completed');
  const browserReceipts = receipts.filter((receipt) => (
    (receipt.actualCall?.name ?? receipt.requestedCall?.name) === 'browser'));
  const browserActions = browserReceipts.map((receipt) => ({
    action: receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action ?? null,
    outcome: receipt.outcome,
    state: receipt.result?.state ?? null,
    url: browserUrl(receipt.result),
    result: receipt.result,
  }));
  const after = await filesUnder(workspace);
  const afterMap = new Map(after.map((item) => [item.path, item.sha256]));
  const sourceUnchanged = [...sourceBefore].every(([path, digest]) => afterMap.get(path) === digest);
  const htmlFiles = after.filter((item) => /(?:^|\/)index\.html$/iu.test(item.path));
  const htmlTexts = await Promise.all(htmlFiles.map((item) => readFile(join(workspace, item.path), 'utf8')));
  const createdWebsite = htmlFiles.length > 0;
  const companyContent = htmlTexts.some((text) => /해솔공간/u.test(text)
    && /소형 사무실|공간 진단/u.test(text) && /02-555-0180/u.test(text));
  const consultationForm = htmlTexts.some((text) => /<form\b/iu.test(text)
    && /(?:name|이름)/iu.test(text) && /(?:tel|phone|연락처)/iu.test(text));
  const localBrowserNavigation = browserActions.some((action) => action.action === 'navigate'
    && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(String(action.url ?? '')));
  const formFilled = browserActions.some((action) => action.action === 'fill');
  const formSubmitted = browserActions.some((action) => action.action === 'submit');
  const successObserved = browserActions.some((action) => textContains(action.result, /접수|신청.{0,8}(?:완료|됐|되었)|감사/u));
  const runningAtDelivery = server.managedProcesses.list(session.id)
    .filter((process) => process.state === 'running').length;
  const localPreviewUrl = browserActions.find((action) => action.action === 'navigate'
    && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(String(action.url ?? '')))?.url ?? null;
  let previewReachableAtDelivery = false;
  if (localPreviewUrl) {
    try { previewReachableAtDelivery = (await fetch(localPreviewUrl, { signal: AbortSignal.timeout(2_000) })).ok; }
    catch {}
  }
  const devServerOwned = !previewReachableAtDelivery || runningAtDelivery > 0;
  const temporaryResidue = after.map((item) => item.path)
    .filter((path) => /(?:^|\/)(?:server\.pid|server\.log|nohup\.out)$/u.test(path));
  const externalBrowserUrls = browserActions.map((action) => action.url).filter(Boolean)
    .filter((url) => !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/u.test(url));
  const checks = {
    turnCompleted: response.status === 200 && run?.status === 'completed',
    answerPresent: Boolean(String(surface.reply ?? '').trim()),
    createdWebsite, companyContent, consultationForm, sourceUnchanged,
    localBrowserNavigation, formFilled, formSubmitted, successObserved,
    devServerOwned, temporaryResidueZero: temporaryResidue.length === 0,
    externalPublicationZero: externalBrowserUrls.length === 0,
    runtimeErrorsZero: runtimeErrors.length === 0,
  };
  const firstDefectFamily = !checks.turnCompleted || !checks.createdWebsite || !checks.companyContent
    || !checks.consultationForm ? 'project_creation_completion'
      : !checks.localBrowserNavigation ? 'live_preview_browser_binding'
        : !checks.devServerOwned || !checks.temporaryResidueZero ? 'dev_server_ownership_cleanup'
          : !checks.formFilled || !checks.formSubmitted || !checks.successObserved
            ? 'functional_browser_verification' : !checks.sourceUnchanged
            ? 'source_scope_preservation' : !checks.externalPublicationZero
              ? 'external_effect_scope' : null;
  const qualificationCleanup = runningAtDelivery === 0
    ? await stopUnmanagedFixturePid(workspace, after.map((item) => item.path)) : [];
  await server.managedProcesses.stopAll('s4p_project_qualification_settlement');
  const processesAfterSettlement = server.managedProcesses.list(session.id);
  let previewReachableAfterSettlement = false;
  if (localPreviewUrl) {
    try { previewReachableAfterSettlement = (await fetch(localPreviewUrl, { signal: AbortSignal.timeout(2_000) })).ok; }
    catch {}
  }
  checks.runtimeCleanupVerified = processesAfterSettlement.every((process) => process.state !== 'running')
    && !previewReachableAfterSettlement
    && qualificationCleanup.every((item) => item.exactFixtureOwner && item.stopped);
  const settledDefect = firstDefectFamily ?? (checks.runtimeCleanupVerified ? null : 'dev_server_ownership_cleanup');
  const evidence = {
    schema: 't5.s4p0.project-building-baseline.v1', recordedAt: new Date().toISOString(),
    sourceHead, productChanges: candidate ? 1 : 0, productSourceDirty, model: selected.modelId,
    actualUserData: false, actualExternalAccount: false, naturalLanguageOnly: true,
    purpose: { prompt, httpStatus: response.status, runStatus: run?.status ?? null,
      answer: surface.reply ?? null },
    checks, firstDefectFamily: settledDefect,
    performance: {
      wallMs, modelCalls: models.length, toolCalls: receipts.length,
      providerTokens: models.reduce((sum, event) => sum
        + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
      requestBytes: models.reduce((sum, event) => sum
        + Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0), 0),
    },
    route: receipts.map((receipt) => ({
      name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
      action: receipt.actualCall?.args?.action ?? receipt.requestedCall?.args?.action ?? null,
      outcome: receipt.outcome, state: receipt.result?.state ?? null,
      activatedTools: receipt.result?.activatedTools ?? [],
      commandShape: receipt.requestedCall?.name === 'exec' ? {
        chars: String(receipt.requestedCall?.args?.command ?? '').length,
        sha256: hash(String(receipt.requestedCall?.args?.command ?? '')),
        steps: (receipt.result?.commandExplanation?.steps ?? []).map((step) => step.executable),
        operators: (receipt.result?.commandExplanation?.operators ?? []).map((operator) => operator.kind),
        shapes: receipt.result?.commandExplanation?.shapes ?? [],
      } : null,
    })),
    browser: { actions: browserActions.map(({ result, ...action }) => action), externalBrowserUrls },
    files: { before: [...sourceBefore.keys()], after: after.map((item) => item.path),
      htmlFiles: htmlFiles.map((item) => item.path) },
    delivery: { artifactCount: surface.artifacts?.length ?? 0, runningManagedProcesses: runningAtDelivery,
      localPreviewUrl, previewReachableAtDelivery, temporaryResidue, qualificationCleanup,
      processesAfterSettlement: processesAfterSettlement.map((process) => ({
        processId: process.processId, state: process.state, terminationConfirmed: process.terminationConfirmed ?? null,
      })), previewReachableAfterSettlement },
    runtimeErrors,
    baselineObserved: true,
    purposePassed: settledDefect == null,
    decision: settledDefect == null
      ? 'CURRENT_PRODUCT_PROJECT_JOURNEY_POSITIVE_CONTROL'
      : 'S4_P_FIRST_BINDING_DEFECT_REPRODUCED',
    ...(keep ? { retainedFixtureRoot: root } : {}),
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, serialized, { mode: 0o600 }); }
  process.stdout.write(serialized);
} finally {
  if (server) {
    server.closeWakeStreams(); server.closeModelConnections(); await server.closeCommandExplainer();
    await server.closeMessengers(); await server.closeBrowsers();
    await server.managedProcesses.stopAll('s4p0_project_baseline_finished');
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (keep) process.stderr.write(`kept ${root}\n`);
  else await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
