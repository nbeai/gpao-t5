// F-65 current-workset 2x2x2 counterfactual runner.
// This is a diagnostic harness only: it changes Runtime reality assembly, never product source or user text.
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, realpath, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

export const F65_MATRIX_SCHEMA_VERSION = 2;
export const FROZEN_F65_MATRIX_SHA256 = 'f80204bdb4455105e79a318a677c722f83c2bdd632e868a2b53d2ac75d7ae2f2';
const execFileAsync = promisify(execFile);

export const F65_CLI_SCHEMA = Object.freeze([
  { key: 'batchRunId', flag: '--batch-run-id', required: true },
  { key: 'cellId', flag: '--cell-id', childOnly: true },
  { key: 'configFile', flag: '--config', required: true },
  { key: 'qualificationManifest', flag: '--qualification-manifest', required: true },
  { key: 'qualificationHistoryDir', flag: '--qualification-history-dir', required: true },
  { key: 'evidenceDir', flag: '--evidence-dir', required: true },
  { key: 'historyDir', flag: '--history-dir', required: true },
  { key: 'sourceRoot', flag: '--source', required: true },
]);

export function serializeF65CliOptions(options, { child = false } = {}) {
  const argv = [];
  for (const field of F65_CLI_SCHEMA) {
    if (field.childOnly && !child) continue;
    const value = options[field.key];
    if (field.required && (value === undefined || value === null || value === '')) {
      throw Object.assign(new Error(`missing CLI option ${field.flag}`), { code: 'F65_CLI_INVALID' });
    }
    if (field.childOnly && child && (value === undefined || value === null || value === '')) {
      throw Object.assign(new Error(`missing child CLI option ${field.flag}`), { code: 'F65_CLI_INVALID' });
    }
    if (value !== undefined && value !== null && value !== '') argv.push(field.flag, String(value));
  }
  return argv;
}

export function parseF65CliArgs(argv, { child = false } = {}) {
  const out = {};
  const known = new Map(F65_CLI_SCHEMA.map((field) => [field.flag, field]));
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1]; const field = known.get(flag);
    if (!field || value === undefined || (field.childOnly && !child)) {
      throw Object.assign(new Error(`unknown or incomplete CLI option ${flag ?? ''}`), { code: 'F65_CLI_INVALID' });
    }
    out[field.key] = value;
  }
  serializeF65CliOptions(out, { child }); // one schema performs validation for both directions
  return out;
}

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
    receiptRef: entry.receiptRef ?? null, result: entry.result ?? null,
    completionContractRef: entry.completionContractRef ?? null,
    deliverableRefs: entry.deliverableRefs ?? [], lifecycle: entry.lifecycle ?? null,
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

function pathInside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function treeFileFacts(root) {
  const rows = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        rows.push({ path: resolve(path), relativePath: relative(root, path), sha256: digest(bytes),
          bytes: bytes.length, text: bytes.toString('utf8') });
      }
    }
  }
  await walk(root); return rows.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ko'));
}

function receiptTarget(call) {
  const value = call?.result?.path ?? call?.result?.to ?? call?.args?.to ?? call?.args?.path;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return resolve(value); } catch { return null; }
}

