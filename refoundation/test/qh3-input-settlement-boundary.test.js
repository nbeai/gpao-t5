import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server, room) {
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}

async function runFixture({ prefix, arrangeExecutingInput }) {
  const room = await mkdtemp(join(tmpdir(), prefix));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let server;
  let arranged;
  const runtimeErrors = [];
  server = makeConsoleServer({
    stateDir,
    workspace,
    onError: (error) => runtimeErrors.push(error?.message ?? String(error)),
    modelFactory: () => ({
      async respond() {
        if (!arranged) {
          const [run] = await server.runLedger.list();
          assert.ok(run?.runId, 'fixture requires the active console run identity');
          arranged = await arrangeExecutingInput({
            runId: run.runId,
            workStore: server.workStore,
          });
        }
        return { text: 'BASE-REVISION-ONLY-RESULT', toolCalls: [] };
      },
    }),
  });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const started = await fetch(`${base}/turn/stream-start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '기준 결과만 만들어줘' }),
    }).then((response) => response.json());
    const wire = await fetch(`${base}/turn/stream?streamId=${started.streamId}`).then((response) => response.text());
    assert.match(wire, /BASE-REVISION-ONLY-RESULT/u, runtimeErrors.join(' | '));
    return { state: await server.workStore.read(), arranged };
  } finally {
    await close(server, room);
  }
}

test('QH-3 red: surface가 다루지 않은 deferred input은 executed로 승격하지 않는다', async () => {
  const { state, arranged } = await runFixture({
    prefix: 't5-qh3-unaddressed-deferred-',
    arrangeExecutingInput: async ({ runId, workStore }) => {
      const [baseWork] = (await workStore.read()).works;
      const priorRunId = 'fixture:prior-delivered-run';
      const admitted = await workStore.admitInput({
        sessionId: baseWork.sessionId,
        messageId: 'fixture:deferred-user-message',
        source: { fixture: 'unaddressed_deferred' },
      });
      await workStore.commitTransitionDecision({ inputId: admitted.inputId,
        sessionId: baseWork.sessionId, runId: priorRunId, currentWorkId: baseWork.workId,
        choice: 'followup_after_delivery' });
      await workStore.recordResultReady({
        runId: priorRunId,
        sessionId: baseWork.sessionId,
        workId: baseWork.workId,
        revision: baseWork.revision,
        resultDigest: 'fixture:prior-result-digest',
        surfaceResult: { kind: 'reply', reply: 'PRIOR-DELIVERED-RESULT', runId: priorRunId },
      });
      await workStore.markResultSurfacePersisted(priorRunId);
      await workStore.markResultDeliveryTerminal(priorRunId, { provider: 'console', state: 'persisted' });
      const activated = await workStore.activateScheduledInput(admitted.inputId);
      await assert.rejects(workStore.claimInputExecution({ inputId: admitted.inputId, runId }),
        /Run claim identity mismatch/u);
      return { inputId: admitted.inputId, workId: activated.workId,
        inputRevision: activated.revision, resultRunId: runId };
    },
  });
  const input = state.inputs.find((candidate) => candidate.inputId === arranged.inputId);
  const result = state.results.find((candidate) => candidate.runId === arranged.resultRunId);
  assert.equal(input.disposition, 'deferred_after_delivery');
  assert.equal(result.revision, 1);
  assert.equal(input.revision, 2);
  assert.notEqual(input.state, 'executed',
    'an execution claim is not evidence that this surface addressed the deferred input');
  assert.equal(input.resultDigest, undefined,
    'an unaddressed deferred input must not inherit the current result digest');
  assert.equal(state.events.some((event) => event.type === 'input_executed'
    && event.inputId === arranged.inputId), false);
});

test('QH-3 red: foreign Work/revision input은 current result에 결속하지 않는다', async () => {
  const { state, arranged } = await runFixture({
    prefix: 't5-qh3-foreign-work-',
    arrangeExecutingInput: async ({ runId, workStore }) => {
      const [currentWork] = (await workStore.read()).works;
      const admitted = await workStore.admitInput({
        sessionId: currentWork.sessionId,
        messageId: 'fixture:independent-user-message',
        source: { fixture: 'foreign_work' },
      });
      const forkedInput = await workStore.commitTransitionDecision({ inputId: admitted.inputId,
        sessionId: currentWork.sessionId, runId, currentWorkId: currentWork.workId,
        choice: 'new_work', currentWorkDisposition: 'pause' });
      await assert.rejects(workStore.claimInputExecution({ inputId: admitted.inputId, runId }),
        /Run claim identity mismatch/u);
      return { inputId: admitted.inputId, currentWorkId: currentWork.workId,
        foreignWorkId: forkedInput.workId, resultRunId: runId };
    },
  });
  const input = state.inputs.find((candidate) => candidate.inputId === arranged.inputId);
  const result = state.results.find((candidate) => candidate.runId === arranged.resultRunId);
  assert.equal(input.disposition, 'independent_work');
  assert.equal(result.workId, arranged.currentWorkId);
  assert.equal(input.workId, arranged.foreignWorkId);
  assert.notEqual(input.workId, result.workId);
  assert.notEqual(input.state, 'executed',
    'a surface for another Work does not settle this independent input');
  assert.equal(input.resultDigest, undefined,
    'a foreign Work input must not inherit the current Work result digest');
  assert.equal(state.events.some((event) => event.type === 'input_executed'
    && event.inputId === arranged.inputId), false);
});

test('projected busy input final text는 formal required settlement 뒤에만 publish된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh3-omitted-settlement-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: (context) => (
    context.purpose === 'transition_decision' ? { async respond() {
      return { text: '', toolCalls: [{ id: 'steer-decision', name: 'transition_decision', args: {
        choice: 'steer_current', targetHandle: null, currentWorkDisposition: null,
      } }] };
    } } : { async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: 'STALE-BASE', toolCalls: [] }; }
    if (input.toolChoice?.requiredToolName === 'work_completion') {
      const handle = /inputHandle=(busy_[A-Za-z0-9_-]{8,80})/u.exec(
        input.messages.map((message) => String(message.content ?? '')).join('\n'),
      )?.[1];
      return { text: '', toolCalls: [{ id: 'required-settlement', name: 'work_completion', args: {
        outcome: 'unresolved', inputSettlements: [{ handle, disposition: 'answered' }],
      } }] };
    }
    assert.match(input.messages.find((message) => String(message.content)
      .includes('T5 NEWLY ADMITTED USER MESSAGE'))?.content ?? '', /inputHandle=busy_[a-f0-9]{32}/u);
    return { text: 'SETTLEMENT-OMITTED-RESULT', toolCalls: [] };
  } }) });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '기준 작업' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
        text: '이 busy 요구도 반영해' }) }).then((response) => response.json());
    release(); const wire = await stream; assert.match(wire, /SETTLEMENT-OMITTED-RESULT/u);
    const state = await server.workStore.read();
    const input = state.inputs.find((candidate) => candidate.inputId === admitted.inputId);
    assert.equal(input.state, 'executed');
    assert.equal(input.settlementDisposition, 'answered');
    assert.ok(input.resultDigest);
    assert.equal(state.events.filter((event) => event.type === 'input_completed_pending_surface'
      && event.inputId === admitted.inputId).length, 1);
    assert.equal(state.events.filter((event) => event.type === 'input_executed'
      && event.inputId === admitted.inputId).length, 1);
    const run = (await server.runLedger.list({ sessionId: session.id }))[0];
    const settlement = run.events.find((event) => event.type === 'work_unresolved');
    assert.equal(settlement.payload.blockers.includes('admitted_input_unaddressed'), false);
    assert.equal(run.events.filter((event) => event.type === 'model_completed').length, 5);
  } finally { release?.(); await close(server, room); }
});
