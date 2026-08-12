// **껍데기는 벽이 아니다. 그리고 벽이어도 멈추지 않는다.**
//
// 라이브(오너 2026-08-05): 날씨·금시세는 통과했는데 `오늘 코스피, 코스닥 상황 알려줘` 에
// T5 가 **"로그인이 필요하다"** 며 멈췄다. 오너:
//   *"해당 사이트가 로그인을 구체적으로 요구하는 허들로 제시하지 않으면 멈춰서는 안 되지!"*
//   *"사용자의 목적 달성을 위해 다른 방법을 찾는 것도 필요하지 않을까?"*
//
// 재 보니 **막힌 게 아니었다.** T5 손으로 지금도 그대로 읽힌다:
//     finance.naver.com/sise/sise_index.naver?code=KOSPI
//     → 코스피 6,622.23 · 전일 6,358.95 · 시가 6,603.48 · 고가 6,674.66 · 저가 6,540.27
//
// 원인은 이 한 줄이었다:
//     const s = String(raw.status ?? raw.body ?? '');       // **페이지 전체**를 훑는다
//     if (/login|signin|로그인/.test(s)) return 'login_wall';
// 네이버 메뉴에는 **"로그인"이 들어 있다.** 낱말 하나로 공개 페이지가 벽이 됐다.
// 같은 함수 주석에 이미 그 교훈이 적혀 있었다 — *"위키백과처럼 누구나 읽는 페이지도 전부
// 막힌 것으로 처리됐다(실측)"*. 길이 게이트 뒤 대비책에서 되살아났다.
//
// 계약 둘:
//   ① **벽은 사이트가 구체적으로 요구할 때만** — 벽 낱말은 건진 본문 안에서만 본다.
//      메뉴에 있는 낱말은 사이트의 요구가 아니다.
//   ② **어떤 결과든 멈춤이 아니다** — 못 얻었으면 *무엇이 없는지*와 *다음에 무엇을 부를 수
//      있는지*가 함께 온다. 이건 창(`readWindow`)에서 이미 세운 것과 같은 계약이고,
//      "같은 페이지의 뒷부분" 대신 "목적을 이룰 다른 길"로 넓힌 것뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWebFetch } from '../src/kernel/l2-plan/web-tool.js';
import { extractReadable } from '../src/runtime/readable.js';
import { makeWebCollector } from '../src/runtime/web-collector.js';

/** 네이버 증시 첫 화면 모양 — 메뉴뿐이고 지수는 다른 페이지에 있다. 메뉴에 "로그인"이 있다. */
const 메뉴만 = `<html><body><div id="wrap">
${['마켓', 'MY', '국내', '해외', '공모주', '토론', '지표', '투자정보', '전체서비스', '공지사항',
   '증권 고객센터', '토론 운영원칙', '약관 및 정책', '개인정보 처리방침', '오류신고', '로그인']
  .map((t) => `<div class="nav"><a href="/${encodeURIComponent(t)}">${t}</a></div>`).join('\n')}
</div></body></html>`;

/** 같은 사이트의 진짜 내용 페이지 — 메뉴가 앞, 지수가 뒤. 여기에도 "로그인"이 있다. */
const 지수있음 = `<html><body><div id="wrap">
${['마켓', 'MY', '국내', '해외', '토론', '로그인'].map((t) => `<div class="nav"><a href="/${t}">${t}</a></div>`).join('')}
<div class="index"><div class="name">코스피 종합주가지수</div><div class="now">6,622.23</div>
<div class="chg">전일 대비 +263.28 올라 4.14% 상승했습니다</div><div class="row">전일 종가 6,358.95</div>
<div class="row">시가 6,603.48</div><div class="row">고가 6,674.66</div><div class="row">저가 6,540.27</div>
<div class="row">거래대금 15조 9,038억원 · 거래량 2억 3,535만 주</div></div>
</div></body></html>`;

const 판 = (html) => makeWebCollector({
  fetchImpl: async () => ({
    ok: true, status: 200, url: 'https://finance.example/sise',
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => html,
  }),
});

// 제품이 넘기는 것과 **같은 것**을 넘긴다 — `markdown` 에는 네비게이션이 꼬리로 붙어 있어서
// 그걸 넘기면 검사만 통과하고 라이브는 그대로 깨진다.
const 재기 = (html) => {
  const { 알맹이글, 살은글자 } = extractReadable(html);
  return classifyWebFetch({ body: html, readable: 알맹이글, readableChars: 살은글자 });
};

