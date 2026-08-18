#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

const roundsIndex = process.argv.indexOf('--rounds');
const rounds = Number(roundsIndex >= 0 ? process.argv[roundsIndex + 1] : 2);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new TypeError('--rounds must be an integer from 1 to 10');
}
const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-tool-projection-'));
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const emptySkillsRoot = join(room, 'empty-skills');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const CASES = [
  {
    id: 'successful-observation', value: 'PROJECTION-7391', outcome: 'succeeded', exitCode: 0,
    stdout: 'PROJECTION-7391\n', stderr: '', finalAnswer: '확인했습니다.',
    request: '터미널을 다시 사용하지 말고 직전 도구 결과에서 확인한 값을 정확히 알려줘.',
    expected: ['PROJECTION-7391'],
  },
  {
    id: 'failed-observation', value: null, outcome: 'failed', exitCode: 1,
    stdout: '', stderr: 'ENOENT projection-missing.txt\n', finalAnswer: '실패했습니다.',
    request: '터미널을 다시 사용하지 말고 직전 명령이 실패한 정확한 원인과 종료코드를 알려줘.',
    expected: ['ENOENT', '1'],
  },
];

function seedReceipt(spec) {
  return {
    toolCallId: 'seed-call',
    requestedCall: {
      id: 'seed-call', name: 'exec',
      args: { command: 'cat continuity-value.txt', cwd: null, effect: {
        kind: 'observe', summary: 'read seeded value', targets: ['continuity-value.txt'],
        reversible: true, backupAvailable: false, recipientNew: false, approvalToken: null,
      } },
    },
    actualCall: { name: 'exec', args: { command: 'cat continuity-value.txt', cwd: null } },
    outcome: spec.outcome,
    result: {
      state: spec.outcome === 'succeeded' ? 'completed' : 'failed', cwd: workspace,
      stdout: spec.stdout, stderr: spec.stderr, truncated: false,
      omittedChars: 0, exitCode: spec.exitCode, signal: null, durationMs: 12,
      startedAt: '2026-08-19T00:00:00.000Z', endedAt: '2026-08-19T00:00:00.012Z',
      effectObservation: {
        declared: { kind: 'observe', summary: 'read seeded value', targets: ['continuity-value.txt'] },
        before: { observed: true, targets: [{ path: join(workspace, 'continuity-value.txt'), sha256: 'a'.repeat(64) }] },
        after: { observed: true, targets: [{ path: join(workspace, 'continuity-value.txt'), sha256: 'a'.repeat(64) }] },
        changed: false,
      },
      commandExplanation: {
        ok: true, source: 'cat continuity-value.txt',
        steps: Array.from({ length: 24 }, (_, index) => ({
          id: `step-${index}`, context: 'top-level', executable: 'cat', argv: ['cat', 'continuity-value.txt'],
        })),
      },
    },
  };
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

async function seedSession(stateDir, spec) {
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create();
  const ledger = new ConversationLedger(join(stateDir, 'conversations'));
  await ledger.ensure({ sessionId: session.id });
  const receiptContent = JSON.stringify(seedReceipt(spec));
  const messages = [
    { id: 'seed-user', message: { role: 'user', content: '파일 값을 확인해줘' } },
    { id: 'seed-assistant-call', message: {
      role: 'assistant', content: '',
      toolCalls: [{ id: 'seed-call', name: 'exec', args: { command: 'cat continuity-value.txt', cwd: null } }],
    } },
    { id: 'seed-tool', message: {
      role: 'tool', toolCallId: 'seed-call', name: 'exec', content: receiptContent,
    } },
    { id: 'seed-assistant-final', message: { role: 'assistant', content: spec.finalAnswer } },
  ];
  for (const item of messages) {
    await ledger.appendMessage({
      sessionId: session.id, messageId: item.id, runId: 'seed-run', message: item.message,
    });
  }
  return { sessionId: session.id, receiptContent, receiptDigest: digest(receiptContent) };
}

async function startArm(name, conversationProjection) {
  const stateDir = join(room, `state-${name}`);
  await mkdir(stateDir, { recursive: true });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  const server = makeConsoleServer({
    stateDir, workspace, skillsRoot: emptySkillsRoot, conversationProjection,
    modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
    computerEnvironment: discoverComputerEnvironment({ userHome: workspace }),
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return { name, stateDir, server, base: `http://127.0.0.1:${server.address().port}` };
}

async function closeArm(arm) {
  arm.server.closeWakeStreams();
  await arm.server.managedProcesses.stopAll('projection_comparison_shutdown');
  await new Promise((resolveClose) => arm.server.close(resolveClose));
}

async function runCase(arm, round, spec) {
  const seeded = await seedSession(arm.stateDir, spec);
  const surface = await fetch(`${arm.base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: seeded.sessionId,
      text: spec.request,
    }),
  }).then(async (response) => {
    const value = await response.json();
    if (!response.ok) throw new Error(`${arm.name}: ${JSON.stringify(value)}`);
    return value;
  });
  const [run, context] = await Promise.all([
    fetch(`${arm.base}/runs/${surface.runId}`).then((response) => response.json()),
    fetch(`${arm.base}/runs/${surface.runId}/context`).then((response) => response.json()),
  ]);
  const canonical = await arm.server.conversationLedger.read(seeded.sessionId);
  const seededTool = canonical.events.find((event) => event.messageId === 'seed-tool');
  const toolCalls = run.events.filter((event) => event.type === 'tool_completed').length;
  const call = context.calls[0];
  return {
    arm: arm.name, round, caseId: spec.id, sessionId: seeded.sessionId, runId: run.runId,
    passed: spec.expected.every((value) => surface.reply.includes(value)) && toolCalls === 0,
    answer: surface.reply, toolCalls,
    requestBytes: call.context.requestBytes,
    inputBytes: call.context.input.bytes,
    functionOutputBytes: call.context.input.byKind.function_call_output?.bytes ?? 0,
    providerInputTokens: call.providerUsage?.inputTokens ?? null,
    canonicalReceiptUnchanged: digest(seededTool.message.content) === seeded.receiptDigest,
  };
}

function aggregate(results, arm) {
  const rows = results.filter((result) => result.arm === arm);
  const sum = (key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    cases: rows.length, passed: rows.filter((row) => row.passed).length,
    requestBytes: sum('requestBytes'), inputBytes: sum('inputBytes'),
    functionOutputBytes: sum('functionOutputBytes'), providerInputTokens: sum('providerInputTokens'),
    toolCalls: sum('toolCalls'), canonicalReceiptsUnchanged: rows.filter((row) => row.canonicalReceiptUnchanged).length,
  };
}

await Promise.all([workspace, isolatedHome, emptySkillsRoot].map((path) => mkdir(path, { recursive: true })));
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const arms = {
  full: await startArm('full', 'full'),
  projected: await startArm('projected', 'historical-tool-receipt-v1'),
};
const results = [];
try {
  for (let round = 1; round <= rounds; round += 1) {
    for (const [caseIndex, spec] of CASES.entries()) {
      const fullFirst = (round + caseIndex) % 2 === 1;
      const order = fullFirst ? [arms.full, arms.projected] : [arms.projected, arms.full];
      for (const arm of order) results.push(await runCase(arm, round, spec));
    }
  }
  const full = aggregate(results, 'full');
  const projected = aggregate(results, 'projected');
  const output = {
    schema: 't5.tool-receipt-projection-comparison.v1', recordedAt: new Date().toISOString(),
    model: (await makeConsoleModelAccess({ connectionFile, stateDir: join(room, 'status') }).status()).modelId,
    rounds, actualUserData: false, results,
    aggregate: {
      full, projected,
      deltaProjectedMinusFull: {
        passed: projected.passed - full.passed,
        requestBytes: projected.requestBytes - full.requestBytes,
        inputBytes: projected.inputBytes - full.inputBytes,
        functionOutputBytes: projected.functionOutputBytes - full.functionOutputBytes,
        providerInputTokens: projected.providerInputTokens - full.providerInputTokens,
        toolCalls: projected.toolCalls - full.toolCalls,
      },
    },
    room: keep ? room : null,
  };
  console.log(JSON.stringify(output, null, 2));
  const expected = rounds * CASES.length;
  if (full.passed !== expected || projected.passed !== expected
    || projected.canonicalReceiptsUnchanged !== expected) process.exitCode = 1;
} finally {
  await Promise.all(Object.values(arms).map(closeArm));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
