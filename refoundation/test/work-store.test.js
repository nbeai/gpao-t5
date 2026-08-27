import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkStore } from '../src/work-store.js';

test('WorkStore resident projection은 반복 read를 재사용하되 다른 writer의 append는 다시 읽는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-resident-projection-'));
  const first = new WorkStore(room); const second = new WorkStore(room);
  await first.create({ sessionId: 'session-a', sourceMessageId: 'message-a' });
  const initial = await first.read();
  assert.equal(initial.works.length, 1);
  initial.works[0].status = 'tampered';
  assert.equal((await first.read()).works[0].status, 'active');
  await second.create({ sessionId: 'session-b', sourceMessageId: 'message-b' });
  assert.equal((await first.read()).works.length, 2);
});

test('WorkStore는 input admission·revision·proposal·settlement를 append-only identity로 보존한다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-store-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message-1' });
  const admitted = await store.admitInput({ sessionId: 'session', messageId: 'message-2', origin: 'console' });
  assert.equal(admitted.state, 'admitted');
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run-1' });
  await store.presentInputs({ sessionId: 'session', workId: work.workId, revision: 1, runId: 'run-1' });
  await store.applyPresentedToCurrentWork({ sessionId: 'session', workId: work.workId, runId: 'run-1' });
  await store.prepareInputCompletion({ inputId: admitted.inputId, runId: 'run-1',
    resultPointer: 'work-result:run-1', resultDigest: 'digest-run-1' });
  await store.commitInputExecuted({ inputId: admitted.inputId, runId: 'run-1', surfaceReceipt: {
    surface: 'console_session', sessionId: 'session', runId: 'run-1', resultDigest: 'digest-run-1',
  } });
  await store.proposeCompletion({ workId: work.workId, revision: 2, runId: 'run-1' });
  await store.settle({ workId: work.workId, revision: 2, outcome: 'achieved', runId: 'run-1' });
  const state = await store.read();
  assert.equal(state.works[0].status, 'completed');
  assert.equal(state.inputs[0].disposition, 'current_work');
  assert.deepEqual(state.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});

test('input executed terminal은 exact persisted surface receipt 없이는 기록되지 않는다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-surface-receipt-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message-1' });
  const admitted = await store.admitInput({ sessionId: 'session', messageId: 'message-2' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run-1' });
  await store.presentInputs({ sessionId: 'session', workId: work.workId, revision: 1, runId: 'run-1' });
  await store.applyPresentedToCurrentWork({ sessionId: 'session', workId: work.workId, runId: 'run-1' });
  await store.prepareInputCompletion({ inputId: admitted.inputId, runId: 'run-1',
    resultPointer: 'work-result:run-1', resultDigest: 'digest-run-1' });
  await assert.rejects(store.commitInputExecuted({ inputId: admitted.inputId, runId: 'run-1',
    surfaceReceipt: null }), /exact input surface receipt/u);
  assert.equal((await store.read()).inputs.find((input) => input.inputId === admitted.inputId).state,
    'completed_pending_surface');
});

test('stale revision settlement와 다른 Run proposal은 최신 Work를 바꾸지 못한다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-stale-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message-1' });
  const first = await store.admitInput({ sessionId: 'session', messageId: 'message-2' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'current-run' });
  await store.presentInputs({ sessionId: 'session', workId: work.workId, revision: 1, runId: 'current-run' });
  await store.applyPresentedToCurrentWork({ sessionId: 'session', workId: work.workId, runId: 'current-run' });
  await assert.rejects(() => store.settle({ workId: work.workId, revision: 1,
    outcome: 'achieved', runId: 'old-run' }), /stale work revision/u);
  await store.claimExecution({ workId: work.workId, revision: 2, runId: 'current-run' });
  await assert.rejects(() => store.proposeCompletion({ workId: work.workId,
    revision: 2, runId: 'old-run' }), /execution claim mismatch/u);
});

test('durable input envelope은 Conversation pointer와 attachment·channel·sender·reply identity를 보존한다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-envelope-')));
  const admitted = await store.admitInput({ sessionId: 'session', messageId: 'message',
    origin: 'telegram', attachmentIds: ['attachment-a', 'attachment-b'],
    source: { channel: 'telegram', senderId: 'owner', replyTo: 'message-previous' } });
  const input = (await store.read()).inputs.find((item) => item.inputId === admitted.inputId);
  assert.deepEqual(input.attachmentIds, ['attachment-a', 'attachment-b']);
  assert.deepEqual(input.source, { channel: 'telegram', senderId: 'owner', replyTo: 'message-previous' });
});

