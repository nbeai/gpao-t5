import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ResourceController } from '../src/resource-controller.js';
import { ResourceLedger } from '../src/resource-ledger.js';
import { deriveResourceReport } from '../src/resource-report.js';

const room = () => mkdtemp(join(tmpdir(), 't5-resource-ledger-'));

test('ResourceLedger는 content-free append-only event와 idempotent dedupe를 보존한다', async () => {
  const directory = await room();
  const ledger = new ResourceLedger(directory);
  const scope = await ledger.createScope({
    scopeId: 'scope-1', kind: 'run', dedupeKey: 'scope:1', facts: { trigger: 'user' },
  });
  const replay = await ledger.createScope({
    scopeId: 'scope-1', kind: 'run', dedupeKey: 'scope:1', facts: { trigger: 'user' },
  });
  assert.equal(replay.eventId, scope.eventId);
  await assert.rejects(() => ledger.createScope({
    scopeId: 'scope-1', kind: 'run', dedupeKey: 'scope:1', facts: { trigger: 'automation' },
  }), /dedupe conflict/u);
  assert.throws(() => ledger.observe({
    scopeId: 'scope-1', dedupeKey: 'bad-content', resources: {}, facts: { prompt: 'private' },
  }), /content-bearing/u);
  const events = await ledger.read();
  assert.equal(events.length, 1);
  assert.equal(events[0].sequence, 1);
  assert.doesNotMatch(await readFile(join(directory, 'events.jsonl'), 'utf8'), /private/u);
});

test('병렬 reservation은 각각 한 번만 commit되고 중복·충돌 settlement를 막는다', async () => {
  const ledger = new ResourceLedger(await room());
  await ledger.createScope({ scopeId: 'run', kind: 'run', dedupeKey: 'scope:run' });
  await Promise.all([1, 2, 3].map(async (attempt) => {
    const scopeId = `attempt-${attempt}`;
    await ledger.createScope({
      scopeId, parentScopeId: 'run', kind: 'model_attempt', dedupeKey: `scope:${scopeId}`,
    });
    await ledger.reserve({
      scopeId, dedupeKey: `reserve:${attempt}`, reservationId: `reservation-${attempt}`,
      requestId: 'logical-request', attempt, resources: { requestBytes: attempt * 10 },
    });
    await ledger.commit({
      scopeId, dedupeKey: `commit:${attempt}`, reservationId: `reservation-${attempt}`,
      responseId: `response-${attempt}`, resources: { totalTokens: attempt * 100 },
    });
  }));
  const duplicate = await ledger.commit({
    scopeId: 'attempt-2', dedupeKey: 'commit:2', reservationId: 'reservation-2',
    responseId: 'response-2', resources: { totalTokens: 200 },
  });
  assert.equal(duplicate.type, 'ReservationCommitted');
  await assert.rejects(() => ledger.markUnknown({
    scopeId: 'attempt-2', dedupeKey: 'unknown:2', reservationId: 'reservation-2', reason: 'crash',
  }), /already settled/u);
  const events = await ledger.read();
  assert.equal(events.filter((event) => event.type === 'ResourceReserved').length, 3);
  assert.equal(events.filter((event) => event.type === 'ReservationCommitted').length, 3);
});

test('crash 뒤 열린 reservation은 재실행하지 않고 unknown으로 한 번 복구한다', async () => {
  const directory = await room();
  const first = new ResourceLedger(directory);
  await first.createScope({ scopeId: 'run', kind: 'run', dedupeKey: 'scope:run' });
  await first.createScope({
    scopeId: 'attempt', parentScopeId: 'run', kind: 'model_attempt', dedupeKey: 'scope:attempt',
  });
  await first.reserve({
    scopeId: 'attempt', dedupeKey: 'reserve:attempt', reservationId: 'reservation',
    requestId: 'request', attempt: 1, resources: { requestBytes: 123 },
  });
  const restarted = new ResourceLedger(directory);
  assert.equal((await restarted.recoverOpenReservations()).length, 1);
  assert.equal((await restarted.recoverOpenReservations()).length, 0);
  const events = await restarted.read();
  assert.equal(events.filter((event) => event.type === 'UsageMarkedUnknown').length, 1);
  assert.equal(events.find((event) => event.type === 'UsageMarkedUnknown').payload.reason, 'runtime_restarted');
});

