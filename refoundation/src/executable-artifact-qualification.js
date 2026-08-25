import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { extractSafeZip, inspectZipArchive } from './archive-safety.js';

const CONTRACT_SCHEMA = 't5.deliverable-contract.v1';
const RECEIPT_SCHEMA = 't5.executable-artifact-qualification.v1';
const PLATFORMS = new Set(['darwin', 'linux', 'win32']);
const QUALIFICATIONS = new Set(['unmeasured', 'structurally_inspected', 'actually_executed']);
const QUALIFICATION_RANK = Object.freeze({
  unmeasured: 0,
  structurally_inspected: 1,
  actually_executed: 2,
});
const MAX_EXPECTED_FILES = 256;
const MAX_GUIDE_REFERENCES = 64;
const MAX_ENTRYPOINTS = 16;
const MAX_PLATFORM_CLAIMS = 8;
const MAX_EXPECTED_LITERALS = 16;
const MAX_LITERAL_BYTES = 2_000;
const DEFAULT_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function boundedString(value, label, { maxBytes = 1_024, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new TypeError(`${label} is too large`);
  return value.normalize('NFC');
}

function artifactPath(value, label) {
  const path = boundedString(value, label, { maxBytes: 1_024 });
  if (isAbsolute(path) || /^[A-Za-z]:/u.test(path) || path.includes('\\')) {
    throw new TypeError(`${label} must be a relative artifact path`);
  }
  const parts = path.replace(/\/$/u, '').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} must be a relative artifact path`);
  }
  return path;
}

function boundedArray(value, label, maximum) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > maximum) throw new TypeError(`${label} must contain at most ${maximum} items`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
}

function validateExpectedLiterals(value, label) {
  const literals = boundedArray(value ?? [], label, MAX_EXPECTED_LITERALS)
    .map((item, index) => boundedString(item, `${label}[${index}]`, {
      maxBytes: MAX_LITERAL_BYTES,
      allowEmpty: false,
    }));
  unique(literals, label);
  return literals;
}

export function validateDeliverableContract(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new TypeError('deliverable contract must be an object');
  }
  if (contract.schema !== CONTRACT_SCHEMA) throw new TypeError(`unsupported deliverable contract: ${contract.schema}`);
  boundedString(contract.artifact?.id, 'artifact.id', { maxBytes: 200 });
  if (!/^[0-9a-f]{64}$/u.test(contract.artifact?.sha256 ?? '')) {
    throw new TypeError('artifact.sha256 must be an exact SHA-256 digest');
  }

  const expectedFiles = boundedArray(contract.expectedFiles, 'expectedFiles', MAX_EXPECTED_FILES)
    .map((path, index) => artifactPath(path, `expectedFiles[${index}]`));
  unique(expectedFiles, 'expectedFiles');

  const guideReferences = boundedArray(
    contract.guideReferences ?? [], 'guideReferences', MAX_GUIDE_REFERENCES,
  ).map((reference, index) => ({
    guidePath: artifactPath(reference?.guidePath, `guideReferences[${index}].guidePath`),
    targetPath: artifactPath(reference?.targetPath, `guideReferences[${index}].targetPath`),
  }));

  const advertisedEntrypoints = boundedArray(
    contract.advertisedEntrypoints, 'advertisedEntrypoints', MAX_ENTRYPOINTS,
  ).map((entrypoint, index) => {
    const platform = boundedString(entrypoint?.platform, `advertisedEntrypoints[${index}].platform`, {
      maxBytes: 20,
    });
    if (!PLATFORMS.has(platform)) throw new TypeError(`unsupported entrypoint platform: ${platform}`);
    const timeoutMs = entrypoint.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      throw new TypeError(`advertisedEntrypoints[${index}].timeoutMs must be between 100 and 30000`);
    }
    const expectedExitCode = entrypoint.expectedExitCode ?? 0;
    if (!Number.isInteger(expectedExitCode) || expectedExitCode < 0 || expectedExitCode > 255) {
      throw new TypeError(`advertisedEntrypoints[${index}].expectedExitCode is invalid`);
    }
    const interpreterArgs = boundedArray(
      entrypoint.interpreterArgs ?? [], `advertisedEntrypoints[${index}].interpreterArgs`, 16,
    ).map((argument, argumentIndex) => boundedString(
      argument, `advertisedEntrypoints[${index}].interpreterArgs[${argumentIndex}]`,
      { maxBytes: 1_024, allowEmpty: true },
    ));
    if (entrypoint.stdin != null) boundedString(
      entrypoint.stdin, `advertisedEntrypoints[${index}].stdin`,
      { maxBytes: 4_096, allowEmpty: true },
    );
    if (entrypoint.requiresExecutablePermission != null
      && typeof entrypoint.requiresExecutablePermission !== 'boolean') {
      throw new TypeError(
        `advertisedEntrypoints[${index}].requiresExecutablePermission must be boolean`,
      );
    }
    return {
      ...entrypoint,
      id: boundedString(entrypoint?.id, `advertisedEntrypoints[${index}].id`, { maxBytes: 200 }),
      platform,
      interpreter: boundedString(
        entrypoint?.interpreter, `advertisedEntrypoints[${index}].interpreter`, { maxBytes: 1_024 },
      ),
      interpreterArgs,
      path: artifactPath(entrypoint?.path, `advertisedEntrypoints[${index}].path`),
      cwd: artifactPath(entrypoint?.cwd, `advertisedEntrypoints[${index}].cwd`),
      requiresExecutablePermission: entrypoint.requiresExecutablePermission ?? false,
      timeoutMs,
      expectedExitCode,
      expectedStdoutIncludes: validateExpectedLiterals(
        entrypoint.expectedStdoutIncludes, `advertisedEntrypoints[${index}].expectedStdoutIncludes`,
      ),
      expectedStderrIncludes: validateExpectedLiterals(
        entrypoint.expectedStderrIncludes, `advertisedEntrypoints[${index}].expectedStderrIncludes`,
      ),
    };
  });
  unique(advertisedEntrypoints.map((entrypoint) => entrypoint.id), 'advertisedEntrypoints.id');

  const platforms = boundedArray(contract.platforms, 'platforms', MAX_PLATFORM_CLAIMS)
    .map((claim, index) => {
      const platform = boundedString(claim?.platform, `platforms[${index}].platform`, { maxBytes: 20 });
      if (!PLATFORMS.has(platform)) throw new TypeError(`unsupported platform claim: ${platform}`);
      if (typeof claim.advertisedSupport !== 'boolean') {
        throw new TypeError(`platforms[${index}].advertisedSupport must be boolean`);
      }
      if (!QUALIFICATIONS.has(claim.claimedQualification)) {
        throw new TypeError(`platforms[${index}].claimedQualification is invalid`);
      }
      return { ...claim, platform };
    });
  unique(platforms.map((claim) => claim.platform), 'platforms.platform');
  for (const entrypoint of advertisedEntrypoints) {
    if (!platforms.some((claim) => claim.platform === entrypoint.platform && claim.advertisedSupport)) {
      throw new TypeError(`entrypoint platform lacks advertised support claim: ${entrypoint.platform}`);
    }
  }
  return {
    ...contract,
    artifact: { ...contract.artifact },
    expectedFiles,
    guideReferences,
    advertisedEntrypoints,
    platforms,
  };
}

function isolatedEnvironment(home) {
  const keep = ['PATH', 'Path', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP'];
  return {
    ...Object.fromEntries(keep.flatMap((name) => (
      process.env[name] == null ? [] : [[name, process.env[name]]]
    ))),
    HOME: home,
    USERPROFILE: home,
  };
}

function captureStream(stream, limit) {
  let bytes = 0;
  let output = '';
  let truncated = false;
  stream?.on('data', (chunk) => {
    const value = Buffer.from(chunk);
    const remaining = Math.max(0, limit - bytes);
    if (remaining) output += value.subarray(0, remaining).toString('utf8');
    bytes += value.length;
    if (bytes > limit) truncated = true;
  });
  return () => ({ output, bytes, truncated });
}

function processGroupState(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform === 'win32') return 'absent';
  try { process.kill(-pid, 0); return 'present'; }
  catch (error) {
    if (error?.code === 'ESRCH') return 'absent';
    if (error?.code === 'EPERM') return 'inaccessible';
    throw error;
  }
}

async function waitForGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = processGroupState(pid);
    if (state !== 'present') return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return processGroupState(pid);
}

async function terminateProcessGroup(pid) {
  if (processGroupState(pid) === 'absent') return { attempted: false, confirmed: true };
  try { process.kill(-pid, 'SIGTERM'); }
  catch (error) {
    if (error?.code === 'ESRCH') return { attempted: false, confirmed: true };
    if (error?.code === 'EPERM') return { attempted: true, confirmed: false };
    throw error;
  }
  let state = await waitForGroupExit(pid, 300);
  if (state === 'absent') return { attempted: true, confirmed: true };
  if (state === 'inaccessible') return { attempted: true, confirmed: false };
  try { process.kill(-pid, 'SIGKILL'); }
  catch (error) {
    if (error?.code === 'ESRCH') return { attempted: true, confirmed: true };
    if (error?.code === 'EPERM') return { attempted: true, confirmed: false };
    throw error;
  }
  state = await waitForGroupExit(pid, 500);
  return { attempted: true, confirmed: state === 'absent' };
}

async function runEntrypoint({ entrypoint, root, home, spawnProcess, outputLimit }) {
  const executable = resolve(root, entrypoint.path);
  const cwd = resolve(root, entrypoint.cwd);
  try { await access(executable, fsConstants.R_OK); }
  catch {
    return { attempted: false, reason: 'entrypoint_missing', stdout: '', stderr: '', processResidual: false };
  }
  try {
    const cwdStat = await lstat(cwd);
    if (!cwdStat.isDirectory()) {
      return { attempted: false, reason: 'cwd_not_directory', stdout: '', stderr: '', processResidual: false };
    }
  } catch {
    return { attempted: false, reason: 'cwd_missing', stdout: '', stderr: '', processResidual: false };
  }
  try { await access(entrypoint.interpreter, fsConstants.X_OK); }
  catch {
    return { attempted: false, reason: 'interpreter_unavailable', stdout: '', stderr: '', processResidual: false };
  }

  const startedAt = Date.now();
  let child;
  try {
    child = spawnProcess(entrypoint.interpreter, [...entrypoint.interpreterArgs, executable], {
      cwd,
      env: isolatedEnvironment(home),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: false,
    });
  } catch (error) {
    return {
      attempted: true, reason: 'spawn_failed', errorCode: error?.code ?? null,
      stdout: '', stderr: '', processResidual: false, wallMs: Date.now() - startedAt,
    };
  }
  child.stdin.on('error', () => {});
  const stdout = captureStream(child.stdout, outputLimit);
  const stderr = captureStream(child.stderr, outputLimit);
  if (entrypoint.stdin != null) child.stdin.end(entrypoint.stdin);
  else child.stdin.end();

  let timedOut = false;
  const terminal = await new Promise((resolveTerminal) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveTerminal(result);
    };
    const timer = setTimeout(async () => {
      timedOut = true;
      await terminateProcessGroup(child.pid).catch(() => {});
      finish({ exitCode: null, signal: null, error: null });
    }, entrypoint.timeoutMs);
    child.once('error', (error) => {
      finish({ exitCode: null, signal: null, error });
    });
    child.once('exit', (exitCode, signal) => {
      finish({ exitCode, signal, error: null });
    });
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 60));
  const processResidual = processGroupState(child.pid) !== 'absent';
  const cleanup = processResidual
    ? await terminateProcessGroup(child.pid)
    : { attempted: false, confirmed: true };
  child.stdout.destroy();
  child.stderr.destroy();
  const stdoutObservation = stdout();
  const stderrObservation = stderr();
  return {
    attempted: true,
    reason: timedOut ? 'timed_out' : (terminal.error ? 'spawn_failed' : 'terminal'),
    exitCode: terminal.exitCode,
    signal: terminal.signal,
    ...(terminal.error ? { errorCode: terminal.error?.code ?? null } : {}),
    stdout: stdoutObservation.output,
    stderr: stderrObservation.output,
    stdoutBytes: stdoutObservation.bytes,
    stderrBytes: stderrObservation.bytes,
    outputTruncated: stdoutObservation.truncated || stderrObservation.truncated,
    processResidual,
    residualCleanupAttempted: cleanup.attempted,
    residualCleanupConfirmed: cleanup.confirmed,
    wallMs: Date.now() - startedAt,
  };
}

function entrypointQualification(entrypoint, execution, currentPlatform) {
  if (entrypoint.platform !== currentPlatform) return 'structurally_inspected';
  const outputMatched = entrypoint.expectedStdoutIncludes.every((value) => execution.stdout.includes(value))
    && entrypoint.expectedStderrIncludes.every((value) => execution.stderr.includes(value));
  return execution.attempted
    && execution.reason === 'terminal'
    && execution.exitCode === entrypoint.expectedExitCode
    && execution.outputTruncated === false
    && execution.processResidual === false
    && outputMatched
    ? 'actually_executed'
    : 'failed';
}

function platformObservations(contract, entrypoints) {
  return contract.platforms.map((claim) => {
    const observations = entrypoints.filter((entrypoint) => entrypoint.platform === claim.platform)
      .map((entrypoint) => entrypoint.qualification);
    let observedQualification = 'unmeasured';
    if (observations.length && observations.every((value) => value === 'actually_executed')) {
      observedQualification = 'actually_executed';
    } else if (observations.length && observations.every((value) => (
      value === 'actually_executed' || value === 'structurally_inspected'
    ))) {
      observedQualification = 'structurally_inspected';
    }
    return {
      ...claim,
      observedQualification,
      claimAccurate: QUALIFICATION_RANK[claim.claimedQualification]
        <= QUALIFICATION_RANK[observedQualification],
    };
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function qualifyExecutableArtifact({
  archiveBytes: input,
  contract,
  platform = process.platform,
  spawnProcess = spawn,
  outputLimit = DEFAULT_OUTPUT_BYTES,
  temporaryRoot = null,
  archiveLimits,
} = {}) {
  contract = validateDeliverableContract(contract);
  if (!PLATFORMS.has(platform)) throw new TypeError(`unsupported current platform: ${platform}`);
  if (!Number.isInteger(outputLimit) || outputLimit < 1_024 || outputLimit > 1024 * 1024) {
    throw new TypeError('outputLimit must be between 1024 and 1048576');
  }
  const archiveBytes = Buffer.from(input ?? []);
  const actualSha256 = sha256(archiveBytes);
  const identityMatched = actualSha256 === contract.artifact.sha256;
  const baseReceipt = {
    schema: RECEIPT_SCHEMA,
    artifact: { ...contract.artifact, observedSha256: actualSha256 },
    currentPlatform: platform,
  };
  if (!identityMatched) {
    return {
      ...baseReceipt,
      archive: { identityMatched: false, extracted: false, manifestState: 'not_inspected' },
      expectedFiles: [], guideReferences: [], entrypoints: [], platforms: [],
      checks: {
        artifactIdentityMatched: false, safeArchive: false, expectedFilesPresent: false,
        guideReferencesResolved: false, advertisedEntrypointsQualified: false,
        atLeastOneEntrypointActuallyExecuted: false, platformClaimsAccurate: false,
      },
      state: 'unqualified', passed: false,
    };
  }

  let manifest;
  try { manifest = inspectZipArchive(archiveBytes, archiveLimits); }
  catch (error) {
    return {
      ...baseReceipt,
      archive: {
        identityMatched: true, extracted: false, manifestState: 'invalid_archive',
        error: error?.message ?? String(error),
      },
      expectedFiles: [], guideReferences: [], entrypoints: [], platforms: [],
      checks: {
        artifactIdentityMatched: true, safeArchive: false, expectedFilesPresent: false,
        guideReferencesResolved: false, advertisedEntrypointsQualified: false,
        atLeastOneEntrypointActuallyExecuted: false, platformClaimsAccurate: false,
      },
      state: 'unqualified', passed: false,
    };
  }
  if (manifest.state !== 'safe_manifest') {
    return {
      ...baseReceipt,
      archive: {
        identityMatched: true, extracted: false, manifestState: manifest.state,
        reason: manifest.reason,
      },
      expectedFiles: [], guideReferences: [], entrypoints: [], platforms: [],
      checks: {
        artifactIdentityMatched: true, safeArchive: false, expectedFilesPresent: false,
        guideReferencesResolved: false, advertisedEntrypointsQualified: false,
        atLeastOneEntrypointActuallyExecuted: false, platformClaimsAccurate: false,
      },
      state: 'unqualified', passed: false,
    };
  }

  const parent = temporaryRoot
    ? await mkdtemp(join(resolve(temporaryRoot), 't5-executable-qualification-'))
    : await mkdtemp(join(tmpdir(), 't5-executable-qualification-'));
  const extractedPath = join(parent, 'expanded');
  try {
    const extracted = await extractSafeZip({
      bytes: archiveBytes, directory: extractedPath, limits: archiveLimits,
    });
    const home = join(parent, 'home');
    await mkdir(home, { mode: 0o700 });
    const archiveEntryByPath = new Map(manifest.entries
      .filter((entry) => !entry.directory).map((entry) => [entry.path, entry]));
    const manifestPaths = new Set(archiveEntryByPath.keys());
    const fileHashByPath = new Map(extracted.files.map((file) => [
      file.path.slice(extracted.root.length + sep.length).split(sep).join('/'), file.sha256,
    ]));
    const expectedFiles = await Promise.all(contract.expectedFiles.map(async (path) => {
      const present = manifestPaths.has(path);
      let extractedMode = null;
      if (present) extractedMode = (await lstat(resolve(extracted.root, path))).mode & 0o777;
      return { path, present, sha256: fileHashByPath.get(path) ?? null, extractedMode };
    }));
    const guideReferences = contract.guideReferences.map((reference) => ({
      ...reference,
      guidePresent: manifestPaths.has(reference.guidePath),
      targetPresent: manifestPaths.has(reference.targetPath),
    }));
    const entrypoints = [];
    for (const entrypoint of contract.advertisedEntrypoints) {
      const pathPresent = manifestPaths.has(entrypoint.path);
      const archiveUnixMode = archiveEntryByPath.get(entrypoint.path)?.unixMode ?? null;
      const executablePermissionSatisfied = !entrypoint.requiresExecutablePermission
        || (archiveUnixMode != null && (archiveUnixMode & 0o111) !== 0);
      const cwdPresent = manifest.entries.some((entry) => (
        entry.path === `${entrypoint.cwd}/` || entry.path.startsWith(`${entrypoint.cwd}/`)
      ));
      let extractedMode = null;
      if (pathPresent) extractedMode = (await lstat(resolve(extracted.root, entrypoint.path))).mode & 0o777;
      let execution;
      if (!pathPresent) {
        execution = {
          attempted: false, reason: 'entrypoint_missing', stdout: '', stderr: '', processResidual: false,
        };
      } else if (!executablePermissionSatisfied) {
        execution = {
          attempted: false, reason: 'entrypoint_not_executable_in_archive',
          stdout: '', stderr: '', processResidual: false,
        };
      } else if (!cwdPresent) {
        execution = {
          attempted: false, reason: 'cwd_missing', stdout: '', stderr: '', processResidual: false,
        };
      } else if (entrypoint.platform !== platform) {
        execution = {
          attempted: false, reason: 'platform_not_current', stdout: '', stderr: '', processResidual: false,
        };
      } else {
        execution = await runEntrypoint({
          entrypoint, root: extracted.root, home, spawnProcess, outputLimit,
        });
      }
      const qualification = pathPresent && cwdPresent && executablePermissionSatisfied
        ? entrypointQualification(entrypoint, execution, platform)
        : 'failed';
      entrypoints.push({
        id: entrypoint.id, platform: entrypoint.platform,
        interpreter: entrypoint.interpreter, interpreterArgs: entrypoint.interpreterArgs,
        path: entrypoint.path, cwd: entrypoint.cwd,
        pathPresent, cwdPresent, archiveUnixMode, extractedMode,
        requiresExecutablePermission: entrypoint.requiresExecutablePermission,
        executablePermissionSatisfied,
        expected: {
          exitCode: entrypoint.expectedExitCode,
          stdoutIncludes: entrypoint.expectedStdoutIncludes,
          stderrIncludes: entrypoint.expectedStderrIncludes,
        },
        execution,
        qualification,
      });
    }
    const platforms = platformObservations(contract, entrypoints);
    const checks = {
      artifactIdentityMatched: true,
      safeArchive: true,
      expectedFilesPresent: expectedFiles.every((file) => file.present),
      guideReferencesResolved: guideReferences.every((reference) => (
        reference.guidePresent && reference.targetPresent
      )),
      advertisedEntrypointsQualified: entrypoints.every((entrypoint) => (
        entrypoint.platform === platform
          ? entrypoint.qualification === 'actually_executed'
          : entrypoint.qualification === 'structurally_inspected'
      )),
      atLeastOneEntrypointActuallyExecuted: entrypoints.some((entrypoint) => (
        entrypoint.qualification === 'actually_executed'
      )),
      platformClaimsAccurate: platforms.every((claim) => claim.claimAccurate),
    };
    const passed = Object.values(checks).every(Boolean);
    return {
      ...baseReceipt,
      archive: {
        identityMatched: true, extracted: true, manifestState: manifest.state,
        entryCount: manifest.entryCount,
        totalCompressedBytes: manifest.totalCompressedBytes,
        totalUncompressedBytes: manifest.totalUncompressedBytes,
      },
      expectedFiles, guideReferences, entrypoints, platforms, checks,
      state: passed ? 'qualified' : 'unqualified', passed,
    };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}
