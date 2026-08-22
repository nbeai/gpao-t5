import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeConversationProjection,
  CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS,
  planConversationCheckpoint,
  summarizeConversationCheckpoint,
} from '../src/conversation-checkpoint.js';

test('checkpoint는 현재 대상·형식·교정·닫힌 쟁점과 합의 경계를 보존한다', () => {
  assert.match(CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS, /current object.*requested output form/is);
  assert.match(CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS, /latest user correction/is);
  assert.match(CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS, /closed or deferred/is);
  assert.match(CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS, /user-accepted.*assistant proposals.*did not accept/is);
  assert.match(CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS, /ACCEPTED DECISIONS\/BOUNDARIES.*CLOSED\/DEFERRED.*PROHIBITED\/DO NOT REOPEN.*OPEN WORK/is);
  assert.match(CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS, /Do not omit an accepted boundary.*topic later changed/is);
});

function entries(count, size = 80) {
  return Array.from({ length: count }, (_, index) => ({
    messageId: `m-${index + 1}`, runId: `run-${index + 1}`, turn: 1,
    message: {
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${index === 0 ? 'EARLY-ID=ALPHA-7391 ' : ''}${index === 5 ? 'DECISION=BETA-7391 ' : ''}${'x'.repeat(size)}`,
    },
  }));
}

test('checkpoint plan은 오래된 prefix만 요약하고 최근 tail은 원문으로 남긴다', () => {
  const conversation = { entries: entries(10), checkpoints: [] };
  const plan = planConversationCheckpoint({
    conversation, currentRequest: '계속해', triggerBytes: 1, tailBytes: 260,
  });
  assert.equal(plan.needed, true);
  assert.ok(plan.summarizeEntries.length > 0);
  assert.ok(plan.tailEntries.length > 0);
  assert.equal(plan.coversThroughMessageId, plan.summarizeEntries.at(-1).messageId);
  assert.equal(plan.tailEntries[0].messageId, `m-${plan.summarizeEntries.length + 1}`);
  assert.deepEqual(
    [...plan.summarizeEntries, ...plan.tailEntries].map((entry) => entry.messageId),
    conversation.entries.map((entry) => entry.messageId),
  );
});

test('checkpoint 발동은 canonical 영수증 원문이 아니라 먼저 줄인 provider projection byte를 본다', () => {
  const conversation = { entries: entries(12, 500), checkpoints: [] };
  const plan = planConversationCheckpoint({
    conversation, currentRequest: '계속해', triggerBytes: 1_000, tailBytes: 260,
    projectedMessages: [{ role: 'assistant', content: '작게 투영된 과거 영수증' }],
  });
  assert.equal(plan.needed, false);
  assert.equal(plan.reason, 'below_trigger');
  assert.ok(plan.activeBytes < 1_000);
});

test('latest checkpoint projection은 summary 한 개와 cover 이후 canonical tail만 사용한다', () => {
  const conversation = {
    entries: entries(8),
    checkpoints: [{
      checkpointId: 'cp-1', coversThroughMessageId: 'm-5',
      summary: 'EARLY-ID=ALPHA-7391\nDECISION=BETA-7391',
    }],
  };
  const active = activeConversationProjection(conversation);
  assert.equal(active.messages.length, 4);
  assert.match(active.messages[0].content, /CONVERSATION CHECKPOINT/);
  assert.match(active.messages[0].content, /EARLY-ID=ALPHA-7391/);
  assert.deepEqual(active.tailEntries.map((entry) => entry.messageId), ['m-6', 'm-7', 'm-8']);
});

test('chunk summary는 exact identifier 보존 지침으로 partial을 만들고 하나로 병합한다', async () => {
  const calls = [];
  const plan = {
    needed: true,
    previousCheckpoint: null,
    summarizeEntries: entries(12, 120),
    tailEntries: entries(2, 20),
    coversThroughMessageId: 'm-12',
    sourceBytes: 2_000,
  };
  const result = await summarizeConversationCheckpoint(plan, {
    chunkBytes: 700,
    summarize: async (input) => {
      calls.push(input);
      if (input.phase === 'merge') return 'EARLY-ID=ALPHA-7391\nDECISION=BETA-7391\nOPEN WORK remains';
      return `partial-${input.index}: EARLY-ID=ALPHA-7391`;
    },
  });
  assert.ok(calls.filter((call) => call.phase === 'chunk').length > 1);
  assert.equal(calls.at(-1).phase, 'merge');
  assert.match(calls[0].prompt, /Preserve exact identifiers/i);
  assert.match(result.summary, /EARLY-ID=ALPHA-7391/);
  assert.equal(result.coversThroughMessageId, 'm-12');
});

test('summary 실패는 checkpoint 결과를 만들지 않고 오류를 그대로 올린다', async () => {
  const plan = {
    needed: true, previousCheckpoint: null, summarizeEntries: entries(4), tailEntries: [],
    coversThroughMessageId: 'm-4', sourceBytes: 400,
  };
  await assert.rejects(() => summarizeConversationCheckpoint(plan, {
    summarize: async () => { throw new Error('summary provider failed'); },
  }), /summary provider failed/);
});
