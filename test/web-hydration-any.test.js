// **데이터가 JSON 으로 심긴 페이지를 이름으로 알아맞히지 않는다.**
//
// 라이브(오너 2026-08-05): `오늘 날씨` · `내일 날씨` 에 T5 가 기온을 **하나도 못 말하고**
// 자외선·밝기만 말하거나 계절 상식으로 지어냈다. 그날 그 페이지의 실제 값은 `35° / 체감 44°`.
//
// 재 보니 페이지에 태그가 없었다:
//     <table> 0개 · <article> 0개 · <main> 0개
//     기온은 스크립트 안 JSON 에:  "temp":"35°","realFeel":"44°"
// 현대 웹이 대개 그렇다(Next.js·Nuxt·React 하이드레이션).
//
// T5 에는 `extractHydrationText` 가 **이미 있었는데 0자를 냈다.** 이유:
//     const HYDRATION_KEYS = ['__APOLLO_STATE__', '__NEXT_DATA__', '__NUXT__', …]  // 이름 7개
// **목록으로 알아맞히고 있었다.** 그 사이트는 그 중 아무것도 안 쓴다.
//
// 이 저장소가 세 번째로 만나는 같은 매듭이다 —
//   `이름낱말`(S3): 확장자를 낱말로 세던 자리 · `needs`(S8): 드라이버를 이름으로 짐작하던 자리.
// 원칙도 이미 적혀 있다: *"목록을 늘리지 않는다(§4-6). 새 이름이 반드시 샌다."*
// **구조로 가른다** — 스크립트 안의 JSON 덩어리를 이름 없이 찾는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHydrationText } from '../src/runtime/readable.js';
import { makeWebCollector } from '../src/runtime/web-collector.js';

const 페이지 = (스크립트) => `<html><head><title>t</title></head><body><div id="root"></div>${스크립트}</body></html>`;

test('① **이름을 안 쓰는 페이지에서도 읽는다** — 라이브에서 잃은 그것', () => {
  // AccuWeather 모양: 전역 이름 없이 그냥 큰 JSON 이 스크립트 안에 있다.
  const html = 페이지('<script>window.__data=[{"localizedName":"서울특별시","temp":"35°","realFeel":"44°"}]</script>');
  const 글 = extractHydrationText(html);
  assert.match(글, /35°/,
    `**JSON 에 있는 값을 못 읽었다**: ${JSON.stringify(글.slice(0, 120))}\n`
    + '이름 목록(`__NEXT_DATA__` 등)에 없는 사이트는 통째로 안 보인다 — 목록은 늘 샌다.');
  assert.match(글, /44°/, '체감 값도 못 읽었다');
  assert.match(글, /서울특별시/, '한글 값도 못 읽었다');
});

test('② **알려진 이름도 그대로 읽는다** — 되던 것을 안 깬다(회귀)', () => {
  const html = 페이지('<script>window.__NEXT_DATA__ = {"props":{"온도":"31도","도시":"부산"}}</script>');
  const 글 = extractHydrationText(html);
  assert.match(글, /31도/, '알려진 이름 경로가 깨졌다');
  assert.match(글, /부산/);
});

test('③ **`type="application/json"` 스크립트도 읽는다** — 요즘 가장 흔한 모양', () => {
  const html = 페이지('<script id="x" type="application/json">{"기온":"29도","하늘":"맑음"}</script>');
  const 글 = extractHydrationText(html);
  assert.match(글, /29도/, `타입 지정 스크립트를 못 읽었다: ${JSON.stringify(글.slice(0, 80))}`);
});

