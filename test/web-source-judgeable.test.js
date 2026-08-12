// **출처는 사용자가 판단할 수 있는 형태여야 한다.**
//
// 라이브(오너 2026-08-05): `오늘 날씨 어때?` 에 T5 가 최저 24°C ~ 최고 31°C 로 정확히 답했다.
// 근거도 진짜였다 — `easeweather.com/asia/south-korea/seoul/today` 의 시간별 기온
// (25.8° · 24.5° · 23.8° …)을 실제로 읽고 답한 것이다.
//
// 그런데 화면에는 이렇게 떴다:
//
//     ▸ 찾아서 읽었어요: Today
//
// 오너: *"답변이 정상이 아닌 것 같은데?"*
// **답은 정상이었다. 근거 표시가 판단 불가능했다.** 제목이 "Today" 뿐이라 사용자는 이게
// 서울 날씨 페이지인지 오늘 날짜 안내인지 광고인지 알 수 없다. 믿을지 말지를 못 정한다.
//
// 이건 거짓말은 아니지만 **아는 것보다 덜 말하는 것**이다. 우리는 어디서 읽었는지 알고 있다 —
// `sources[].sourceUrl` 에 그대로 있다. 알면서 안 보여 준 것이다.
// (같은 계열의 반대 실수는 아침에 밟았다: 원장은 "읽었어요"라는데 내용이 없던 자리.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebCollector } from '../src/runtime/web-collector.js';

/** 검색 → 읽기 흐름을 흉내 낸다. 실제 망을 안 탄다(결정적이어야 한다). */
function 판({ title = 'Today', url = 'https://www.easeweather.com/asia/south-korea/seoul/today' } = {}) {
  const html = `<html><head><title>${title}</title></head>`
    + '<body><article><p>Seoul hourly forecast 25.8 ° 24.5 ° 23.8 °</p></article></body></html>';
  return makeWebCollector({
    search: { async search() { return { state: 'ok', provider: 'duckduckgo', results: [{ title, url, snippet: '' }], tried: ['duckduckgo'] }; } },
    fetchImpl: async () => ({
      ok: true, status: 200, url,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => html,
    }),
  });
}

const 요약 = async (opts) => (await 판(opts).handler({ request: '오늘 날씨' }))?.userSafeSummary ?? '';

test('① **어디서 읽었는지가 요약에 있다** — 제목만으로는 못 믿는다', async () => {
  const s = await 요약();
  assert.match(s, /easeweather\.com/,
    `**출처가 판단 불가능한 형태다**: "${s}"\n`
    + '사용자는 "Today" 만 보고 이게 서울 날씨인지 오늘 날짜 안내인지 광고인지 모른다.\n'
    + '우리는 알고 있다 — `sources[].sourceUrl` 에 그대로 있다. **알면서 안 보여 준 것이다.**');
});

test('② **제목도 함께 남는다** — 주소만 있으면 사람이 못 읽는다', async () => {
  assert.match(await 요약({ title: 'Seoul Hourly Weather' }), /Seoul Hourly Weather/,
    '제목이 사라졌다 — 주소만으로는 무엇을 읽었는지 사람이 알기 어렵다');
});

test('③ **제목이 없어도 어디서 읽었는지는 말한다**', async () => {
  const s = await 요약({ title: '' });
  assert.match(s, /easeweather\.com/, `제목이 없다고 출처까지 사라졌다: "${s}"`);
});

test('④ **주소가 통째로 실리지 않는다** — 사용자면에 긴 경로를 붙이지 않는다', async () => {
  const s = await 요약();
  assert.doesNotMatch(s, /asia\/south-korea/,
    `**경로까지 실렸다**: "${s}"\n`
    + '사용자면 문장은 읽는 것이지 복사하는 것이 아니다 — 어디인지만 알면 된다(전체 주소는 원장에 있다).');
});

test('⑤ **읽기와 찾아 읽기를 여전히 구분한다** — 검색만 하고 아는 척하지 않는다', async () => {
  const 찾아읽음 = await 요약();
  assert.match(찾아읽음, /찾아서 읽었어요/, '찾아서 읽은 것을 그렇게 안 말했다');
});
