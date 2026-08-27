import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeInputSettlementScope } from '../src/input-settlement-scope.js';
import { makeWorkCompletionTool } from '../src/work-completion-tool.js';
import { WorkStore } from '../src/work-store.js';

async function fixture() {
  const room = await mkdtemp(join(tmpdir(), 't5-input-settlement-scope-'));
  const store = new WorkStore(room, { makeId: (() => {
    let id = 0; return () => `exact-input-${++id}`;
  })() });
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'source' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run' });
  const admitted = await store.admitInput({ sessionId: 'session', messageId: 'busy-message' });
  await store.presentInputs({ sessionId: 'session', workId: work.workId, revision: 1, runId: 'run' });
  const [presented] = await store.presentedInputs('session', 'run');
  const scope = makeInputSettlementScope({ store, runId: 'run',
    makeHandle: ({ runId, sequence }) => `busy_${runId}_${String(sequence).padStart(4, '0')}` });
  const handle = scope.register(presented);
  await store.applyPresentedToCurrentWork({ sessionId: 'session', workId: work.workId, runId: 'run' });
  return { room, store, scope, handle, inputId: admitted.inputId, workId: work.workId, revision: 2 };
}

test('busy input handle은 bounded opaque identity이고 exact Work/revision answered만 승인한다', async () => {
  const value = await fixture();
  try {
    assert.equal(value.handle, 'busy_run_0001');
    assert.equal(value.handle.includes(value.inputId), false);
    const evaluated = await value.scope.evaluate([
      { handle: value.handle, disposition: 'answered' },
    ], { workId: value.workId, revision: value.revision });
    assert.deepEqual(evaluated.blockers, []);
    assert.deepEqual(evaluated.settlements, [{ handle: 'busy_run_0001', inputId: value.inputId,
      workId: value.workId, revision: 2, disposition: 'answered' }]);
  } finally { await rm(value.room, { recursive: true, force: true }); }
});

test('production busy handle은 같은 Run·순번에서도 cryptographic token을 재사용하지 않는다', async () => {
  const value = await fixture();
  try {
    const first = makeInputSettlementScope({ store: value.store, runId: 'same-run' })
      .register({ inputId: value.inputId });
    const second = makeInputSettlementScope({ store: value.store, runId: 'same-run' })
      .register({ inputId: value.inputId });
    assert.match(first, /^busy_[a-f0-9]{32}$/u);
    assert.match(second, /^busy_[a-f0-9]{32}$/u);
    assert.notEqual(first, second);
    assert.equal(first.includes(value.inputId), false);
  } finally { await rm(value.room, { recursive: true, force: true }); }
});

test('누락·중복·foreign handle·Work/revision mismatch는 achieved blocker다', async () => {
  for (const arrange of [
    ({ handle }) => ({ settlements: [], blockers: ['admitted_input_unaddressed'] }),
    ({ handle }) => ({ settlements: [
      { handle, disposition: 'answered' }, { handle, disposition: 'answered' },
    ], blockers: ['admitted_input_identity_mismatch'] }),
    () => ({ settlements: [{ handle: 'busy_foreign', disposition: 'answered' }],
      blockers: ['admitted_input_identity_mismatch', 'admitted_input_unaddressed'] }),
    ({ handle }) => ({ settlements: [{ handle, disposition: 'answered' }],
      workId: 'foreign-work', blockers: ['admitted_input_identity_mismatch', 'admitted_input_unaddressed'] }),
  ]) {
    const value = await fixture();
    try {
      const example = arrange(value);
      const evaluated = await value.scope.evaluate(example.settlements, {
        workId: example.workId ?? value.workId, revision: value.revision,
      });
      assert.deepEqual(evaluated.blockers, example.blockers.toSorted());
    } finally { await rm(value.room, { recursive: true, force: true }); }
  }
});

test('이전 Run의 opaque handle replay는 현재 scope identity와 충돌하지 않는다', async () => {
  const value = await fixture();
  try {
    const staleHandle = 'busy_previous_run_0001';
    assert.notEqual(staleHandle, value.handle);
    const evaluated = await value.scope.evaluate([
      { handle: staleHandle, disposition: 'answered' },
    ], { workId: value.workId, revision: value.revision });
    assert.deepEqual(evaluated.blockers,
      ['admitted_input_identity_mismatch', 'admitted_input_unaddressed']);
    assert.deepEqual(evaluated.settlements, []);
    const current = (await value.store.read()).inputs
      .find((candidate) => candidate.inputId === value.inputId);
    assert.equal(current.state, 'executing');
    assert.equal(current.resultDigest, undefined);
  } finally { await rm(value.room, { recursive: true, force: true }); }
});

test('work_completion은 handle별 disposition 전량이 없으면 achieved를 unresolved로 낮춘다', async () => {
  const value = await fixture();
  try {
    const tool = makeWorkCompletionTool({ store: value.store, runId: 'run',
      inputSettlementScope: value.scope });
    const result = await tool.execute({ outcome: 'achieved', inputSettlements: [] }, { priorReceipts: [] });
    assert.equal(result.verifiedOutcome, 'unresolved');
    const proposal = await value.store.proposalForRun('run');
    assert.ok(proposal.blockers.includes('admitted_input_unaddressed'));
    assert.deepEqual(proposal.inputSettlements, []);
  } finally { await rm(value.room, { recursive: true, force: true }); }
});

test('unresolved·deferred·superseded는 executed 대신 재정산 가능한 상태로 release된다', async () => {
  for (const [disposition, state, schedule] of [
    ['unresolved', 'classified', 'settlement_retry'],
    ['deferred', 'scheduled', 'after_current_delivery'],
    ['superseded', 'admitted', null],
  ]) {
    const value = await fixture();
    try {
      await value.store.recordInputSettlementDisposition({ inputId: value.inputId, runId: 'run',
        workId: value.workId, revision: value.revision, disposition });
      await value.store.releaseInputExecution({ inputId: value.inputId, runId: 'run', disposition });
      const input = (await value.store.read()).inputs.find((candidate) => candidate.inputId === value.inputId);
      assert.equal(input.state, state); assert.equal(input.schedule, schedule);
      assert.equal(input.resultDigest, undefined);
      if (disposition === 'unresolved') {
        await value.store.claimInputExecution({ inputId: value.inputId, runId: 'retry-run' });
        await value.store.recordInputSettlementDisposition({ inputId: value.inputId, runId: 'retry-run',
          workId: value.workId, revision: value.revision, disposition: 'answered' });
        const retried = (await value.store.read()).inputs
          .find((candidate) => candidate.inputId === value.inputId);
        assert.equal(retried.settlementDisposition, 'answered');
      }
    } finally { await rm(value.room, { recursive: true, force: true }); }
  }
});
