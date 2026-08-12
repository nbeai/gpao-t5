#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const help = process.argv.includes('--help');
const runsAt = process.argv.indexOf('--runs');
const runs = runsAt >= 0 ? Number(process.argv[runsAt + 1]) : 5;

if (help) {
  console.log('Usage: node scripts/calibrate-gate.mjs [--runs 5]');
  console.log('Runs the unchanged test suite repeatedly and prints evidence. It never edits gate-baseline.json.');
  process.exit(0);
}
if (!Number.isInteger(runs) || runs < 3 || runs > 9) {
  console.error('--runs must be an integer from 3 to 9');
  process.exit(2);
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
}

function measure() {
  const started = Date.now();
  // The spec reporter emits thousands of lines through a pipe. Node 24's test
  // workers have crashed in that shape on macOS; dot keeps the test set
  // identical while making the measurement transport small and stable.
  const result = spawnSync('/usr/bin/time', ['-p', 'npm', 'test', '--', '--test-reporter=dot'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const timing = `${result.stderr ?? ''}`.match(/real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys\s+([\d.]+)/s);
  if (result.status !== 0 || !timing) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`test run failed with status ${result.status}`);
  }
  return {
    wallSeconds: Number(timing[1]),
    cpuSeconds: Number(timing[2]) + Number(timing[3]),
    elapsedSeconds: (Date.now() - started) / 1000,
    loadAverage: loadavg().map((n) => Number(n.toFixed(2))),
  };
}

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
const samples = [];
for (let i = 0; i < runs; i += 1) {
  const sample = measure();
  samples.push(sample);
  console.error(`run ${i + 1}/${runs}: CPU ${sample.cpuSeconds.toFixed(1)}s · wall ${sample.wallSeconds.toFixed(1)}s`);
}

const cpu = samples.map((s) => s.cpuSeconds);
const wall = samples.map((s) => s.wallSeconds);
console.log(JSON.stringify({
  schemaVersion: 1,
  commit,
  dirty,
  node: process.version,
  logicalCpuCount: cpus().length,
  runs,
  samples,
  summary: {
    cpu: { min: Math.min(...cpu), median: quantile(cpu, 0.5), p95: quantile(cpu, 0.95), max: Math.max(...cpu) },
    wall: { min: Math.min(...wall), median: quantile(wall, 0.5), p95: quantile(wall, 0.95), max: Math.max(...wall) },
  },
  baselineChanged: false,
}, null, 2));
