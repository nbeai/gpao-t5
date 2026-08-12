// P2-11 · 사이트에 대한 예의 — **429 를 우리가 만들지 않는다.**
//
// 실측(2026-07-27): 같은 네이버 플레이스 주소를 하루에 열 번 넘게 다시 열어 `HTTP 429` 를 받았다.
// 그 뒤로는 사용자가 주소를 직접 줘도 못 읽었다 — 우리가 문을 스스로 닫은 것이다.
//
// 우회가 아니라 예의다. 사이트별 규칙은 없다 — 어느 호스트에나 같다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHostManners, waitPhrase } from '../src/runtime/host-manners.js';
import { httpToFetchState, makeWebCollector } from '../src/runtime/web-collector.js';
import { nextRung, rungMessage } from '../src/kernel/l2-plan/recovery-ladder.js';

/** 시간을 손으로 돌린다 — 실제로 기다리면 게이트 5초 기준선을 넘는다. */
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

// ── 429 는 봇 차단이 아니다 ─────────────────────────────────────────────
test('429·503 은 "너무 자주 불렀다"이지 봇 차단이 아니다', () => {
  assert.equal(httpToFetchState(429), 'rate_limited');
  assert.equal(httpToFetchState(503), 'rate_limited');
  assert.notEqual(httpToFetchState(429), 'bot_wall',
    '"봇 차단이 걸려 있어요"라고 하면 사용자는 "원래 안 되는 사이트"로 오해한다');
});

test('속도 제한의 다음 길은 **기다렸다 다시**다(다른 경로로 도망가지 않는다)', () => {
  const step = nextRung([{ failureState: 'blocked', fetchState: 'rate_limited' }]);
  assert.equal(step.rung, 'retry', '잠시 뒤면 되는 일을 "다른 데서 찾아볼게요"로 넘기지 않는다');
  assert.match(rungMessage(step), /너무 자주 물어봐서/);
});

// ── ① 한 번 읽은 것은 다시 읽지 않는다 ──────────────────────────────────
test('최근에 읽은 주소는 다시 열지 않는다(오늘 내가 어긴 것)', () => {
  const c = fakeClock();
  const m = makeHostManners({ now: c.now, sleep: c.sleep, cacheTtlMs: 60_000 });
  m.remember('https://a.example/x', { body: '본문' });
  assert.equal(m.cached('https://a.example/x').value.body, '본문');
  c.advance(61_000);
  assert.equal(m.cached('https://a.example/x'), undefined, '오래된 것은 다시 읽는다(낡은 사실 금지)');
});

test('관통: 같은 주소를 열 번 물어도 실제 요청은 한 번이다', async () => {
  let calls = 0;
  const collector = makeWebCollector({
    robotsCheck: async () => true,
    manners: makeHostManners({ minIntervalMs: 0 }),
    fetchImpl: async () => { calls += 1; return { status: 200, url: 'https://a.example/x', text: async () => '<html><body><p>'.concat('내용'.repeat(200), '</p></body></html>') }; },
  });
  for (let i = 0; i < 10; i += 1) await collector.handler({ request: 'https://a.example/x' });
  assert.equal(calls, 1, `열 번 물었는데 ${calls}번 나갔다 — 이게 429 를 만든다`);
});

// ── ② 429 를 받으면 물러선다 ────────────────────────────────────────────
test('429 를 받으면 쉬고, 쉬는 동안은 **시도조차 하지 않는다**', async () => {
  const c = fakeClock();
  let calls = 0;
  const manners = makeHostManners({ now: c.now, sleep: c.sleep, minIntervalMs: 0 });
  const collector = makeWebCollector({
    robotsCheck: async () => true, manners,
    fetchImpl: async () => { calls += 1; return { status: 429, url: 'https://b.example/y', headers: { get: () => null }, text: async () => '제한' }; },
  });
  const first = await collector.handler({ request: 'https://b.example/y' });
  assert.equal(first.fetchState, 'rate_limited');
  assert.match(first.userSafeSummary, /너무 자주 물어봐서/);
  assert.match(first.nextSafeAction, /뒤에 다시 열어 볼까요/, '"안 되는 사이트"가 아니라 "잠시 뒤"라고 말한다');

  const before = calls;
  await collector.handler({ request: 'https://b.example/y' });
  assert.equal(calls, before, '쉬는 중에 또 두드리면 제한만 길어진다');
});

