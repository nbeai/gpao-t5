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

test('여러 대화의 보관·삭제·복원은 한 상태 전이로 적용되고 실제 변경만 반환한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-console-bulk-lifecycle-'));
  try {
    const store = new ConsoleSessionStore(dir);
    const first = await store.create();
    const second = await store.create();
    const third = await store.create();

    const archived = await store.bulkTransition({ ids: [first.id, second.id], action: 'archive' });
    assert.equal(archived.action, 'archive');
    assert.equal(archived.count, 2);
    assert.deepEqual(archived.sessions.map((session) => session.id), [first.id, second.id]);
    assert.deepEqual((await store.list({ archived: true })).map((session) => session.id), [second.id, first.id]);

    const archivedAgain = await store.bulkTransition({ ids: [first.id, second.id], action: 'archive' });
    assert.deepEqual(archivedAgain, { action: 'archive', count: 0, sessions: [] });

    const deleted = await store.bulkTransition({ ids: [first.id, third.id], action: 'delete' });
    assert.equal(deleted.count, 2);
    assert.deepEqual((await store.list({ deleted: true })).map((session) => session.id), [third.id, first.id]);
    assert.deepEqual((await store.list({ archived: true })).map((session) => session.id), [second.id]);

    const restored = await store.bulkTransition({ ids: [first.id, second.id, third.id], action: 'restore' });
    assert.equal(restored.count, 3);
    assert.deepEqual((await store.list()).map((session) => session.id), [third.id, second.id, first.id]);
    assert.equal((await store.list({ archived: true })).length, 0);
    assert.equal((await store.list({ deleted: true })).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('여러 대화 전이는 action·범위·중복·모든 id를 먼저 검증하고 실패 시 일부도 바꾸지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-console-bulk-validation-'));
  try {
    const store = new ConsoleSessionStore(dir);
    const first = await store.create();
    const second = await store.create();
    const original = await store.read();
    const unknown = '00000000-0000-4000-8000-000000000000';

    const invalidInputs = [
      { ids: [first.id], action: 'remove' },
      { ids: [], action: 'archive' },
      { ids: Array.from({ length: 101 }, (_, index) => `id-${index}`), action: 'archive' },
      { ids: [first.id, first.id], action: 'delete' },
      { ids: [first.id, 'not-a-session-id'], action: 'restore' },
    ];
    for (const input of invalidInputs) {
      await assert.rejects(store.bulkTransition(input), TypeError);
      assert.deepEqual(await store.read(), original);
    }

    await assert.rejects(
      store.bulkTransition({ ids: [first.id, unknown, second.id], action: 'archive' }),
      /bulk session not found/u,
    );
    assert.deepEqual(await store.read(), original);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('고정·수동 그룹은 Conversation 내용을 복제하거나 휴지통 대화를 부활시키지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-console-groups-'));
  try {
    const store = new ConsoleSessionStore(dir); const first = await store.create(); const second = await store.create();
    await store.append(first.id, { role: 'user', text: '한빛상사 정산' });
    await store.updateMeta(first.id, { pinned: true });
    const group = await store.createGroup('회사 운영');
    assert.equal((await store.assignGroup({ ids: [first.id, second.id], groupId: group.groupId })).count, 2);
    const listed = await store.list();
    assert.equal(listed.find((session) => session.id === first.id).groupId, group.groupId);
    assert.ok(listed.find((session) => session.id === first.id).pinnedAt);
    assert.equal(JSON.stringify(await store.listGroups()).includes('한빛상사'), false);
    await store.softDelete(second.id);
    await assert.rejects(store.assignGroup({ ids: [second.id], groupId: null }), /target not found/u);
    const removed = await store.deleteGroup(group.groupId); assert.equal(removed.moved, 2);
    assert.equal((await store.load(first.id)).groupId, null);
    assert.ok((await store.load(second.id)).deletedAt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('자동화 실행용 내부 대화는 원장에는 남지만 일반·보관함·휴지통 목록에는 나오지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-console-internal-session-'));
  try {
    const store = new ConsoleSessionStore(dir); const origin = await store.create();
    const internal = await store.create({ continuationOf: origin.id, internal: true });
    await store.append(internal.id, { role: 'user', text: 'Return exactly this text: internal' });
    await store.setArchived(internal.id, true);
    assert.ok(await store.load(internal.id));
    assert.equal((await store.list()).some((item) => item.id === internal.id), false);
    assert.equal((await store.list({ archived: true })).some((item) => item.id === internal.id), false);
    assert.equal((await store.list({ deleted: true })).some((item) => item.id === internal.id), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
