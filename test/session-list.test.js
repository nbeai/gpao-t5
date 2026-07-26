// P2-4a · 대화 목록 정리성 — 이름 변경 · 고정 · 아카이브 · 삭제.
//
// 왜: 실사용 대화가 쌓이면 좌측 목록이 무한히 자란다. AI OS 는 대화를 기록으로 쌓는 게 아니라
// 작업 기억을 정리·회수·폐기할 수 있어야 한다(오너 지시서).
//
// 이 슬라이스가 특히 조심하는 것(지시서 [보강]):
//   · 지운 대화가 **검색으로 되살아나지 않는다**(/search 는 세션 경계를 넘어 전체를 뒤진다)
//   · 지운 대화는 주소로도 안 열린다(목록에서만 막으면 URL 로 들어온다)
//   · 휴지통이 무한히 자라지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, sanitizeTitle, sortSessions, DEFAULT_TITLE } from '../src/surface/session-store.js';

const newStore = async () => new SessionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-list-')));

// ── 제목 손질 ─────────────────────────────────────────────────────────────
test('제목은 한 줄로 손질하고, 빈 제목은 "새 대화"로 보인다', () => {
  assert.equal(sanitizeTitle('  T5   개발\n검수  '), 'T5 개발 검수');
  assert.equal(sanitizeTitle('탭\t제어문자'), '탭 제어 문자');
  assert.equal(sanitizeTitle('   '), DEFAULT_TITLE);
  assert.equal(sanitizeTitle('가'.repeat(200)).length, 60);
});

test('정렬은 고정 먼저, 그 안에서 최근순', () => {
  const sorted = sortSessions([
    { id: 'a', pinned: false, updatedAt: 300 },
    { id: 'b', pinned: true, updatedAt: 100 },
    { id: 'c', pinned: false, updatedAt: 200 },
    { id: 'd', pinned: true, updatedAt: 150 },
  ]);
  assert.deepEqual(sorted.map((s) => s.id), ['d', 'b', 'a', 'c']);
});

// ── 저장소 계약 ───────────────────────────────────────────────────────────
test('새 대화는 목록 메타를 갖고 시작한다(나중에 마이그레이션하지 않게)', async () => {
  const store = await newStore();
  const s = await store.create();
  assert.equal(s.manualTitle, false);
  assert.equal(s.pinned, false);
  assert.equal(s.archivedAt, null);
  assert.equal(s.deletedAt, null);
  assert.equal(s.groupId, null);
});

test('이름을 바꾸면 수동 제목으로 표시된다(자동 제목이 덮어쓰지 않게)', async () => {
  const store = await newStore();
  const s = await store.create();
  const updated = await store.updateMeta(s.id, { title: '  T5 개발 검수  ' });
  assert.equal(updated.title, 'T5 개발 검수');
  assert.equal(updated.manualTitle, true);
});

test('숨기면 기본 목록에서 사라지고 보관함에서 보이며, 되돌리면 돌아온다', async () => {
  const store = await newStore();
  const s = await store.create();
  await store.setArchived(s.id, true);
  assert.equal((await store.list()).length, 0);
  const archived = await store.list({ archived: true });
  assert.equal(archived.length, 1);
  assert.ok(archived[0].archivedAt);
  await store.setArchived(s.id, false);
  assert.equal((await store.list()).length, 1);
});

test('숨긴 대화는 그대로 열린다(삭제가 아니라 숨김이다)', async () => {
  const store = await newStore();
  const s = await store.create();
  await store.setArchived(s.id, true);
  assert.ok(await store.load(s.id));
});

test('지우면 목록에서 빠지고 **주소로도 안 열린다**', async () => {
  const store = await newStore();
  const s = await store.create();
  await store.softDelete(s.id);
  assert.equal((await store.list()).length, 0);
  assert.equal(await store.load(s.id), null, '목록에서만 막으면 주소로 들어온다');
  assert.equal((await store.list({ deleted: true })).length, 1, '휴지통에서는 보여야 되돌릴 수 있다');
});

test('지운 대화를 되돌리면 목록으로 돌아온다', async () => {
  const store = await newStore();
  const s = await store.create();
  await store.softDelete(s.id);
  await store.restore(s.id);
  assert.equal((await store.list()).length, 1);
  assert.ok(await store.load(s.id));
});

test('휴지통은 무한히 자라지 않는다(보관 기한이 지나면 실제로 지운다)', async () => {
  const store = await newStore();
  const keep = await store.create();
  const old = await store.create();
  await store.softDelete(old.id);
  const recent = await store.create();
  await store.softDelete(recent.id);

  const purged = await store.purgeExpired(Date.now() + 31 * 24 * 60 * 60 * 1000);
  assert.equal(purged, 2, '기한 지난 것은 파일까지 사라진다');
  const files = (await readdir(store.dir)).filter((f) => f.endsWith('.json'));
  assert.deepEqual(files, [`${keep.id}.json`]);
});