test('연속 429 는 쉬는 시간이 길어진다(지수 백오프)', () => {
  const c = fakeClock();
  const m = makeHostManners({ now: c.now, sleep: c.sleep });
  const a = m.noteRateLimited('https://c.example/1');
  const b = m.noteRateLimited('https://c.example/1');
  assert.ok(b > a, `두 번째가 더 길어야 한다: ${a} → ${b}`);
});

test('서버가 Retry-After 로 말하면 그 말을 따른다', () => {
  const c = fakeClock();
  const m = makeHostManners({ now: c.now, sleep: c.sleep });
  const ms = m.noteRateLimited('https://d.example/1', 600); // 10분
  assert.ok(ms >= 600_000, `서버가 10분이라 했는데 ${ms}ms 만 쉰다`);
});

test('잘 읽히면 제재 기록을 지운다(영원히 의심하지 않는다)', () => {
  const c = fakeClock();
  const m = makeHostManners({ now: c.now, sleep: c.sleep });
  m.noteRateLimited('https://e.example/1');
  assert.ok(m.coolingMs('https://e.example/1') > 0);
  m.noteOk('https://e.example/1');
  assert.equal(m.coolingMs('https://e.example/1'), 0);
});

// ── ③ 같은 곳에 연달아 묻지 않는다 ──────────────────────────────────────
test('같은 호스트에 연달아 물으면 최소 간격만큼 기다린다', async () => {
  const c = fakeClock();
  const m = makeHostManners({ now: c.now, sleep: c.sleep, minIntervalMs: 1200 });
  const t0 = c.now();
  await m.pace('https://f.example/1');
  await m.pace('https://f.example/2'); // 같은 호스트
  assert.ok(c.now() - t0 >= 1200, '연달아 두드리면 그게 429 를 만든다');
  const t1 = c.now();
  await m.pace('https://other.example/1'); // 다른 호스트는 기다릴 이유가 없다
  assert.equal(c.now(), t1);
});

test('기다릴 시간은 사람 말로 말한다(내부 밀리초를 보여주지 않는다)', () => {
  assert.equal(waitPhrase(0), '');
  assert.match(waitPhrase(30_000), /30초쯤/);
  assert.match(waitPhrase(600_000), /10분쯤/);
});

// ── 손이 둘이면 예의도 하나여야 한다 ────────────────────────────────────
// web.collect 와 브라우저는 **같은 IP 로 나간다.** 한쪽만 절제하면 다른 쪽이 문을 닫는다.
// 실측(2026-07-27): 내가 web.collect 로 만든 429 에 브라우저도 그대로 걸렸다.
test('관통: web 과 브라우저가 같은 예의를 공유한다(따로 놀지 않는다)', async () => {
  const { liveDeps } = await import('../src/surface/live-context.js');
  const { makeHostManners } = await import('../src/runtime/host-manners.js');
  const manners = makeHostManners();
  const live = liveDeps({ GPAO_T5_BROWSER_PATH: '/없는/브라우저' }, { manners });
  const wc = live.tools.tools['web.collect'];
  assert.ok(wc.manners, 'web.collect 가 예의를 들고 있어야 한다');
  assert.equal(wc.manners, manners, '주입한 예의를 그대로 써야 두 손이 같은 것을 본다');

  // 한쪽이 제한을 기록하면 다른 쪽도 즉시 안다(공유 상태).
  manners.noteRateLimited('https://shared.example/x');
  assert.ok(wc.manners.coolingMs('https://shared.example/x') > 0, '한쪽이 맞은 제한을 다른 손도 알아야 한다');
});

test('브라우저 손도 쉬는 중이면 열지 않는다(손이 둘이라고 두 번 두드리지 않는다)', async () => {
  const { makeBrowserObserveTool } = await import('../src/runtime/browser-tool.js');
  let opened = 0;
  const tool = makeBrowserObserveTool({
    browser: { coolingMs: () => 45_000, async open() { opened += 1; return {}; } },
  });
  const r = await tool.handler({ action: 'open', url: 'https://cooling.example/x' });
  assert.equal(opened, 0, '쉬는 중에 열면 제한만 길어진다');
  assert.equal(r.fetchState, 'rate_limited');
  assert.match(r.nextSafeAction, /45초쯤 뒤에/, '언제 다시 되는지 사람 말로 말한다');
});