test('새 Controller·Run은 이전 Session resource history를 초기화하거나 덮어쓰지 않는다', async () => {
  const directory = await room();
  const firstLedger = new ResourceLedger(directory);
  const firstController = new ResourceController(firstLedger);
  const firstRun = await firstController.startRun({ sessionId: 'session-a', runId: 'run-a' });
  await firstRun.close('completed');
  const before = await firstLedger.read();

  const restartedLedger = new ResourceLedger(directory);
  const restartedController = new ResourceController(restartedLedger);
  const secondRun = await restartedController.startRun({ sessionId: 'session-b', runId: 'run-b' });
  await secondRun.close('completed');
  const after = await restartedLedger.read();
  assert.deepEqual(after.slice(0, before.length), before);
  assert.equal(after.filter((event) => event.type === 'ScopeCreated'
    && event.payload.kind === 'session').length, 2);
  assert.equal(after.filter((event) => event.type === 'ScopeCreated'
    && event.payload.kind === 'run').length, 2);
});

test('ResourceController는 retry attempt·tool·Run을 계층 scope로 한 번 rollup할 근거를 남긴다', async () => {
  let clock = 100;
  let id = 0;
  const ledger = new ResourceLedger(await room(), { makeId: () => `event-${++id}` });
  const controller = new ResourceController(ledger, {
    now: () => clock,
    makeId: () => `reservation-${++id}`,
  });
  const run = await controller.startRun({ sessionId: 'session-A', runId: 'run-A', trigger: 'user' });
  const observer = run.modelObserver({ logicalCallId: 'main:1', purpose: 'main' });
  const first = await observer.reserve({
    provider: 'openai', model: 'model-a', attempt: 1,
    contextReceipt: { requestBytes: 1000, input: { bytes: 800 }, tools: { bytes: 100 } },
  });
  clock = 140;
  assert.equal(await observer.commit(first, {
    usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 }, responseId: 'response-a',
  }), true);
  const retry = await observer.reserve({
    provider: 'openai', model: 'model-a', attempt: 2,
    contextReceipt: { requestBytes: 1000, input: { bytes: 800 }, tools: { bytes: 100 } },
  });
  clock = 170;
  assert.equal(await observer.unknown(retry, { reason: 'provider_transport_unknown' }), true);
  await run.observeTool({
    turn: 1, toolCallId: 'tool-1', name: 'exec', outcome: 'succeeded', startedAt: 160,
  });
  await run.close('completed');
  const events = await ledger.read();
  assert.equal(events.filter((event) => event.type === 'RequestForecasted').length, 2);
  assert.equal(events.filter((event) => event.type === 'ReservationCommitted').length, 1);
  assert.equal(events.filter((event) => event.type === 'UsageMarkedUnknown').length, 1);
  assert.equal(events.some((event) => event.payload?.kind === 'tool_call'), true);
  assert.equal(events.some((event) => event.payload?.resources?.toolCalls === 1), true);
});

