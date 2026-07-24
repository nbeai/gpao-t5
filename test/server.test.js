import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../src/surface/server.js';

// 서버를 임의 포트로 띄우고 실제 HTTP 로 검사한다(절대원칙 1: 산출물 레벨 검증).
// 커널 단위 테스트는 runTurn 을 직접 부르므로 서버 래퍼의 검증 결함을 잡지 못한다.
async function withServer(fn) {
  const server = makeServer();
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (base, body) =>
  fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET / 는 Work Chat 화면을 준다', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Work Chat/);
  });
});

test('빈 입력은 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, {});
    assert.equal(res.status, 400);
  });
});

// 재발 방지: 승인/거부는 text 가 없어도 서버가 받아야 한다(승인 재개 400 회귀 방지).
test('승인 재개(approve/reject)는 text 없이도 서버가 받는다', async () => {
  await withServer(async (base) => {
    // 1) 슬랙 게시 요청 → 승인 대기(slack.post 는 데모에서 executable=true).
    const r1 = await (await post(base, { text: '이 소식 슬랙에 올려줘' })).json();
    assert.equal(r1.kind, 'approval');
    assert.ok(r1.pendingId);

    // 2) text 없이 approve 만 — 서버가 200 으로 받아 재개해야 한다(과거 400 회귀 지점).
    const res2 = await post(base, { approve: r1.pendingId });
    assert.equal(res2.status, 200, 'approve 는 400 이 아니어야 한다');
    const r2 = await res2.json();
    assert.equal(r2.kind, 'reply');
    assert.ok(r2.reply && r2.reply.length > 0, '재개 응답에 빈 답이 아니어야 한다');
  });
});