test('보관 기한 안이면 지우지 않는다(성급한 영구 삭제 금지)', async () => {
  const store = await newStore();
  const s = await store.create();
  await store.softDelete(s.id);
  assert.equal(await store.purgeExpired(Date.now()), 0);
  assert.ok(await store.load(s.id, { includeDeleted: true }));
});

// ── 서버 API (절대원칙 1: 사용자에게 도달하는 경로) ───────────────────────
async function withServer(fn) {
  const { makeServer } = await import('../src/surface/server.js');
  const store = await newStore();
  const server = makeServer({ store, model: { respond: async () => '네' } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => (await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })).json();
  const getj = async (path) => (await fetch(`${base}${path}`)).json();
  try { return await fn({ post, getj, base, store }); }
  finally { await new Promise((r) => server.close(r)); }
}

test('API: 이름 변경 → 첫 발화가 덮어쓰지 않는다', async () => {
  await withServer(async ({ post, getj }) => {
    const s = await post('/sessions');
    await post('/sessions/meta', { sessionId: s.id, title: 'T5 개발 검수' });
    await post('/turn', { sessionId: s.id, text: '안녕하세요 반갑습니다' });
    const { sessions } = await getj('/sessions');
    assert.equal(sessions[0].title, 'T5 개발 검수', '수동 제목이 자동 제목에 먹혔다');
  });
});

test('API: 이름을 안 바꿨으면 첫 발화가 제목이 된다(기존 흐름 유지)', async () => {
  await withServer(async ({ post, getj }) => {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '주간 보고 정리' });
    const { sessions } = await getj('/sessions');
    assert.equal(sessions[0].title, '주간 보고 정리');
  });
});

test('API: 고정하면 최근 대화보다 위에 온다', async () => {
  await withServer(async ({ post, getj }) => {
    const first = await post('/sessions');
    await post('/sessions'); // 더 최근 대화
    await post('/sessions/meta', { sessionId: first.id, pinned: true });
    const { sessions } = await getj('/sessions');
    assert.equal(sessions[0].id, first.id);
    assert.equal(sessions[0].pinned, true);
  });
});

test('API: 숨기기·되돌리기가 사용자 말과 함께 온다', async () => {
  await withServer(async ({ post, getj }) => {
    const s = await post('/sessions');
    const hidden = await post('/sessions/archive', { sessionId: s.id, archived: true });
    assert.match(hidden.userSafeSummary, /보관함/, '어디로 갔는지 알려줘야 다시 찾는다');
    assert.equal((await getj('/sessions')).sessions.length, 0);
    assert.equal((await getj('/sessions?archived=1')).sessions.length, 1);
    await post('/sessions/archive', { sessionId: s.id, archived: false });
    assert.equal((await getj('/sessions')).sessions.length, 1);
  });
});

test('API: 삭제는 무엇이 사라지고 무엇이 복구되는지 말한다(P2-3 계약)', async () => {
  await withServer(async ({ post }) => {
    const s = await post('/sessions');
    await post('/sessions/meta', { sessionId: s.id, title: '지울 대화' });
    const out = await post('/sessions/delete', { sessionId: s.id });
    assert.match(out.userSafeSummary, /지울 대화/, '무엇이 사라지는지');
    assert.match(out.userSafeSummary, /되돌릴 수 있어요/, '무엇이 복구되는지');
    assert.ok(!/정말/.test(out.userSafeSummary), '정책문 금지');
  });
});

test('API: 지운 대화는 목록·열람에서 빠지고 휴지통에서 되돌릴 수 있다', async () => {
  await withServer(async ({ post, getj, base }) => {
    const s = await post('/sessions');
    await post('/sessions/delete', { sessionId: s.id });
    assert.equal((await getj('/sessions')).sessions.length, 0);
    assert.equal((await fetch(`${base}/sessions/${s.id}`)).status, 404, '주소로도 못 연다');
    assert.equal((await getj('/sessions?deleted=1')).sessions.length, 1);
    await post('/sessions/restore', { sessionId: s.id });
    assert.equal((await getj('/sessions')).sessions.length, 1);
  });
});

// 지시서 [보강] 1 — 이게 없으면 "지웠는데 다음 턴에 다시 나온다"
test('API: 지운 대화는 세션 검색 후보에도 나오지 않는다', async () => {
  await withServer(async ({ post }) => {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '비밀번호는 무지개다' });
    const before = await post('/search', { query: '무지개' });
    assert.ok(before.results.length > 0, '먼저 찾히는지 확인(반대 조건)');

    await post('/sessions/delete', { sessionId: s.id });
    const after = await post('/search', { query: '무지개' });
    assert.equal(after.results.length, 0, '지운 대화가 검색으로 되살아났다');
  });
});

test('API: 없는 대화를 조작하면 정직하게 못 찾았다고 한다', async () => {
  await withServer(async ({ post }) => {
    const out = await post('/sessions/delete', { sessionId: '00000000-0000-4000-8000-000000000000' });
    assert.match(out.error, /찾지 못했어요/);
  });
});
