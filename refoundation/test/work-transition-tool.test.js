import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkStore } from '../src/work-store.js';
import { makeWorkTransitionTool } from '../src/work-transition-tool.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 't5-work-control-')); const store = new WorkStore(directory);
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'm1' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'current-run' });
  const input = await store.admitInput({ sessionId: 'session', messageId: 'm2' });
  await store.presentInputs({ sessionId: 'session', workId: work.workId, revision: 1, runId: 'current-run' });
  return { directory, store, work, input, tool: makeWorkTransitionTool({
    store, sessionId: 'session', runId: 'current-run', stopProcesses: async () => {},
  }) };
}

test('control이 없으면 presented input은 현재 Work R+1·현재 Run에 적용된다', async () => {
  const { store, work, input } = await fixture();
  await store.applyPresentedToCurrentWork({ sessionId: 'session', workId: work.workId, runId: 'current-run' });
  const state = await store.read(); const applied = state.inputs.find((item) => item.inputId === input.inputId);
  assert.equal(applied.disposition, 'current_work'); assert.equal(applied.state, 'executing');
  assert.equal(state.works[0].revision, 2); assert.equal(state.claims.at(-1).runId, 'current-run');
});

test('defer_after_delivery는 base revision을 유지하고 activation 전까지 R+1을 만들지 않는다', async () => {
  const { store, input, tool } = await fixture();
  await tool.execute({ action: 'defer_after_delivery', currentWorkDisposition: null, targetWorkId: null });
  let state = await store.read(); let deferred = state.inputs.find((item) => item.inputId === input.inputId);
  assert.equal(state.works[0].revision, 1); assert.equal(deferred.state, 'scheduled');
  assert.equal(deferred.baseRevision, 1);
  await store.activateScheduledInput(input.inputId);
  state = await store.read(); deferred = state.inputs.find((item) => item.inputId === input.inputId);
  assert.equal(state.works[0].revision, 2); assert.equal(deferred.state, 'classified');
});

test('start_independent_work만 새 Work를 만들고 현재 Run의 completion을 내린다', async () => {
  const { store, work, input, tool } = await fixture();
  const result = await tool.execute({ action: 'start_independent_work',
    currentWorkDisposition: 'pause', targetWorkId: null });
  const state = await store.read(); assert.equal(state.works.length, 2);
  assert.equal(state.works.find((item) => item.workId === work.workId).status, 'paused');
  assert.notEqual(state.inputs.find((item) => item.inputId === input.inputId).workId, work.workId);
  assert.deepEqual(result.deactivatedTools, ['work_completion']);
});

test('cancel_current_work는 process stop·cancelled Work·executed input으로 닫는다', async () => {
  const base = await fixture(); let stops = 0;
  const tool = makeWorkTransitionTool({ store: base.store, sessionId: 'session', runId: 'current-run',
    stopProcesses: async () => { stops += 1; } });
  const result = await tool.execute({ action: 'cancel_current_work',
    currentWorkDisposition: null, targetWorkId: null });
  const state = await base.store.read(); assert.equal(stops, 1);
  assert.equal(state.works[0].status, 'cancelled'); assert.equal(state.inputs[0].state, 'executed');
  assert.deepEqual(result.deactivatedTools, ['work_completion']);
});

test('resume_paused_work는 exact paused Work만 다시 활성화하고 새 Work를 만들지 않는다', async () => {
  const directory = await mkdtemp(join(tmpdir(), 't5-work-resume-control-')); const store = new WorkStore(directory);
  const paused = await store.create({ sessionId: 'session', sourceMessageId: 'old' });
  await store.setStatus({ workId: paused.workId, expectedRevision: 1, status: 'paused' });
  const current = await store.create({ sessionId: 'session', sourceMessageId: 'current' });
  await store.claimExecution({ workId: current.workId, revision: 1, runId: 'current-run' });
  const input = await store.admitInput({ sessionId: 'session', messageId: 'resume-message' });
  await store.presentInputs({ sessionId: 'session', workId: current.workId, revision: 1, runId: 'current-run' });
  const tool = makeWorkTransitionTool({ store, sessionId: 'session', runId: 'current-run' });
  await tool.execute({ action: 'resume_paused_work', currentWorkDisposition: 'pause', targetWorkId: paused.workId });
  const state = await store.read(); assert.equal(state.works.length, 2);
  assert.equal(state.works.find((item) => item.workId === current.workId).status, 'paused');
  assert.equal(state.works.find((item) => item.workId === paused.workId).status, 'active');
  assert.equal(state.inputs.find((item) => item.inputId === input.inputId).workId, paused.workId);
});
