import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConsoleSessionStore } from '../src/console-session-store.js';

test('콘솔 세션은 생성·대화 추가·재시작 복원이 한 저장 파일에서 이어진다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-console-session-'));
  try {
    const store = new ConsoleSessionStore(dir);
    const created = await store.create();
    await store.append(created.id, { role: 'user', text: '안녕' });
    await store.append(created.id, { role: 'assistant', result: { kind: 'reply', reply: '반가워요' } });
    const reopened = new ConsoleSessionStore(dir);
    const session = await reopened.load(created.id);
    assert.equal(session.transcript.length, 2);
    assert.equal(session.transcript[0].text, '안녕');
    assert.equal(session.transcript[1].result.reply, '반가워요');
    assert.equal((await stat(join(dir, 'console-sessions.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('보관·휴지통은 복구 가능하고 기본 목록에서만 빠진다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-console-lifecycle-'));
  try {
    const store = new ConsoleSessionStore(dir);
    const first = await store.create();
    const second = await store.create();
    await store.setArchived(first.id, true);
    assert.deepEqual((await store.list()).map((session) => session.id), [second.id]);
    assert.deepEqual((await store.list({ archived: true })).map((session) => session.id), [first.id]);
    await store.softDelete(second.id);
    assert.equal((await store.list()).length, 0);
    assert.deepEqual((await store.list({ deleted: true })).map((session) => session.id), [second.id]);
    await store.restore(second.id);
    assert.deepEqual((await store.list()).map((session) => session.id), [second.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
