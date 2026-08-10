// F-65 current-workset 2x2x2 counterfactual runner.
// This is a diagnostic harness only: it changes Runtime reality assembly, never product source or user text.
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { makeServer } from '../../src/surface/server.js';
import { SessionStore } from '../../src/surface/session-store.js';
import { liveDeps } from '../../src/surface/live-context.js';
import { buildSelfState } from '../../src/kernel/l0-evidence/self-state.js';
import { 격리증명 } from './prove-isolation.mjs';
import {
  artifactIdentity, assertNoSecretExposure, changedPaths, claimRun, digest, finishRun,
  snapshotPaths, verifyQualificationEvidence,
} from './harness-qualification.mjs';
import {
  createLivingSimRoom, createRecordingFetch, loadOpenAiCredential, materializeFixture,
} from './living-sim-runner.mjs';

export const F65_MATRIX_SCHEMA_VERSION = 1;
export const FROZEN_F65_MATRIX_SHA256 = '20681992a5eb2d1060445bec5151252397c9f03b1670cd5deb0c9dcb6e8cd102';
const execFileAsync = promisify(execFile);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

async function exclusiveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

export async function loadF65MatrixDefinition(path) {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const sha256 = digest(bytes);
  if (sha256 !== FROZEN_F65_MATRIX_SHA256) {
    throw Object.assign(new Error(`F-65 matrix freeze mismatch: ${sha256}`), { code: 'MATRIX_NOT_FROZEN' });
  }
  const document = JSON.parse(bytes.toString('utf8'));
  if (document.schemaVersion !== F65_MATRIX_SCHEMA_VERSION || document.status !== 'FROZEN_BEFORE_PAID_RUN') {
    throw Object.assign(new Error('F-65 matrix schema/status mismatch'), { code: 'MATRIX_NOT_FROZEN' });
  }
  if (document.model?.provider !== 'openai' || document.model?.modelId !== 'gpt-5.1') {
    throw Object.assign(new Error('F-65 matrix model mismatch'), { code: 'MATRIX_NOT_FROZEN' });
  }
  if (document.scenarios?.length !== 3) throw new Error('F-65 matrix must contain exactly three scenarios');
  return { path: absolute, sha256, document };
}

export function enumerateF65Cells(definition) {
  const rows = [];
  for (const scenario of definition.scenarios ?? []) {
    for (const W of [false, true]) for (const P of [false, true]) for (const O of [false, true]) {
      rows.push({ scenarioId: scenario.id, W, P, O, cellId: `${scenario.id}--W${+W}P${+P}O${+O}` });
    }
  }
  return rows;
}

function compact(value, limit = 12_000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function listEvidenceFact(receipt) {
  if (receipt?.failureState !== 'none' || receipt?.actualCall?.tool !== 'local.file'
      || receipt?.actualCall?.args?.action !== 'list') {
    throw Object.assign(new Error('O axis requires an actual successful read-only local.file list Receipt'), {
      code: 'O_RECEIPT_INVALID',
    });
  }
  return {
    intended: receipt.intended,
    failureState: receipt.failureState,
    summary: receipt.userSafeSummary,
    calledWith: compact(receipt.actualCall.args),
    data: compact(receipt.result),
    ...(receipt.actualCall?.callRef ? { ref: receipt.actualCall.callRef } : {}),
  };
}

/** Add only structured facts to TaskContext; the normal model facts renderer remains the sole renderer. */
export function applyDiagnosticReality(model, { axes, worksetRef, rootPath, listReceipt, observe } = {}) {
  if (!model?.respond) throw new Error('model.respond required');
  return {
    ...model,
    async respond(taskContext, options) {
      const tc = { ...taskContext };
      const state = { ...(tc.workingState ?? {}), subjects: [...(tc.workingState?.subjects ?? [])],
        places: [...(tc.workingState?.places ?? [])] };
      if (axes.W) state.places.push({ label: `현재 임무 자료방 · 범위 신분 ${worksetRef}`, path: '' });
      if (axes.P) state.subjects.push({ key: `diagnostic-root:${worksetRef}`, kind: 'place',
        label: '현재 임무 자료방', detail: rootPath, lastTurn: state.turnNo ?? 1 });
      if (axes.W || axes.P) tc.workingState = state;
      if (axes.O) tc.evidenceFacts = [...(tc.evidenceFacts ?? []), listEvidenceFact(listReceipt)];
      observe?.(tc);
      return model.respond(tc, options);
    },
  };
}

function isolatedEnv({ homeDir, stateDir, fixtureDir, apiKey, model }) {
  return {
    HOME: homeDir, GPAO_T5_HOME: homeDir, GPAO_T5_DATA_DIR: stateDir,
    GPAO_T5_FILE_ROOTS: fixtureDir, GPAO_T5_BROWSER_PROFILE: '0', GPAO_T5_DESKTOP_BIN: '', GPAO_T5_CUA_BIN: '',
    GPAO_T5_MODEL_PROVIDER: 'openai', GPAO_T5_MODEL_ID: model.modelId,
    GPAO_T5_MODEL_BASE_URL: 'https://api.openai.com/v1', GPAO_T5_MODEL_API_KEY: apiKey, OPENAI_API_KEY: apiKey,
    GPAO_T5_MODEL_MAX_TOKENS: String(model.maxOutputTokens),
    GPAO_T5_MODEL_TIMEOUT_MS: String(model.totalTimeoutMs),
    GPAO_T5_MODEL_HTTP_TIMEOUT_MS: String(model.httpTimeoutMs),
    GPAO_T5_MODEL_STALL_MS: String(model.stallMs),
    GPAO_T5_WEB_TIMEOUT_MS: '0', GPAO_T5_ENABLE_TCELL: '0', GPAO_T5_ENABLE_SCHEDULER: '0',
  };
}

async function listen(server) {
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); ok(); });
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((ok) => server.close(ok));
}

