// 상태 지도 §12-S5 — **브라우저 포트 고정 · 소유권 확인 없음** (2026-08-12).
//
// `browser.js` 는 포트 9412 를 못 박고, 띄운 뒤 `/json/version` 이 답하기만 하면 그 답의
// `webSocketDebuggerUrl` 에 그대로 붙었다. 그 포트에 **남의 크롬**이 이미 있으면(사용자가
// 디버깅 포트를 열어 둔 실계정 크롬 · 다른 도구가 띄운 크롬) 우리 크롬은 포트를 못 잡고,
// 우리는 **남의 브라우저를 몰고 다닌다.** 코드 주석(`browser.js:388-391`)이 같은 사고의
// 앞 얼굴을 이미 기록해 뒀다 — *"뒤엣것은 포트를 못 잡아 앞엣것에 붙었다"*.
//
// ── 오픈북: 남의 것과 내 것을 무엇으로 가르나 ────────────────────────────────
// 오픈클로 `docs/tools/browser.md:247-249`:
//   *"Local `openclaw` profiles auto-assign `cdpPort`/`cdpUrl`; set those only for
//     remote CDP profiles or existing-session endpoint attach."*
// 같은 문서 `:283`:
//   *"`attachOnly: true` means never launch a local browser; only attach if one is
//     already running."*
// 축 둘이다 — ① 관리하는 프로필의 포트는 **못 박지 않고 자동으로 잡는다**
//            ② 남이 이미 띄운 것에 붙는 것은 **명시로 고르는 별도 모드**이지 사고가 아니다.
//
// T5 에는 이미 같은 축이 산다 — `src/surface/port-claim.js` 의 세 갈래:
//   *"① 4173 이 비었다 → 그대로 쓴다 · ② 거기 있는 게 이 T5 다 → 그 T5 로 간다
//     ③ 다른 프로그램이 쓴다 → 빈 자리로 옮기고 사람 말로 한 줄 알린다"*
// 새 축을 만들지 않고 **그 축을 브라우저 손에도 세운다.**
//
// 이 검사는 **가짜 `/json/version` 서버**(진짜 http 서버다 — 흉내가 아니다)를 그 포트에
// 세워 두고, 브라우저 손이 거기 안 붙는지를 잰다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeBrowser } from '../src/runtime/browser.js';

/** 그 포트에 앉아 있는 **남의 크롬**. 진짜로 듣는다 — 우리가 진짜로 fetch 한다. */
async function 남의크롬() {
  let 물은적 = 0;
  const 서버 = createServer((req, res) => {
    물은적 += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      Browser: 'Chrome/9999.0 (남의 것)',
      webSocketDebuggerUrl: 'ws://127.0.0.1/남의브라우저',
    }));
  });
  await new Promise((r) => 서버.listen(0, '127.0.0.1', r));
  return {
    port: 서버.address().port,
    물은적: () => 물은적,
    끄기: () => new Promise((r) => 서버.close(r)),
  };
}

/**
 * 가짜 크롬 실행기 — **뜨면 그 포트에 진짜로 듣는다.**
 * 예전 시험 대역은 포트와 무관하게 답했다. 그건 "아직 아무것도 안 띄웠는데 이미 브라우저가
 * 있다"는 거짓 사실을 계약 검사에 심는 것이라, 소유권을 잴 수 없다.
 */
function 우리크롬대역() {
  const 켠것 = []; const 서버들 = [];
  const launch = (path, args) => {
    const 포트 = Number(String(args.find((a) => a.startsWith('--remote-debugging-port='))).split('=')[1]);
    const p = { path, args, 포트, killed: false, 못떴다: false, kill() { p.killed = true; } };
    const s = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Browser: 'Chrome/1.0 (우리 것)', webSocketDebuggerUrl: `ws://127.0.0.1:${포트}/우리브라우저` }));
    });
    // **자리를 못 잡으면 못 잡는 것이다** — 진짜 크롬이 그렇듯이. 여기서 안 받아 두면
    // EADDRINUSE 가 처리 안 된 예외가 되어 노드가 죽고, 빨강이 아니라 파편이 남는다.
    s.on('error', () => { p.못떴다 = true; });
    s.listen(포트, '127.0.0.1');
    서버들.push(s);
    // `kill()` 은 **표시만** 한다(위 `p`). 종료 훅(`process.on('exit')`)이 이걸 그대로
    // 부르는데, 그 안에서 서버를 닫으면 노드가 죽는다(`execution_async_id` 단언).
    // 자리 치우기는 `치우기()` 가 맡는다.
    켠것.push(p);
    return p;
  };
  const 붙은곳 = [];
  const connect = (ws) => {
    붙은곳.push(ws);
    return {
      ready: Promise.resolve(),
      async send(method) {
        if (method === 'Target.createTarget') return { result: { targetId: 't1' } };
        if (method === 'Target.attachToTarget') return { result: { sessionId: 's1' } };
        if (method === 'Runtime.evaluate') return { result: { result: { value: 0 } } };
        return { result: {} };
      },
      close() {},
    };
  };
  const 치우기 = () => { for (const s of 서버들) { try { s.close(); } catch { /* 이미 닫힘 */ } } };
  return { launch, connect, 켠것, 붙은곳, 치우기 };
}

