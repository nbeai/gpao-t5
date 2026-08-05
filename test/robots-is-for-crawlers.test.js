// **robots.txt 는 크롤러 규칙이지, 사용자를 대신해 한 장 여는 것을 막는 규칙이 아니다.**
//
// 라이브(오너 2026-08-05): `오늘 한국 증시 상황 알려줘` 에 T5 가 웹을 아예 못 쓰고
// **사용자에게 지수를 알려 달라**고 요구했다. 원인은 이것이었다:
//     web.collect → https://finance.naver.com/…KOSPI  →  failureState: blocked
//     (네이버 금융 robots.txt 가 수집을 거부)
//
// 오너: *"robots 내용은 법적 강제가 아니야. 그 데이터를 다른 용도로 가공해서 사용할 때
// 문제가 발생할 수도 있는 거지. 이걸 지키는 걸 원칙으로 하면 정말 많은 웹검색 및 서치 기능이
// 무용지물이 된다."*
//
// 맞다. 그리고 T5 코드 주석에 **이미 모순이 적혀 있었다** —
//   "robots.txt 는 계속 지킨다" 바로 옆에
//   "T5 는 크롤러가 아니라 **사용자 요청 1건을 대신 여는** 도구다".
// 사용자가 자기 폰으로 열면 보이는 페이지다. 크롤러 규칙을 거기 적용한 것이 잘못이었다.
//
// 경계는 남긴다 — 막지 않는 것은 **지금 이 요청 한 건**이다:
//   · 사용자가 물어서 여는 페이지 → 연다(사용자가 직접 여는 것과 같다)
//   · 같은 사이트를 더 훑는 확장 탐색 → robots 를 지킨다(그건 크롤이다)
//   · 예의(요청 간격·429 물러서기)는 그대로 — 우리가 부하를 만들지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebCollector } from '../src/runtime/web-collector.js';

const 페이지 = '<html><head><title>코스피</title></head><body><main>'
  + '<div>코스피 종합주가지수</div><div>6,634.22</div><div>전일 대비 +275.27 상승</div>'
  + '<div>거래대금 15조 9,038억원으로 활발합니다</div></main></body></html>';

const 판 = (opts = {}) => makeWebCollector({
  robotsCheck: async () => false,          // 사이트가 크롤러를 거부한다
  fetchImpl: async (u) => ({
    ok: true, status: 200, url: u,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => 페이지,
  }),
  ...opts,
});

test('① **사용자가 물어서 여는 한 장은 열린다** — 라이브에서 막힌 그 자리', async () => {
  const r = await 판().handler({ request: 'https://finance.naver.com/sise/sise_index.naver?code=KOSPI' });
  assert.notEqual(r.fetchState, 'robots_disallow',
    '**사용자가 자기 폰으로 열면 보이는 페이지를 크롤러 규칙으로 막았다.**\n'
    + '그날 T5 는 이 자리에서 멈추고 사용자에게 지수를 알려 달라고 했다.');
  assert.match(r.result?.markdown ?? '', /6,634\.22/, `본문이 안 왔다: ${JSON.stringify(r).slice(0, 200)}`);
});

test('② **확장 탐색은 여전히 robots 를 지킨다** — 그건 크롤이다', async () => {
  const 열린곳 = [];
  const r = await 판({
    robotsCheck: async () => false,
    fetchImpl: async (u) => { 열린곳.push(u); return {
      ok: true, status: 200, url: u,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => `${페이지}<a href="https://finance.naver.com/item/1">더</a><a href="https://finance.naver.com/item/2">더2</a>`,
    }; },
  }).handler({ request: 'https://finance.naver.com/sise/', maxPages: 5, depth: 2 });
  assert.ok(r.result, '첫 장은 열려야 한다');
  assert.equal(열린곳.length, 1,
    `**거부한 사이트를 계속 훑었다**(${열린곳.length}장). 한 건은 사용자 대신이지만 여러 장은 크롤이다.\n`
    + 열린곳.join('\n'));
});

test('③ **예의는 그대로다** — 우리가 부하를 만들지 않는다', async () => {
  const c = makeWebCollector({ robotsCheck: async () => false, fetchImpl: async () => ({ ok: false, status: 429, url: 'x', headers: { get: () => null }, text: async () => '' }) });
  const r = await c.handler({ request: 'https://finance.naver.com/sise/' });
  assert.equal(r.fetchState, 'rate_limited', '사이트가 쉬라고 하면 쉰다 — 그건 robots 와 다른 축이다');
});