test('prepared admission은 commit 전 pending이 아니며 abort 뒤 실행 대상이 되지 않는다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-prepare-')));
  const prepared = await store.prepareInputAdmission({ sessionId: 'session', messageId: 'message',
    attachmentIds: ['attachment'], source: { channel: 'console', senderId: 'owner' } });
  assert.equal((await store.pendingInputs('session')).length, 0);
  await store.abortInputAdmission(prepared.inputId, 'fixture failure');
  const input = (await store.read()).inputs.find((item) => item.inputId === prepared.inputId);
  assert.equal(input.state, 'aborted');
  assert.equal((await store.pendingInputs('session')).length, 0);
});

test('같은 Work revision의 동시 실행 claim은 하나만 열리고 정산 뒤 새 Run은 가능하다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-claim-cas-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run-a' });
  await assert.rejects(() => store.claimExecution({ workId: work.workId, revision: 1, runId: 'run-b' }),
    /already claimed/u);
  await store.settle({ workId: work.workId, revision: 1, outcome: 'unresolved', runId: 'run-a' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run-b' });
});

test('provider 실패 Run의 execution claim을 release하면 같은 Work의 다음 사용자 Run이 실행된다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-claim-release-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'failed-run' });
  const released = await store.releaseExecution({ runId: 'failed-run', reason: 'provider_http_error' });
  assert.equal(released.released, true);
  assert.equal((await store.read()).works[0].status, 'active');
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'next-user-run' });
  assert.equal((await store.workForRun('next-user-run')).claimedRevision, 1);
});

test('provider 실패 전 presented 입력은 exact Run에서만 settlement retry로 돌아간다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-presented-retry-')));
  const work = await store.create({ sessionId: 'session-presented-retry', sourceMessageId: 'source-1' });
  const prepared = await store.prepareInputAdmission({ sessionId: work.sessionId, messageId: 'message-2',
    source: { channel: 'telegram' } });
  await store.commitInputAdmission(prepared.inputId);
  await store.presentInputs({ sessionId: work.sessionId, workId: work.workId, revision: work.revision, runId: 'run-failed' });
  assert.deepEqual(await store.releasePresentedInputsForRun('foreign-run'), []);
  const released = await store.releasePresentedInputsForRun('run-failed');
  assert.deepEqual(released, [{ inputId: prepared.inputId, state: 'classified', schedule: 'settlement_retry' }]);
  const queued = await store.queuedInputs(work.sessionId);
  assert.equal(queued.length, 1);assert.equal(queued[0].workId, work.workId);assert.equal(queued[0].revision, 1);
});

test('provider 실패 surface가 답하는 presented 입력은 exact claim으로 전환되어 재시도 대기열에 남지 않는다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-presented-failure-surface-')));
  const work = await store.create({ sessionId: 'session-failure-surface', sourceMessageId: 'source-1' });
  const admitted = await store.admitInput({ sessionId: 'session-failure-surface', messageId: 'message-2' });
  await store.claimExecution({ workId: work.workId, revision: work.revision, runId: 'failed-run' });
  await store.presentInputs({ sessionId: 'session-failure-surface', workId: work.workId,
    revision: work.revision, runId: 'failed-run' });
  const claimed = await store.claimPresentedInputsForFailure('failed-run');
  assert.deepEqual(claimed.map((input) => input.inputId), [admitted.inputId]);
  const state = await store.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
  assert.equal(input.state, 'executing'); assert.equal(input.workId, work.workId);
  assert.deepEqual(await store.releasePresentedInputsForRun('failed-run'), []);
  assert.equal((await store.queuedInputs('session-failure-surface')).length, 0);
});

test('Run 종료 경계에 남은 평범한 입력은 분류기 없이 현재 Work R+1에 exact 결속된다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-boundary-current-default-')));
  const work = await store.create({ sessionId: 'session-boundary', sourceMessageId: 'source-1' });
  const admitted = await store.admitInput({ sessionId: 'session-boundary', messageId: 'message-2' });
  const attached = await store.attachAdmittedInputToCurrentWork(admitted.inputId);
  assert.equal(attached.workId, work.workId); assert.equal(attached.revision, 2);
  assert.equal(attached.disposition, 'current_work'); assert.equal(attached.state, 'classified');
  const state = await store.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
  assert.equal(input.transitionChoice, undefined); assert.equal(input.workId, work.workId);
  assert.equal(state.works[0].revision, 2);
});

