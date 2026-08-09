// 생활모의시험 0단계 — 본시험을 열기 전에 하네스 자체의 기계 사실만 검증한다.
// 모델 답의 문구·품질·점수는 어느 판정에도 쓰지 않는다.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, rename, rm, writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLiveServer } from '../../src/surface/server.js';
import { 격리증명 } from './prove-isolation.mjs';
import { 대본모델띄우기 } from '../live/scripted-model.mjs';

export const QUALIFICATION_SCHEMA_VERSION = 1;
export const MACHINE_INVALID_REASONS = Object.freeze([
  'artifact_identity_invalid',
  'declared_path_changed',
  'evidence_incomplete',
  'interactive_lease_held',
  'isolation_failed',
  'manifest_invalid',
  'probe_crashed',
  'protected_state_changed',
  'secret_exposed',
]);
const MACHINE_INVALID = new Set(MACHINE_INVALID_REASONS);
const INTERACTIVE_KINDS = new Set(['ui', 'browser', 'app']);
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
// 기존 격리 증명은 같은 프로세스의 HOME을 잠깐 바꾼다. 별도 headless 실행들은 lease 없이
// 병렬일 수 있지만, 이 짧은 증명 구간만은 서로의 process.env를 섞지 않게 직렬화한다.
let isolationQueue = Promise.resolve();

async function defaultIsolationProof(room) {
  const previous = isolationQueue;
  let release;
  isolationQueue = new Promise((done) => { release = done; });
  await previous;
  try { return await 격리증명(room); }
  finally { release(); }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(stable(value)), 'utf8');
  return createHash('sha256').update(bytes).digest('hex');
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${randomUUID()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}

async function exclusiveJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
  finally { await handle.close(); }
}

async function withDirectoryLock(lockPath, action) {
  await mkdir(dirname(lockPath), { recursive: true });
  try { await mkdir(lockPath); }
  catch (error) {
    if (error?.code === 'EEXIST') throw Object.assign(new Error('run history is busy'), { code: 'RUN_HISTORY_BUSY' });
    throw error;
  }
  try { return await action(); }
  finally { await rm(lockPath, { recursive: true, force: true }); }
}

async function eventFiles(runDir) {
  return (await readdir(runDir).catch(() => []))
    .filter((name) => /^\d{6}-.+\.json$/.test(name)).sort();
}

async function readEvents(runDir) {
  const out = [];
  for (const name of await eventFiles(runDir)) out.push(JSON.parse(await readFile(join(runDir, name), 'utf8')));
  return out;
}

function lastAttempt(events) {
  const started = [...events].reverse().find((event) => event.type === 'started');
  if (!started) return null;
  return {
    started,
    finished: [...events].reverse().find((event) => event.type === 'finished'
      && event.attemptId === started.attemptId) ?? null,
  };
}

/** 같은 runId의 원본은 지우지 않고, 직전 시도가 기계 무효일 때만 새 attempt를 붙인다. */
export async function claimRun({ historyDir, runId, executionKind, isolatedRoot }) {
  if (!String(runId ?? '').trim()) throw new TypeError('runId가 필요하다');
  const key = digest(runId);
  const runDir = join(resolve(historyDir), 'runs', key);
  const lock = join(resolve(historyDir), 'locks', `${key}.lock`);
  return withDirectoryLock(lock, async () => {
    await mkdir(runDir, { recursive: true });
    const events = await readEvents(runDir);
    const previous = lastAttempt(events);
    if (previous) {
      const rerunnable = previous.finished?.status === 'HARNESS_INVALID'
        && MACHINE_INVALID.has(previous.finished?.invalidReason);
      if (!rerunnable) {
        throw Object.assign(new Error('같은 run ID는 기계 무효 원본 뒤에만 재실행할 수 있다'), {
          code: 'RUN_ID_ALREADY_USED', previous,
        });
      }
    }
    const attemptId = randomUUID();
    const seq = events.length + 1;
    const event = {
      schemaVersion: QUALIFICATION_SCHEMA_VERSION,
      type: 'started', runId, attemptId, executionKind, isolatedRoot: resolve(isolatedRoot),
      recordedAt: new Date().toISOString(),
    };
    await exclusiveJson(join(runDir, `${String(seq).padStart(6, '0')}-started.json`), event);
    return { runDir, runId, attemptId };
  });
}