export function evaluateDerivedArtifacts({ root, scenario, beforeFiles, afterFiles, calls, sourceChanged = [] }) {
  const before = new Set((beforeFiles ?? []).map((file) => resolve(file.path)));
  const sources = new Set((scenario.sourceFiles ?? []).map((name) => resolve(root, name)));
  const qualification = new Set((scenario.qualificationFiles ?? []).map((name) => resolve(root, name)));
  const writes = calls.filter((call) => call.tool === 'local.file' && ['write', 'move'].includes(call.args?.action)
    && call.failureState === 'none' && call.lifecycle === 'delivered');
  const outsideSuccessful = writes.filter((call) => {
    const target = receiptTarget(call); return target && !pathInside(root, target);
  }).map((call) => ({ receiptRef: call.receiptRef, target: receiptTarget(call), action: call.args.action }));
  const sourceOverwrite = writes.filter((call) => sources.has(receiptTarget(call)))
    .map((call) => ({ receiptRef: call.receiptRef, target: receiptTarget(call), action: call.args.action }));
  const candidates = (afterFiles ?? []).filter((file) => !before.has(resolve(file.path))
    && !sources.has(resolve(file.path)) && !qualification.has(resolve(file.path))).map((file) => {
    const matching = writes.filter((call) => receiptTarget(call) === resolve(file.path));
    const contentRows = scenario.requiredContent.map((fact) => ({ fact, present: file.text.includes(fact) }));
    const extension = extname(file.path).toLowerCase();
    const pass = pathInside(root, file.path) && contentRows.every((row) => row.present)
      && matching.length > 0 && sourceChanged.length === 0 && outsideSuccessful.length === 0 && sourceOverwrite.length === 0;
    return { identity: { path: resolve(file.path), relativePath: file.relativePath, sha256: file.sha256, bytes: file.bytes,
      extension, artifactKind: scenario.artifactKind,
      artifactKindMachineBasis: scenario.artifactKindMachineBasis }, contentRows,
      writeReceipts: matching.map((call) => ({ receiptRef: call.receiptRef,
        completionContractRef: call.completionContractRef, deliverableRefs: call.deliverableRefs,
        action: call.args.action, lifecycle: call.lifecycle })), pass };
  });
  return { candidates, candidateCount: candidates.length, validCount: candidates.filter((row) => row.pass).length,
    ambiguity: candidates.length === 1 ? 'single' : candidates.length === 0 ? 'none' : 'multiple',
    sourceFilesUnchanged: { pass: sourceChanged.length === 0, changed: sourceChanged },
    workspaceBoundary: { pass: outsideSuccessful.length === 0, outsideSuccessful },
    sourceOverwrite: { pass: sourceOverwrite.length === 0, receipts: sourceOverwrite },
    pass: candidates.some((row) => row.pass) };
}

export function scoreF65Cell({ root, scenario, surfaceTurn, session, workEvents, beforeFiles, afterFiles,
  sourceChanged = [] }) {
  const calls = receiptCalls(session?.ledgerEntries ?? []);
  const first = calls[0] ?? null;
  const reads = new Set(calls.filter((c) => c.tool === 'local.file' && c.args?.action === 'read'
    && c.failureState === 'none').map((c) => basename(String(c.result?.path ?? c.args?.path ?? ''))));
  const artifacts = evaluateDerivedArtifacts({ root, scenario, beforeFiles, afterFiles, calls, sourceChanged });
  const recent = session?.workingState?.recentOutcome?.status === 'completed'
    || surfaceTurn?.response?.recentOutcome?.status === 'completed';
  const completedEvents = (workEvents ?? []).filter((event) => event?.eventType === 'execution_completed'
    || event?.type === 'execution_completed');
  const truthRows = artifacts.candidates.map((artifact) => {
    const receiptRefs = [...new Set(artifact.writeReceipts.map((receipt) => receipt.receiptRef).filter(Boolean))];
    const completionContractRefs = [...new Set(artifact.writeReceipts
      .map((receipt) => receipt.completionContractRef).filter(Boolean))];
    const events = completedEvents.filter((event) => receiptRefs.includes(event?.evidence?.receiptRef));
    const eventRefs = [...new Set(events.map((event) => event.evidence.receiptRef))];
    const receiptBound = receiptRefs.length === 1;
    const contractBound = completionContractRefs.length === 1;
    const eventBound = receiptBound && contractBound && events.length === 1 && eventRefs.length === 1
      && eventRefs[0] === receiptRefs[0]
      && events[0]?.evidence?.completionContractRef === completionContractRefs[0];
    return { artifact: artifact.identity, artifactPass: artifact.pass, receiptRefs,
      completionContractRefs,
      matchingExecutionCompleted: events.map((event) => ({ eventId: event.eventId ?? null,
        receiptRef: event.evidence.receiptRef, completionContractRef: event.evidence.completionContractRef ?? null })),
      recentOutcome: recent, consistent: recent === receiptBound && receiptBound === eventBound,
      verifiedComplete: artifact.pass && recent && receiptBound && eventBound };
  });
  const selectedTruth = artifacts.candidateCount === 1 ? truthRows[0] : null;
  return {
    firstToolTarget: first ? { tool: first.tool, action: first.args?.action ?? null,
      target: first.args?.path ?? first.args?.target ?? first.args?.request ?? null } : null,
    sourceFilesReadCoverage: { read: [...reads].filter((name) => scenario.sourceFiles.includes(name)).sort(),
      total: scenario.sourceFiles.length },
    userRestatementBurden: surfaceTurn?.response?.kind === 'clarify' ? 1 : 0,
    derivedArtifactIdentity: artifacts,
    requiredContentCoverage: { candidates: artifacts.candidates.map((row) => ({ artifact: row.identity,
      rows: row.contentRows, pass: row.contentRows.every((fact) => fact.present) })), pass: artifacts.pass },
    completionTruthConsistency: { ambiguity: artifacts.ambiguity, candidates: truthRows,
      selected: selectedTruth, consistent: selectedTruth?.consistent ?? null,
      verifiedComplete: selectedTruth?.verifiedComplete ?? false },
    semantic: 'PM_UNJUDGED',
  };
}

