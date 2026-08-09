// 생활모의시험 예비 7 실행기. 제품 답을 채점하지 않고, 실제 제품 경로와 증거 계보만 고정한다.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import {
  lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startLiveServer } from '../../src/surface/server.js';
import { MODEL_CONTROL_SCHEMAS } from '../../src/kernel/l2-plan/model-control.js';
import { actualCallFacts, MODEL_PROVIDERS, wireToolName } from '../../src/runtime/model-provider.js';
import { 격리증명 } from './prove-isolation.mjs';
import {
  artifactIdentity, assertNoSecretExposure, changedPaths, claimRun, digest, finishRun,
  snapshotPaths, verifyQualificationEvidence,
} from './harness-qualification.mjs';
import { 저장된연결 } from '../s1/run.mjs';

export const LIVING_SIM_SCHEMA_VERSION = 1;
export const FROZEN_PILOT_SHA256 = '873fb72de05f1d1143d569a9eeab34e99409d28466202aa434b6dd984df441f0';
const EXPECTED_SCENARIOS = Object.freeze([
  'L1-settlement-files', 'L2-customer-policy', 'L3-policy-research', 'L4-content-document',
  'L5-admin-preparation', 'L6-schedule-automation', 'L7-pc-mixed-work',
]);
const PROVIDER_ORIGIN = 'https://api.openai.com';
const MODEL_ID = 'gpt-5.1';
export const LIVE_SERVER_CONTROL_IDS = Object.freeze(['skill.propose', 'automation.propose', 'agent.propose', 'work.state']);
const EXTERNAL_EFFECT_HANDS = new Set(['mail.send', 'slack.post', 'telegram.send', 'browser.act', 'desktop.act']);
const MACHINE_CONDITIONS = new Set(['outputFile', 'sourceHashesUnchanged', 'outputReadBack']);
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

function redact(value, secretValues = []) {
  const secrets = secretValues.map(String).filter((item) => item.length >= 4);
  const visit = (item, key = '') => {
    if (/^(?:authorization|proxy-authorization|api[-_]?key|secret|client_secret|cookie|set-cookie|token|access_token|refresh_token|credential)$/i.test(key)) {
      return '[REDACTED]';
    }
    if (typeof item === 'string') {
      let out = item;
      for (const secret of secrets) out = out.replaceAll(secret, '[REDACTED]');
      return out;
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry));
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).map(([name, entry]) => [name, visit(entry, name)]));
  };
  return visit(value);
}

function safeRelativePath(root, name) {
  if (typeof name !== 'string' || !name.trim() || isAbsolute(name)) throw new Error('안전한 상대경로가 아니다');
  const normalized = name.replaceAll('\\', '/');
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('안전한 상대경로가 아니다');
  }
  const target = resolve(root, normalized);
  const rel = relative(resolve(root), target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('안전한 상대경로가 아니다');
  return target;
}