export async function finishRun(claim, { status, invalidReason = null, manifestHash = null }) {
  if (status === 'HARNESS_INVALID' && !MACHINE_INVALID.has(invalidReason)) {
    throw new TypeError('HARNESS_INVALID에는 동결된 기계 무효 사유가 필요하다');
  }
  if (status !== 'HARNESS_INVALID' && invalidReason !== null) {
    throw new TypeError('답 품질·점수·모델 행동은 무효 사유가 될 수 없다');
  }
  const key = digest(claim.runId);
  const lock = join(dirname(dirname(claim.runDir)), 'locks', `${key}.lock`);
  return withDirectoryLock(lock, async () => {
    const events = await readEvents(claim.runDir);
    if (events.some((event) => event.type === 'finished' && event.attemptId === claim.attemptId)) {
      throw Object.assign(new Error('attempt는 이미 종료됐다'), { code: 'ATTEMPT_ALREADY_FINISHED' });
    }
    const seq = events.length + 1;
    const event = {
      schemaVersion: QUALIFICATION_SCHEMA_VERSION,
      type: 'finished', runId: claim.runId, attemptId: claim.attemptId,
      status, invalidReason, manifestHash, recordedAt: new Date().toISOString(),
    };
    await exclusiveJson(join(claim.runDir, `${String(seq).padStart(6, '0')}-finished.json`), event);
    return event;
  });
}

/** UI·브라우저·앱은 하나의 원자적 lease를 공유한다. headless 격리는 이 lease를 잡지 않는다. */
export async function claimExecutionLease({ leaseDir, executionKind, runId }) {
  if (!INTERACTIVE_KINDS.has(executionKind)) return { interactive: false, release: async () => {} };
  const lock = join(resolve(leaseDir), 'interactive.lock');
  await mkdir(dirname(lock), { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if (error?.code === 'EEXIST') {
      throw Object.assign(new Error('UI·브라우저·앱 회차는 병렬 실행할 수 없다'), {
        code: 'INTERACTIVE_LEASE_HELD', invalidReason: 'interactive_lease_held',
      });
    }
    throw error;
  }
  await exclusiveJson(join(lock, 'owner.json'), { runId, executionKind });
  let released = false;
  return {
    interactive: true,
    release: async () => {
      if (released) return;
      released = true;
      await rm(lock, { recursive: true, force: true });
    },
  };
}

async function describePath(path) {
  const absolute = resolve(path);
  async function walk(current, relative = '.') {
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error?.code === 'ENOENT') return [{ path: relative, type: 'missing' }];
      throw error;
    }
    if (stat.isSymbolicLink()) return [{ path: relative, type: 'symlink', target: await readlink(current) }];
    if (stat.isFile()) return [{ path: relative, type: 'file', mode: stat.mode & 0o777, hash: digest(await readFile(current)) }];
    if (!stat.isDirectory()) return [{ path: relative, type: 'other', mode: stat.mode & 0o777, size: stat.size }];
    const rows = [{ path: relative, type: 'dir', mode: stat.mode & 0o777 }];
    for (const name of (await readdir(current)).sort()) {
      rows.push(...await walk(join(current, name), relative === '.' ? name : join(relative, name)));
    }
    return rows;
  }
  const entries = await walk(absolute);
  return { path: absolute, digest: digest(entries), entries };
}

export async function snapshotPaths(paths) {
  const out = [];
  for (const path of [...new Set(paths.map((item) => resolve(item)))].sort()) out.push(await describePath(path));
  return out;
}

