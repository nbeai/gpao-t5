#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertIncidentFixture } from '../src/incident-reference-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '..', 'config', 's2-incident-reference-fixtures.json');
const index = process.argv.indexOf('--runs-dir');
if (index < 0 || !process.argv[index + 1]) {
  console.error('usage: verify-s2-a0-incident-source.mjs --runs-dir /absolute/path/to/runs');
  process.exit(2);
}
const runsDirectory = resolve(process.argv[index + 1]);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assertIncidentFixture(fixture);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function profile(events) {
  let pendingTools = 0;
  let pendingBrowser = 0;
  const calls = [];
  for (const event of events) {
    if (event.type === 'tool_completed') {
      pendingTools += 1;
      if (event.payload?.receipt?.requestedCall?.name === 'browser') pendingBrowser += 1;
    }
    if (event.type === 'model_completed') {
      calls.push([
        Number(event.payload?.response?.usage?.total_tokens ?? 0),
        Number(event.payload?.response?.contextReceipt?.requestBytes ?? 0),
        pendingTools,
        pendingBrowser,
      ]);
      pendingTools = 0;
      pendingBrowser = 0;
    }
  }
  const terminal = [...events].reverse().find((event) => /^run_(completed|failed|cancelled)$/u.test(event.type));
  return {
    relation: events[0]?.payload?.metadata?.trigger === 'automation'
      ? 'automation_occurrence' : 'origin_conversation',
    status: terminal?.type?.slice('run_'.length) ?? 'interrupted',
    calls,
    terminalToolReceipts: pendingTools,
    terminalBrowserReceipts: pendingBrowser,
  };
}

const sources = new Map();
for (const name of await readdir(runsDirectory)) {
  if (!name.endsWith('.jsonl')) continue;
  const bytes = await readFile(resolve(runsDirectory, name));
  sources.set(sha256(bytes), bytes);
}

const failures = [];
for (const expected of fixture.resourceRunaway.runs) {
  const bytes = sources.get(expected.sourceSha256);
  if (!bytes || bytes.length !== expected.sourceBytes) {
    failures.push(`${expected.runRef}:source_identity`);
    continue;
  }
  let events;
  try { events = bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse); }
  catch { failures.push(`${expected.runRef}:invalid_jsonl`); continue; }
  const actual = profile(events);
  const comparable = {
    relation: expected.relation,
    status: expected.status,
    calls: expected.calls,
    terminalToolReceipts: expected.terminalToolReceipts ?? 0,
    terminalBrowserReceipts: expected.terminalBrowserReceipts ?? 0,
  };
  if (JSON.stringify(actual) !== JSON.stringify(comparable)) failures.push(`${expected.runRef}:profile`);
}

if (failures.length) {
  console.error(JSON.stringify({ schema: 't5.s2-a0-source-verification.v1', passed: false, failures }));
  process.exit(1);
}
console.log(JSON.stringify({
  schema: 't5.s2-a0-source-verification.v1', passed: true,
  matchedRawRuns: fixture.resourceRunaway.runs.length,
  modelCalls: fixture.resourceRunaway.totals.modelCalls,
  providerTokens: fixture.resourceRunaway.totals.providerTokens,
  contentEmitted: false,
}));