test('④ **여럿이면 말이 되는 쪽이 앞에 온다** — 광고 설정에 자리를 뺏기지 않는다', () => {
  // 라이브 AccuWeather 실측: 덩어리가 수십 개고 **조각 수는 광고·계측 설정이 압도적으로 많다.**
  // "많은 쪽을 고른다"로 하면 온도값 0개인 덩어리가 이긴다. 그리고 앞을 채우면
  // 창(readWindow 900자)에 본문이 아예 안 들어온다 — 실측 첫 온도값이 66% 지점이었다.
  const 광고 = JSON.stringify([...Array(120)].map((_, i) => ({ [`k${i}`]: `slotRenderEnded${i}` })));
  const html = 페이지(
    `<script>window.cfg=${광고}</script>`
    + '<script>window.d=[{"제목":"오늘 서울 날씨","기온":"35도","체감":"44도","하늘":"구름 조금"}]</script>',
  );
  const 글 = extractHydrationText(html);
  const 어디 = 글.indexOf('35도');
  assert.ok(어디 >= 0, `내용 덩어리가 통째로 사라졌다: ${JSON.stringify(글.slice(0, 100))}`);
  assert.ok(어디 < 200,
    `**본문이 광고 설정 뒤로 밀렸다**(${어디}자 지점) — 창 900자 안에 안 들어온다.\n`
    + `앞부분: ${JSON.stringify(글.slice(0, 120))}`);
  assert.match(글, /slotRenderEnded/, '설정을 버렸다 — 고르지 않고 뒤에 두기로 했다(창으로 닿는다)');
});

test('⑤ **JSON 이 없으면 빈손을 정직하게 돌려준다** — 지어내지 않는다', () => {
  assert.equal(extractHydrationText(페이지('<script>console.log("hi")</script>')), '');
  assert.equal(extractHydrationText('<html><body><p>글만 있다</p></body></html>'), '');
});

test('⑥ **깨진 JSON 에 걸려 죽지 않는다** — 한 덩어리가 나빠도 다음으로 간다', () => {
  const html = 페이지(
    '<script>window.a={"broken": </script>'
    + '<script>window.b={"기온":"27도"}</script>',
  );
  assert.match(extractHydrationText(html), /27도/, '앞 덩어리가 깨지자 그대로 멈췄다');
});

// ── 제품 경로 ────────────────────────────────────────────────────────────────
// 위 ①~⑥ 을 다 고쳐도 **본선이 이 함수를 안 부르면 사용자 답은 그대로다.**
// 라이브 실측이 정확히 그 모양이었다:
//     extractReadable → 757자   (전부 알림 배너·쿠키 문구)
//     MIN_READABLE_CHARS = 200  → 757 > 200 이므로 **하이드레이션은 아예 안 돌았다**
// 길이로 "본문이 있다"를 판정하면 **껍데기 문구가 본문 자격을 딴다.**
// 여기서도 답은 같다 — 고르지 않는다. 태그 글도 주고 심긴 데이터도 준다(뒤는 창으로 닿는다).

test('⑧ **껍데기 문구가 길어도 심긴 데이터가 답에 닿는다** — 라이브에서 막힌 그 자리', async () => {
  const 배너 = `<p>${'브라우저 알림을 켜면 경보를 바로 받아 보실 수 있습니다. '.repeat(12)}</p>`;
  const html = `<html><head><title>서울 날씨</title></head><body>${배너}`
    + '<script>window.__d=[{"localizedName":"서울특별시","temp":"35°","realFeel":"46°","phrase":"구름 조금"}]</script>'
    + '</body></html>';
  const 손 = makeWebCollector({
    fetchImpl: async () => ({
      ok: true, status: 200, url: 'https://example.test/w',
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => html,
    }),
  });
  const r = await 손.handler({ request: 'https://example.test/w' });
  const md = r.result?.markdown ?? '';
  assert.ok(md.length > 200, `본문이 안 왔다: ${md.length}자`);
  assert.match(md, /35°/,
    `**심긴 데이터가 제품 본문에 없다** — 태그 글이 ${md.length}자라 임계(200)를 넘겨 버렸다.\n`
    + '길이로 "본문이 있다"를 판정하면 알림 배너가 본문 자격을 딴다. 실측 그대로다.\n'
    + `받은 것 앞부분: ${JSON.stringify(md.slice(0, 160))}`);
  assert.match(md, /구름 조금/, '하늘 상태도 안 왔다');
});

test('⑦ **상한을 지킨다** — 프롬프트를 삼키지 않는다', () => {
  const 큰것 = JSON.stringify([...Array(500)].map((_, i) => ({ [`항목${i}`]: `아주 긴 사람 말 ${i} `.repeat(5) })));
  const 글 = extractHydrationText(페이지(`<script>window.x=${큰것}</script>`), { maxChars: 600 });
  assert.ok(글.length <= 601, `상한을 넘겼다: ${글.length}자`);
});
