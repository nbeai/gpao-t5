#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const seatbelt = (value) => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');

function profile({ scratch, protectedRoot, interpreter }) {
  return [
    '(version 1)', '(allow default)', '(deny file-write*)',
    `(allow file-write* (subpath "${seatbelt(scratch)}"))`,
    '(deny network*)',
    `(deny file-read* (subpath "${seatbelt(protectedRoot)}"))`,
    '(deny process-exec*)',
    `(allow process-exec (literal "${seatbelt(interpreter)}"))`,
  ].join('\n');
}

async function run({ interpreter, sandboxProfile, source, scratch, permission = true,
  heapMb = 64, timeoutMs = 2_000, outputLimit = 64 * 1024, env = {},
  rssLimitBytes = null, rssPollMs = 10 }) {
  const args = ['-p', sandboxProfile, interpreter,
    ...(permission ? ['--permission', `--allow-fs-read=${scratch}`, `--allow-fs-write=${scratch}`] : []),
    `--max-old-space-size=${heapMb}`, source];
  const child = spawn('/usr/bin/sandbox-exec', args, { cwd: scratch, detached: true,
    env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let stdoutBytes = 0; let stderrBytes = 0; let outputTruncated = false;
  const collect = (kind, chunk) => {
    const text = chunk.toString('utf8');
    if (kind === 'stdout') stdoutBytes += chunk.length; else stderrBytes += chunk.length;
    const current = kind === 'stdout' ? stdout : stderr; const remaining = Math.max(0, outputLimit - current.length);
    const next = `${current}${text.slice(0, remaining)}`; if (text.length > remaining) outputTruncated = true;
    if (kind === 'stdout') stdout = next; else stderr = next;
  };
  child.stdout.on('data', (chunk) => collect('stdout', chunk)); child.stderr.on('data', (chunk) => collect('stderr', chunk));
  let rssProbeRunning = false; let peakRssBytes = 0; let rssLimitExceeded = false;
  const rssTimer = rssLimitBytes == null ? null : setInterval(async () => {
    if (rssProbeRunning) return; rssProbeRunning = true;
    try {
      const probe = spawn('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let value = ''; probe.stdout.on('data', (chunk) => { value += chunk.toString('utf8'); });
      await new Promise((resolveProbe) => probe.once('close', resolveProbe));
      const rss = Number.parseInt(value.trim(), 10) * 1024;
      if (Number.isFinite(rss)) peakRssBytes = Math.max(peakRssBytes, rss);
      if (Number.isFinite(rss) && rss > rssLimitBytes && !rssLimitExceeded) {
        rssLimitExceeded = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
    } finally { rssProbeRunning = false; }
  }, rssPollMs);
  let timedOut = false; const timer = setTimeout(() => { timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutMs);
  const closed = await new Promise((resolveClose, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolveClose({ code, signal }));
  });
  clearTimeout(timer); if (rssTimer) clearInterval(rssTimer);
  return { ...closed, timedOut, stdout, stderr, stdoutBytes, stderrBytes, outputTruncated,
    peakRssBytes, rssLimitExceeded, rssLimitBytes, rssPollMs };
}

function lastJson(result, label) {
  const line = result.stdout.trim().split('\n').filter(Boolean).at(-1);
  if (!line) throw new Error(`${label} produced no result: code=${result.code} signal=${result.signal} stderr=${result.stderr.slice(0, 300)}`);
  try { return JSON.parse(line); }
  catch { throw new Error(`${label} produced malformed result: code=${result.code} signal=${result.signal} stdout=${line.slice(0, 300)} stderr=${result.stderr.slice(0, 300)}`); }
}

async function main() {
  const evidencePath = option('--evidence'); const root = await mkdtemp(join(tmpdir(), 't5-s4g-g3-node-'));
  const scratch = await mkdir(join(root, 'scratch'), { mode: 0o700 }).then(() => realpath(join(root, 'scratch')));
  const outside = await mkdir(join(root, 'outside'), { mode: 0o700 }).then(() => realpath(join(root, 'outside')));
  const protectedRoot = await mkdir(join(root, 'protected'), { mode: 0o700 }).then(() => realpath(join(root, 'protected')));
  const interpreter = await realpath(process.execPath); const sandboxProfile = profile({ scratch, protectedRoot, interpreter });
  const expectedPath = join(scratch, 'expected.txt'); const outsidePath = join(outside, 'outside.txt');
  const protectedPath = join(protectedRoot, 'secret.txt'); const secret = 'G3-PROTECTED-CANARY';
  await writeFile(protectedPath, secret); const safeEnv = { G3_PUBLIC_FIXTURE: 'visible' };
  try {
    const seatbeltOnlySource = join(scratch, 'seatbelt-only.mjs');
    await writeFile(seatbeltOnlySource, `import { spawnSync } from 'node:child_process';
const child = spawnSync(process.execPath, ['-e', 'console.log("nested")']);
console.log(JSON.stringify({ status: child.status, code: child.error?.code ?? null }));
`);
    const seatbeltOnly = await run({ interpreter, sandboxProfile, source: seatbeltOnlySource,
      scratch, permission: false });
    const seatbeltOnlyFact = lastJson(seatbeltOnly, 'seatbelt-only');

    const permissionSource = join(scratch, 'permission.mjs');
    await writeFile(permissionSource, `import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import net from 'node:net';
const result = {};
try { writeFileSync(${JSON.stringify(expectedPath)}, 'fixture-ok'); result.scratchWrite = 'allowed'; }
catch (error) { result.scratchWrite = error.code; }
try { writeFileSync(${JSON.stringify(outsidePath)}, 'escape'); result.outsideWrite = 'allowed'; }
catch (error) { result.outsideWrite = error.code; }
try { readFileSync(${JSON.stringify(protectedPath)}); result.protectedRead = 'allowed'; }
catch (error) { result.protectedRead = error.code; }
try { const child = spawnSync(process.execPath, ['-e', 'console.log("nested")']);
  result.sameInterpreterChild = child.error?.code ?? String(child.status); }
catch (error) { result.sameInterpreterChild = error.code; }
try { new Worker('setInterval(()=>{},1000)', { eval: true }); result.worker = 'allowed'; }
catch (error) { result.worker = error.code; }
result.secretEnvPresent = Object.hasOwn(process.env, 'G3_SECRET_CANARY');
const socket = net.connect(9, '127.0.0.1');
socket.on('connect', () => { result.network = 'allowed'; socket.destroy(); console.log(JSON.stringify(result)); });
socket.on('error', (error) => { result.network = error.code; console.log(JSON.stringify(result)); });
`);
    const permissionRun = await run({ interpreter, sandboxProfile, source: permissionSource,
      scratch, permission: true, env: safeEnv });
    const permissionFact = lastJson(permissionRun, 'permission');

    const memorySource = join(scratch, 'memory.mjs');
    await writeFile(memorySource, `const bytes = 128 * 1024 * 1024;
const value = Buffer.alloc(bytes, 1);
console.log(JSON.stringify({ allocated: value.length, rss: process.memoryUsage().rss }));
`);
    const memoryRun = await run({ interpreter, sandboxProfile, source: memorySource,
      scratch, permission: true, heapMb: 32, timeoutMs: 5_000 });
    const memoryFact = memoryRun.code === 0 ? lastJson(memoryRun, 'memory') : null;
    const memoryLimitedRun = await run({ interpreter, sandboxProfile, source: memorySource,
      scratch, permission: true, heapMb: 32, timeoutMs: 5_000,
      rssLimitBytes: 96 * 1024 * 1024, rssPollMs: 10 });

    const timeoutSource = join(scratch, 'timeout.mjs'); await writeFile(timeoutSource, 'while (true) {}\n');
    const timeoutRun = await run({ interpreter, sandboxProfile, source: timeoutSource,
      scratch, permission: true, timeoutMs: 100 });

    const outputSource = join(scratch, 'output.mjs');
    await writeFile(outputSource, 'process.stdout.write("x".repeat(131072));\n');
    const outputRun = await run({ interpreter, sandboxProfile, source: outputSource,
      scratch, permission: true, outputLimit: 16 * 1024 });

    const result = {
      schema: 't5.s4g.g3-node-confinement-baseline.v1', recordedAt: new Date().toISOString(),
      productChanges: 0, platform: process.platform,
      interpreter: { kind: 'bundled_node_candidate', version: process.version,
        digest: sha256(await readFile(interpreter)) },
      seatbeltOnly: { sameInterpreterChildEscaped: seatbeltOnlyFact.status === 0,
        childStatus: seatbeltOnlyFact.status, childErrorCode: seatbeltOnlyFact.code },
      nodePermissionPlusSeatbelt: {
        fixtureScratchWrite: permissionFact.scratchWrite,
        outsideWriteBlocked: permissionFact.outsideWrite === 'ERR_ACCESS_DENIED' || permissionFact.outsideWrite === 'EPERM',
        protectedReadBlocked: permissionFact.protectedRead === 'ERR_ACCESS_DENIED' || permissionFact.protectedRead === 'EPERM',
        sameInterpreterChildBlocked: permissionFact.sameInterpreterChild === 'ERR_ACCESS_DENIED'
          || permissionFact.sameInterpreterChild === 'EPERM',
        workerBlocked: permissionFact.worker === 'ERR_ACCESS_DENIED' || permissionFact.worker === 'EPERM',
        networkBlocked: permissionFact.network === 'EPERM' || permissionFact.network === 'EACCES',
        secretEnvPresent: permissionFact.secretEnvPresent,
        expectedOutputExact: await readFile(expectedPath, 'utf8') === 'fixture-ok',
      },
      limits: {
        wallTimeoutKilled: timeoutRun.timedOut && timeoutRun.signal === 'SIGKILL',
        outputProjectionBounded: outputRun.outputTruncated && outputRun.stdout.length === 16 * 1024,
        outputProducedBytes: outputRun.stdoutBytes,
        heapLimitMb: 32,
        externalBufferAllocationBytes: memoryFact?.allocated ?? null,
        observedRssBytes: memoryFact?.rss ?? null,
        hardRssBoundaryProven: false,
        sampledRssBoundary: {
          limitBytes: memoryLimitedRun.rssLimitBytes,
          pollMs: memoryLimitedRun.rssPollMs,
          limitExceeded: memoryLimitedRun.rssLimitExceeded,
          killed: memoryLimitedRun.signal === 'SIGKILL',
          peakObservedBytes: memoryLimitedRun.peakRssBytes,
          overshootBytes: Math.max(0, memoryLimitedRun.peakRssBytes - memoryLimitedRun.rssLimitBytes),
          hardCapClaimed: false
        },
      },
      canaries: { outsideWriteAbsent: await readFile(outsidePath).then(() => false).catch((error) => error?.code === 'ENOENT'),
        protectedCanaryUnchanged: await readFile(protectedPath, 'utf8') === secret },
      actualInputExecutions: 0, externalNetworkEffects: 0,
      decision: 'NODE_CANDIDATE_INCOMPLETE_HARD_RSS_BOUNDARY',
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (evidencePath) await writeFile(resolve(evidencePath), serialized, { mode: 0o600 });
    process.stdout.write(serialized);
    const positive = result.nodePermissionPlusSeatbelt;
    if (!result.seatbeltOnly.sameInterpreterChildEscaped || positive.fixtureScratchWrite !== 'allowed'
      || !positive.outsideWriteBlocked || !positive.protectedReadBlocked || !positive.sameInterpreterChildBlocked
      || !positive.workerBlocked || !positive.networkBlocked || positive.secretEnvPresent
      || !positive.expectedOutputExact || !result.limits.wallTimeoutKilled
      || !result.limits.outputProjectionBounded || !result.canaries.outsideWriteAbsent
      || !result.canaries.protectedCanaryUnchanged || !result.limits.sampledRssBoundary.limitExceeded
      || !result.limits.sampledRssBoundary.killed) process.exitCode = 1;
  } finally { await rm(root, { recursive: true, force: true }); }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ schema: 't5.s4g.g3-node-confinement-baseline.v1',
    passed: false, failure: error?.code ?? error?.message ?? String(error) })}\n`); process.exitCode = 1;
});