async function surface(base, cookie, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(json)}`);
  return { json, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] || cookie };
}

async function fixtureIdentity(root, fixture) {
  const rows = [];
  for (const name of Object.keys(fixture).sort()) {
    const path = join(root, name); const bytes = await readFile(path);
    rows.push({ name, sha256: digest(bytes), bytes: bytes.length });
  }
  return { rows, sha256: digest(JSON.stringify(rows)) };
}

function receiptCalls(ledger = []) {
  return ledger.filter((entry) => entry?.actualCall?.tool).map((entry) => ({
    tool: entry.actualCall.tool, args: entry.actualCall.args ?? {}, failureState: entry.failureState,
    receiptRef: entry.receiptRef ?? entry.ref ?? null, result: entry.result ?? null,
  }));
}

function providerMeter(events, expected) {
  const calls = events.filter((event) => event.type === 'provider_call' && event.requestModelId === 'gpt-5.1');
  const usage = calls.map((event) => event.usage).filter(Boolean);
  const sum = (key) => usage.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);
  return { observedCalls: calls.length, responseModelIds: [...new Set(calls.map((c) => c.responseModelId).filter(Boolean))],
    usage: { callsWithUsage: usage.length, promptTokens: sum('prompt_tokens'),
      completionTokens: sum('completion_tokens'), totalTokens: sum('total_tokens'), raw: usage },
    expectedUpperBoundsForMeteringOnly: expected, enforced: false };
}

async function outputFact(root, scenario) {
  const path = resolve(root, scenario.expectedOutput);
  try {
    const bytes = await readFile(path);
    return { exists: true, path, relativePath: relative(root, path), sha256: digest(bytes), bytes: bytes.length,
      text: bytes.toString('utf8') };
  } catch { return { exists: false, path, relativePath: relative(root, path) }; }
}

export function scoreF65Cell({ scenario, surfaceTurn, session, workEvents, output }) {
  const calls = receiptCalls(session?.ledgerEntries ?? []);
  const first = calls[0] ?? null;
  const reads = new Set(calls.filter((c) => c.tool === 'local.file' && c.args?.action === 'read'
    && c.failureState === 'none').map((c) => basename(String(c.result?.path ?? c.args?.path ?? ''))));
  const expectedPath = resolve(output.path);
  const exactWrite = calls.some((c) => c.tool === 'local.file' && ['write', 'move'].includes(c.args?.action)
    && c.failureState === 'none' && resolve(String(c.result?.path ?? c.args?.path ?? '')) === expectedPath);
  const contentRows = scenario.requiredContent.map((fact) => ({ fact, present: output.exists && output.text.includes(fact) }));
  const recent = session?.workingState?.recentOutcome?.status === 'completed'
    || surfaceTurn?.response?.recentOutcome?.status === 'completed';
  const receiptRef = Boolean(session?.ledgerEntries?.some((entry) => entry?.receiptRef));
  const completedEvents = (workEvents ?? []).filter((event) => event?.eventType === 'execution_completed'
    || event?.type === 'execution_completed');
  return {
    firstToolTarget: first ? { tool: first.tool, action: first.args?.action ?? null,
      target: first.args?.path ?? first.args?.target ?? first.args?.request ?? null } : null,
    sourceFilesReadCoverage: { read: [...reads].filter((name) => scenario.sourceFiles.includes(name)).sort(),
      total: scenario.sourceFiles.length },
    userRestatementBurden: surfaceTurn?.response?.kind === 'clarify' ? 1 : 0,
    exactOutputPath: { exists: output.exists, receiptMatched: exactWrite,
      pass: output.exists && exactWrite, expected: scenario.expectedOutput, observed: output.relativePath },
    requiredContentCoverage: { rows: contentRows, pass: contentRows.every((row) => row.present) },
    completionTruthConsistency: { recentOutcome: recent, receiptRef, executionCompleted: completedEvents.length,
      consistent: recent === receiptRef && receiptRef === Boolean(completedEvents.length) },
    semantic: 'PM_UNJUDGED',
  };
}

export async function runF65MatrixCell(options) {
  const { batchRunId, cellId, configFile, qualificationManifest, qualificationHistoryDir,
    evidenceDir, historyDir, sourceRoot } = options;
  const definition = await loadF65MatrixDefinition(configFile);
  const cell = enumerateF65Cells(definition.document).find((row) => row.cellId === cellId);
  if (!cell) throw Object.assign(new Error('unknown matrix cell'), { code: 'CELL_NOT_FROZEN' });
  const scenario = definition.document.scenarios.find((row) => row.id === cell.scenarioId);
  const qualification = await verifyQualificationEvidence(qualificationManifest, { historyDir: qualificationHistoryDir });
  if (!qualification.ok) throw Object.assign(new Error('qualification evidence invalid'), { code: 'QUALIFICATION_REQUIRED' });
  const qualificationDoc = JSON.parse(await readFile(qualificationManifest, 'utf8'));
  const source = await artifactIdentity({ sourceRoot });
  if (source.kind !== 'source' || source.dirty || qualificationDoc.artifact?.kind !== 'source'
      || source.gitSha !== qualificationDoc.artifact.gitSha
      || source.worktreeDigest !== qualificationDoc.artifact.worktreeDigest) {
    throw Object.assign(new Error('clean source differs from qualification artifact'), { code: 'SOURCE_IDENTITY_MISMATCH' });
  }
  const runId = `${batchRunId}::${cellId}`; let room; let server; let claim; let finished = false;
  const realProtected = resolve(homedir(), '.local/state/gpao-t5');
  try {
    room = await createLivingSimRoom();
    const homeDir = join(room, 'home'); const stateDir = join(room, 'state'); const fixtureDir = join(room, 'fixture');
    await Promise.all([mkdir(homeDir), mkdir(stateDir), mkdir(fixtureDir)]);
    claim = await claimRun({ historyDir, runId, executionKind: 'f65_counterfactual', isolatedRoot: room });
    const attemptDir = join(resolve(evidenceDir), encodeURIComponent(runId), claim.attemptId);
    const rawDir = join(attemptDir, 'raw'); const manifestPath = join(attemptDir, 'manifest.json');
    await mkdir(rawDir, { recursive: true });
    await materializeFixture(fixtureDir, scenario.fixture);
    const fixture = await fixtureIdentity(fixtureDir, scenario.fixture);
    const sourcePaths = Object.keys(scenario.fixture).map((name) => join(fixtureDir, name));
    const beforeSources = await snapshotPaths(sourcePaths);
    const isolation = await 격리증명({ root: homeDir, fixtureDir, stateDir });
    if (!isolation.ok) throw Object.assign(new Error('isolation failed'), { code: 'ISOLATION_FAILED' });
    const beforeProtected = await snapshotPaths([realProtected]);
    const credential = loadOpenAiCredential(homedir()); const secrets = [credential.key];
    const providerEvents = [];
    const recordingFetch = createRecordingFetch({ secretValues: secrets,
      record: async (event) => { providerEvents.push(event); } });
    const processEnv = isolatedEnv({ homeDir, stateDir, fixtureDir, apiKey: credential.key,
      model: definition.document.model });
    const store = new SessionStore(stateDir);
    const live = liveDeps(processEnv, { fetchImpl: recordingFetch, sessionStore: store });
    let listReceipt = null;
    if (cell.O) listReceipt = await live.tools.run('local.file', { action: 'list', path: fixtureDir },
      buildSelfState(live.env, { tools: live.tools }),
      { callRef: `diagnostic-list:${cellId}` });
    const seenContexts = [];
    const worksetRef = `ws1.${digest(`${scenario.id}\0${fixture.sha256}`).slice(0, 16)}`;
    const model = applyDiagnosticReality(live.model, { axes: cell, worksetRef,
      rootPath: await realpath(fixtureDir), listReceipt, observe: (tc) => seenContexts.push(stable(tc)) });
    server = makeServer({ store, processEnv, env: live.env, tools: live.tools, descriptors: live.descriptors,
      channels: live.channels, connectors: live.connectors, model, modelDoctor: live.modelDoctor,
      modelSupportsSearch: live.modelSupportsSearch,
      modelProviderId: live.modelProviderId, modelTimeoutMs: 0, enableAgentDelegation: true,
      runtimeEnvironment: { locality: 'this_computer', networkExposure: 'loopback_only', costTracking: 'meter_only' } });
    await server.loadSelfhood();
    await server.runtimeReconcile();
    await listen(server); const base = `http://127.0.0.1:${server.address().port}`;
    const landing = await fetch(`${base}/`);
    let cookie = (landing.headers.get('set-cookie') ?? '').split(';')[0];
    let response;
    response = await surface(base, cookie, 'POST', '/sessions', {}); cookie = response.cookie;
    const sessionId = response.json.id;
    const turn = await surface(base, cookie, 'POST', '/turn', { sessionId, text: scenario.userUtterance });
    const surfaceSession = (await surface(base, cookie, 'GET', `/sessions/${encodeURIComponent(sessionId)}`, null)).json;
    await closeServer(server); server = null;
    const persisted = await readJson(join(stateDir, `${sessionId}.json`), {});
    const workEvents = (await readJson(join(stateDir, 'work-events.json'), {}))?.records ?? [];
    const output = await outputFact(fixtureDir, scenario);
    const afterProtected = await snapshotPaths([realProtected]);
    const afterSources = await snapshotPaths(sourcePaths);
    const protectedChanged = changedPaths(beforeProtected, afterProtected);
    const sourceChanged = changedPaths(beforeSources, afterSources);
    const machine = scoreF65Cell({ scenario, surfaceTurn: { response: turn.json }, session: persisted, workEvents, output });
    const raw = { execution: { batchRunId, runId, cell, source, configSha256: definition.sha256,
      fixture, qualificationManifest: resolve(qualificationManifest), qualificationStatus: qualificationDoc.status,
      credentialIdentity: credential.identity }, frozen: { userUtterance: scenario.userUtterance,
      resultConditions: scenario.resultConditions, forbiddenOutcomes: scenario.forbiddenOutcomes },
      diagnosticReality: { axes: { W: cell.W, P: cell.P, O: cell.O }, worksetRef,
        rootPath: cell.P ? await realpath(fixtureDir) : null, listReceipt }, isolation,
      providerEvents, providerMeter: providerMeter(providerEvents,
        definition.document.measurement.expectedUpperBoundsForMeteringOnly),
      firstRealitySnapshot: seenContexts[0] ?? null, surfaceTurn: turn.json,
      surfaceSession, persistedSession: persisted, workEvents, output,
      pathSnapshots: { protected: { before: beforeProtected, after: afterProtected, changed: protectedChanged },
        sources: { before: beforeSources, after: afterSources, changed: sourceChanged } } };
    assertNoSecretExposure(raw, secrets);
    const rawPath = join(rawDir, 'cell.json'); await exclusiveJson(rawPath, raw);
    const manifest = { schemaVersion: F65_MATRIX_SCHEMA_VERSION, kind: 'f65-workset-counterfactual-cell',
      runId, attemptId: claim.attemptId, status: protectedChanged.length || sourceChanged.length ? 'HARNESS_INVALID' : 'RECORDED',
      invalidReason: protectedChanged.length ? 'protected_state_changed' : sourceChanged.length ? 'source_fixture_changed' : null,
      cell, source,
      config: { path: relative(sourceRoot, definition.path), sha256: definition.sha256 }, fixture,
      isolation, machine, semantic: 'PM_UNJUDGED',
      providerMeter: providerMeter(providerEvents, definition.document.measurement.expectedUpperBoundsForMeteringOnly),
      protectedState: { path: realProtected, changed: protectedChanged }, fixtureState: { sourcePaths, changed: sourceChanged },
      rawEvidence: [{ name: 'cell.json', sha256: digest(await readFile(rawPath)) }] };
    await exclusiveJson(manifestPath, manifest);
    await finishRun(claim, { status: manifest.status, invalidReason: manifest.invalidReason,
      manifestHash: digest(await readFile(manifestPath)) }); finished = true;
    return { ok: manifest.status === 'RECORDED', status: manifest.status, manifestPath };
  } catch (error) {
    if (claim && !finished) await finishRun(claim, { status: 'HARNESS_INVALID',
      invalidReason: 'evidence_incomplete' }).catch(() => {});
    throw error;
  } finally {
    await closeServer(server).catch(() => {});
    if (room) await rm(room, { recursive: true, force: true });
  }
}

