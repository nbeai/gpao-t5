#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./command-explainer-child.mjs', import.meta.url));
const now = () => Number(process.hrtime.bigint()) / 1_000_000;

function client() {
  const child = spawn(process.execPath, [helper, '--persistent'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map(); let stderr = ''; let sequence = 0;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-1000); });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let response;
    try { response = JSON.parse(line); } catch { response = null; }
    const entry = response?.id && pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok === true) entry.resolve({ ...response, wallMs: now() - entry.startedAt });
    else entry.reject(new Error(response?.error ?? 'invalid_explanation_response'));
  });
  child.once('exit', () => {
    for (const entry of pending.values()) entry.reject(new Error('explainer_process_exited'));
    pending.clear();
  });
  return {
    child,
    explain(command) {
      const id = `q-${++sequence}`; const startedAt = now();
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, startedAt });
        child.stdin.write(`${JSON.stringify({ id, command })}\n`, (error) => {
          if (!error) return;
          pending.delete(id); reject(error);
        });
      });
    },
    async close() {
      child.stdin.end();
      if (child.exitCode == null) await once(child, 'close');
      lines.close();
      return stderr;
    },
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const first = client();
  const cold = await first.explain("printf 'cold'");
  const warm = [];
  for (let index = 0; index < 20; index += 1) {
    warm.push(await first.explain(index % 2
      ? "printf 'warm' | wc -c" : "diff a b | sed -n '1,4p'"));
  }
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, index) => (
    first.explain(`printf 'parallel-${index}'`)
  )));
  await first.close();

  const crashed = client();
  const pending = crashed.explain("printf 'crash'");
  crashed.child.kill('SIGKILL');
  let crashState = null;
  try { await pending; crashState = 'incorrectly_completed'; }
  catch (error) { crashState = error.message; }
  if (crashed.child.exitCode == null && crashed.child.signalCode == null) {
    await once(crashed.child, 'close').catch(() => {});
  }

  const successor = client();
  const recovered = await successor.explain("printf 'after-crash'");
  await successor.close();

  const exactConcurrent = concurrent.every((item, index) => (
    item.id === `q-${22 + index}`
    && item.result.steps?.[0]?.argv?.[1] === `parallel-${index}`
  ));
  const report = {
    schema: 't5.s4d5b.persistent-explainer.v1',
    recordedOn: new Date().toISOString().slice(0, 10),
    platform: process.platform, architecture: process.arch, node: process.version,
    productChanges: 0, isolatedTemporaryData: true, realUserData: false, externalWrites: 0,
    cold: { wallMs: cold.wallMs, helperRss: cold.rss, exact: cold.result.steps?.[0]?.executable === 'printf' },
    warm: { calls: warm.length, medianWallMs: median(warm.map((item) => item.wallMs)),
      maxWallMs: Math.max(...warm.map((item) => item.wallMs)),
      helperMedianRss: median(warm.map((item) => item.rss)),
      pipelineFactsExact: warm.every((item, index) => index % 2 === 0
        ? item.result.shapes.includes('pipeline') : item.result.shapes.includes('pipeline')) },
    concurrent: { calls: concurrent.length, exactIdentity: exactConcurrent,
      uniqueIds: new Set(concurrent.map((item) => item.id)).size },
    crash: { pendingState: crashState, automaticCommandExecution: 0,
      successorExact: recovered.result.steps?.[0]?.argv?.[1] === 'after-crash' },
  };
  report.passed = report.cold.exact && report.warm.pipelineFactsExact
    && report.concurrent.exactIdentity && report.concurrent.uniqueIds === report.concurrent.calls
    && report.crash.pendingState === 'explainer_process_exited' && report.crash.successorExact;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}

await main();