export function changedPaths(before, after) {
  const b = new Map(before.map((item) => [item.path, item.digest]));
  const a = new Map(after.map((item) => [item.path, item.digest]));
  return [...new Set([...b.keys(), ...a.keys()])].filter((path) => b.get(path) !== a.get(path)).sort();
}

export async function artifactIdentity({ sourceRoot, pkgPath } = {}) {
  if (Boolean(sourceRoot) === Boolean(pkgPath)) throw new TypeError('sourceRoot 또는 pkgPath 중 하나만 필요하다');
  if (sourceRoot) {
    const root = resolve(sourceRoot);
    const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    if (!GIT_SHA.test(gitSha)) throw new Error('정확한 Git SHA를 얻지 못했다');
    const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
    });
    const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024,
    }).toString('utf8').split('\0').filter(Boolean).sort();
    const files = [];
    for (const name of names) {
      const path = join(root, name);
      const stat = await lstat(path);
      files.push(stat.isSymbolicLink()
        ? { path: name, type: 'symlink', target: await readlink(path) }
        : { path: name, type: 'file', mode: stat.mode & 0o777, sha256: digest(await readFile(path)) });
    }
    return {
      kind: 'source', gitSha, dirty: status.length > 0,
      worktreeDigest: digest(files), changesDigest: digest(status),
    };
  }
  const bytes = await readFile(resolve(pkgPath));
  return { kind: 'package', pkgSha: digest(bytes), packageName: basename(pkgPath) };
}

export function assertNoSecretExposure(value, secretValues = []) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  const leaked = secretValues.filter((secret) => String(secret ?? '').length >= 4 && serialized.includes(String(secret)));
  if (leaked.length) throw Object.assign(new Error('비밀 원문이 증거에 노출됐다'), {
    code: 'SECRET_EXPOSED', invalidReason: 'secret_exposed', leakCount: leaked.length,
  });
}

function machineFactsFrom({ session, workEvents, first, second, providerRequests = [] }) {
  const userTurns = (session.transcript ?? []).filter((entry) => entry.role === 'user');
  const receipt = (session.ledgerEntries ?? []).find((entry) => entry?.actualCall?.tool === 'local.file');
  const agreement = workEvents.find((event) => event.type === 'agreement_set');
  const statement = String(agreement?.evidence?.statement ?? '');
  const projectedRequest = providerRequests.find((request) => {
    const body = request?.body;
    const system = typeof body?.system === 'string' ? body.system : JSON.stringify(body?.system ?? '');
    const messages = JSON.stringify(body?.messages ?? []);
    return statement && system.includes(statement) && messages.includes('이어서 fixture 읽기');
  });
  const projectedContext = typeof projectedRequest?.body?.system === 'string'
    ? projectedRequest.body.system : JSON.stringify(projectedRequest?.body?.system ?? '');
  const projected = Boolean(projectedRequest);
  return {
    turnRefs: userTurns.map((entry) => entry.turnRef),
    sessionWorkRef: session.workRef ?? null,
    workEvent: agreement ? {
      eventId: agreement.eventId, type: agreement.type, turnRef: agreement.evidence?.turnRef,
      workRef: agreement.workRef, statementDigest: digest(statement),
    } : null,
    receipt: receipt ? {
      lifecycle: receipt.lifecycle, failureState: receipt.failureState,
      tool: receipt.actualCall?.tool, turnRef: receipt.turnRef,
    } : null,
    nextTurnContext: {
      hasContext: typeof second?.contextShown === 'string' && second.contextShown.length > 0,
      carriesWorkRef: Boolean(session.workRef),
      surfaceContextDigest: digest(String(second?.contextShown ?? '')),
      contextSource: projected ? 'provider-request-system' : null,
      contextDigest: projected ? digest(projectedContext) : null,
      projectedEventId: projected ? agreement.eventId : null,
      projectedStatementDigest: projected ? digest(statement) : null,
    },
    surfaceKinds: [first?.kind ?? null, second?.kind ?? null],
  };
}

