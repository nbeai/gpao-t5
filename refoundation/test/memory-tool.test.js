import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryLedger } from '../src/memory-ledger.js';
import { makeMemoryTool, memoryContextMessage } from '../src/memory-tool.js';

test('memory 도구 하나로 자연어 대화가 add·list·replace·remove 현재값을 다룬다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-tool-'));
  try {
    const ledger = new MemoryLedger(room);
    await ledger.ensure();
    const tool = makeMemoryTool({
      ledger, source: { origin: 'explicit', sessionId: 'session-1', runId: 'run-1' },
    });
    const added = await tool.execute({
      action: 'add', memoryId: null, kind: 'user', content: '사용자는 한국어 답변을 선호한다.',
    });
    assert.equal(added.state, 'added');
    const listed = await tool.execute({ action: 'list', memoryId: null, kind: null, content: null });
    assert.equal(listed.items.length, 1);
    await tool.execute({
      action: 'replace', memoryId: added.item.memoryId, kind: 'user',
      content: '사용자는 간결한 한국어 답변을 선호한다.',
    });
    const context = memoryContextMessage((await ledger.read()).items);
    assert.match(context.content, /PERSISTENT MEMORY/);
    assert.match(context.content, /간결한 한국어/);
    assert.match(context.content, /current request/i);
    await tool.execute({
      action: 'remove', memoryId: added.item.memoryId, kind: null, content: null,
    });
    assert.equal((await ledger.read()).items.length, 0);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