test('after-delivery와 independent 입력이 함께 대기해도 각 exact Work만 순서대로 claim한다', async () => {
  let nextId = 0;
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-exact-input-order-')),
    { makeId: () => `exact-input-order-${nextId += 1}` });
  const sessionId = 'session-order';
  const current = await store.create({ sessionId, sourceMessageId: 'current-message' });
  const weather = await store.admitInput({ sessionId, messageId: 'weather-message' });
  await store.commitTransitionDecision({ inputId: weather.inputId, sessionId,
    runId: 'current-run', currentWorkId: current.workId, choice: 'followup_after_delivery' });
  const calendar = await store.admitInput({ sessionId, messageId: 'calendar-message' });
  await store.commitTransitionDecision({ inputId: calendar.inputId, sessionId,
    runId: 'current-run', currentWorkId: current.workId, choice: 'new_work', currentWorkDisposition: 'pause' });
  const initial = await store.read(); const calendarInput = initial.inputs.find((item) => item.inputId === calendar.inputId);
  const activatedWeather = await store.activateScheduledInput(weather.inputId);
  const exactWeather = await store.activateExactInputWork(activatedWeather.inputId);
  assert.equal(exactWeather.workId, current.workId); assert.equal(exactWeather.revision, 2);
  await store.claimExecution({ workId: exactWeather.workId, revision: exactWeather.revision, runId: 'weather-run' });
  await store.claimInputExecution({ inputId: weather.inputId, runId: 'weather-run' });
  await store.releaseExecution({ runId: 'weather-run', reason: 'fixture_terminal' });
  const exactCalendar = await store.activateExactInputWork(calendarInput.inputId);
  assert.equal(exactCalendar.workId, calendarInput.workId); assert.equal(exactCalendar.revision, 1);
  const state = await store.read();
  assert.equal(state.works.find((item) => item.workId === current.workId).status, 'paused');
  assert.equal(state.works.find((item) => item.workId === calendarInput.workId).status, 'active');
  await store.claimExecution({ workId: exactCalendar.workId, revision: exactCalendar.revision, runId: 'calendar-run' });
  await store.claimInputExecution({ inputId: calendar.inputId, runId: 'calendar-run' });
});

test('같은 boundary의 교정 뒤 취소는 교정을 원래 Work에서 닫고 이후 새 Work에 이월하지 않는다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-correction-cancel-boundary-')));
  const sessionId = 'session-correction-cancel';
  const work = await store.create({ sessionId, sourceMessageId: 'source-message' });
  const correction = await store.admitInput({ sessionId, messageId: 'correction-message' });
  await store.commitTransitionDecision({ inputId: correction.inputId, sessionId, runId: 'active-run',
    currentWorkId: work.workId, choice: 'steer_current' });
  const cancel = await store.admitInput({ sessionId, messageId: 'cancel-message' });
  await store.commitTransitionDecision({ inputId: cancel.inputId, sessionId, runId: 'active-run',
    currentWorkId: work.workId, choice: 'cancel', currentWorkDisposition: 'cancel' });
  let state = await store.read();
  const closedCorrection = state.inputs.find((input) => input.inputId === correction.inputId);
  assert.equal(closedCorrection.state, 'cancelled');
  assert.equal(closedCorrection.disposition, 'superseded_by_cancel');
  assert.equal(closedCorrection.workId, work.workId); assert.equal(closedCorrection.revision, 1);
  assert.equal((await store.pendingInputs(sessionId)).some((input) => input.inputId === correction.inputId), false);
  const next = await store.create({ sessionId, sourceMessageId: 'followup-message' });
  await store.presentInputs({ sessionId, workId: next.workId, revision: next.revision, runId: 'followup-run' });
  state = await store.read();
  assert.equal(state.inputs.find((input) => input.inputId === correction.inputId).state, 'cancelled');
  assert.equal(state.events.some((event) => event.type === 'input_presented'
    && event.inputId === correction.inputId && event.runId === 'followup-run'), false);
});