export function validateQualificationManifest(manifest, { secretValues = [] } = {}) {
  const failures = [];
  if (manifest?.schemaVersion !== QUALIFICATION_SCHEMA_VERSION) failures.push('schema');
  if (!manifest?.runId || !manifest?.attemptId || manifest?.executionKind !== 'headless_isolated') failures.push('run_identity');
  const artifact = manifest?.artifact;
  if (!(artifact?.kind === 'source' && GIT_SHA.test(artifact.gitSha ?? '')
      && typeof artifact.dirty === 'boolean' && SHA256.test(artifact.worktreeDigest ?? '')
      && SHA256.test(artifact.changesDigest ?? ''))
    && !(artifact?.kind === 'package' && SHA256.test(artifact.pkgSha ?? ''))) failures.push('artifact_identity');
  const model = manifest?.model;
  if (model?.provider !== 'scripted-loopback' || model?.model !== 'qualification-scripted-v1'
    || model?.adapter !== 'anthropic-messages' || !model?.configuredModelId
    || !model?.settings || !SHA256.test(manifest?.fixtureHash ?? '')) failures.push('runtime_identity');
  const facts = manifest?.machineFacts;
  if (facts?.turnRefs?.length !== 2
    || facts.turnRefs.some((ref, index) => ref?.sessionId !== facts.turnRefs[0]?.sessionId || ref?.turnSeq !== index + 1)) failures.push('turn_refs');
  if (facts?.workEvent?.type !== 'agreement_set'
    || facts?.workEvent?.turnRef?.sessionId !== facts?.turnRefs?.[0]?.sessionId
    || facts?.workEvent?.turnRef?.turnSeq !== 1
    || !SHA256.test(facts?.workEvent?.statementDigest ?? '')
    || facts?.workEvent?.workRef !== facts?.sessionWorkRef) failures.push('work_event');
  if (facts?.receipt?.tool !== 'local.file' || facts?.receipt?.lifecycle !== 'delivered'
    || facts?.receipt?.failureState !== 'none'
    || facts?.receipt?.turnRef?.sessionId !== facts?.turnRefs?.[0]?.sessionId
    || facts?.receipt?.turnRef?.turnSeq !== 2) failures.push('receipt');
  if (facts?.nextTurnContext?.hasContext !== true || facts?.nextTurnContext?.carriesWorkRef !== true
    || facts?.nextTurnContext?.contextSource !== 'provider-request-system'
    || !SHA256.test(facts?.nextTurnContext?.contextDigest ?? '')
    || facts?.nextTurnContext?.projectedEventId !== facts?.workEvent?.eventId
    || facts?.nextTurnContext?.projectedStatementDigest !== facts?.workEvent?.statementDigest) failures.push('next_turn_context');
  if (manifest?.isolation?.ok !== true) failures.push('isolation');
  if ((manifest?.protectedState?.changed ?? []).length) failures.push('protected_state_changed');
  if ((manifest?.declaredPaths?.changed ?? []).length) failures.push('declared_path_changed');
  if (!SHA256.test(manifest?.protectedState?.beforeSnapshotDigest ?? '')
    || !SHA256.test(manifest?.protectedState?.afterSnapshotDigest ?? '')
    || !SHA256.test(manifest?.declaredPaths?.beforeSnapshotDigest ?? '')
    || !SHA256.test(manifest?.declaredPaths?.afterSnapshotDigest ?? '')) failures.push('path_snapshots');
  if (!Array.isArray(manifest?.rawEvidence) || !manifest.rawEvidence.length
    || manifest.rawEvidence.some((item) => !item?.name || !SHA256.test(item?.sha256 ?? ''))) failures.push('raw_evidence');
  try { assertNoSecretExposure(manifest, secretValues); } catch { failures.push('secret_exposed'); }
  return { ok: failures.length === 0, failures };
}

function snapshotDigestRows(snapshot) {
  return snapshot.map(({ path, digest: sha256 }) => ({ path, digest: sha256 }));
}

