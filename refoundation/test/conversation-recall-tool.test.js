import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeConversationRecallTool } from '../src/conversation-recall-tool.js';

test('conversation_recall은 허용된 historical output에서 find 후 정확한 구간을 읽는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-conversation-recall-'));
  const sessionId = '33333333-3333-4333-8333-333333333333';
  try {
    const ledger = new ConversationLedger(root);
    await ledger.ensure({ sessionId });
    const stdout = `${'a'.repeat(9_000)}MIDDLE-NEEDLE-7391${'z'.repeat(9_000)}`;
    const receipt = {
      toolCallId: 'call-1', requestedCall: { id: 'call-1', name: 'exec', args: {} },
      actualCall: { name: 'exec', args: {} }, outcome: 'succeeded',
      result: { stdout, stderr: '', exitCode: 0 },
    };
    await ledger.appendMessage({
      sessionId, messageId: 'large-tool-message', runId: 'run-1',
      message: { role: 'tool', toolCallId: 'call-1', name: 'exec', content: JSON.stringify(receipt) },
    });
    const tool = makeConversationRecallTool({
      ledger, sessionId,
      allowedRefs: [{ messageId: 'large-tool-message', stream: 'stdout', totalChars: stdout.length }],
    });
    const found = await tool.execute({
      action: 'find', messageId: 'large-tool-message', stream: 'stdout',
      query: 'MIDDLE-NEEDLE', offset: null, limit: null,
    });
    assert.equal(found.state, 'found');
    assert.equal(found.matches.length, 1);
    assert.equal(found.matches[0].offset, 9_000);
    assert.match(found.matches[0].excerpt, /MIDDLE-NEEDLE-7391/);
    const read = await tool.execute({
      action: 'read', messageId: 'large-tool-message', stream: 'stdout',
      query: null, offset: 8_990, limit: 50,
    });
    assert.equal(read.state, 'read');
    assert.match(read.text, /MIDDLE-NEEDLE-7391/);
    assert.equal(read.totalChars, stdout.length);
    await assert.rejects(() => tool.execute({
      action: 'read', messageId: 'not-allowed', stream: 'stdout',
      query: null, offset: 0, limit: 10,
    }), /not available/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