function parseChild(stdout = '', stderr = '') {
  const rows = `${stdout}\n${stderr}`.trim().split(/\r?\n/).filter(Boolean);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    try { return JSON.parse(rows[i]); } catch { /* continue */ }
  }
  throw new Error(`child did not return JSON: ${stderr.slice(-1000)}`);
}

async function spawnCell(args) {
  const argv = [fileURLToPath(import.meta.url), '--child'];
  for (const [key, value] of Object.entries(args)) argv.push(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(value));
  try {
    const result = await execFileAsync(process.execPath, argv, { cwd: args.sourceRoot, env: process.env,
      maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    return parseChild(result.stdout, result.stderr);
  } catch (error) { return parseChild(error.stdout ?? '', error.stderr ?? ''); }
}

export async function runF65Matrix(options) {
  const definition = await loadF65MatrixDefinition(options.configFile);
  const cells = enumerateF65Cells(definition.document);
  if (cells.length !== 24 || new Set(cells.map((cell) => cell.cellId)).size !== 24) throw new Error('matrix is not 24 unique cells');
  const results = [];
  for (const cell of cells) { // serial by frozen policy; one child and no rerun per cell
    // eslint-disable-next-line no-await-in-loop
    results.push(await spawnCell({ ...options, cellId: cell.cellId }));
  }
  const batch = { schemaVersion: F65_MATRIX_SCHEMA_VERSION, kind: 'f65-workset-counterfactual-batch',
    batchRunId: options.batchRunId, status: results.every((row) => row.status === 'RECORDED') ? 'RECORDED' : 'HARNESS_INVALID',
    configSha256: definition.sha256, cells: results, semantic: 'PM_UNJUDGED' };
  const path = join(resolve(options.evidenceDir), encodeURIComponent(options.batchRunId), 'batch-manifest.json');
  await exclusiveJson(path, batch); return { ok: batch.status === 'RECORDED', status: batch.status, manifestPath: path };
}

function arg(name) { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; }
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const options = { batchRunId: arg('--batch-run-id'), cellId: arg('--cell-id'), configFile: arg('--config'),
    qualificationManifest: arg('--qualification-manifest'), qualificationHistoryDir: arg('--qualification-history-dir'),
    evidenceDir: arg('--evidence-dir'), historyDir: arg('--history-dir'), sourceRoot: arg('--source') };
  if (Object.entries(options).some(([key, value]) => key !== 'cellId' && !value)) {
    console.error('usage: node scripts/human-use/f65-workset-matrix-runner.mjs --batch-run-id ID --config FILE --qualification-manifest FILE --qualification-history-dir DIR --evidence-dir DIR --history-dir DIR --source DIR');
    process.exit(2);
  }
  try {
    const result = process.argv.includes('--child') ? await runF65MatrixCell(options) : await runF65Matrix(options);
    console.log(JSON.stringify(result)); process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error?.code ?? 'F65_RUNNER_FAILED', error: String(error?.message ?? error) }));
    process.exit(2);
  }
}