function safeRawPath(manifestPath, name) {
  if (typeof name !== 'string' || !name || name !== basename(name) || name.includes('..')) return null;
  const rawRoot = resolve(dirname(manifestPath), 'raw');
  const candidate = resolve(rawRoot, name);
  return candidate.startsWith(`${rawRoot}/`) ? candidate : null;
}

/** 저장 뒤 감사 경로: manifest 주장을 믿지 않고 raw 바이트·계보·경로 snapshot을 다시 잰다. */
export async function verifyQualificationEvidence(manifestPath, { secretValues = [] } = {}) {
  const failures = [];
  let manifest;
  try { manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8')); }
  catch { return { ok: false, failures: ['manifest_unreadable'] }; }
  failures.push(...validateQualificationManifest(manifest, { secretValues }).failures);
  let probe = null;
  for (const item of manifest.rawEvidence ?? []) {
    const path = safeRawPath(resolve(manifestPath), item?.name);
    if (!path) { failures.push('raw_path_escape'); continue; }
    let bytes;
    try { bytes = await readFile(path); } catch { failures.push('raw_missing'); continue; }
    if (digest(bytes) !== item.sha256) failures.push('raw_hash_mismatch');
    if (item.name === 'probe.json') {
      try { probe = JSON.parse(bytes.toString('utf8')); } catch { failures.push('raw_unreadable'); }
    }
    try { assertNoSecretExposure(bytes.toString('utf8'), secretValues); } catch { failures.push('secret_exposed'); }
  }
  if (!probe) failures.push('probe_evidence_missing');
  if (probe) {
    const derived = machineFactsFrom({
      session: probe.session ?? {}, workEvents: probe.workEvents ?? [],
      first: probe.turns?.[0], second: probe.turns?.[1], providerRequests: probe.providerRequests ?? [],
    });
    if (digest(derived) !== digest(manifest.machineFacts)) failures.push('machine_facts_mismatch');
    for (const [key, manifestKey] of [['protected', 'protectedState'], ['declared', 'declaredPaths']]) {
      const before = probe.pathSnapshots?.[key]?.before;
      const after = probe.pathSnapshots?.[key]?.after;
      if (!Array.isArray(before) || !Array.isArray(after)) { failures.push(`${key}_snapshots_missing`); continue; }
      if (digest(before) !== manifest?.[manifestKey]?.beforeSnapshotDigest
        || digest(after) !== manifest?.[manifestKey]?.afterSnapshotDigest
        || digest(changedPaths(before, after)) !== digest(manifest?.[manifestKey]?.changed ?? [])) {
        failures.push(`${key}_snapshots_mismatch`);
      }
    }
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)] };
}

function invalidReasonFor(failures) {
  if (failures.includes('secret_exposed')) return 'secret_exposed';
  if (failures.includes('protected_state_changed')) return 'protected_state_changed';
  if (failures.includes('declared_path_changed')) return 'declared_path_changed';
  if (failures.includes('isolation')) return 'isolation_failed';
  if (failures.includes('artifact_identity')) return 'artifact_identity_invalid';
  return failures.length ? 'evidence_incomplete' : null;
}

async function closeServer(server) {
  if (server?.listening) await new Promise((done) => server.close(done));
}

async function recordingLoopbackProxy(upstreamBaseUrl) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      try {
        const bytes = Buffer.concat(chunks);
        let body = null;
        if (bytes.length) {
          try { body = JSON.parse(bytes.toString('utf8')); } catch { body = { unreadableBodyHash: digest(bytes) }; }
        }
        requests.push({ method: request.method, path: request.url, body });
        const upstream = await fetch(`${upstreamBaseUrl}${request.url}`, {
          method: request.method,
          headers: {
            'content-type': request.headers['content-type'] ?? 'application/json',
            ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
          },
          ...(bytes.length ? { body: bytes } : {}),
        });
        response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (error) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error?.message ?? error) }));
      }
    });
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => closeServer(server),
  };
}

