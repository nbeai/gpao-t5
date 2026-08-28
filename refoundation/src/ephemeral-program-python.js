import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { publishAtomicFile } from './atomic-file-publication.js';
import { assertExecProgramContract } from './exec-program-contract.js';

const execFile = promisify(execFileCallback);
const INTERPRETERS = new WeakSet();
const ATTEMPTED = new WeakSet();
const EXECUTIONS = new WeakSet();
const DEFAULT_CHILD = fileURLToPath(new URL('../scripts/python-capsule-child.py', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function seatbelt(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function inside(candidate, root) {
  const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !value.startsWith('../'));
}

function profile(scratch, protectedReadRoots) {
  return [
    '(version 1)', '(allow default)', '(deny network*)', '(deny process-fork)', '(deny file-write*)',
    '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
    `(allow file-write* (subpath "${seatbelt(scratch)}"))`,
    ...protectedReadRoots.map((root) => `(deny file-read* (subpath "${seatbelt(root)}"))`),
  ].join('\n');
}

async function filesBelow(root, maximum = 256) {
  const result = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('python capsule scratch contains a symlink');
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
      else throw new Error('python capsule scratch contains an unsupported entry');
      if (result.length > maximum) throw new Error('python capsule scratch entry limit exceeded');
    }
  };
  await visit(root);
  return result;
}

async function reopenInputs(contract, sourceReader) {
  if (!sourceReader?.reopen) throw new TypeError('record source reader required');
  const values = [];
  for (const binding of contract.inputs) {
    const reference = binding.recordRef;
    const reopened = await sourceReader.reopen(reference, {
      expectedSessionId: reference.scope.sessionId, expectedWorkId: contract.workId,
    });
    if (reopened.state !== 'reopened' || reopened.accounting?.digestMatched !== true
      || !Buffer.isBuffer(reopened.source)) return { state: reopened.state, values: null };
    values.push({ binding, bytes: Buffer.from(reopened.source) });
  }
  return { state: 'reopened', values };
}

async function publishExact(target, bytes, publish) {
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const result = await publish({ target, bytes, expectedPreimage: null, mode: 0o600 });
  const reopened = await readFile(target);
  if (result.state !== 'published' || result.sha256 !== sha256(bytes) || sha256(reopened) !== result.sha256) {
    throw new Error('python capsule scratch publication failed');
  }
}

