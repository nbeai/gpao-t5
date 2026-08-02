// 기본 자리가 막혀도 T5 는 켜진다 — 그리고 기억은 둘로 갈라지지 않는다.
//
// 설치본을 받은 사람에게 "4173 이 사용 중이니 --port 로 다시 실행하세요"는 안내가 아니라
// **켜지지 않는 프로그램**이다. 여기서 재는 것은 셋이다.
//   ① 다른 프로그램이 자리를 쓰고 있어도 T5 가 뜨는가
//   ② 이미 떠 있는 이 T5 를 찾아서 하나 더 띄우지 않는가 (자리를 옮긴 뒤에도)
//   ③ 자리가 바뀌어도 기억이 그대로 따라오는가
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { 설치신분, 자리표읽기, 자리표쓰기 } from '../src/surface/install-locator.js';
import { 자리잡기, 우리것인가, 옮김안내 } from '../src/surface/port-claim.js';

async function 새자리() {
  return mkdtemp(join(tmpdir(), 'gpao-t5-port-'));
}

/** 자리를 미리 차지하고 앉은 남의 프로그램. T5 인 척하지 않는다. */
async function 남의프로그램() {
  const s = createServer((_req, res) => { res.writeHead(200); res.end('나는 T5 가 아니다'); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { port: s.address().port, 닫기: () => new Promise((r) => s.close(r)) };
}

async function 띄우기(dir, port, { writerLock = true } = {}) {
  const server = await startLiveServer({
    port, processEnv: { GPAO_T5_DATA_DIR: dir }, sessionStore: new SessionStore(dir),
    startScheduler: false, startReceivers: false, restoreConnections: false, writerLock,
  });
  return { server, port: server.address().port, 닫기: () => new Promise((r) => server.close(r)) };
}

// **하나의 상황을 한 번만 만든다.** 아래 셋은 전부 "기본 자리를 남이 쓰는 채로 T5 가 떴다"는
// 같은 자리에서 재는 것이라, 검사마다 다시 띄우면 재는 것은 그대로인데 일하는 양만 는다(§17).
let 막힌자리 = null;
before(async () => {
  const dir = await 새자리();
  const 남 = await 남의프로그램();
  const t = await 띄우기(dir, 남.port);   // 이미 차 있는 자리를 달라고 한다
  막힌자리 = { dir, 남, t };
});
after(async () => {
  if (!막힌자리) return;
  await 막힌자리.t.닫기();
  await 막힌자리.남.닫기();
});

test('다른 프로그램이 자리를 쓰고 있으면 조용히 옮겨서 뜬다', async () => {
  const { 남, t } = 막힌자리;
  assert.notEqual(t.port, 남.port, '남의 자리를 뺏지도, 거기서 죽지도 않는다');
  const r = await fetch(`http://127.0.0.1:${t.port}/health`);
  assert.equal(r.status, 200, '옮긴 자리에서 정상으로 산다');
  assert.equal(t.server.자리옮김, true, '옮겼다는 사실을 숨기지 않는다 — 안내는 이걸 보고 한다');
});

test('옮긴 자리는 자리표에 적힌다 — 다음 실행이 이걸로 찾는다', async () => {
  const { dir, t } = 막힌자리;
  const 적힌것 = await 자리표읽기(dir);
  assert.equal(적힌것?.port, t.port, '실제로 잡은 자리가 적힌다');
  assert.equal(적힌것?.installId, (await 설치신분(dir)).installId, '누구의 자리인지도');
});

test('자리를 옮긴 뒤에도 두 번째 실행은 같은 T5 를 찾는다 — 하나 더 띄우지 않는다', async () => {
  const { dir, 남, t } = 막힌자리;
  const 신분 = await 설치신분(dir);
  // 두 번째 실행이 하는 일: 기본 자리(막혀 있다)가 아니라 자리표를 먼저 본다.
  const 결정 = await 자리잡기({ dir, 원하는포트: 남.port, installId: 신분.installId });
  assert.equal(결정.결정, 'reuse', '떠 있는 걸 놔두고 하나 더 띄우면 기억이 둘로 갈라진다');
  assert.equal(결정.port, t.port, '옮긴 그 자리로 간다');
});

test('자리표가 가리키는 곳이 비어 있으면 그냥 새로 잡는다', async () => {
  const dir = await 새자리();
  const 신분 = await 설치신분(dir);
  const 죽은자리 = await 남의프로그램();
  await 죽은자리.닫기();                                   // 아무도 없는 포트 번호 하나
  await 자리표쓰기(dir, { port: 죽은자리.port, installId: 신분.installId });
  const 결정 = await 자리잡기({ dir, 원하는포트: 4173, installId: 신분.installId, 기다림: 300 });
  assert.equal(결정.결정, 'claim', '적혀 있다고 살아 있다고 믿지 않는다');
});

test('남의 T5 에 사용자를 밀어 넣지 않는다', async () => {
  const dir = await 새자리();
  const t = await 띄우기(dir, 0);
  try {
    // 같은 자리에 T5 가 떠 있지만 **다른 설치본**이다(installId 가 다르다).
    assert.equal(await 우리것인가(t.port, 'da39a3ee-0000-0000-0000-000000000000', { 기다림: 500 }), false);
    assert.equal(await 우리것인가(t.port, (await 설치신분(dir)).installId, { 기다림: 500 }), true);
  } finally { await t.닫기(); }
});

test('자리가 바뀌어도 기억은 그대로 따라온다', async () => {
  const dir = await 새자리();
  const 남 = await 남의프로그램();
  try {
    const t = await 띄우기(dir, 남.port);
    let 만든대화 = null;
    try {
      const 쿠키 = ((await fetch(`http://127.0.0.1:${t.port}/`)).headers.get('set-cookie') ?? '').split(';')[0];
      const 만들기 = await fetch(`http://127.0.0.1:${t.port}/sessions`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: 쿠키 }, body: '{}',
      });
      assert.equal(만들기.status, 200, '옮긴 자리에서도 평소처럼 쓴다');
      만든대화 = (await 만들기.json()).id;
      assert.ok(만든대화, '대화가 실제로 생겼다');
    } finally { await t.닫기(); }

    // 껐다 켠다 — 이번엔 자리가 또 다를 수 있다. 그래도 있던 대화가 있어야 한다.
    // 단일 writer 잠금은 여기서 끈다: 실제로는 앞의 **프로세스가 끝나서** 잠금이 풀리는데,
    // 한 프로세스 안에서 두 번 띄우는 이 검사에서는 같은 pid 가 살아 있는 것으로 보인다.
    // 재는 것은 잠금이 아니라 "자리가 바뀌어도 기억이 따라오는가"다.
    const 다시 = await 띄우기(dir, 0, { writerLock: false });
    try {
      const 쿠키 = ((await fetch(`http://127.0.0.1:${다시.port}/`)).headers.get('set-cookie') ?? '').split(';')[0];
      const 목록 = await (await fetch(`http://127.0.0.1:${다시.port}/sessions`, { headers: { cookie: 쿠키 } })).json();
      assert.ok(JSON.stringify(목록).includes(만든대화), '자리는 바뀌어도 기억은 같은 폴더에 있다');
    } finally { await 다시.닫기(); }
  } finally { await 남.닫기(); }
});

test('사람에게는 포트가 아니라 무슨 일이 있었는지를 말한다', () => {
  const 말 = 옮김안내();
  assert.ok(!/\d{4}/.test(말), '포트 번호를 설명하지 않는다 — 그건 사용자의 일이 아니다');
  assert.match(말, /다른 프로그램/, '무엇 때문인지는 말한다');
});