/** 실제 HTTP→세션→도구→Receipt→WorkEvent→다음 턴 재료를 두 턴으로 관통한다. */
export async function runHarnessQualification(options) {
  const {
    runId, evidenceDir, historyDir, leaseDir = historyDir, executionKind = 'headless_isolated',
    sourceRoot, pkgPath, protectedPaths = [join(homedir(), '.local', 'state', 'gpao-t5')],
    declaredPaths = [], secretValues = [], hooks = {},
  } = options;
  if (pkgPath) {
    throw Object.assign(new Error('이 관문은 패키지 바이트를 실제 실행하지 않는다 — --pkg 자격을 주장할 수 없다'), {
      code: 'PACKAGE_EXECUTION_NOT_AVAILABLE',
    });
  }
  const room = await mkdtemp(join(tmpdir(), 't5-harness-qualification-'));
  const fixtureDir = join(room, 'fixture');
  const stateDir = join(room, 'state');
  const homeDir = join(room, 'home');
  await Promise.all([mkdir(fixtureDir), mkdir(stateDir), mkdir(homeDir), mkdir(resolve(evidenceDir), { recursive: true })]);
  const fixturePath = join(fixtureDir, 'qualification.txt');
  await writeFile(fixturePath, '생활모의시험 하네스 자격검증 fixture\n', 'utf8');
  const watchedDeclared = [...declaredPaths, fixturePath];
  const claim = await claimRun({ historyDir, runId, executionKind, isolatedRoot: room });
  let lease;
  let server;
  let scripted;
  let providerProxy;
  let finished = false;
  const rawDir = join(resolve(evidenceDir), `${runId}-${claim.attemptId}`, 'raw');
  const manifestPath = join(dirname(rawDir), 'manifest.json');
  const fakeSecret = 'qualification_scripted_key_not_for_network';
  const allSecrets = [...secretValues, fakeSecret];
  try {
    lease = await claimExecutionLease({ leaseDir, executionKind, runId });
    const artifact = await artifactIdentity({ sourceRoot, pkgPath });
    const beforeProtected = await snapshotPaths(protectedPaths);
    const beforeDeclared = await snapshotPaths(watchedDeclared);
    const isolation = await (hooks.isolationProof ?? defaultIsolationProof)({ root: homeDir, fixtureDir, stateDir });
    if (!isolation.ok) throw Object.assign(new Error('격리 증명이 실패했다'), { invalidReason: 'isolation_failed' });

    const agreementText = '자격 합의: 두 번째 턴에서도 이 작업을 이어간다.';
    scripted = await 대본모델띄우기({ 대본: [
      { 열쇠: '자격 합의', tool: 'work.state', args: () => ({
        changes: [{ type: 'agreement_set', utteranceQuote: agreementText }],
      }) },
      { 열쇠: 'fixture 읽기', tool: 'local.file', args: () => ({ action: 'read', path: fixturePath }) },
    ] });
    providerProxy = await recordingLoopbackProxy(scripted.baseUrl);
    const processEnv = {
      HOME: homeDir,
      GPAO_T5_HOME: homeDir,
      GPAO_T5_DATA_DIR: stateDir,
      GPAO_T5_FILE_ROOTS: fixtureDir,
      GPAO_T5_TCELL: 'off',
      GPAO_T5_NO_AUTO_SCREEN_BIN: '1',
      GPAO_T5_CUA_BIN: '', GPAO_T5_DESKTOP_BIN: '', GPAO_T5_BROWSER_PATH: '',
      GPAO_T5_MODEL_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: fakeSecret,
      GPAO_T5_MODEL_BASE_URL: providerProxy.baseUrl,
      GPAO_T5_MODEL_ID: 'claude-opus-4-8',
      GPAO_T5_MODEL_MAX_TOKENS: '8192',
      GPAO_T5_MODEL_TIMEOUT_MS: '0', GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0',
    };
    server = await startLiveServer({ port: 0, processEnv, startScheduler: false });
    const base = `http://127.0.0.1:${server.address().port}`;
    const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    const post = async (path, body) => {
      const response = await fetch(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body ?? {}),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`surface ${path} ${response.status}: ${JSON.stringify(value)}`);
      return value;
    };
    const sessionId = (await post('/sessions')).id;
    const first = await post('/turn', { sessionId, text: agreementText });
    const second = await post('/turn', { sessionId, text: '이어서 fixture 읽기' });
    const providerCalls = structuredClone(scripted.고른것);
    const providerRequests = structuredClone(providerProxy.requests);
    const observedCalls = providerRequests.filter((request) => request.method === 'POST' && request.body?.model)
      .map((request) => ({
        model: request.body.model,
        maxTokens: request.body.max_tokens ?? null,
        stream: request.body.stream === true,
        temperature: request.body.temperature ?? null,
      }));
    const modelIdentity = {
      provider: 'scripted-loopback', model: 'qualification-scripted-v1',
      adapter: processEnv.GPAO_T5_MODEL_PROVIDER === 'anthropic' ? 'anthropic-messages' : processEnv.GPAO_T5_MODEL_PROVIDER,
      configuredModelId: processEnv.GPAO_T5_MODEL_ID,
      settings: {
        configured: {
          baseUrl: processEnv.GPAO_T5_MODEL_BASE_URL,
          maxTokens: Number(processEnv.GPAO_T5_MODEL_MAX_TOKENS),
          modelTimeoutMs: Number(processEnv.GPAO_T5_MODEL_TIMEOUT_MS),
          httpTimeoutMs: Number(processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS),
        },
        observedCalls,
      },
    };
    await closeServer(server); server = null;
    await providerProxy.close(); providerProxy = null;
    await scripted.close(); scripted = null;
    await hooks.afterProbe?.({ room, fixtureDir, stateDir, homeDir });

    const session = JSON.parse(await readFile(join(stateDir, `${sessionId}.json`), 'utf8'));
    const workEvents = JSON.parse(await readFile(join(stateDir, 'work-events.json'), 'utf8')).records ?? [];
    const afterProtected = await snapshotPaths(protectedPaths);
    const afterDeclared = await snapshotPaths(watchedDeclared);
    const raw = {
      session: {
        id: session.id, workRef: session.workRef ?? null,
        transcript: (session.transcript ?? []).map((entry) => ({ role: entry.role, turnRef: entry.turnRef })),
        ledgerEntries: session.ledgerEntries ?? [],
      },
      workEvents,
      turns: [first, second],
      isolation,
      providerCalls,
      providerRequests,
      pathSnapshots: {
        protected: { before: snapshotDigestRows(beforeProtected), after: snapshotDigestRows(afterProtected) },
        declared: { before: snapshotDigestRows(beforeDeclared), after: snapshotDigestRows(afterDeclared) },
      },
    };
    assertNoSecretExposure(raw, allSecrets);
    await mkdir(rawDir, { recursive: true });
    const rawPath = join(rawDir, 'probe.json');
    await atomicJson(rawPath, raw);
    const rawEvidence = [{ name: 'probe.json', sha256: digest(await readFile(rawPath)) }];
    const manifest = {
      schemaVersion: QUALIFICATION_SCHEMA_VERSION,
      runId, attemptId: claim.attemptId, executionKind,
      status: 'QUALIFIED', artifact,
      model: modelIdentity,
      fixtureHash: digest(await readFile(fixturePath)),
      isolation,
      protectedState: {
        paths: protectedPaths.map((path) => resolve(path)),
        beforeSnapshotDigest: digest(snapshotDigestRows(beforeProtected)),
        afterSnapshotDigest: digest(snapshotDigestRows(afterProtected)),
        changed: changedPaths(beforeProtected, afterProtected),
      },
      declaredPaths: {
        paths: watchedDeclared.map((path) => resolve(path)),
        beforeSnapshotDigest: digest(snapshotDigestRows(beforeDeclared)),
        afterSnapshotDigest: digest(snapshotDigestRows(afterDeclared)),
        changed: changedPaths(beforeDeclared, afterDeclared),
      },
      machineFacts: machineFactsFrom({ session, workEvents, first, second, providerRequests }),
      rawEvidence,
    };
    const validation = validateQualificationManifest(manifest, { secretValues: allSecrets });
    if (!validation.ok) {
      const reason = invalidReasonFor(validation.failures);
      const invalid = { ...manifest, status: 'HARNESS_INVALID', invalidReason: reason, validation };
      await atomicJson(manifestPath, invalid);
      await finishRun(claim, { status: 'HARNESS_INVALID', invalidReason: reason, manifestHash: digest(await readFile(manifestPath)) });
      finished = true;
      return { ok: false, status: 'HARNESS_INVALID', invalidReason: reason, manifestPath, manifest: invalid };
    }
    await atomicJson(manifestPath, manifest);
    const persisted = await verifyQualificationEvidence(manifestPath, { secretValues: allSecrets });
    if (!persisted.ok) {
      const invalid = {
        ...manifest, status: 'HARNESS_INVALID', invalidReason: 'manifest_invalid',
        validation: persisted,
      };
      await atomicJson(manifestPath, invalid);
      await finishRun(claim, {
        status: 'HARNESS_INVALID', invalidReason: 'manifest_invalid',
        manifestHash: digest(await readFile(manifestPath)),
      });
      finished = true;
      return { ok: false, status: 'HARNESS_INVALID', invalidReason: 'manifest_invalid', manifestPath, manifest: invalid };
    }
    const manifestHash = digest(await readFile(manifestPath));
    await finishRun(claim, { status: 'QUALIFIED', manifestHash });
    finished = true;
    return { ok: true, status: 'QUALIFIED', manifestPath, manifest };
  } catch (error) {
    const invalidReason = MACHINE_INVALID.has(error?.invalidReason) ? error.invalidReason : 'probe_crashed';
    const invalid = {
      schemaVersion: QUALIFICATION_SCHEMA_VERSION, runId, attemptId: claim.attemptId,
      executionKind, status: 'HARNESS_INVALID', invalidReason,
      diagnostic: String(error?.message ?? error).slice(0, 500),
    };
    assertNoSecretExposure(invalid, allSecrets);
    await atomicJson(manifestPath, invalid).catch(() => {});
    if (!finished) await finishRun(claim, {
      status: 'HARNESS_INVALID', invalidReason,
      manifestHash: await readFile(manifestPath).then(digest).catch(() => null),
    });
    return { ok: false, status: 'HARNESS_INVALID', invalidReason, manifestPath, manifest: invalid };
  } finally {
    await closeServer(server).catch(() => {});
    await providerProxy?.close().catch(() => {});
    await scripted?.close().catch(() => {});
    await lease?.release().catch(() => {});
    await rm(room, { recursive: true, force: true });
  }
}

function arg(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : null;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const runId = arg('--run-id');
  const evidenceDir = arg('--evidence-dir');
  const historyDir = arg('--history-dir');
  const pkgPath = arg('--pkg');
  const sourceRoot = pkgPath ? null : (arg('--source') ?? resolve(dirname(thisFile), '../..'));
  if (!runId || !evidenceDir || !historyDir) {
    console.error('usage: node scripts/human-use/harness-qualification.mjs --run-id ID --evidence-dir DIR --history-dir DIR [--source DIR|--pkg FILE]');
    process.exit(2);
  }
  try {
    const result = await runHarnessQualification({ runId, evidenceDir, historyDir, sourceRoot, pkgPath });
    console.log(JSON.stringify({ ok: result.ok, status: result.status, invalidReason: result.invalidReason ?? null, manifestPath: result.manifestPath }, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error?.code ?? 'QUALIFICATION_START_FAILED', error: String(error?.message ?? error) }, null, 2));
    process.exit(2);
  }
}
