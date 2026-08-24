import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkStore } from '../src/work-store.js';
import { makeWorkTransitionTool } from '../src/work-transition-tool.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 't5-work-transition-'));
  const store = new WorkStore(directory); const work = await store.create({ sessionId: 'session', sourceMessageId: 'm1' });
  return { directory, store, work };
}

test('extend는 같은 Work·현재 Run의 새 revision을 claim하고 input을 executing으로 만든다', async () => {
  const { store } = await fixture();
  const input = await store.admitInput({ sessionId: 'session', messageId: 'm2' });
  await store.claimExecution({ workId: (await store.latestForSession('session')).workId,
    revision: 1, runId: 'current-run' });
  const tool = makeWorkTransitionTool({ store, sessionId: 'session', runId: 'current-run' });
  const result = await tool.execute({ decisions: [{
    meaning: 'extend_current_work', schedule: 'within_current_work', cancelCurrent: false }] });
  assert.equal(result.classified[0].meaning, 'extend_current_work');
  const state = await store.read(); assert.equal(state.inputs[0].meaning, 'extend_current_work');
  assert.equal(state.inputs[0].state, 'executing'); assert.equal(state.inputs[0].executionRunId, 'current-run');
  assert.equal(state.works.length, 1); assert.equal(state.claims.at(-1).revision, 2);
  assert.equal(state.works[0].revision, 2);
});

test('independent work만 기존 Work를 paused로 남기고 새 identity에 input을 결속한다', async () => {
  const { store, work } = await fixture();
  const input = await store.admitInput({ sessionId: 'session', messageId: 'm2' });
  const tool = makeWorkTransitionTool({ store, sessionId: 'session' });
  const result = await tool.execute({ decisions: [{
    meaning: 'start_independent_work', schedule: 'independent_work', cancelCurrent: false }] });
  const state = await store.read();
  assert.equal(state.works.find((item) => item.workId === work.workId).status, 'paused');
  assert.notEqual(result.classified[0].workId, work.workId);
  assert.equal(state.inputs[0].workId, result.classified[0].workId);
  assert.deepEqual(result.deactivatedTools, ['work_completion']);
});

test('cancel과 cancelCurrent independent work는 명시적 모델 결정에서만 실행 중 프로세스를 멈춘다', async () => {
  for (const decision of [
    { meaning: 'cancel_current_work', schedule: 'stop', cancelCurrent: false },
    { meaning: 'start_independent_work', schedule: 'independent_work', cancelCurrent: true },
  ]) {
    const { store } = await fixture(); let stops = 0;
    const input = await store.admitInput({ sessionId: 'session', messageId: 'm2' });
    const tool = makeWorkTransitionTool({ store, sessionId: 'session', stopProcesses: async () => { stops += 1; } });
    await tool.execute({ decisions: [{ ...decision }] });
    assert.equal(stops, 1);
  }
});

test('admission 후 classification 전 restart해도 pending input과 Work revision은 그대로 복원된다', async () => {
  const { directory, store, work } = await fixture();
  const input = await store.admitInput({ sessionId: 'session', messageId: 'm2' });
  const restarted = new WorkStore(directory); const state = await restarted.read();
  assert.equal(state.inputs.find((item) => item.inputId === input.inputId).state, 'admitted');
  assert.equal(state.works[0].workId, work.workId); assert.equal(state.works[0].revision, 1);
});

test('delivery-first extension은 restart 후에도 queued로 복원되고 exact Run이 한 번만 claim·complete한다', async () => {
  const { directory, store } = await fixture();
  const input = await store.admitInput({ sessionId: 'session', messageId: 'm2' });
  await makeWorkTransitionTool({ store, sessionId: 'session' }).execute({ decisions: [{
    meaning: 'extend_current_work', schedule: 'after_current_delivery',
    cancelCurrent: false,
  }] });
  let state = await store.read();
  assert.equal(state.works[0].revision, 1); assert.equal(state.inputs[0].state, 'scheduled');
  assert.equal(state.inputs[0].baseRevision, 1);
  const restarted = new WorkStore(directory);
  assert.deepEqual((await restarted.queuedInputs('session')).map((item) => item.inputId), [input.inputId]);
  await restarted.activateScheduledInput(input.inputId);
  state = await restarted.read(); assert.equal(state.works[0].revision, 2);
  assert.equal(state.inputs[0].state, 'classified');
  await restarted.claimInputExecution({ inputId: input.inputId, runId: 'run-followup' });
  await assert.rejects(() => restarted.claimInputExecution({ inputId: input.inputId,
    runId: 'duplicate-run' }), /not queued/u);
  await restarted.completeInputExecution({ inputId: input.inputId, runId: 'run-followup' });
  assert.equal((await restarted.read()).inputs[0].state, 'executed');
});
