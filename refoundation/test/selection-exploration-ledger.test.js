import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { buildSelectionAnchor, projectSelectableMessage } from '../src/selectable-message-projection.js';
import { projectSelectionExplorationPublic } from '../src/selection-exploration-projection.js';

test('side branch는 같은 Conversation 원장에 남지만 main entries와 messages를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-selection-ledger-'));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  try {
    const ledger = new ConversationLedger(room); await ledger.ensure({ sessionId });
    const content = '결과는 **15,500원 차이**입니다.';
    await ledger.appendMessage({ sessionId, messageId: 'message-a', runId: 'run-a',
      message: { role: 'assistant', content } });
    const projection = projectSelectableMessage(content);
    const startUtf16 = projection.text.indexOf('15,500원');
    const anchor = buildSelectionAnchor({ canonical: { sessionId, messageId: 'message-a',
      sequence: 2, role: 'assistant', runId: 'run-a', content }, request: {
      projectionVersion: projection.version, projectionDigest: projection.digest,
      startUtf16, endUtf16: startUtf16 + '15,500원 차이'.length } });
    await ledger.openSelectionExploration({ sessionId, explorationId: 'exploration-a',
      requestId: 'open-a', anchor });
    await ledger.appendSelectionSideMessage({ sessionId, explorationId: 'exploration-a',
      sideMessageId: 'side-user-a', requestId: 'message-a', role: 'user',
      content: '이 차이가 왜 생겼어?' });
    await ledger.appendSelectionSideMessage({ sessionId, explorationId: 'exploration-a',
      sideMessageId: 'side-assistant-a', requestId: 'message-b', role: 'assistant',
      content: '검증된 근거를 더 봐야 합니다.' });
    const state = await ledger.read(sessionId);
    assert.deepEqual(state.messages, [{ role: 'assistant', content }]);
    assert.equal(state.entries.length, 1);
    assert.equal(state.checkpoints.length, 0);
    assert.equal(state.explorations.length, 1);
    assert.deepEqual(state.explorations[0].messages.map((item) => item.role), ['user', 'assistant']);
    const publicBranch = projectSelectionExplorationPublic(state.explorations[0]);
    assert.equal(publicBranch.anchor.quote, '15,500원 차이');
    assert.doesNotMatch(JSON.stringify(publicBranch), /sessionId|message-a|run-a|exploration-a|sha256/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('stale source sequence·digest와 다른 request payload는 side event 전에 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-selection-stale-'));
  const sessionId = '22222222-2222-4222-8222-222222222222';
  try {
    const ledger = new ConversationLedger(room); await ledger.ensure({ sessionId });
    const content = '한글 선택'; await ledger.appendMessage({ sessionId, messageId: 'message-b',
      message: { role: 'user', content } });
    const projection = projectSelectableMessage(content);
    const anchor = buildSelectionAnchor({ canonical: { sessionId, messageId: 'message-b',
      sequence: 2, role: 'user', runId: null, content }, request: {
      projectionVersion: projection.version, projectionDigest: projection.digest,
      startUtf16: 0, endUtf16: content.length } });
    await assert.rejects(() => ledger.openSelectionExploration({ sessionId,
      explorationId: 'bad', requestId: 'bad-open', anchor: { ...anchor, sourceMessageSequence: 3 } }),
    /selection source identity mismatch/u);
    await ledger.openSelectionExploration({ sessionId, explorationId: 'good',
      requestId: 'good-open', anchor });
    await assert.rejects(() => ledger.appendSelectionSideMessage({ sessionId,
      explorationId: 'good', sideMessageId: 'one', requestId: 'same-request',
      role: 'user', content: '첫 질문' }).then(() => ledger.appendSelectionSideMessage({ sessionId,
      explorationId: 'good', sideMessageId: 'two', requestId: 'same-request',
      role: 'user', content: '다른 질문' })), /selection request identity conflict/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('restart read는 dangling·tampered selection anchor를 main source 관계로 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-selection-restore-'));
  const sessionId = '55555555-5555-4555-8555-555555555555';
  try {
    const ledger = new ConversationLedger(room); await ledger.ensure({ sessionId });
    const content = '복원할 선택 원문'; await ledger.appendMessage({ sessionId, messageId: 'message-c',
      message: { role: 'assistant', content } });
    const projection = projectSelectableMessage(content);
    const anchor = buildSelectionAnchor({ canonical: { sessionId, messageId: 'message-c', sequence: 2,
      role: 'assistant', runId: null, content }, request: { projectionVersion: projection.version,
      projectionDigest: projection.digest, startUtf16: 0, endUtf16: 3 } });
    await ledger.openSelectionExploration({ sessionId, explorationId: 'restore', requestId: 'restore-open', anchor });
    const file = join(room, `${sessionId}.jsonl`); const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    const opened = JSON.parse(lines[2]); opened.anchor.quote = '변조'; lines[2] = JSON.stringify(opened);
    await writeFile(file, `${lines.join('\n')}\n`);
    await assert.rejects(() => new ConversationLedger(room).read(sessionId),
      /selection source relationship is invalid/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