const 빠르게 = { settleMs: 5, maxWaitMs: 30 };

test('남의 크롬이 그 포트에 있으면 붙지 않는다 — 빈 자리로 옮긴다', async () => {
  const 남 = await 남의크롬();
  const 대역 = 우리크롬대역();
  const 손 = makeBrowser({
    browserPath: '/가짜/chrome', port: 남.port, idleMs: 60_000,
    launch: 대역.launch, connect: 대역.connect, ...빠르게,
  });
  try {
    await 손.open('https://example.com', 빠르게);
    // ① **남의 것에 안 붙었다.** 이게 이 검사의 알맹이다.
    assert.ok(!대역.붙은곳.some((ws) => String(ws).includes('남의브라우저')),
      `남의 브라우저에 붙었다: ${JSON.stringify(대역.붙은곳)}`);
    // ② 우리 크롬은 **다른 포트**로 떴다(자리를 옮겼다 — 포기하지 않았다).
    assert.equal(대역.켠것.length, 1, '크롬을 안 띄웠다');
    assert.notEqual(대역.켠것[0].포트, 남.port,
      '남이 앉아 있는 포트로 그대로 띄웠다 — 자리를 안 옮겼다');
    assert.ok(대역.붙은곳.some((ws) => String(ws).includes(`:${대역.켠것[0].포트}/우리브라우저`)),
      `우리 것에 안 붙었다: ${JSON.stringify(대역.붙은곳)}`);
  } finally {
    await 손.close?.().catch?.(() => {});
    대역.치우기(); await 남.끄기();
  }
});

test('빈 자리가 하나도 없으면 정직하게 막는다 — 남의 것으로 대신하지 않는다', async () => {
  // 탐색 창을 통째로 막는다. 자리를 못 찾으면 **못 찾았다고 말해야** 한다.
  const 막은것 = [];
  const 남 = await 남의크롬();
  const 시작 = 남.port;
  for (let i = 1; i < 12; i += 1) {
    const s = createServer((req, res) => res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1/남의브라우저' })));
    try { await new Promise((r, j) => { s.once('error', j); s.listen(시작 + i, '127.0.0.1', r); }); 막은것.push(s); }
    catch { /* 그 자리는 이미 남이 쓴다 — 그것도 막힌 것이다 */ }
  }
  const 대역 = 우리크롬대역();
  const 손 = makeBrowser({
    browserPath: '/가짜/chrome', port: 시작, idleMs: 60_000,
    launch: 대역.launch, connect: 대역.connect, ...빠르게,
  });
  try {
    await assert.rejects(
      () => 손.open('https://example.com', 빠르게),
      (e) => {
        assert.match(String(e.message), /브라우저|자리|포트/, `사람이 읽을 수 없는 실패: ${e.message}`);
        return true;
      },
      '빈 자리가 없는데 실패하지 않았다 — 남의 크롬에 붙었을 것이다',
    );
    assert.ok(!대역.붙은곳.some((ws) => String(ws).includes('남의브라우저')),
      `막혔어야 하는데 남의 브라우저에 붙었다: ${JSON.stringify(대역.붙은곳)}`);
  } finally {
    await 손.close?.().catch?.(() => {});
    대역.치우기(); await 남.끄기();
    for (const s of 막은것) await new Promise((r) => s.close(r));
  }
});

test('아무도 없으면 부른 그 포트를 그대로 쓴다 — 멀쩡한 자리를 피하지 않는다', async () => {
  // 빈 포트 하나를 확보했다가 놓아 준다(그 번호가 비어 있다는 기계 사실).
  const 잠깐 = await 남의크롬();
  const 빈포트 = 잠깐.port;
  await 잠깐.끄기();
  const 대역 = 우리크롬대역();
  const 손 = makeBrowser({
    browserPath: '/가짜/chrome', port: 빈포트, idleMs: 60_000,
    launch: 대역.launch, connect: 대역.connect, ...빠르게,
  });
  try {
    await 손.open('https://example.com', 빠르게);
    assert.equal(대역.켠것[0].포트, 빈포트, '빈 자리를 두고 딴 데로 갔다');
  } finally {
    await 손.close?.().catch?.(() => {});
    대역.치우기();
  }
});
