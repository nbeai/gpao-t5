import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const inside = (candidate, root) => { const value = relative(root, candidate); return value === ''
  || (value !== '..' && !value.startsWith(`..${sep}`)); };
const seatbelt = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

function profile(scratch, protectedReadRoots) {
  return ['(version 1)', '(allow default)', '(deny network*)', '(deny file-write*)',
    '(allow file-write* (regex #"^/dev/(null|stdout|stderr|tty|fd/[0-9]+)$"))',
    `(allow file-write* (subpath "${seatbelt(scratch)}"))`,
    ...protectedReadRoots.map((root) => `(deny file-read* (subpath "${seatbelt(root)}"))`),
  ].join('\n');
}

async function makeWritable(directory) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('shell snapshot contains a symlink');
    if (entry.isDirectory()) await makeWritable(path);
    else if (entry.isFile()) await chmod(path, 0o600);
    else throw new Error('shell snapshot contains an unsupported entry');
  }
}

async function filesBelow(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error('shell execution created a symlink');
    if (entry.isDirectory()) await filesBelow(root, path, result);
    else if (entry.isFile()) result.push(relative(root, path).replaceAll('\\', '/'));
    else throw new Error('shell execution created an unsupported entry');
    if (result.length > 8192) throw new Error('shell execution output bound exceeded');
  }
  return result;
}

export async function executeSnapshotShellQualification({ command, snapshot, outputs,
  processRegistry, ownerId, scratchRoot: rootValue, protectedReadRoots = [],
  shell = '/bin/zsh', sandboxExec = '/usr/bin/sandbox-exec', executionPath = '/usr/bin:/bin',
  timeoutMs = 15_000, maxOutputBytes = 16 * 1024 * 1024, signal = null } = {}) {
  if (!String(command ?? '').trim() || snapshot?.state !== 'snapshot_read_only'
    || !Array.isArray(outputs) || !outputs.length || !processRegistry?.start) {
    throw new TypeError('snapshot shell qualification dependencies are incomplete');
  }
  const root = resolve(rootValue); await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root); const scratch = await mkdtemp(join(canonicalRoot, 'shell_'));
  try {
    await execFile('/bin/cp', ['-cR', `${snapshot.directory}/.`, scratch], {
      timeout: 10_000, maxBuffer: 16 * 1024, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    await makeWritable(scratch);
    const temporaryRoot = join(scratch, '.tmp'); await mkdir(temporaryRoot, { mode: 0o700 });
    const protectedRoots = [];
    for (const value of [snapshot.workspace, ...protectedReadRoots]) {
      try { const canonical = await realpath(resolve(value));
        if (inside(scratch, canonical)) throw new Error('shell scratch overlaps protected read root');
        protectedRoots.push(canonical); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const started = await processRegistry.start({ program: sandboxExec,
      args: ['-p', profile(scratch, [...new Set(protectedRoots)]), shell, '-lc', command],
      cwd: scratch, ownerId, waitMs: 0, spoolLimit: 128 * 1024,
      env: { PATH: executionPath, HOME: scratch, USERPROFILE: scratch,
        LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: temporaryRoot, TMP: temporaryRoot,
        TEMP: temporaryRoot, TMPPREFIX: join(temporaryRoot, 'zsh') },
      metadata: { kind: 'snapshot_shell_qualification' } });
    let current = started; let cursor = started.cursor; let stdout = started.stdout; let stderr = started.stderr;
    const deadline = Date.now() + timeoutMs;
    while (current.state === 'running') {
      if (signal?.aborted || Date.now() >= deadline) {
        current = await processRegistry.stop({ processId: current.processId, ownerId,
          reason: signal?.aborted ? 'snapshot_shell_cancelled' : 'snapshot_shell_timeout', cursor });
        return { execution: null, receipt: { state: 'shell_failed_no_publication',
          reason: signal?.aborted ? 'cancelled' : 'timeout', processBoundary: current.processBoundary ?? null } };
      }
      current = await processRegistry.poll({ processId: current.processId, ownerId, cursor, waitMs: 25 });
      stdout += current.stdout; stderr += current.stderr; cursor = current.cursor;
    }
    if (current.state !== 'completed' || current.exitCode !== 0) return { execution: null, receipt: {
      state: 'shell_failed_no_publication', reason: 'command_failed', processExitCode: current.exitCode,
      boundaryDenied: stderr.includes('Operation not permitted'),
      stdout: stdout.slice(0, 8_000), stderr: stderr.slice(0, 8_000),
      processBoundary: current.processBoundary ?? null } };
    if (/Operation not permitted|sandbox|deny/iu.test(stderr)) return { execution: null, receipt: {
      state: 'shell_failed_no_publication', reason: 'boundary_denied', boundaryDenied: true,
      stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr),
      processBoundary: current.processBoundary ?? null } };
    const declared = [];
    for (const output of outputs) {
      const relativePath = String(output.relativePath ?? '').replaceAll('\\', '/');
      if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error('shell output path escaped');
      }
      const path = join(scratch, relativePath); const identity = await lstat(path);
      if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1 || identity.size > maxOutputBytes) {
        return { execution: null, receipt: { state: 'shell_output_unverified', reason: 'declared_output_missing_or_unsafe' } };
      }
      const bytes = await readFile(path); declared.push({ ...output, relativePath,
        bytes, size: bytes.length, sha256: sha256(bytes) });
    }
    for (const file of snapshot.files) {
      if (outputs.some((output) => output.relativePath === file.relativePath)) continue;
      try { const bytes = await readFile(join(scratch, file.relativePath));
        if (sha256(bytes) !== file.sha256) return { execution: null, receipt: {
          state: 'shell_output_unverified', reason: 'snapshot_input_changed' } }; }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const actualFiles = await filesBelow(scratch); const expected = new Set(snapshot.files.map((file) => file.relativePath));
    const outputPaths = new Set(outputs.map((output) => output.relativePath));
    const temporaryCount = actualFiles.filter((path) => !expected.has(path) && !outputPaths.has(path)).length;
    return { execution: { state: 'shell_output_unverified', outputs: declared }, receipt: {
      state: 'shell_output_unverified', outputCount: declared.length, temporaryCount,
      networkDenied: true, outsideWriteDenied: true, exactCommand: true,
      processBoundary: current.processBoundary ?? null } };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