test('Resource Core는 macOS 경로·POSIX signal·chmod를 회계 identity나 invariant로 사용하지 않는다', async () => {
  const [ledgerSource, controllerSource] = await Promise.all([
    readFile(new URL('../src/resource-ledger.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/resource-controller.js', import.meta.url), 'utf8'),
  ]);
  const source = `${ledgerSource}\n${controllerSource}`;
  assert.doesNotMatch(source, /darwin|launchctl|SIGTERM|SIGKILL|\/Users\//u);
  assert.doesNotMatch(source, /chmod/u);
  assert.match(ledgerSource, /NodeResourceEventStorage/u);
  const platformSeal = JSON.parse(await readFile(new URL(
    '../evidence/s2-a1-platform-boundary-seal-2026-08-24.json', import.meta.url,
  ), 'utf8'));
  assert.equal(platformSeal.windowsFeatureImplemented, false);
  assert.equal(platformSeal.copiedWslArchitecture, false);
  assert.equal(platformSeal.observedFailureCases.length, 3);
});

test('ResourceLedger invariant는 filesystem 대신 platform storage adapter에서도 동일하다', async () => {
  let body = '';
  const durability = [];
  const storage = {
    async prepare() {}, async read() { return body; },
    async append(line, options) { body += line; durability.push(options?.durable === true); },
  };
  const ledger = new ResourceLedger('platform-owned', { storage });
  await ledger.createScope({ scopeId: 'scope', kind: 'run', dedupeKey: 'scope' });
  await ledger.reserve({
    scopeId: 'scope', dedupeKey: 'reserve', reservationId: 'reservation',
    requestId: 'request', attempt: 1, resources: { requestBytes: 10 },
  });
  await ledger.commit({
    scopeId: 'scope', dedupeKey: 'commit', reservationId: 'reservation',
    resources: { totalTokens: 3 },
  });
  assert.equal((await ledger.read()).length, 3);
  assert.deepEqual(durability, [false, true, true]);
});

test('storage가 publication 뒤 실패해도 resident cache를 버리고 같은 event를 중복 append하지 않는다', async () => {
  let body = '';
  let failAfterPublish = true;
  const storage = {
    async prepare() {}, async read() { return body; },
    async append(line) {
      body += line;
      if (failAfterPublish) { failAfterPublish = false; throw new Error('durability unknown'); }
    },
  };
  const ledger = new ResourceLedger('platform-owned', { storage });
  await assert.rejects(() => ledger.createScope({
    scopeId: 'scope', kind: 'run', dedupeKey: 'scope',
  }), /durability unknown/u);
  const replay = await ledger.createScope({
    scopeId: 'scope', kind: 'run', dedupeKey: 'scope',
  });
  assert.equal(replay.type, 'ScopeCreated');
  assert.equal(body.split('\n').filter(Boolean).length, 1);
});

test('A0 107-call 곡선은 exact accounting report에서 같은 token·request 합계로 재현된다', async () => {
  const fixture = JSON.parse(await readFile(new URL(
    '../config/s2-incident-reference-fixtures.json', import.meta.url,
  ), 'utf8'));
  const ledger = new ResourceLedger(await room());
  await ledger.createScope({ scopeId: 'incident', kind: 'session', dedupeKey: 'scope:incident' });
  let callIndex = 0;
  for (const run of fixture.resourceRunaway.runs) {
    await ledger.createScope({
      scopeId: run.runRef, parentScopeId: 'incident', kind: 'run', dedupeKey: `scope:${run.runRef}`,
    });
    for (const [tokens, requestBytes] of run.calls) {
      callIndex += 1;
      const scopeId = `call-${callIndex}`; const reservationId = `reservation-${callIndex}`;
      await ledger.createScope({
        scopeId, parentScopeId: run.runRef, kind: 'model_attempt', dedupeKey: `scope:${scopeId}`,
      });
      await ledger.reserve({
        scopeId, dedupeKey: `reserve:${callIndex}`, reservationId,
        requestId: `request-${callIndex}`, attempt: 1, resources: { requestBytes },
      });
      await ledger.commit({
        scopeId, dedupeKey: `commit:${callIndex}`, reservationId,
        responseId: `response-${callIndex}`, resources: { totalTokens: tokens },
      });
    }
  }
  const report = deriveResourceReport(await ledger.read());
  assert.equal(report.reservations, 107);
  assert.equal(report.committed, 107);
  assert.equal(report.unsettled, 0);
  assert.equal(report.providerTokensCommitted, 10_146_162);
  assert.equal(report.requestBytesReserved, 43_239_237);
});