export async function runF65MatrixCell(options, hooks = {}) {
  const { batchRunId, cellId, configFile, qualificationManifest, qualificationHistoryDir,
    evidenceDir, historyDir, sourceRoot } = options;
  const definition = await loadF65MatrixDefinition(configFile);
  const cell = enumerateF65Cells(definition.document).find((row) => row.cellId === cellId);
  if (!cell) throw Object.assign(new Error('unknown matrix cell'), { code: 'CELL_NOT_FROZEN' });
  const scenario = definition.document.scenarios.find((row) => row.id === cell.scenarioId);
  const qualification = await (hooks.verifyQualificationEvidence ?? verifyQualificationEvidence)(
    qualificationManifest, { historyDir: qualificationHistoryDir });
  if (!qualification.ok) throw Object.assign(new Error('qualification evidence invalid'), { code: 'QUALIFICATION_REQUIRED' });
  const qualificationDoc = JSON.parse(await readFile(qualificationManifest, 'utf8'));
  const source = await (hooks.artifactIdentity ?? artifactIdentity)({ sourceRoot });
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
    const beforeFiles = await treeFileFacts(fixtureDir);
    const isolation = await 격리증명({ root: homeDir, fixtureDir, stateDir });
    if (!isolation.ok) throw Object.assign(new Error('isolation failed'), { code: 'ISOLATION_FAILED' });
    const beforeProtected = await snapshotPaths([realProtected]);
    const boundary = { stage: 'provider_boundary', runId, cell, claim: { runId: claim.runId,
      attemptId: claim.attemptId }, qualification: { ok: qualification.ok, artifact: qualificationDoc.artifact },
      source, isolation, fixture };
    await hooks.beforeProvider?.(boundary);
    if (hooks.stopBeforeProvider === true) {
      await finishRun(claim, { status: 'HARNESS_INVALID', invalidReason: 'evidence_incomplete' }); finished = true;
      return { ok: false, status: 'HARNESS_INVALID', invalidReason: 'TEST_PRE_PROVIDER_REACHED',
        providerCalls: 0, reached: boundary };
    }
    const credential = (hooks.loadOpenAiCredential ?? loadOpenAiCredential)(homedir());
    const secrets = [credential.key];
    const providerEvents = [];
    const recordingFetch = createRecordingFetch({ fetchImpl: hooks.fetchImpl ?? globalThis.fetch, secretValues: secrets,
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
    const afterFiles = await treeFileFacts(fixtureDir);
    const afterProtected = await snapshotPaths([realProtected]);
    const afterSources = await snapshotPaths(sourcePaths);
    const protectedChanged = changedPaths(beforeProtected, afterProtected);
    const sourceChanged = changedPaths(beforeSources, afterSources);
    const machine = scoreF65Cell({ root: fixtureDir, scenario, surfaceTurn: { response: turn.json },
      session: persisted, workEvents, beforeFiles, afterFiles, sourceChanged });
    const raw = { execution: { batchRunId, runId, cell, source, configSha256: definition.sha256,
      fixture, qualificationManifest: resolve(qualificationManifest), qualificationStatus: qualificationDoc.status,
      credentialIdentity: credential.identity }, frozen: { userUtterance: scenario.userUtterance,
      resultConditions: scenario.resultConditions, forbiddenOutcomes: scenario.forbiddenOutcomes },
      diagnosticReality: { axes: { W: cell.W, P: cell.P, O: cell.O }, worksetRef,
        rootPath: cell.P ? await realpath(fixtureDir) : null, listReceipt }, isolation,
      providerEvents, providerMeter: providerMeter(providerEvents,
        definition.document.measurement.expectedUpperBoundsForMeteringOnly),
      firstRealitySnapshot: seenContexts[0] ?? null, surfaceTurn: turn.json,
      surfaceSession, persistedSession: persisted, workEvents, artifactFiles: { before: beforeFiles, after: afterFiles },
      pathSnapshots: { protected: { before: beforeProtected, after: afterProtected, changed: protectedChanged },
        sources: { before: beforeSources, after: afterSources, changed: sourceChanged } } };
    assertNoSecretExposure(raw, secrets);
    const rawPath = join(rawDir, 'cell.json'); await exclusiveJson(rawPath, raw);
    const manifest = { schemaVersion: F65_MATRIX_SCHEMA_VERSION, kind: 'f65-workset-counterfactual-cell',
      runId, attemptId: claim.attemptId, status: protectedChanged.length ? 'HARNESS_INVALID' : 'RECORDED',
      invalidReason: protectedChanged.length ? 'protected_state_changed' : null,
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

async function defaultSpawnCell(childArgv) {
  const parsed = parseF65CliArgs(childArgv, { child: true });
  const argv = [fileURLToPath(import.meta.url), '--child', ...childArgv];
  try {
    const result = await execFileAsync(process.execPath, argv, { cwd: parsed.sourceRoot, env: process.env,
      maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });
    return parseChild(result.stdout, result.stderr);
  } catch (error) {
    try { return parseChild(error.stdout ?? '', error.stderr ?? ''); }
    catch (parseError) {
      return { ok: false, status: 'HARNESS_INVALID', invalidReason: 'child_protocol_invalid',
        diagnostic: String(parseError.message).slice(0, 500), exitCode: error?.code ?? null };
    }
  }
}

export async function runF65ChildFromArgv(argv, hooks = {}) {
  return runF65MatrixCell(parseF65CliArgs(argv, { child: true }), hooks);
}

export async function runF65Matrix(options, { spawn = defaultSpawnCell } = {}) {
  const definition = await loadF65MatrixDefinition(options.configFile);
  const cells = enumerateF65Cells(definition.document);
  if (cells.length !== 24 || new Set(cells.map((cell) => cell.cellId)).size !== 24) throw new Error('matrix is not 24 unique cells');
  const results = [];
  let stoppedAtCell = null;
  for (const cell of cells) { // serial by frozen policy; one child and no rerun per cell
    const childArgv = serializeF65CliOptions({ ...options, cellId: cell.cellId }, { child: true });
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await spawn(childArgv);
    } catch (error) {
      result = { ok: false, status: 'HARNESS_INVALID', invalidReason: 'child_spawn_failed',
        diagnostic: String(error?.message ?? error).slice(0, 500) };
    }
    results.push({ cellId: cell.cellId, childArgv, ...result });
    if (result?.status !== 'RECORDED') { stoppedAtCell = cell.cellId; break; }
  }
  const batch = { schemaVersion: F65_MATRIX_SCHEMA_VERSION, kind: 'f65-workset-counterfactual-batch',
    batchRunId: options.batchRunId, status: results.length === cells.length
      && results.every((row) => row.status === 'RECORDED') ? 'RECORDED' : 'HARNESS_INVALID',
    invalidReason: stoppedAtCell ? results.at(-1)?.invalidReason ?? 'child_failed' : null,
    stoppedAtCell, notRunCellIds: stoppedAtCell ? cells.slice(results.length).map((cell) => cell.cellId) : [],
    configSha256: definition.sha256, cells: results, semantic: 'PM_UNJUDGED' };
  const path = join(resolve(options.evidenceDir), encodeURIComponent(options.batchRunId), 'batch-manifest.json');
  await exclusiveJson(path, batch); return { ok: batch.status === 'RECORDED', status: batch.status, manifestPath: path };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  try {
    const child = process.argv.includes('--child');
    const argv = process.argv.slice(2).filter((value) => value !== '--child');
    const options = parseF65CliArgs(argv, { child });
    const result = child ? await runF65MatrixCell(options) : await runF65Matrix(options);
    console.log(JSON.stringify(result)); process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error?.code ?? 'F65_RUNNER_FAILED', error: String(error?.message ?? error) }));
    process.exit(2);
  }
}
