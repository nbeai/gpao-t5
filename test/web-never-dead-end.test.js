// **커널은 "다 됐다"고 못 박지 않는다. 고르지도 않는다.**
//
// 라이브(오너 2026-08-05): `오늘 한국 증시 상황은 어때?` 에 T5 가 지수를 하나도 못 말하고
// **사용자에게 대신 찾아보라고 넘겼다** — *"네이버 금융… 중 하나를 여시고 등락률을 대략만
// 찍어서 알려주시면"*. 오너 규칙 정면 위반이다: *"멈춰서는 안 되지!"*
//
// 그런데 재 보니 모델이 포기한 게 아니었다. **커널이 다 됐다고 말했다:**
//     읽은 곳  m.alphasquare.co.kr   (검색 첫 결과 · 지수는 JS 로 그리는 마케팅 페이지)
//     알맹이   602자 → 회사 소개·주소·연락처
//     지수 숫자 0개 · 상태 **ok** · 다음수단 **null**
//
// 두 곳에서 커널이 고르고 있었다.
//
// ① **"읽었으니 끝"** — `다음수단` 을 `읽은상태 === 'ok'` 일 때 끊었다. 그런데 "알맹이가
//    있다"와 "물은 것의 답이 있다"는 다르다. 회사 소개 602자는 알맹이지만 답이 아니다.
//    그렇다고 **커널이 관련성을 재면 안 된다** — 내용 판정은 심문의 부활이다(절대원칙 8).
//    그러니 재지 말고 **끊지 않는다.** 관련 없다는 판단은 모델이 한다.
//
// ② **"첫 결과가 답"** — 검색 후보를 여럿 받아 놓고 첫 개만 읽고 나머지를 버렸다.
//    모델은 다른 후보가 있었다는 사실조차 못 본다. 고른 건 커널이다.
//
// 둘 다 같은 규율의 위반이다 — *커널은 쓸 수 있는 수를 주고, 두는 것은 모델이다.*
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebCollector } from '../src/runtime/web-collector.js';

/** 알맹이는 넉넉한데 물은 것과는 무관한 페이지 — 라이브의 alphasquare 모양. */
const 회사소개 = '<html><head><title>알파스퀘어</title></head><body><main>'
  + '<h1>알파스퀘어 | 올인원 스마트 트레이딩 플랫폼</h1>'
  + '<p>실시간 투자정보부터 다양한 발굴분석까지 기존과는 전혀 다른 새로운 투자환경을 경험해 보세요.</p>'
  + '<p>서울특별시 관악구 남부순환로 1698 캐모빌딩 3층. 문의는 고객센터로 주세요.</p>'
  + '<p>투자에 필요한 모든 것을 기기의 제약 없이 한 곳에서 만나보실 수 있는 서비스입니다.</p>'
  + '</main></body></html>';

const 검색판 = (후보) => makeWebCollector({
  search: {
    search: async () => ({
      state: 'ok', provider: 'duckduckgo', providerLabel: '덕덕고', tried: ['duckduckgo'],
      results: 후보,
    }),
  },
  fetchImpl: async (u) => ({
    ok: true, status: 200, url: u,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => 회사소개,
  }),
});

const 후보셋 = [
  { title: '알파스퀘어', url: 'https://m.alphasquare.co.kr/home/market-summary', snippet: '' },
  { title: '네이버 금융 코스피', url: 'https://finance.naver.com/sise/sise_index.naver?code=KOSPI', snippet: '' },
  { title: '다음 금융', url: 'https://finance.daum.net/domestic', snippet: '' },
];

test('① **읽었어도 다음 수가 끊기지 않는다** — "다 됐다"는 커널이 정할 일이 아니다', async () => {
  const r = await 검색판(후보셋).handler({ request: '오늘 한국 증시 코스피 코스닥' });
  assert.equal(r.blocked ?? false, false);
  const 수단 = r.result?.다음수단;
  assert.ok(Array.isArray(수단) && 수단.length > 0,
    '**읽었다는 이유로 다음 수를 끊었다.**\n'
    + '알맹이가 있다 ≠ 물은 것의 답이 있다. 라이브에서 회사 소개 602자를 받고 "ok" 라 끝냈고,\n'
    + '모델은 사용자에게 대신 찾아보라고 넘겼다.\n'
    + `받은 것: ${JSON.stringify(r.result?.다음수단 ?? null)}`);
});

test('② **다른 검색 후보가 결과에 있다** — 첫 개가 답이라고 커널이 정하지 않는다', async () => {
  const r = await 검색판(후보셋).handler({ request: '오늘 한국 증시 코스피 코스닥' });
  const 말 = JSON.stringify(r.result ?? {});
  assert.match(말, /finance\.naver\.com/,
    '**나머지 후보를 버렸다** — 모델은 다른 길이 있었다는 사실조차 못 본다.\n'
    + `받은 것: ${말.slice(0, 300)}`);
  assert.match(말, /finance\.daum\.net/, '세 번째 후보도 사라졌다');
});

test('③ **후보에는 제목과 주소가 함께 온다** — 모델이 고를 수 있어야 한다', async () => {
  const r = await 검색판(후보셋).handler({ request: '오늘 한국 증시' });
  const 후보 = r.result?.다른후보 ?? [];
  assert.ok(후보.length >= 2, `후보가 안 실렸다: ${JSON.stringify(후보)}`);
  assert.ok(후보.every((c) => c.url && c.title != null),
    `후보에 제목이나 주소가 빠졌다: ${JSON.stringify(후보)}`);
  assert.ok(!후보.some((c) => c.url.includes('alphasquare')),
    '이미 읽은 곳이 "다른 후보"로 다시 올라왔다');
});

test('④ **주소를 직접 준 경우엔 없는 후보를 지어내지 않는다**', async () => {
  const 손 = makeWebCollector({
    fetchImpl: async (u) => ({
      ok: true, status: 200, url: u,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => 회사소개,
    }),
  });
  const r = await 손.handler({ request: 'https://m.alphasquare.co.kr/home/market-summary' });
  assert.equal(r.result?.다른후보, undefined, '검색을 안 했는데 후보가 생겼다');
});

test('⑤ **다음 수단에는 방법과 이유가 있다** — 목록만 던지지 않는다', async () => {
  const r = await 검색판(후보셋).handler({ request: '오늘 한국 증시' });
  const 수단 = r.result?.다음수단 ?? [];
  assert.ok(수단.every((x) => x.방법 && x.왜), `방법·이유가 빠졌다: ${JSON.stringify(수단)}`);
  assert.ok(수단.some((x) => x.방법 === 'search'), '다시 검색하는 길이 늘 있어야 막다른 답이 안 된다');
});
