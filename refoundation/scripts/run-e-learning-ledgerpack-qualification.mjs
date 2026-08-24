#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const modelId = option('--model-id') ?? 'api_key:openai:gpt-5.6-terra';
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-e-ledgerpack-')); const workspace = join(room, 'workspace');
const stateDir = join(room, 'state'); await mkdir(workspace, { recursive: true });
const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
const connectionFile = join(room, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
await writeFile(join(workspace, '2026-08.ledgerpack'), JSON.stringify({ transactions: [
  { label: 'Atlas', amount: 275, approved: true },
  { label: 'Beacon', amount: 125, approved: true },
  { label: 'Cinder', amount: 900, approved: false },
] }), { mode: 0o600 });
await writeFile(join(workspace, 'notes.txt'), '결정사항: 금요일 검토 회의를 오전 열 시에 연다.\n', { mode: 0o600 });
await writeFile(join(workspace, 'ledger-inspect'), `#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const [, , action, target] = process.argv;
if (action !== 'inspect' || !target?.endsWith('.ledgerpack')) process.exit(2);
const data = JSON.parse(await readFile(target, 'utf8'));
const rows = data.transactions.filter((row) => row.approved === true);
const largest = rows.toSorted((a, b) => b.amount - a.amount)[0];
process.stdout.write(JSON.stringify({ approvedTotal: rows.reduce((sum, row) => sum + row.amount, 0), largest }));
`, { mode: 0o700 });
await chmod(join(workspace, 'ledger-inspect'), 0o700);

const access = makeConsoleModelAccess({ connectionFile, stateDir: join(room, 'model-state') });
const server = makeConsoleServer({ stateDir, workspace, learningReviewMode: 'off',
  modelFactory: (context) => access.model(context), modelStatus: () => access.status() });
const source = (index) => ({ eligible: true, pointer: { workId: `source-work-${index}`, revision: 1,
  runId: `source-run-${index}`, sessionId: `source-session-${index}`,
  sourceMessageId: `source-message-${index}`, resultDigest: `source-result-${index}` } });
const ledgerSkill = `---
name: ledgerpack-audit
description: Inspect LedgerPack transaction bundles with the local ledger inspector and verify approved totals.
---

# Inspect a LedgerPack

Locate the LedgerPack that matches the current request. Run \`./ledger-inspect inspect <target.ledgerpack>\`
with the exact selected file substituted for the placeholder. Use the returned approved total and largest approved
transaction, then verify both fields before answering. Do not include rejected transactions.
`;
const unrelatedSkill = `---
name: image-contact-sheet
description: Build and verify a contact sheet from a requested image collection.
---

# Image contact sheet

Inspect the selected images, build a contact sheet, reopen it, and verify its coverage before answering.
`;

async function close() {
  await server.closeWorkspaceConnections(); await server.closeMessengers();
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
}

try {
  await server.learningCandidateStore.stage({ name: 'ledgerpack-audit',
    description: 'Inspect LedgerPack transaction bundles with the local ledger inspector and verify approved totals.',
    content: ledgerSkill, sourcePointers: [source(1), source(2)],
    methodTrace: [{ tool: 'exec', template: './ledger-inspect inspect <target.ledgerpack>' }],
    createdRunId: 'review-ledger' });
  await server.learningCandidateStore.stage({ name: 'image-contact-sheet',
    description: 'Build and verify a contact sheet from a requested image collection.',
    content: unrelatedSkill, sourcePointers: [source(3), source(4)],
    methodTrace: [{ tool: 'exec', template: 'image-sheet build <arg>' }], createdRunId: 'review-images' });
  await new Promise((resolveListen, reject) => { server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const turn = (text) => fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text }) }).then((response) => response.json());
  const unrelated = await turn('작업 폴더의 회의 메모에서 결정사항 한 줄만 알려줘.');
  const field = await turn('작업 폴더에 있는 이번 달 원장 묶음에서 승인된 거래 총액과 가장 큰 거래를 확인해줘.');
  const unrelatedRun = await server.runLedger.read(unrelated.runId); const fieldRun = await server.runLedger.read(field.runId);
  const calls = (run) => run.events.filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload.receipt.requestedCall);
  const unrelatedCalls = calls(unrelatedRun); const fieldCalls = calls(fieldRun);
  const proposals = await server.capabilityLifecycleLedger.list();
  const fieldEvents = proposals.flatMap((proposal) => proposal.events)
    .filter((event) => event.type === 'learning_field_observed');
  const answer = String(field.reply ?? '');
  const report = { schema: 't5.s2-e-learning-ledgerpack-live.v1', recordedAt: new Date().toISOString(), modelId,
    results: {
      multipleCandidates: proposals.filter((proposal) => proposal.type === 'learning_candidate_created').length,
      unrelatedTrialViews: unrelatedCalls.filter((call) => call.name === 'learning_trial' && call.args.action === 'view').length,
      fieldTrialViews: fieldCalls.filter((call) => call.name === 'learning_trial' && call.args.action === 'view').length,
      fieldObservations: fieldEvents.length, fieldObservedRunIds: fieldEvents.map((event) => event.sourceRunId),
      fieldModelTurns: fieldRun.events.findLast((event) => event.type === 'run_completed')?.payload?.modelTurns ?? null,
      fieldToolCalls: fieldCalls.length, fieldCallNames: fieldCalls.map((call) => call.name),
      answer, answerCorrect: /400/u.test(answer) && /Atlas|275/u.test(answer),
    } };
  report.passed = report.results.multipleCandidates === 2 && report.results.unrelatedTrialViews === 0
    && report.results.fieldTrialViews === 1 && report.results.fieldObservations === 1
    && report.results.fieldObservedRunIds[0] === field.runId && report.results.answerCorrect;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
} finally { await close(); await rm(room, { recursive: true, force: true }); }
