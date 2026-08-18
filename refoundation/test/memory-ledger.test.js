import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryLedger } from '../src/memory-ledger.js';

test('memory 원장은 add·replace·remove를 append-only로 남기고 재시작 뒤 현재값을 복원한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-ledger-'));
  try {
    const ledger = new MemoryLedger(room);
    await ledger.ensure();
    const added = await ledger.add({
      kind: 'user', content: '사용자는 결론을 먼저 듣는 것을 선호한다.',
      source: { origin: 'explicit', sessionId: 'session-1', runId: 'run-1' },
    });
    const afterAdd = await readFile(join(room, 'memory.jsonl'), 'utf8');
    const duplicate = await ledger.add({
      kind: 'user', content: '사용자는 결론을 먼저 듣는 것을 선호한다.',
      source: { origin: 'pre_checkpoint', sessionId: 'session-1' },
    });
    assert.equal(duplicate.memoryId, added.memoryId);
    assert.equal(await readFile(join(room, 'memory.jsonl'), 'utf8'), afterAdd);

    await ledger.replace({
      memoryId: added.memoryId, kind: 'user', content: '사용자는 짧은 결론을 먼저 듣는 것을 선호한다.',
      source: { origin: 'explicit', sessionId: 'session-1', runId: 'run-2' },
    });
    const beforeRemove = await readFile(join(room, 'memory.jsonl'), 'utf8');
    await ledger.remove({
      memoryId: added.memoryId,
      source: { origin: 'explicit', sessionId: 'session-1', runId: 'run-3' },
    });
    const afterRemove = await readFile(join(room, 'memory.jsonl'), 'utf8');
    assert.ok(afterRemove.startsWith(beforeRemove));
    const reopened = await new MemoryLedger(room).read();
    assert.equal(reopened.items.length, 0);
    assert.deepEqual(reopened.events.map((event) => event.type), [
      'memory_started', 'memory_added', 'memory_replaced', 'memory_removed',
    ]);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('memory는 사실·선호·결정 두 kind와 bounded content만 받는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-bounds-'));
  try {
    const ledger = new MemoryLedger(room, { maxEntryBytes: 80, maxActiveBytes: 120 });
    await ledger.ensure();
    await assert.rejects(() => ledger.add({ kind: 'episode', content: '한 번 있었던 일' }), /kind/);
    await assert.rejects(() => ledger.add({ kind: 'work', content: '가'.repeat(100) }), /entry.*large/i);
    await ledger.add({ kind: 'user', content: 'A'.repeat(70) });
    await assert.rejects(() => ledger.add({ kind: 'work', content: 'B'.repeat(70) }), /capacity/i);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
