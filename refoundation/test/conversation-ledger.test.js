import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConversationLedger } from '../src/conversation-ledger.js';

test('세션 메시지는 append-only sequence로 기록되고 재시작 뒤 전체 역할이 복원된다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-conversation-ledger-'));
  const sessionId = '11111111-1111-4111-8111-111111111111';
  try {
    const ledger = new ConversationLedger(root);
    await ledger.ensure({ sessionId });
    await ledger.appendMessage({
      sessionId, messageId: 'run-1:user', runId: 'run-1',
      message: { role: 'user', content: '값을 확인해줘' },
    });
    const prefix = await readFile(join(root, `${sessionId}.jsonl`), 'utf8');
    await ledger.appendMessage({
      sessionId, messageId: 'run-1:assistant-1', runId: 'run-1',
      message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'exec', args: { command: 'read' } }] },
    });
    await ledger.appendMessage({
      sessionId, messageId: 'run-1:tool-call-1', runId: 'run-1',
      message: { role: 'tool', toolCallId: 'call-1', name: 'exec', content: '{"stdout":"hidden-value"}' },
    });
    await ledger.appendMessage({
      sessionId, messageId: 'run-1:assistant-2', runId: 'run-1',
      message: { role: 'assistant', content: '확인했습니다.' },
    });

    const text = await readFile(join(root, `${sessionId}.jsonl`), 'utf8');
    assert.ok(text.startsWith(prefix));
    assert.equal((await stat(join(root, `${sessionId}.jsonl`))).mode & 0o777, 0o600);
    const reopened = new ConversationLedger(root);
    const conversation = await reopened.read(sessionId);
    assert.deepEqual(conversation.events.map((event) => event.sequence), [1, 2, 3, 4, 5]);
    assert.deepEqual(conversation.messages.map((message) => message.role), [
      'user', 'assistant', 'tool', 'assistant',
    ]);
    assert.match(conversation.messages[2].content, /hidden-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy UI 대화는 원장이 없을 때 한 번만 가져오고 기존 원장이 있으면 재주입하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-conversation-import-'));
  const sessionId = '22222222-2222-4222-8222-222222222222';
  try {
    const ledger = new ConversationLedger(root);
    await ledger.ensure({
      sessionId,
      legacyMessages: [
        { role: 'user', content: '과거 질문' },
        { role: 'assistant', content: '과거 답' },
      ],
    });
    await ledger.ensure({
      sessionId,
      legacyMessages: [{ role: 'user', content: '중복되면 안 됨' }],
    });
    const conversation = await ledger.read(sessionId);
    assert.deepEqual(conversation.messages.map((message) => message.content), ['과거 질문', '과거 답']);
    assert.equal(conversation.events.filter((event) => event.type === 'conversation_started').length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