test('① **메뉴의 "로그인" 낱말로 공개 페이지를 벽이라 하지 않는다** — 오너가 본 그 문장', () => {
  assert.notEqual(재기(메뉴만), 'login_wall',
    '**공개 페이지를 로그인 벽이라고 했다.** 메뉴에 "로그인"이 있을 뿐 사이트가 요구한 게 아니다.');
  assert.notEqual(재기(지수있음), 'login_wall',
    '지수가 다 실린 페이지까지 벽이 됐다 — 메뉴 낱말 하나 때문에.');
});

test('② **알맹이가 있으면 읽은 것이다** — 메뉴가 앞에 있어도', () => {
  assert.equal(재기(지수있음), 'ok', '메뉴 때문에 진짜 페이지가 껍데기로 몰렸다');
});

test('③ **알맹이가 없으면 껍데기라고 말한다** — 읽은 척하지 않는다', () => {
  assert.equal(재기(메뉴만), 'shell',
    '메뉴뿐인데 "읽었다(ok)"고 하면 모델은 그 위에 지어내거나 벽을 상상한다');
});

test('④ **사이트가 구체적으로 요구하면 그건 벽이다** — 본문이 로그인을 말할 때', () => {
  const 벽 = '<html><body><main><h1>로그인이 필요합니다</h1>'
    + '<p>이 페이지를 보려면 로그인해 주세요. 계정이 없으면 가입할 수 있습니다.</p></main></body></html>';
  assert.equal(재기(벽), 'login_wall');
});

test('⑤ **알맹이가 네비게이션보다 앞에 온다** — 첫 창을 메뉴가 차지하지 않는다', async () => {
  const r = await 판(지수있음).handler({ request: 'https://finance.example/sise' });
  const md = r.result?.markdown ?? '';
  const 지수자리 = md.indexOf('6,622.23');
  const 메뉴자리 = md.indexOf('공모주') >= 0 ? md.indexOf('공모주') : md.indexOf('토론');
  assert.ok(지수자리 >= 0, `지수가 첫 창에 없다: ${JSON.stringify(md.slice(0, 160))}`);
  assert.ok(메뉴자리 < 0 || 지수자리 < 메뉴자리,
    `**메뉴가 알맹이보다 앞에 있다.**\n${JSON.stringify(md.slice(0, 200))}`);
});

test('⑥ **네비게이션을 버리지는 않는다** — 뒤로 보낼 뿐이다', async () => {
  const r = await 판(지수있음).handler({ request: 'https://finance.example/sise' });
  const 전부 = (r.result?.markdown ?? '') + JSON.stringify(r.result?.links ?? []);
  assert.match(전부, /공모주|토론/, '메뉴를 통째로 버렸다 — 사용자가 다음에 갈 곳일 수도 있다');
});

test('⑦ **껍데기여도 멈추지 않는다** — 다음에 무엇을 할 수 있는지가 함께 온다', async () => {
  const r = await 판(메뉴만).handler({ request: 'https://finance.example/sise' });
  const 말 = JSON.stringify(r.result ?? {}) + String(r.userSafeSummary ?? '');
  assert.match(말, /shell|껍데기|알맹이/,
    `**"알맹이가 없다"는 사실이 결과 어디에도 없다.**\n받은 것: ${말.slice(0, 240)}`);
  // `links` 는 늘 실리므로 그걸로는 못 잰다 — **다음 수단 자체**를 본다.
  const 수단 = r.result?.다음수단;
  assert.ok(Array.isArray(수단) && 수단.length > 0,
    '**다음에 무엇을 할 수 있는지가 없다** — 모델은 멈추거나 지어낼 수밖에 없다.\n'
    + '오너: "로그인을 구체적으로 요구하는 허들로 제시하지 않으면 멈춰서는 안 되지!"\n'
    + `받은 것: ${JSON.stringify(수단)}`);
  assert.ok(수단.every((x) => x.방법 && x.왜), `수단에 방법·이유가 빠졌다: ${JSON.stringify(수단)}`);
  assert.ok(수단.some((x) => x.방법 === 'search'), '마지막 길(다시 검색)이 늘 있어야 막다른 답이 안 된다');
});