function pathContains(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** 긴 macOS TMPDIR 토큰이 제품의 파일 대상 신분을 민감값처럼 가리지 않는 짧은 격리 방. */
export async function createLivingSimRoom() {
  const room = await realpath(await mkdtemp('/tmp/t5-ls-'));
  const ownerHome = await realpath(homedir());
  if (pathContains(ownerHome, room) || pathContains(room, ownerHome)) {
    await rm(room, { recursive: true, force: true });
    throw new Error('격리 방과 실제 홈이 겹친다');
  }
  return room;
}

export async function loadPilotDefinition(path) {
  const bytes = await readFile(resolve(path));
  const sha256 = digest(bytes);
  const document = JSON.parse(bytes.toString('utf8'));
  const ids = (document.scenarios ?? []).map((scenario) => scenario.id);
  const invalid = document.schemaVersion !== 1 || document.status !== 'FROZEN_BEFORE_RUN'
    || document.model?.provider !== 'openai' || document.model?.modelId !== MODEL_ID
    || document.model?.baseHost !== 'api.openai.com' || document.model?.maxOutputTokens !== 8192
    || digest(ids) !== digest(EXPECTED_SCENARIOS)
    || document.scenarios.some((scenario) => !Array.isArray(scenario.requiredHands) || 'allowedHands' in scenario)
    || document.runPolicy?.oneRunPerScenario !== true || document.runPolicy?.separateProcessPerScenario !== true
    || document.runPolicy?.parallel !== false;
  if (invalid) throw Object.assign(new Error('동결 생활모의시험 계약이 아니다'), { code: 'PILOT_DEFINITION_INVALID' });
  if (sha256 !== FROZEN_PILOT_SHA256) {
    throw Object.assign(new Error('동결 생활모의시험 바이트가 바뀌었다'), { code: 'PILOT_DEFINITION_CHANGED', sha256 });
  }
  return { path: resolve(path), sha256, document };
}

export function renderScenarioTurns(scenario, { webBase = null } = {}) {
  return (scenario.turns ?? []).map((entry, entryIndex) => {
    if (typeof entry === 'string') {
      const usesWebBase = entry.includes('{{WEB_BASE}}');
      if (usesWebBase && !webBase) throw new Error('L3 WEB_BASE 실물 신분이 없다');
      const rendered = usesWebBase ? entry.replaceAll('{{WEB_BASE}}', webBase) : entry;
      if (rendered.includes('{{WEB_BASE}}')) throw new Error('WEB_BASE가 덜 렌더됐다');
      return {
        entryIndex, inputKind: 'user_text', frozen: entry, rendered,
        ...(usesWebBase ? { baseIdentity: webBase } : {}),
      };
    }
    if (entry?.action === 'approve_current_if_present') {
      return { entryIndex, inputKind: 'action', action: entry.action, frozen: stable(entry) };
    }
    throw new Error(`알 수 없는 동결 턴: ${entryIndex}`);
  });
}

export async function materializeFixture(root, fixture = {}) {
  const rows = [];
  for (const [name, content] of Object.entries(fixture)) {
    const path = safeRelativePath(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, String(content), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    rows.push({ name, path, sha256: digest(await readFile(path)) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export function createRecordingFetch({ fetchImpl = globalThis.fetch, record, secretValues = [] }) {
  if (typeof record !== 'function') throw new TypeError('provider record 함수가 필요하다');
  return async function recordingFetch(url, init = {}) {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const bodyBytes = Buffer.from(typeof init.body === 'string' ? init.body : init.body ?? '');
    const requestBodySha256 = digest(bodyBytes);
    let requestBody = null;
    try { requestBody = JSON.parse(bodyBytes.toString('utf8')); } catch { requestBody = { unreadableBodySha256: requestBodySha256 }; }
    let response;
    try { response = await fetchImpl(url, init); }
    catch (error) {
      await record(redact({
        type: 'provider_call', startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
        endpointOrigin: new URL(String(url)).origin, requestBodySha256,
        forwardedBodySha256: digest(bodyBytes), requestBody, networkError: String(error?.message ?? error),
      }, secretValues));
      throw error;
    }
    let json = null;
    try { json = await response.clone().json(); } catch { /* 비JSON 응답도 상태와 해시로 남긴다 */ }
    const facts = actualCallFacts({
      url, bodyText: bodyBytes.toString('utf8'), json, spec: MODEL_PROVIDERS.openai,
    });
    const event = redact({
      type: 'provider_call', startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      method: init.method ?? 'GET', status: response.status,
      requestBodySha256, forwardedBodySha256: digest(bodyBytes), requestBody,
      response: json, ...facts,
      cost: json?.cost ?? json?.usage?.cost ?? null,
      costSource: json?.cost != null || json?.usage?.cost != null ? 'provider_response' : 'not_reported',
    }, secretValues);
    assertNoSecretExposure(event, secretValues);
    await record(event);
    return response;
  };
}

/** 오너의 기존 모델 연결을 읽되 자격 값은 호출자 메모리 밖으로 복제하지 않는다. */
export function loadOpenAiCredential(home = homedir()) {
  let connection;
  try { connection = 저장된연결(home); } catch { connection = null; }
  const baseUrl = String(connection?.상류 || 'https://api.openai.com/v1').replace(/\/$/, '');
  let origin = null;
  try { origin = new URL(baseUrl).origin; } catch { /* 아래에서 unavailable */ }
  if (!connection?.자격 || connection.provider !== 'openai' || connection.modelId !== MODEL_ID
    || origin !== PROVIDER_ORIGIN || baseUrl !== 'https://api.openai.com/v1') {
    throw Object.assign(new Error('저장된 openai/gpt-5.1 연결 신분이 동결값과 다르다'), {
      code: 'HARNESS_UNAVAILABLE', invalidReason: 'evidence_incomplete',
    });
  }
  return {
    key: connection.자격,
    identity: { source: 'saved-model-connection', provider: 'openai', configuredModelId: MODEL_ID, baseUrl, baseOrigin: origin },
  };
}

function eventOf(events, type) { return events.find((event) => event?.type === type); }
function same(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return digest(a) === digest(b);
}

/** 답 품질이 아니라 manifest 주장과 raw 실물이 같은지 판정한다. */
export function auditScenarioRecord({ manifest, scenario, events }) {
  const failures = [];
  const execution = eventOf(events, 'execution');
  const runtime = eventOf(events, 'runtime_reality');
  const session = eventOf(events, 'surface_session');
  const turns = events.filter((event) => event?.type === 'surface_turn');
  const calls = events.filter((event) => event?.type === 'provider_call'
    && String(event.endpointOrigin ?? '') === PROVIDER_ORIGIN && event.requestModelId === MODEL_ID);
  const final = eventOf(events, 'final_state');
  const paths = eventOf(events, 'path_snapshots');
  const isolation = eventOf(events, 'isolation_proof');
  if (manifest?.schemaVersion !== 1 || manifest?.kind !== 'living-sim-pilot-scenario'
    || manifest?.status !== 'RECORDED') failures.push('manifest_status');
  if (manifest?.source?.dirty !== false || execution?.source?.dirty !== false) failures.push('source_dirty');
  if (!same(manifest?.source, execution?.source)
    || manifest?.scenarioFile?.sha256 !== execution?.scenarioFileSha256
    || manifest?.scenarioDigest !== execution?.scenarioDigest
    || (manifest?.qualification && !same(manifest.qualification, execution?.qualification))
    || (manifest?.credentialIdentity && !same(manifest.credentialIdentity, execution?.credentialIdentity))
    || (manifest?.runId && execution?.runId && manifest.runId !== execution.runId)
    || (manifest?.attemptId && execution?.attemptId && manifest.attemptId !== execution.attemptId)) failures.push('execution_binding');
  if (!runtime || !same(manifest?.runtime?.requiredHands, runtime?.requiredHands)
    || !same(manifest?.runtime?.usableToolIds, runtime?.usableToolIds)
    || !same(manifest?.runtime?.exposedToolIds, runtime?.exposedToolIds)
    || !same(manifest?.runtime?.executableToolIds, runtime?.executableToolIds)
    || !same(manifest?.runtime?.controlToolIds, runtime?.controlToolIds)
    || !same(manifest?.runtime?.modelConfiguration, runtime?.modelConfiguration)
    || !same(manifest?.runtime?.externalEffectToolsUsable, runtime?.externalEffectToolsUsable)
    || manifest?.runtime?.providerRequestMutation !== runtime?.providerRequestMutation
    || (runtime?.unavailableRequiredHands ?? []).length) failures.push('runtime_binding');
  if (!session?.sessionId || turns.length !== (scenario?.turns ?? []).length
    || turns.some((turn, index) => turn.entryIndex !== index || turn.sessionId !== session.sessionId)) {
    failures.push('product_turns');
  }
  const surfaceSessionId = manifest?.surface?.sessionId;
  if (!surfaceSessionId || surfaceSessionId !== session?.sessionId || final?.sessionId !== surfaceSessionId
    || turns.some((turn) => turn.sessionId !== surfaceSessionId)
    || manifest?.surface?.entryCount !== turns.length) failures.push('session_binding');
  if (!calls.length || calls.some((call) => !String(call.responseModelId ?? '').trim()
    || call.requestBodySha256 !== call.forwardedBodySha256)) failures.push('provider_identity');
  if (manifest?.provider?.provider !== 'openai' || manifest?.provider?.configuredModelId !== MODEL_ID
    || manifest?.provider?.baseOrigin !== PROVIDER_ORIGIN || manifest?.provider?.observedCalls !== calls.length) {
    failures.push('provider_binding');
  }
  if (manifest?.provider?.settings && !same(providerSummary(events), manifest.provider)) failures.push('provider_settings_binding');
  if (manifest?.isolation && (!isolation || !same(manifest.isolation, isolation.proof))) failures.push('isolation_binding');
  if (manifest?.evaluation?.machineConditions?.outputFile?.status === 'PASS') {
    const output = final?.output;
    if (!output?.exists || !/^[0-9a-f]{64}$/.test(output.sha256 ?? '')
      || output.sha256 !== output.readbackSha256) failures.push('output_binding');
  }
  if ((paths?.protectedChanged ?? []).length || (manifest?.protectedState?.changed ?? []).length) {
    failures.push('protected_state_changed');
  }
  const expectedProtectedPath = resolve(homedir(), '.local', 'state', 'gpao-t5');
  if (!same(manifest?.protectedState?.paths, [expectedProtectedPath])
    || !same(paths?.protected?.paths, [expectedProtectedPath])) failures.push('protected_path_identity');
  if (manifest?.protectedState && paths) {
    if (manifest.protectedState.beforeSnapshotDigest !== digest(paths.protected?.before ?? [])
      || manifest.protectedState.afterSnapshotDigest !== digest(paths.protected?.after ?? [])
      || !same(manifest.protectedState.changed, paths.protectedChanged ?? [])) failures.push('protected_snapshot_binding');
  }
  if (manifest?.fixtureState && paths) {
    if (manifest.fixtureState.beforeSnapshotDigest !== digest(paths.sources?.before ?? [])
      || manifest.fixtureState.afterSnapshotDigest !== digest(paths.sources?.after ?? [])
      || !same(manifest.fixtureState.changed, paths.sourceChanged ?? [])
      || !same(manifest.fixtureState.sourcePaths, paths.sources?.paths)) failures.push('fixture_snapshot_binding');
  }
  const ledgerReadBack = final?.output?.exists
    ? outputReadbackEvidence(final?.ledgerEntries, final.output.absolutePath) : false;
  if (final?.outputReadBack !== ledgerReadBack) failures.push('output_readback_binding');
  const recalculatedEvaluation = evaluateMachineConditions(scenario ?? {}, {
    output: final?.output ?? null,
    sourceChanged: paths?.sourceChanged ?? [],
    outputReadBack: ledgerReadBack,
  });
  if (!same(manifest?.evaluation, recalculatedEvaluation)) failures.push('evaluation_binding');
  if ((final?.runnerMutations ?? []).some((path) => /^\/automation\/(?:pause|resume|manage)/.test(path))) {
    failures.push('runner_ghost_action');
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

async function readHistoryEvents(historyDir, runId) {
  const runDir = join(resolve(historyDir), 'runs', digest(runId));
  const names = (await readdir(runDir).catch(() => [])).filter((name) => /^\d{6}-.+\.json$/.test(name)).sort();
  const events = [];
  for (const name of names) events.push(JSON.parse(await readFile(join(runDir, name), 'utf8')));
  return events;
}

function safeRawPath(manifestPath, name) {
  if (typeof name !== 'string' || !name || name !== basename(name) || name.includes('..')) return null;
  const root = resolve(dirname(manifestPath), 'raw');
  const target = resolve(root, name);
  return target.startsWith(`${root}${sep}`) ? target : null;
}

async function rawEvidenceSetMatches(manifestPath, rawEvidence) {
  const root = resolve(dirname(manifestPath), 'raw');
  const actual = await readdir(root).catch(() => null);
  if (!actual) return false;
  const actualJson = actual.filter((name) => name.endsWith('.json')).sort();
  const claimed = (rawEvidence ?? []).map((item) => item?.name).filter((name) => typeof name === 'string').sort();
  return claimed.length === (rawEvidence ?? []).length
    && new Set(claimed).size === claimed.length
    && same(actualJson, claimed);
}

export async function verifyLivingSimScenarioEvidence(manifestPath, {
  historyDir, scenarioFile, secretValues = [], verifyQualification = verifyQualificationEvidence,
} = {}) {
  const failures = [];
  let manifest;
  try { manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')); }
  catch { return { ok: false, failures: ['manifest_unreadable'] }; }
  if (!await rawEvidenceSetMatches(manifestPath, manifest.rawEvidence)) failures.push('raw_evidence_set');
  const events = [];
  for (const item of manifest.rawEvidence ?? []) {
    const path = safeRawPath(manifestPath, item?.name);
    if (!path) { failures.push('raw_path_escape'); continue; }
    let bytes;
    try { bytes = await readFile(path); } catch { failures.push('raw_missing'); continue; }
    if (digest(bytes) !== item.sha256) failures.push('raw_hash_mismatch');
    try { events.push(JSON.parse(bytes.toString('utf8'))); } catch { failures.push('raw_unreadable'); }
    try { assertNoSecretExposure(bytes.toString('utf8'), secretValues); } catch { failures.push('secret_exposed'); }
  }
  if (!(manifest.rawEvidence ?? []).length) failures.push('raw_evidence_missing');
  let pilot; let scenario;
  try {
    pilot = await loadPilotDefinition(scenarioFile);
    scenario = pilot.document.scenarios.find((entry) => entry.id === manifest.scenarioId);
  } catch { failures.push('scenario_file_invalid'); }
  if (!scenario || manifest.scenarioFile?.sha256 !== pilot?.sha256
    || manifest.scenarioDigest !== digest(scenario)) failures.push('scenario_binding');
  failures.push(...auditScenarioRecord({ manifest, scenario, events }).failures);
  if (manifest.qualification?.manifestPath) {
    const qualification = await verifyQualification(manifest.qualification.manifestPath, {
      historyDir: manifest.qualification.historyDir,
    }).catch(() => ({ ok: false }));
    if (!qualification.ok) failures.push('qualification_invalid');
    const qHash = await readFile(manifest.qualification.manifestPath).then(digest).catch(() => null);
    if (qHash !== manifest.qualification.sha256) failures.push('qualification_binding');
  } else failures.push('qualification_missing');
  const history = await readHistoryEvents(historyDir, manifest.runId).catch(() => []);
  const started = history.filter((event) => event.type === 'started' && event.attemptId === manifest.attemptId);
  const finished = history.filter((event) => event.type === 'finished' && event.attemptId === manifest.attemptId);
  const manifestHash = await readFile(resolve(manifestPath)).then(digest).catch(() => null);
  if (started.length !== 1 || started[0]?.executionKind !== 'headless_isolated') failures.push('history_started');
  if (finished.length !== 1 || finished[0]?.status !== 'RECORDED' || finished[0]?.invalidReason !== null
    || finished[0]?.manifestHash !== manifestHash) failures.push('history_finished');
  return { ok: failures.length === 0, failures: [...new Set(failures)], manifest, events };
}

function snapshotDigestRows(snapshot) {
  return snapshot.map(({ path, digest: sha256 }) => ({ path, digest: sha256 }));
}

async function makeEvidenceWriter(rawDir, secretValues) {
  await mkdir(rawDir, { recursive: true });
  let seq = 0;
  const items = [];
  return {
    async append(event) {
      const safe = redact(event, secretValues);
      assertNoSecretExposure(safe, secretValues);
      seq += 1;
      const name = `${String(seq).padStart(6, '0')}-${String(event.type ?? 'event').replace(/[^a-z0-9_-]/gi, '_')}.json`;
      const path = join(rawDir, name);
      await exclusiveJson(path, safe);
      items.push({ name, sha256: digest(await readFile(path)) });
      return safe;
    },
    items: () => structuredClone(items),
  };
}

async function closeServer(server) {
  if (server?.listening) await new Promise((done) => server.close(done));
}

async function startWebFixture(webFixture = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: url.pathname, recordedAt: new Date().toISOString() });
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }); response.end('method not allowed'); return;
    }
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); response.end('User-agent: *\nAllow: /\n'); return;
    }
    if (!(url.pathname in webFixture)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(String(webFixture[url.pathname]));
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    server, baseUrl, requests,
    identity: {
      origin: baseUrl, host: '127.0.0.1', protocol: 'http:',
      fixtures: Object.entries(webFixture).sort(([a], [b]) => a.localeCompare(b))
        .map(([path, body]) => ({ path, sha256: digest(String(body)) })),
    },
  };
}

function isolatedProcessEnv({ homeDir, stateDir, fixtureDir, apiKey }) {
  return {
    PATH: process.env.PATH, LANG: process.env.LANG ?? 'ko_KR.UTF-8',
    TMPDIR: process.env.TMPDIR ?? tmpdir(), SHELL: process.env.SHELL,
    HOME: homeDir, GPAO_T5_HOME: homeDir, GPAO_T5_DATA_DIR: stateDir, GPAO_T5_FILE_ROOTS: fixtureDir,
    GPAO_T5_TCELL: 'off', GPAO_T5_NO_AUTO_SCREEN_BIN: '1', GPAO_T5_CUA_BIN: '',
    GPAO_T5_DESKTOP_BIN: '', GPAO_T5_BROWSER_PATH: '', GPAO_T5_BROWSER_PROFILE: '0',
    GPAO_T5_MODEL_PROVIDER: 'openai', OPENAI_API_KEY: apiKey,
    GPAO_T5_MODEL_BASE_URL: 'https://api.openai.com/v1', GPAO_T5_MODEL_ID: MODEL_ID,
    GPAO_T5_MODEL_MAX_TOKENS: '8192', GPAO_T5_MODEL_TIMEOUT_MS: '0',
    GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0', GPAO_T5_MODEL_STALL_MS: '0',
  };
}

function modelConfigurationFromEnv(env) {
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  let baseOrigin = null;
  try { baseOrigin = new URL(env.GPAO_T5_MODEL_BASE_URL).origin; } catch { /* 판정기가 아래에서 거부한다 */ }
  return {
    provider: env.GPAO_T5_MODEL_PROVIDER ?? null,
    configuredModelId: env.GPAO_T5_MODEL_ID ?? null,
    baseUrl: env.GPAO_T5_MODEL_BASE_URL ?? null,
    baseOrigin,
    settings: {
      maxOutputTokens: numberOrNull(env.GPAO_T5_MODEL_MAX_TOKENS),
      totalTimeoutMs: numberOrNull(env.GPAO_T5_MODEL_TIMEOUT_MS),
      httpTimeoutMs: numberOrNull(env.GPAO_T5_MODEL_HTTP_TIMEOUT_MS),
      stallMs: numberOrNull(env.GPAO_T5_MODEL_STALL_MS),
      temperature: null,
    },
  };
}

async function readJson(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function readSurface(base, cookie, path) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  const value = await response.json();
  if (!response.ok) throw new Error(`surface GET ${path} ${response.status}`);
  return value;
}

async function postSurface(base, cookie, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`surface POST ${path} ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

function outputReadbackEvidence(ledgerEntries, outputPath) {
  const wanted = resolve(outputPath);
  return (ledgerEntries ?? []).some((entry) => {
    if (entry?.actualCall?.tool !== 'local.file') return false;
    if (!['read', 'open'].includes(String(entry.actualCall?.args?.action ?? ''))) return false;
    try { return resolve(String(entry.actualCall.args.path ?? '')) === wanted; } catch { return false; }
  });
}

function evaluateMachineConditions(scenario, { output, sourceChanged, outputReadBack }) {
  const machineConditions = {};
  for (const [name, expected] of Object.entries(scenario.resultConditions ?? {})) {
    if (!MACHINE_CONDITIONS.has(name)) continue;
    if (name === 'outputFile') {
      machineConditions[name] = {
        status: output?.exists ? 'PASS' : 'FAIL', expected, observed: output?.exists ? output.path : null,
      };
    } else if (name === 'sourceHashesUnchanged') {
      machineConditions[name] = { status: expected === true && sourceChanged.length === 0 ? 'PASS' : 'FAIL', expected, observed: sourceChanged };
    } else if (name === 'outputReadBack') {
      machineConditions[name] = { status: expected === true && outputReadBack ? 'PASS' : 'FAIL', expected, observed: outputReadBack };
    }
  }
  const semanticConditions = Object.entries(scenario.resultConditions ?? {})
    .filter(([name]) => !MACHINE_CONDITIONS.has(name))
    .map(([name, expected]) => ({ name, expected, status: 'PM_UNJUDGED' }));
  return {
    machineConditions, semanticConditions,
    safetyConditions: (scenario.safetyConditions ?? []).map((condition) => ({ condition, status: 'PM_UNJUDGED' })),
    forbiddenOutcomes: (scenario.forbiddenOutcomes ?? []).map((outcome) => ({ outcome, status: 'PM_UNJUDGED' })),
    overall: 'PM_UNJUDGED',
  };
}

async function outputFact(fixtureDir, scenario) {
  const name = scenario.resultConditions?.outputFile;
  if (!name) return null;
  const path = safeRelativePath(fixtureDir, name);
  let bytes;
  try { bytes = await readFile(path); } catch { return { path: name, absolutePath: path, exists: false }; }
  const sha256 = digest(bytes);
  return { path: name, absolutePath: path, exists: true, sha256, readbackSha256: sha256, text: bytes.toString('utf8') };
}

function qualificationBinding(path, historyDir, manifest, bytes) {
  return {
    manifestPath: resolve(path), historyDir: resolve(historyDir), sha256: digest(bytes),
    runId: manifest.runId, attemptId: manifest.attemptId,
  };
}

function providerSummary(events) {
  const calls = events.filter((event) => event.type === 'provider_call' && event.requestModelId === MODEL_ID);
  const configured = eventOf(events, 'runtime_reality')?.modelConfiguration ?? {
    provider: 'openai', configuredModelId: MODEL_ID, baseOrigin: PROVIDER_ORIGIN,
    settings: { maxOutputTokens: 8192, totalTimeoutMs: 0, httpTimeoutMs: 0, stallMs: 0, temperature: null },
  };
  const usage = calls.map((call) => call.usage).filter(Boolean);
  const sum = (key) => usage.reduce((total, row) => total + (Number(row?.[key]) || 0), 0);
  const reportedCosts = calls.map((call) => call.cost).filter((value) => typeof value === 'number');
  return {
    provider: configured.provider, configuredModelId: configured.configuredModelId, baseOrigin: configured.baseOrigin,
    settings: {
      configured: configured.settings,
      observed: calls.map((call) => ({
        requestModelId: call.requestModelId, responseModelId: call.responseModelId,
        maxCompletionTokens: call.requestBody?.max_completion_tokens ?? null,
        maxTokens: call.requestBody?.max_tokens ?? null, temperature: call.requestBody?.temperature ?? null,
        stream: call.requestBody?.stream === true, finishReason: call.finishReason ?? null,
      })),
    },
    observedCalls: calls.length,
    usage: {
      callsWithUsage: usage.length, promptTokens: sum('prompt_tokens'), completionTokens: sum('completion_tokens'),
      totalTokens: sum('total_tokens'), raw: usage,
    },
    cost: reportedCosts.length ? { value: reportedCosts.reduce((a, b) => a + b, 0), source: 'provider_response' }
      : { value: null, source: 'not_reported' },
  };
}

function scenarioEvidenceRoot(evidenceDir, runId, attemptId) {
  return join(resolve(evidenceDir), 'scenarios', digest(runId), attemptId);
}

/** 별도 child 한 개가 시나리오 하나를 실제 HTTP→세션→도구→원장 경로로 딱 한 번 돈다. */
export async function runLivingSimScenario(options) {
  const {
    batchRunId, scenarioId, scenarioFile, qualificationManifest, qualificationHistoryDir,
    evidenceDir, historyDir, sourceRoot,
  } = options;
  const runId = `${batchRunId}::${scenarioId}`;
  if (options.protectedPath) {
    throw Object.assign(new Error('생활모의시험은 실제 T5 상태 감시 경로를 바꿀 수 없다'), {
      code: 'PROTECTED_PATH_OVERRIDE_FORBIDDEN',
    });
  }
  const ownerHome = homedir();
  const realProtectedPath = resolve(ownerHome, '.local', 'state', 'gpao-t5');
  let room; let claim; let server; let web; let writer; let manifestPath; let finished = false;
  let previousHome; let homeChanged = false;
  const runnerMutations = [];
  try {
    // 자격·동결·clean source를 모두 대조하기 전에는 키도 서버도 모델도 열지 않는다.
    const qualification = await verifyQualificationEvidence(qualificationManifest, { historyDir: qualificationHistoryDir });
    if (!qualification.ok) throw Object.assign(new Error('qualification evidence invalid'), { code: 'QUALIFICATION_REQUIRED' });
    const qualificationBytes = await readFile(resolve(qualificationManifest));
    const qualificationDoc = JSON.parse(qualificationBytes.toString('utf8'));
    const pilot = await loadPilotDefinition(scenarioFile);
    const scenario = pilot.document.scenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) throw Object.assign(new Error('동결본에 시나리오가 없다'), { code: 'SCENARIO_NOT_FROZEN' });
    const source = await artifactIdentity({ sourceRoot });
    if (source.kind !== 'source' || source.dirty || !same(source, qualificationDoc.artifact)) {
      throw Object.assign(new Error('clean source가 qualification 산출물과 다르다'), { code: 'SOURCE_IDENTITY_MISMATCH' });
    }

    room = await createLivingSimRoom();
    const homeDir = join(room, 'home'); const stateDir = join(room, 'state'); const fixtureDir = join(room, 'fixture');
    await Promise.all([mkdir(homeDir), mkdir(stateDir), mkdir(fixtureDir)]);
    claim = await claimRun({ historyDir, runId, executionKind: 'headless_isolated', isolatedRoot: room });
    const attemptRoot = scenarioEvidenceRoot(evidenceDir, runId, claim.attemptId);
    const rawDir = join(attemptRoot, 'raw'); manifestPath = join(attemptRoot, 'manifest.json');
    const beforeProtected = await snapshotPaths([realProtectedPath]);
    const savedCredential = loadOpenAiCredential(ownerHome);
    const apiKey = savedCredential.key;
    const credentialIdentity = savedCredential.identity;
    const secrets = [apiKey];
    writer = await makeEvidenceWriter(rawDir, secrets);
    const qualificationRef = qualificationBinding(qualificationManifest, qualificationHistoryDir, qualificationDoc, qualificationBytes);
    await writer.append({
      type: 'execution', batchRunId, runId, attemptId: claim.attemptId, scenarioId,
      source, scenarioFileSha256: pilot.sha256, scenarioDigest: digest(scenario), qualification: qualificationRef,
      credentialIdentity,
      executionKind: 'headless_isolated', startedAt: new Date().toISOString(),
    });

    const fixtureFiles = await materializeFixture(fixtureDir, scenario.fixture ?? {});
    if (scenario.webFixture) web = await startWebFixture(scenario.webFixture);
    const renderedTurns = renderScenarioTurns(scenario, { webBase: web?.baseUrl ?? null });
    await writer.append({
      type: 'fixture_identity', files: fixtureFiles, web: web?.identity ?? null,
      frozenTurns: renderedTurns,
    });
    const sourcePaths = fixtureFiles.map((file) => file.path);
    const beforeSources = await snapshotPaths(sourcePaths);
    const isolation = await 격리증명({ root: homeDir, fixtureDir, stateDir });
    if (!isolation.ok) throw Object.assign(new Error('격리 증명이 실패했다'), { invalidReason: 'isolation_failed' });
    await writer.append({ type: 'isolation_proof', proof: isolation });
    previousHome = process.env.HOME; process.env.HOME = homeDir; homeChanged = true;
    const providerEvents = [];
    const recordingFetch = createRecordingFetch({
      fetchImpl: globalThis.fetch,
      secretValues: secrets,
      record: async (event) => { providerEvents.push(event); await writer.append(event); },
    });
    const processEnv = isolatedProcessEnv({ homeDir, stateDir, fixtureDir, apiKey });
    const modelConfiguration = modelConfigurationFromEnv(processEnv);
    server = await startLiveServer({ port: 0, processEnv, fetchImpl: recordingFetch, startScheduler: false });
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    const truth = await readSurface(base, cookie, '/connectors/truth');
    const executableTools = [...new Set(truth.modelSchema ?? [])].sort();
    const declaredControls = new Set(MODEL_CONTROL_SCHEMAS.map((schema) => schema.name));
    const controlTools = LIVE_SERVER_CONTROL_IDS.filter((name) => declaredControls.has(name));
    const usableToolIds = [...new Set([...executableTools, ...controlTools])].sort();
    const exposedToolIds = [...usableToolIds];
    const unavailableRequiredHands = scenario.requiredHands.filter((id) => !usableToolIds.includes(id));
    const externalEffectToolsUsable = usableToolIds.filter((id) => EXTERNAL_EFFECT_HANDS.has(id));
    const preflightProviderCalls = providerEvents.filter((event) => event.requestModelId === MODEL_ID).length;
    const runtimeReality = {
      type: 'runtime_reality', requiredHands: scenario.requiredHands, usableToolIds, exposedToolIds,
      executableToolIds: executableTools, controlToolIds: controlTools,
      controlContract: 'startLiveServer ctx.modelControls',
      modelConfiguration,
      unavailableRequiredHands, externalEffectToolsUsable, preflightProviderCalls,
      providerRequestMutation: false,
    };
    await writer.append(runtimeReality);
    if (controlTools.length !== LIVE_SERVER_CONTROL_IDS.length
      || unavailableRequiredHands.length || externalEffectToolsUsable.length || preflightProviderCalls) {
      throw Object.assign(new Error('required hand 또는 외부효과 격리 preflight가 성립하지 않았다'), {
        code: 'HARNESS_UNAVAILABLE', invalidReason: 'evidence_incomplete', runtimeReality,
      });
    }

    const session = await postSurface(base, cookie, '/sessions', {});
    await writer.append({ type: 'surface_session', endpoint: '/sessions', sessionId: session.id, response: session });
    let lastResult = null;
    for (const turn of renderedTurns) {
      if (turn.inputKind === 'user_text') {
        // eslint-disable-next-line no-await-in-loop
        const result = await postSurface(base, cookie, '/turn', { sessionId: session.id, text: turn.rendered });
        lastResult = result;
        // eslint-disable-next-line no-await-in-loop
        await writer.append({
          type: 'surface_turn', entryIndex: turn.entryIndex, inputKind: turn.inputKind,
          endpoint: '/turn', sessionId: session.id, frozenText: turn.frozen, renderedText: turn.rendered,
          baseIdentity: turn.baseIdentity ?? null, response: result,
        });
      } else {
        // 현재 카드의 pendingId만 쓴다. 카드가 없으면 어떤 후보도 지어내 승인하지 않는다.
        // eslint-disable-next-line no-await-in-loop
        const current = await readSurface(base, cookie, `/sessions/${encodeURIComponent(session.id)}`);
        const pendingId = typeof lastResult?.pendingId === 'string'
          && (current.activePendingIds ?? []).includes(lastResult.pendingId) ? lastResult.pendingId : null;
        let result = null;
        if (pendingId) {
          // eslint-disable-next-line no-await-in-loop
          result = await postSurface(base, cookie, '/turn', { sessionId: session.id, approve: pendingId });
          lastResult = result;
        }
        // eslint-disable-next-line no-await-in-loop
        await writer.append({
          type: 'surface_turn', entryIndex: turn.entryIndex, inputKind: turn.inputKind,
          endpoint: pendingId ? '/turn' : null, sessionId: session.id, action: turn.action,
          currentPendingId: pendingId, outcome: pendingId ? 'approved_current' : 'no_current_card', response: result,
        });
      }
    }
    const surfaceSession = await readSurface(base, cookie, `/sessions/${encodeURIComponent(session.id)}`);
    const automation = await readSurface(base, cookie, '/automation').catch((error) => ({ readError: String(error?.message ?? error) }));
    await closeServer(server); server = null;
    if (homeChanged) { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; homeChanged = false; }

    const persistedSession = await readJson(join(stateDir, `${session.id}.json`), {});
    const workEventsDoc = await readJson(join(stateDir, 'work-events.json'), {});
    const afterProtected = await snapshotPaths([realProtectedPath]);
    const afterSources = await snapshotPaths(sourcePaths);
    const protectedChanged = changedPaths(beforeProtected, afterProtected);
    const sourceChanged = changedPaths(beforeSources, afterSources);
    const output = await outputFact(fixtureDir, scenario);
    const readBack = output?.exists ? outputReadbackEvidence(persistedSession.ledgerEntries, output.absolutePath) : false;
    const finalState = await writer.append({
      type: 'final_state', sessionId: session.id, surfaceSession,
      transcript: persistedSession.transcript ?? [], ledgerEntries: persistedSession.ledgerEntries ?? [],
      workRef: persistedSession.workRef ?? null, workEvents: workEventsDoc.records ?? [], automation,
      output, outputReadBack: readBack, webRequests: web?.requests ?? [], runnerMutations,
    });
    await writer.append({
      type: 'path_snapshots',
      protected: { paths: [realProtectedPath], before: snapshotDigestRows(beforeProtected), after: snapshotDigestRows(afterProtected) },
      sources: { paths: sourcePaths, before: snapshotDigestRows(beforeSources), after: snapshotDigestRows(afterSources) },
      protectedChanged, sourceChanged,
    });
    const allEvents = [];
    for (const item of writer.items()) allEvents.push(JSON.parse(await readFile(join(rawDir, item.name), 'utf8')));
    const provider = providerSummary(allEvents);
    const observedWireTools = [...new Set(allEvents.filter((event) => event.type === 'provider_call')
      .flatMap((event) => (event.requestBody?.tools ?? []).map((tool) => tool.function?.name).filter(Boolean)))].sort();
    const wireMap = new Map(usableToolIds.map((id) => [wireToolName(id), id]));
    const observedToolIds = observedWireTools.map((name) => wireMap.get(name) ?? `unknown:${name}`);
    const runtime = { ...runtimeReality, observedProviderToolIds: observedToolIds };
    delete runtime.type;
    const evaluation = evaluateMachineConditions(scenario, { output, sourceChanged, outputReadBack: readBack });
    const manifest = {
      schemaVersion: LIVING_SIM_SCHEMA_VERSION, kind: 'living-sim-pilot-scenario',
      batchRunId, runId, attemptId: claim.attemptId, scenarioId, status: 'RECORDED', invalidReason: null,
      source, scenarioFile: { path: relative(resolve(sourceRoot), pilot.path), sha256: pilot.sha256 },
      scenarioDigest: digest(scenario), qualification: qualificationRef, credentialIdentity,
      runtime, provider, isolation,
      protectedState: {
        paths: [realProtectedPath], beforeSnapshotDigest: digest(snapshotDigestRows(beforeProtected)),
        afterSnapshotDigest: digest(snapshotDigestRows(afterProtected)), changed: protectedChanged,
      },
      fixtureState: {
        root: fixtureDir, sourcePaths, beforeSnapshotDigest: digest(snapshotDigestRows(beforeSources)),
        afterSnapshotDigest: digest(snapshotDigestRows(afterSources)), changed: sourceChanged,
      },
      surface: { sessionId: session.id, entryCount: renderedTurns.length }, evaluation,
      rawEvidence: writer.items(), startedAt: allEvents[0]?.startedAt ?? null, finishedAt: new Date().toISOString(),
    };
    assertNoSecretExposure(manifest, secrets);
    const audit = auditScenarioRecord({ manifest, scenario, events: allEvents });
    if (!audit.ok) throw Object.assign(new Error(`scenario evidence invalid: ${audit.failures.join(',')}`), {
      invalidReason: protectedChanged.length ? 'protected_state_changed' : 'manifest_invalid', audit,
    });
    await exclusiveJson(manifestPath, manifest);
    await finishRun(claim, { status: 'RECORDED', manifestHash: digest(await readFile(manifestPath)) }); finished = true;
    const verified = await verifyLivingSimScenarioEvidence(manifestPath, {
      historyDir, scenarioFile, secretValues: secrets,
    });
    if (!verified.ok) return { ok: false, status: 'EVIDENCE_INVALID', manifestPath, failures: verified.failures };
    return { ok: true, status: 'RECORDED', manifestPath, manifest };
  } catch (error) {
    if (!claim) throw error;
    const invalidReason = error?.invalidReason === 'protected_state_changed' ? 'protected_state_changed'
      : error?.invalidReason === 'isolation_failed' ? 'isolation_failed'
      : error?.invalidReason === 'secret_exposed' ? 'secret_exposed' : 'evidence_incomplete';
    const invalid = {
      schemaVersion: LIVING_SIM_SCHEMA_VERSION, kind: 'living-sim-pilot-scenario',
      batchRunId, runId, attemptId: claim.attemptId, scenarioId,
      status: 'HARNESS_INVALID', harnessState: error?.code === 'HARNESS_UNAVAILABLE' ? 'HARNESS_UNAVAILABLE' : 'HARNESS_INVALID',
      invalidReason, diagnostic: String(error?.message ?? error).slice(0, 500),
      rawEvidence: writer?.items?.() ?? [],
    };
    if (manifestPath) await exclusiveJson(manifestPath, invalid).catch(() => {});
    if (!finished) await finishRun(claim, {
      status: 'HARNESS_INVALID', invalidReason,
      manifestHash: manifestPath ? await readFile(manifestPath).then(digest).catch(() => null) : null,
    }).catch(() => {});
    return { ok: false, status: invalid.harnessState, invalidReason, manifestPath, manifest: invalid };
  } finally {
    await closeServer(server).catch(() => {});
    await closeServer(web?.server).catch(() => {});
    if (homeChanged) { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; }
    if (room) await rm(room, { recursive: true, force: true });
  }
}

async function defaultSpawnScenario(args) {
  const argv = [fileURLToPath(import.meta.url), '--child'];
  for (const [name, value] of Object.entries(args)) {
    if (value == null) continue;
    argv.push(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, String(value));
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, argv, {
      cwd: args.sourceRoot, env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    return parseChildProcessOutput(stdout, stderr);
  } catch (error) {
    // child의 HARNESS_INVALID/UNAVAILABLE은 exit 1이다. 그 기계 결과를 버리고 예외로 바꾸면
    // 부모 이력에는 어떤 시나리오가 왜 무효였는지 결합되지 않는다.
    return parseChildProcessOutput(error?.stdout, error?.stderr);
  }
}

export function parseChildProcessOutput(stdout = '', stderr = '') {
  for (const output of [stdout, stderr]) {
    const lines = String(output ?? '').trim().split('\n').filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed?.status === 'string') return parsed;
        if (parsed?.ok === false && parsed?.code) {
          return { ...parsed, status: 'HARNESS_INVALID', invalidReason: 'evidence_incomplete' };
        }
      } catch { /* 마지막 기계 JSON을 찾을 때까지 진단 줄을 건너뛴다 */ }
    }
  }
  throw new Error(`child result unreadable: ${String(stdout).slice(-1000)} ${String(stderr).slice(-1000)}`);
}

async function latestRecordedScenario(evidenceDir, runId, verifyOptions) {
  const root = join(resolve(evidenceDir), 'scenarios', digest(runId));
  const attempts = (await readdir(root).catch(() => [])).sort().reverse();
  for (const attemptId of attempts) {
    const path = join(root, attemptId, 'manifest.json');
    const manifest = await readJson(path);
    if (manifest?.status !== 'RECORDED') continue;
    // eslint-disable-next-line no-await-in-loop
    const verified = await verifyLivingSimScenarioEvidence(path, verifyOptions);
    if (verified.ok) return { ok: true, status: 'RECORDED', manifestPath: path, manifest };
  }
  return null;
}

function batchHistoryRunId(runId) { return `living-sim-batch::${runId}`; }

export async function verifyLivingSimBatchEvidence(manifestPath, {
  historyDir, scenarioFile, qualificationHistoryDir, sourceRoot,
} = {}) {
  const failures = [];
  const manifest = await readJson(resolve(manifestPath));
  if (!manifest) return { ok: false, failures: ['manifest_unreadable'] };
  let pilot;
  try { pilot = await loadPilotDefinition(scenarioFile); } catch { failures.push('scenario_file_invalid'); }
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'living-sim-pilot-batch'
    || manifest.status !== 'RECORDED') failures.push('batch_status');
  if (!same(manifest.scenarioIds, EXPECTED_SCENARIOS)
    || !same((manifest.scenarios ?? []).map((entry) => entry.id), EXPECTED_SCENARIOS)
    || (manifest.scenarios ?? []).length !== 7) failures.push('scenario_selection');
  if (manifest.scenarioFile?.sha256 !== pilot?.sha256 || manifest.source?.dirty !== false) failures.push('batch_identity');
  if (sourceRoot) {
    const current = await artifactIdentity({ sourceRoot }).catch(() => null);
    if (!same(current, manifest.source)) failures.push('source_identity_changed');
  }
  if (!await rawEvidenceSetMatches(manifestPath, manifest.rawEvidence)) failures.push('batch_raw_evidence_set');
  const rawEvents = [];
  for (const item of manifest.rawEvidence ?? []) {
    const rawPath = safeRawPath(manifestPath, item?.name);
    if (!rawPath) { failures.push('batch_raw_path'); continue; }
    // eslint-disable-next-line no-await-in-loop
    const bytes = await readFile(rawPath).catch(() => null);
    if (!bytes) { failures.push('batch_raw_missing'); continue; }
    if (digest(bytes) !== item.sha256) failures.push('batch_raw_hash');
    try { rawEvents.push(JSON.parse(bytes.toString('utf8'))); } catch { failures.push('batch_raw_unreadable'); }
  }
  const batchRaw = rawEvents.filter((event) => event?.type === 'batch_execution');
  const raw = batchRaw.length === 1 ? batchRaw[0] : null;
  if (!raw || raw.runId !== manifest.runId || !same(raw.source, manifest.source)
    || !same(raw.scenarioIds, manifest.scenarioIds) || raw.scenarioFileSha256 !== manifest.scenarioFile?.sha256
    || !same(raw.qualification, manifest.qualification)) failures.push('batch_raw_binding');
  const qualification = manifest.qualification?.manifestPath
    ? await verifyQualificationEvidence(manifest.qualification.manifestPath, {
      historyDir: qualificationHistoryDir ?? manifest.qualification.historyDir,
    }).catch(() => ({ ok: false })) : { ok: false };
  if (!qualification.ok) failures.push('qualification_invalid');
  const childManifestPaths = [];
  const childAttemptIds = [];
  for (const entry of manifest.scenarios ?? []) {
    // symlink로 같은 child를 다른 문자열처럼 쓰는 우회까지 같은 실물 경로로 접는다.
    // eslint-disable-next-line no-await-in-loop
    const childPath = await realpath(resolve(entry.manifestPath)).catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    const childBytes = childPath ? await readFile(childPath).catch(() => null) : null;
    // eslint-disable-next-line no-await-in-loop
    const verified = childPath
      ? await verifyLivingSimScenarioEvidence(childPath, { historyDir, scenarioFile })
      : { ok: false, manifest: null };
    if (!verified.ok || !childBytes) failures.push(`${entry.id}:scenario_evidence`);
    if (!childBytes || digest(childBytes) !== entry.sha256) failures.push(`${entry.id}:scenario_hash`);
    const child = verified.manifest;
    if (!child || entry.id !== child.scenarioId
      || child.batchRunId !== manifest.runId
      || child.runId !== `${manifest.runId}::${entry.id}`
      || !same(child.source, manifest.source)
      || child.scenarioFile?.sha256 !== manifest.scenarioFile?.sha256
      || !same(child.qualification, manifest.qualification)) failures.push(`${entry.id}:child_binding`);
    if (childPath) childManifestPaths.push(childPath);
    if (typeof child?.attemptId === 'string' && child.attemptId) childAttemptIds.push(child.attemptId);
    else failures.push(`${entry.id}:child_attempt`);
  }
  if (childManifestPaths.length !== 7 || new Set(childManifestPaths).size !== 7) {
    failures.push('child_manifest_paths_unique');
  }
  if (childAttemptIds.length !== 7 || new Set(childAttemptIds).size !== 7) {
    failures.push('child_attempt_ids_unique');
  }
  const history = await readHistoryEvents(historyDir, manifest.historyRunId).catch(() => []);
  const started = history.filter((event) => event.type === 'started' && event.attemptId === manifest.attemptId);
  const finished = history.filter((event) => event.type === 'finished' && event.attemptId === manifest.attemptId);
  const hash = await readFile(resolve(manifestPath)).then(digest).catch(() => null);
  if (started.length !== 1) failures.push('batch_history_started');
  if (finished.length !== 1 || finished[0]?.status !== 'RECORDED' || finished[0]?.manifestHash !== hash) {
    failures.push('batch_history_finished');
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)], manifest };
}

/** 자격을 먼저 대조하고, 7개 고정 목록을 별도 child로 직렬 실행한다. */
export async function runLivingSimPilot(options) {
  const {
    runId, scenarioFile, qualificationManifest, qualificationHistoryDir,
    evidenceDir, historyDir, sourceRoot, hooks = {},
  } = options;
  if (!runId || !scenarioFile || !qualificationManifest || !qualificationHistoryDir
    || !evidenceDir || !historyDir || !sourceRoot) throw new TypeError('생활모의시험 실행 인자가 부족하다');
  if (options.scenarioId || options.scenarioIds || options.select || options.only) {
    throw Object.assign(new Error('결과를 보고 시나리오를 골라 실행할 수 없다'), { code: 'SCENARIO_SELECTION_FORBIDDEN' });
  }
  if (options.protectedPath) {
    throw Object.assign(new Error('실제 T5 상태 감시 경로는 바꿀 수 없다'), { code: 'PROTECTED_PATH_OVERRIDE_FORBIDDEN' });
  }
  const pilot = await loadPilotDefinition(scenarioFile);
  const verifyQualification = hooks.verifyQualification ?? verifyQualificationEvidence;
  const qualified = await verifyQualification(qualificationManifest, { historyDir: qualificationHistoryDir });
  if (!qualified.ok) {
    throw Object.assign(new Error('qualification manifest+history 통과 전에는 모델 호출이 0이다'), {
      code: 'QUALIFICATION_REQUIRED', failures: qualified.failures,
    });
  }
  const qualificationBytes = await readFile(resolve(qualificationManifest));
  const qualificationDoc = JSON.parse(qualificationBytes.toString('utf8'));
  const source = hooks.artifactIdentity
    ? await hooks.artifactIdentity({ sourceRoot }) : await artifactIdentity({ sourceRoot });
  if (source.kind !== 'source' || source.dirty || !same(source, qualificationDoc.artifact)) {
    throw Object.assign(new Error('qualification과 같은 clean source만 실행할 수 있다'), { code: 'SOURCE_IDENTITY_MISMATCH' });
  }
  const historyRunId = batchHistoryRunId(runId);
  const claim = await claimRun({
    historyDir, runId: historyRunId, executionKind: 'headless_isolated', isolatedRoot: resolve(evidenceDir),
  });
  const batchRoot = join(resolve(evidenceDir), 'batches', digest(runId), claim.attemptId);
  const rawDir = join(batchRoot, 'raw'); const manifestPath = join(batchRoot, 'manifest.json');
  await mkdir(rawDir, { recursive: true });
  const qualification = qualificationBinding(
    qualificationManifest, qualificationHistoryDir, qualificationDoc, qualificationBytes,
  );
  const raw = {
    schemaVersion: 1, type: 'batch_execution', runId, historyRunId, attemptId: claim.attemptId,
    source, scenarioFileSha256: pilot.sha256, scenarioIds: EXPECTED_SCENARIOS, qualification,
    execution: { separateProcessPerScenario: true, parallel: false, resultBasedSelection: false },
    startedAt: new Date().toISOString(),
  };
  const rawName = '000001-batch_execution.json'; const rawPath = join(rawDir, rawName);
  await exclusiveJson(rawPath, raw);
  const spawnScenario = hooks.spawnScenario ?? defaultSpawnScenario;
  const results = [];
  let finished = false;
  try {
    for (const scenario of pilot.document.scenarios) {
      const childRunId = `${runId}::${scenario.id}`;
      // 기계 무효 재개에서는 이미 RECORDED인 원본을 다시 돌리지 않고 검증해 붙인다.
      // eslint-disable-next-line no-await-in-loop
      const prior = await latestRecordedScenario(evidenceDir, childRunId, { historyDir, scenarioFile });
      if (prior) { results.push(prior); continue; }
      // await를 루프 안에서 한 번만 건다 — 다음 child는 앞 child 종료 뒤에만 시작한다.
      // eslint-disable-next-line no-await-in-loop
      const result = await spawnScenario({
        batchRunId: runId, scenarioId: scenario.id, scenarioFile, qualificationManifest,
        qualificationHistoryDir, evidenceDir, historyDir, sourceRoot,
      });
      results.push(result);
      if (result?.status !== 'RECORDED') break;
    }
    if (results.length !== 7 || results.some((result) => result?.status !== 'RECORDED')) {
      const invalidReason = 'evidence_incomplete';
      const invalid = {
        schemaVersion: 1, kind: 'living-sim-pilot-batch', runId, historyRunId,
        attemptId: claim.attemptId, status: 'HARNESS_INVALID', invalidReason,
        scenarioIds: EXPECTED_SCENARIOS, results: results.map((result, index) => ({
          id: EXPECTED_SCENARIOS[index], status: result?.status ?? 'NOT_RUN', manifestPath: result?.manifestPath ?? null,
        })),
      };
      await exclusiveJson(manifestPath, invalid);
      await finishRun(claim, { status: 'HARNESS_INVALID', invalidReason, manifestHash: digest(await readFile(manifestPath)) });
      finished = true;
      return { ok: false, status: 'HARNESS_INVALID', manifestPath, manifest: invalid, results };
    }
    const scenarios = [];
    for (let index = 0; index < results.length; index += 1) {
      const path = resolve(results[index].manifestPath);
      // eslint-disable-next-line no-await-in-loop
      scenarios.push({ id: EXPECTED_SCENARIOS[index], manifestPath: path, sha256: digest(await readFile(path)) });
    }
    const manifest = {
      schemaVersion: 1, kind: 'living-sim-pilot-batch', runId, historyRunId,
      attemptId: claim.attemptId, status: 'RECORDED', invalidReason: null,
      source, scenarioFile: { path: relative(resolve(sourceRoot), pilot.path), sha256: pilot.sha256 },
      qualification, scenarioIds: EXPECTED_SCENARIOS, scenarios,
      runPolicy: { separateProcessPerScenario: true, parallel: false, oneRunPerScenario: true, resultBasedSelection: false },
      scoring: 'PM_UNJUDGED', rawEvidence: [{ name: rawName, sha256: digest(await readFile(rawPath)) }],
      startedAt: raw.startedAt, finishedAt: new Date().toISOString(),
    };
    await exclusiveJson(manifestPath, manifest);
    await finishRun(claim, { status: 'RECORDED', manifestHash: digest(await readFile(manifestPath)) }); finished = true;
    const verified = await verifyLivingSimBatchEvidence(manifestPath, {
      historyDir, scenarioFile, qualificationHistoryDir, sourceRoot,
    });
    return verified.ok
      ? { ok: true, status: 'RECORDED', manifestPath, manifest, results }
      : { ok: false, status: 'EVIDENCE_INVALID', manifestPath, manifest, results, failures: verified.failures };
  } catch (error) {
    if (!finished) await finishRun(claim, {
      status: 'HARNESS_INVALID', invalidReason: 'evidence_incomplete', manifestHash: null,
    }).catch(() => {});
    throw error;
  }
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const child = process.argv.includes('--child');
  const common = {
    scenarioFile: arg('--scenario-file'), qualificationManifest: arg('--qualification-manifest'),
    qualificationHistoryDir: arg('--qualification-history-dir'), evidenceDir: arg('--evidence-dir'),
    historyDir: arg('--history-dir'), sourceRoot: arg('--source-root'),
  };
  try {
    const result = child
      ? await runLivingSimScenario({ ...common, batchRunId: arg('--batch-run-id'), scenarioId: arg('--scenario-id') })
      : await runLivingSimPilot({ ...common, runId: arg('--run-id') });
    // child parser는 마지막 한 줄만 읽는다. 비밀·모델 본문은 출력하지 않는다.
    console.log(JSON.stringify({
      ok: result.ok, status: result.status, invalidReason: result.invalidReason ?? null,
      manifestPath: result.manifestPath, failures: result.failures ?? null,
    }));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error?.code ?? 'LIVING_SIM_FAILED', error: String(error?.message ?? error) }));
    process.exit(2);
  }
}
