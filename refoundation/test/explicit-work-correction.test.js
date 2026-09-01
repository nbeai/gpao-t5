import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeExplicitWorkCorrection } from '../src/explicit-work-correction.js';
import { buildSelectionAnchor, projectSelectableMessage } from '../src/selectable-message-projection.js';
import { selectionSideMessageHandle } from '../src/selection-exploration-projection.js';
import { WorkStore } from '../src/work-store.js';

async function fixture({ completed = false } = {}) {
  const room = await mkdtemp(join(tmpdir(), 't5-explicit-selection-'));
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const conversationLedger = new ConversationLedger(join(room, 'conversation'));
  const workStore = new WorkStore(join(room, 'work'));
  await conversationLedger.ensure({ sessionId });
  const content = '정산 결과는 15,500원 차이입니다.'; const runId = 'source-run';
  await conversationLedger.appendMessage({ sessionId, messageId: 'source-message', runId,
    message: { role: 'assistant', content } });
  const work = await workStore.create({ sessionId, sourceMessageId: 'source-message' });
  await workStore.claimExecution({ workId: work.workId, revision: 1, runId });
  if (completed) await workStore.settle({ workId: work.workId, revision: 1,
    outcome: 'achieved', runId });
  const projection = projectSelectableMessage(content); const startUtf16 = content.indexOf('15,500원');
  const anchor = buildSelectionAnchor({ canonical: { sessionId, messageId: 'source-message',
    sequence: 2, role: 'assistant', runId, content }, request: {
    projectionVersion: projection.version, projectionDigest: projection.digest,
    startUtf16, endUtf16: startUtf16 + '15,500원 차이'.length } });
  await conversationLedger.openSelectionExploration({ sessionId, explorationId: 'exploration',
    requestId: 'open', anchor });
  await conversationLedger.appendSelectionSideMessage({ sessionId, explorationId: 'exploration',
    sideMessageId: 'side-user', requestId: 'side-user-request', role: 'user',
    content: '이 차액만 반영해서 결과를 다시 정리해줘.' });
  const coordinator = makeExplicitWorkCorrection({ conversationLedger, workStore,
    makeId: () => 'apply-main-message' });
  return { room, sessionId, conversationLedger, workStore, work, coordinator,
    handle: selectionSideMessageHandle('side-user') };
}

test('active source Work explicit apply는 exact R+1 한 번이고 retry는 멱등이다', async () => {
  const target = await fixture();
  try {
    const first = await target.coordinator.apply({ sessionId: target.sessionId,
      explorationId: 'exploration', instructionMessageHandle: target.handle, requestId: 'apply-1' });
    assert.equal(first.relation, 'current_revision'); assert.equal(first.revision, 2);
    const second = await target.coordinator.apply({ sessionId: target.sessionId,
      explorationId: 'exploration', instructionMessageHandle: target.handle, requestId: 'apply-1' });
    assert.equal(second.workId, first.workId); assert.equal(second.revision, 2);
    const work = await target.workStore.read();
    assert.equal(work.works[0].revision, 2);
    assert.equal(work.inputs.filter((input) => input.origin === 'selection_exploration').length, 1);
    const conversation = await target.conversationLedger.read(target.sessionId);
    assert.equal(conversation.entries.filter((entry) => entry.messageId === 'apply-main-message').length, 1);
    assert.equal(conversation.explorations[0].apply.state, 'committed');
    await target.conversationLedger.appendSelectionSideMessage({ sessionId: target.sessionId,
      explorationId: 'exploration', sideMessageId: 'side-user-other', requestId: 'side-user-other-request',
      role: 'user', content: '다른 지시' });
    await assert.rejects(() => target.coordinator.apply({ sessionId: target.sessionId,
      explorationId: 'exploration', instructionMessageHandle: selectionSideMessageHandle('side-user-other'),
      requestId: 'apply-1' }), /selection apply request conflict/u);
  } finally { await rm(target.room, { recursive: true, force: true }); }
});

test('completed source Work apply는 과거 settlement를 보존한 derived Work를 만든다', async () => {
  const target = await fixture({ completed: true });
  try {
    const applied = await target.coordinator.apply({ sessionId: target.sessionId,
      explorationId: 'exploration', instructionMessageHandle: target.handle, requestId: 'apply-derived' });
    assert.equal(applied.relation, 'derived_work'); assert.notEqual(applied.workId, target.work.workId);
    const state = await target.workStore.read();
    assert.equal(state.works.find((work) => work.workId === target.work.workId).status, 'completed');
    const derived = state.works.find((work) => work.workId === applied.workId);
    assert.equal(derived.provenance.derivedFromWorkId, target.work.workId);
    assert.equal(state.inputs.find((input) => input.inputId === applied.inputId).workId, applied.workId);
  } finally { await rm(target.room, { recursive: true, force: true }); }
});

test('assistant side answer와 stale source revision은 main admission 전에 차단된다', async () => {
  const target = await fixture();
  try {
    await target.conversationLedger.appendSelectionSideMessage({ sessionId: target.sessionId,
      explorationId: 'exploration', sideMessageId: 'side-assistant', requestId: 'assistant-message',
      role: 'assistant', content: '자동 적용하면 안 됨' });
    await assert.rejects(() => target.coordinator.apply({ sessionId: target.sessionId,
      explorationId: 'exploration', instructionMessageHandle: selectionSideMessageHandle('side-assistant'),
      requestId: 'apply-assistant' }), /user-authored side instruction/u);
    const admitted = await target.workStore.prepareInputAdmission({ sessionId: target.sessionId,
      messageId: 'other-message' }); await target.workStore.commitInputAdmission(admitted.inputId);
    await target.workStore.attachAdmittedInputToCurrentWork(admitted.inputId);
    await assert.rejects(() => target.coordinator.apply({ sessionId: target.sessionId,
      explorationId: 'exploration', instructionMessageHandle: target.handle,
      requestId: 'apply-stale' }), /stale selection source Work/u);
    const conversation = await target.conversationLedger.read(target.sessionId);
    assert.equal(conversation.entries.some((entry) => entry.messageId === 'apply-main-message'), false);
  } finally { await rm(target.room, { recursive: true, force: true }); }
});
