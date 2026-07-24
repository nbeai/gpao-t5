import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// 서버를 임의 포트로 띄우고 실제 HTTP 로 검사한다(절대원칙 1: 산출물 레벨 검증).
// 세션 저장소는 temp dir 로 격리해 실제 홈을 오염시키지 않는다.
async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-srv-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { return await fn(base); }
  finally { await new Promise((r) => server.close(r)); }
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

test('GET / 는 Work Chat 화면을 준다', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Work Chat/);
  });
});

test('세션 생성 → 목록에 나타남', async () => {
  await withServer(async (base) => {
    assert.deepEqual((await getj(base, '/sessions')).sessions, []);
    const s = await (await post(base, '/sessions')).json();
    assert.match(s.id, /^[a-f0-9-]{36}$/);
    const { sessions } = await getj(base, '/sessions');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, s.id);
  });
});

test('sessionId 없는 turn은 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/turn', { text: '안녕' });
    assert.equal(res.status, 400);
  });
});

// 지속성: 발화가 transcript에 남고 재접속(GET)으로 복원된다.
test('turn 결과가 세션 transcript에 지속되고 복원된다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    const reloaded = await getj(base, `/sessions/${s.id}`);
    // [user 안녕, assistant reply]
    assert.equal(reloaded.transcript.length, 2);
    assert.equal(reloaded.transcript[0].role, 'user');
    assert.equal(reloaded.transcript[1].role, 'assistant');
    assert.equal(reloaded.transcript[1].result.kind, 'reply');
    assert.match(reloaded.title, /안녕/, '첫 발화로 제목이 지어진다');
  });
});

// 격리: 두 세션의 대화가 서로 새지 않는다.
test('세션 간 대화 격리 — 한 세션 발화가 다른 세션에 안 보인다', async () => {
  await withServer(async (base) => {
    const a = await (await post(base, '/sessions')).json();
    const b = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: a.id, text: 'A 프로젝트 얘기' });
    await post(base, '/turn', { sessionId: b.id, text: 'B 프로젝트 얘기' });
    const ra = await getj(base, `/sessions/${a.id}`);
    const rb = await getj(base, `/sessions/${b.id}`);
    assert.ok(ra.transcript.some((e) => e.text === 'A 프로젝트 얘기'));
    assert.ok(!ra.transcript.some((e) => e.text === 'B 프로젝트 얘기'), '격리');
    assert.ok(rb.transcript.some((e) => e.text === 'B 프로젝트 얘기'));
  });
});

// 승인 재개: 세션 안에서 approve가 text 없이도 동작한다(회귀 지점 + 세션 배선).
test('세션 안 승인 재개(approve)는 text 없이도 200, 계획 이어받음', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r1 = await (await post(base, '/turn', { sessionId: s.id, text: '이 소식 슬랙에 올려줘' })).json();
    assert.equal(r1.kind, 'approval');
    const res2 = await post(base, '/turn', { sessionId: s.id, approve: r1.pendingId });
    assert.equal(res2.status, 200);
    assert.equal((await res2.json()).kind, 'reply');
  });
});

// Approval Lifecycle: 승인 대기가 서버 재시작(같은 저장소, 새 서버) 후에도 지속돼 이어실행된다.
test('승인 대기가 재시작 후에도 지속돼 이어실행된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-persist-'));
  const srv1 = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => srv1.listen(0, r));
  const b1 = `http://127.0.0.1:${srv1.address().port}`;
  const s = await (await post(b1, '/sessions')).json();
  const r1 = await (await post(b1, '/turn', { sessionId: s.id, text: '이 소식 슬랙에 올려줘' })).json();
  assert.equal(r1.kind, 'approval');
  await new Promise((r) => srv1.close(r)); // 재시작

  const srv2 = makeServer({ store: new SessionStore(dir) }); // 같은 저장소, 새 프로세스
  await new Promise((r) => srv2.listen(0, r));
  const b2 = `http://127.0.0.1:${srv2.address().port}`;
  try {
    const reloaded = await getj(b2, `/sessions/${s.id}`);
    assert.ok(reloaded.activePendingIds.includes(r1.pendingId), '재시작 후 승인 대기 유효');
    const r2 = await (await post(b2, '/turn', { sessionId: s.id, approve: r1.pendingId })).json();
    assert.equal(r2.kind, 'reply', '재시작 후에도 이어실행');
  } finally {
    await new Promise((r) => srv2.close(r));
  }
});

test('존재하지 않는 세션의 turn은 404', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/turn', { sessionId: '00000000-0000-0000-0000-000000000000', text: '안녕' });
    assert.equal(res.status, 404);
  });
});
