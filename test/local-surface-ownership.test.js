// 이 표면은 이 사람 것이다 — 다른 웹페이지도, 지나가는 로컬 프로그램도 부를 수 없다.
//
// 루프백에 떴다는 것만으로는 아무 것도 지켜지지 않는다. 사용자가 열어 둔 아무 탭이
// http://127.0.0.1:4173/sessions 를 부를 수 있고, 공격자 도메인이 127.0.0.1 로 해석되면
// 그 페이지는 아예 같은 출처가 된다. 여기서 재는 것은 **그게 실제로 막히는가**와,
// 그걸 막느라 **쓰던 사람이 뭔가를 더 해야 하지는 않은가** 둘이다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { 설치신분 } from '../src/surface/install-locator.js';

// **서버는 한 번만 띄운다.** 여기서 재는 것은 전부 "누가 부르면 어떻게 되나"라 서로 상태를
// 건드리지 않는다. 검사마다 새로 띄우면 재는 것은 그대로인데 검사가 일하는 양만 늘어난다(§17).
let t = null;
before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-own-'));
  const server = await startLiveServer({
    port: 0, processEnv: { GPAO_T5_DATA_DIR: dir }, sessionStore: new SessionStore(dir),
    startScheduler: false, startReceivers: false, restoreConnections: false,
  });
  const port = server.address().port;
  t = { server, dir, port, base: `http://127.0.0.1:${port}` };
});
after(async () => { if (t) await new Promise((r) => t.server.close(r)); });

/** 사람이 화면을 여는 그 한 걸음 — 여기서 신분이 붙는다. 사용자가 하는 일은 없다. */
async function 화면열기(base) {
  const r = await fetch(`${base}/`);
  const set = r.headers.get('set-cookie') ?? '';
  const 쿠키 = set.split(';')[0];
  return { r, 쿠키 };
}

test('다른 웹페이지는 세션 API 를 부르지 못한다', async () => {
  const { 쿠키 } = await 화면열기(t.base);
  // 쿠키까지 들고 있어도(SameSite 가 없는 옛 브라우저라 쳐도) 다른 출처면 거절이다.
  const r = await fetch(`${t.base}/sessions`, {
    headers: { origin: 'https://evil.example.com', cookie: 쿠키 },
  });
  assert.equal(r.status, 403, '다른 페이지에서 온 요청은 받지 않는다');
  const 본문 = await r.text();
  assert.match(본문, /다른 웹페이지/, '왜 막혔는지 사람 말로 말한다');
});

/**
 * `fetch` 는 Host 헤더를 못 바꾸게 막는다(브라우저 규칙). 그런데 rebinding 에서 Host 를 정하는 건
 * 브라우저지 페이지가 아니다 — 공격자 도메인이 그대로 실려 온다. 그 모습을 재려면 생 소켓이어야 한다.
 */
async function 생요청(port, 경로, host) {
  const { connect } = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1', () => {
      s.write(`GET ${경로} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let 받은것 = '';
    s.on('data', (b) => { 받은것 += b; });
    s.on('end', () => resolve(받은것));
    s.on('error', reject);
  });
}

test('우리 이름이 아닌 Host 로는 붙지 못한다 — DNS rebinding 이 여기서 걸린다', async () => {
  const 목록 = await 생요청(t.port, '/sessions', 'attacker.example.com');
  assert.match(목록.split('\r\n')[0], /403/, '공격자 도메인이 127.0.0.1 로 해석돼도 Host 가 우리 이름이 아니다');
  // 화면조차 안 준다 — HTML 을 내주면 그때 신분 쿠키가 공격자 쪽으로 붙는다.
  const 화면 = await 생요청(t.port, '/', 'attacker.example.com');
  assert.match(화면.split('\r\n')[0], /403/, 'HTML 을 내주면 거기서 신분이 넘어간다');
  assert.ok(!/set-cookie/i.test(화면), '막힌 요청에는 신분을 붙이지 않는다');
  // 우리 이름으로 오면 그대로 열린다 — 막느라 정상 사용을 막지 않았는지도 같이 잰다.
  assert.match((await 생요청(t.port, '/health', `localhost:${t.port}`)).split('\r\n')[0], /200/);
});

test('신분 없는 로컬 프로그램은 기록을 바꾸지 못한다', async () => {
  const r = await fetch(`${t.base}/sessions`);           // 브라우저가 아닌 쪽: 쿠키도 헤더도 없다
  assert.equal(r.status, 403, '읽기도 막는다 — 기억을 보는 것 자체가 이미 이 사람의 일이다');
  const p = await fetch(`${t.base}/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(p.status, 403, '쓰기는 더더욱');
});

test('화면을 열면 그 뒤로는 그냥 된다 — 사용자가 하는 일은 없다', async () => {
  const { r, 쿠키 } = await 화면열기(t.base);
  assert.equal(r.status, 200, '화면은 아무 것도 묻지 않고 뜬다');
  assert.ok(쿠키.startsWith('t5_surface='), '뜨면서 신분이 함께 온다');
  const 목록 = await fetch(`${t.base}/sessions`, { headers: { cookie: 쿠키 } });
  assert.equal(목록.status, 200, '그 다음부터 API 는 예전 그대로다');
});

test('신분 쿠키는 다른 사이트 요청에 붙지 않게 표시된다', async () => {
  const set = (await fetch(`${t.base}/`)).headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/i, '페이지 스크립트도 못 읽는다 — XSS 한 방에 신분이 새지 않게');
  assert.match(set, /SameSite=Strict/i, '다른 사이트에서 시작된 요청에는 아예 붙지 않는다');
});

test('/health 는 열려 있되 비밀을 싣지 않는다', async () => {
  const r = await fetch(`${t.base}/health`);
  assert.equal(r.status, 200, '설치 검증이 물어보는 자리는 그대로 열려 있다');
  const 본문 = await r.text();
  const { token, installId } = await 설치신분(t.dir);
  assert.ok(!본문.includes(token), '토큰은 어떤 응답에도 실리지 않는다');
  const j = JSON.parse(본문);
  assert.equal(j.product, 'gpao-t5', '누구인지는 말한다 — 두 번째 실행이 이걸 보고 같은 T5 를 찾는다');
  assert.equal(j.installId, installId, '어느 설치본인지도. 남의 T5 에 사용자를 밀어 넣지 않으려면 필요하다');
});

test('신분은 이 사람만 읽을 수 있게 저장된다', async () => {
  await 설치신분(t.dir);
  const { stat } = await import('node:fs/promises');
  const m = (await stat(join(t.dir, 'install.json'))).mode & 0o777;
  assert.equal(m, 0o600, '계정 밖으로는 새지 않는다');
  const 파일 = JSON.parse(await readFile(join(t.dir, 'install.json'), 'utf8'));
  assert.notEqual(파일.token, 파일.installId, '공개해도 되는 이름과 비밀을 같은 값으로 쓰지 않는다');
});