export async function observePythonInterpreter({ path: pathValue, run = execFile } = {}) {
  const path = await realpath(resolve(pathValue));
  const identity = await lstat(path);
  if (!identity.isFile() || identity.isSymbolicLink()) throw new Error('Python interpreter is unavailable');
  const bytes = await readFile(path);
  const observed = await run(path, ['--version'], { timeout: 5_000, maxBuffer: 16 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const version = `${observed.stdout ?? ''}${observed.stderr ?? ''}`.trim();
  if (!/^Python \d+\.\d+\.\d+$/u.test(version)) throw new Error('Python version is unavailable');
  const interpreter = Object.freeze({ schema: 't5.python-interpreter-observation.v1',
    path, version, sha256: sha256(bytes), bytes: bytes.length });
  INTERPRETERS.add(interpreter);
  return interpreter;
}

export async function executePythonProgramQualification({ contract: rawContract, interpreter,
  sourceReader, processRegistry, scratchRoot: rootValue, protectedReadRoots = [],
  sandboxExec = '/usr/bin/sandbox-exec', childPath = DEFAULT_CHILD, timeoutMs = 10_000,
  maxOutputBytes = 16 * 1024 * 1024, publish = publishAtomicFile,
  platform = process.platform, signal = null } = {}) {
  const contract = assertExecProgramContract(rawContract);
  if (platform !== 'darwin') throw new Error('physical macOS Python qualification required');
  if (!INTERPRETERS.has(interpreter) || interpreter.path !== contract.interpreter) {
    throw new TypeError('exact observed Python interpreter required');
  }
  if (contract.sourceLanguage !== 'python' || contract.requirements.filesystem !== true
    || contract.requirements.network !== false || contract.requirements.childProcess !== false
    || contract.requirements.packages !== false) {
    throw new TypeError('first Python qualification requires local stdlib-only filesystem work');
  }
  if (ATTEMPTED.has(contract)) throw new TypeError('Python program qualification already attempted');
  if (!processRegistry?.start || !processRegistry?.poll || !processRegistry?.stop) {
    throw new TypeError('managed process registry required');
  }
  ATTEMPTED.add(contract);
  if (signal?.aborted) return { execution: null, receipt: {
    state: 'actual_failed_no_effect', reason: 'cancelled', userTargetWrites: 0 } };
  const root = resolve(rootValue); await mkdir(root, { recursive: true, mode: 0o700 });
  const rootIdentity = await lstat(root);
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) throw new Error('Python scratch root is unsafe');
  const canonicalRoot = await realpath(root);
  const roots = [];
  for (const candidate of protectedReadRoots) {
    try { const canonical = await realpath(resolve(candidate));
      if (inside(canonicalRoot, canonical)) throw new Error('Python scratch overlaps a protected read root');
      roots.push(canonical); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const childIdentity = await lstat(childPath);
  if (!childIdentity.isFile() || childIdentity.isSymbolicLink() || childIdentity.nlink !== 1) {
    throw new Error('Python capsule child is unavailable');
  }
  const childSha256 = sha256(await readFile(childPath));
  const scratch = await mkdtemp(join(canonicalRoot, 'python_'));
  let cleaned = false;
  try {
    const before = await reopenInputs(contract, sourceReader);
    if (before.state !== 'reopened') return { execution: null, receipt: {
      state: 'actual_failed_no_effect', reason: `input_${before.state}`, userTargetWrites: 0 } };
    const sourcePath = join(scratch, 'program.py');
    await publishExact(sourcePath, Buffer.from(contract.source), publish);
    for (const item of before.values) {
      await publishExact(join(scratch, item.binding.relativePath), item.bytes, publish);
    }
    const started = await processRegistry.start({ program: sandboxExec,
      args: ['-p', profile(scratch, [...new Set(roots)]), interpreter.path, childPath, scratch, sourcePath],
      cwd: scratch, ownerId: contract.workId, waitMs: 0, spoolLimit: 128 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: scratch, USERPROFILE: scratch,
        LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: scratch, TMP: scratch, TEMP: scratch,
        PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1', PYTHONSAFEPATH: '1' },
      metadata: { kind: 'python_program_qualification', sourceSha256: contract.sourceSha256 },
    });
    let current = started; let cursor = started.cursor; let stdout = started.stdout; let stderr = started.stderr;
    const deadline = Date.now() + timeoutMs;
    while (current.state === 'running') {
      if (signal?.aborted) {
        current = await processRegistry.stop({ processId: current.processId, ownerId: contract.workId,
          reason: 'python_program_cancelled', cursor });
        return { execution: null, receipt: { state: 'actual_failed_no_effect', reason: 'cancelled',
          processBoundary: current.processBoundary ?? null, userTargetWrites: 0 } };
      }
      if (Date.now() >= deadline) {
        current = await processRegistry.stop({ processId: current.processId, ownerId: contract.workId,
          reason: 'python_program_timeout', cursor });
        return { execution: null, receipt: { state: 'actual_failed_no_effect', reason: 'timeout',
          processBoundary: current.processBoundary ?? null, userTargetWrites: 0 } };
      }
      current = await processRegistry.poll({ processId: current.processId, ownerId: contract.workId,
        cursor, waitMs: 25 });
      stdout += current.stdout; stderr += current.stderr; cursor = current.cursor;
    }
    if (current.state !== 'completed' || current.exitCode !== 0) return { execution: null, receipt: {
      state: 'actual_failed_no_effect', reason: 'program_failed', processExitCode: current.exitCode,
      boundaryDenied: stderr.includes('T5_PYTHON_CAPSULE_BOUNDARY_DENIED'),
      processBoundary: current.processBoundary ?? null, userTargetWrites: 0 } };
    if (sha256(await readFile(sourcePath)) !== contract.sourceSha256) {
      return { execution: null, receipt: { state: 'actual_failed_no_effect', reason: 'source_changed',
        userTargetWrites: 0 } };
    }
    if (sha256(await readFile(childPath)) !== childSha256) {
      return { execution: null, receipt: { state: 'actual_failed_no_effect', reason: 'child_changed',
        userTargetWrites: 0 } };
    }
    const after = await reopenInputs(contract, sourceReader);
    if (after.state !== 'reopened' || after.values.some((item, index) => (
      sha256(item.bytes) !== sha256(before.values[index].bytes)
    ))) return { execution: null, receipt: { state: 'actual_failed_no_effect',
      reason: 'input_changed_after_execution', userTargetWrites: 0 } };
    for (const item of before.values) {
      if (sha256(await readFile(join(scratch, item.binding.relativePath))) !== sha256(item.bytes)) {
        return { execution: null, receipt: { state: 'actual_failed_no_effect',
          reason: 'staged_input_changed_after_execution', userTargetWrites: 0 } };
      }
    }
    const expectedFiles = new Set(['program.py', ...contract.inputs.map((item) => item.relativePath),
      ...contract.outputs.map((item) => item.relativePath)]);
    const actualFiles = (await filesBelow(scratch)).map((path) => relative(scratch, path).replaceAll('\\', '/'));
    const unexpected = actualFiles.filter((path) => !expectedFiles.has(path));
    if (unexpected.length) return { execution: null, receipt: { state: 'actual_output_unverified',
      reason: 'unexpected_scratch_output', unexpectedCount: unexpected.length, userTargetWrites: 0 } };
    const outputs = [];
    for (const declared of contract.outputs) {
      const path = join(scratch, declared.relativePath); let identity;
      try { identity = await lstat(path); } catch { identity = null; }
      if (!identity?.isFile() || identity.isSymbolicLink() || identity.nlink !== 1
        || identity.size > maxOutputBytes) return { execution: null, receipt: {
        state: 'actual_output_unverified', reason: 'declared_output_missing_or_unsafe', userTargetWrites: 0 } };
      const bytes = await readFile(path); outputs.push({ ...declared, bytes,
        size: bytes.length, sha256: sha256(bytes) });
    }
    const execution = Object.freeze({ schema: 't5.python-program-qualification-output.v1',
      contract, interpreter, childSha256, outputs, stdoutBytes: Buffer.byteLength(stdout),
      stderrBytes: Buffer.byteLength(stderr), state: 'actual_output_unverified' });
    EXECUTIONS.add(execution);
    return { execution, receipt: { state: 'actual_output_unverified', sourceSha256: contract.sourceSha256,
      inputCount: contract.inputs.length, outputCount: outputs.length, unexpectedCount: 0,
      networkDenied: true, processForkDenied: true, scratchWriteConfined: true,
      sourceLanguage: 'python', childSha256, translated: false, userTargetWrites: 0,
      processBoundary: current.processBoundary ?? null } };
  } finally {
    try { await rm(scratch, { recursive: true, force: true });
      cleaned = await lstat(scratch).then(() => false).catch((error) => error?.code === 'ENOENT'); }
    catch { cleaned = false; }
    if (!cleaned) throw new Error('Python capsule scratch cleanup is unknown');
  }
}

export function assertPythonProgramQualificationExecution(value) {
  if (!EXECUTIONS.has(value) || value.state !== 'actual_output_unverified') {
    throw new TypeError('fresh Python program qualification execution required');
  }
  return value;
}
