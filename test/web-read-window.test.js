// **웹도 문을 갖는다 — 길면 창을 옮겨 더 읽는다.**
//
// 라이브 사고(오너 2026-08-05): `오늘 날씨 어때?` 에 T5 가 **"최고 약 31°C, 체감 30도 초반,
// 얇은 우산"** 이라고 답했다. 그날 그 페이지의 실제 값은 **최고 37.9°C · 체감 43.7°C ·
// 폭염중대경보** 였다. **폭염경보 날에 위험한 답이 나갔다.**
//
// 원인은 읽기가 아니었다(엔티티는 그날 고쳤다). **접기**였다:
//   원본 4,588자 → 모델이 본 것 1,183자 → 모델이 본 온도값 **0개**
// `fold()` 가 앞 70% + 뒤 30% 를 남기고 가운데를 접는데, **온도표가 통째로 그 가운데였다.**
// 모델은 숫자를 하나도 못 받고 계절 상식으로 지어냈다.
//
// ── 답은 T5 안에 이미 있었다 ──────────────────────────────────────────────
// 상한을 올리는 것은 실측으로 이미 기각됐다(1200→6000 을 써도 이름은 3분의 1). 그때 세운 것이
// **문**이다 — `local.file list` 는 `offset`/`limit` 을 받고 *"전체 N개 중 …, 다음은 offset=…"*
// 이라고 말한다. 조용히 자르지 않고 **다시 부를 길**을 준다.
// 내가 큰 파일을 읽을 때 하는 것과 같다: 접힌 요약이 아니라 **창을 옮긴다.**
// 웹 손만 그 문이 없었다.
//
// §10 규율 12 — 개수가 아니라 **계약**:
//   "본문을 더 준다"(양) ❌
//   → **"얼마나 있는지 말한다 · 다음을 부를 길이 있다 · 부르면 그 자리가 온다 ·
//      끝이면 끝이라고 한다"**(계약) ⭕
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebCollector } from '../src/runtime/web-collector.js';

/** 온도표가 가운데 있는 긴 페이지 — 라이브에서 잘린 그 모양. */
const 시간별 = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00 ${(20 + h * 0.8).toFixed(1)} °`).join(' | ');
const 긴본문 = `${'머리말 '.repeat(400)}\n\n| 기온 | ${시간별} |\n\n${'꼬리말 '.repeat(400)}`;

function 판() {
  const html = `<html><head><title>서울 시간별</title></head><body><article><p>${긴본문}</p></article></body></html>`;
  return makeWebCollector({
    fetchImpl: async () => ({
      ok: true, status: 200, url: 'https://example.test/seoul',
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => html,
    }),
  });
}

const 읽기 = (args) => 판().handler({ request: 'https://example.test/seoul', ...args });

test('① **얼마나 있는지 말한다** — 조용히 자르지 않는다', async () => {
  const r = await 읽기();
  const md = r.result?.markdown ?? '';
  assert.ok(r.result?.readWindow, '**본문을 얼마나 줬는지가 결과에 없다** — 모델은 다 받은 줄 안다');
  const w = r.result.readWindow;
  assert.equal(typeof w.총, 'number');
  assert.ok(w.총 > md.length, `전체(${w.총})가 실린 것(${md.length})보다 크지 않다 — 이 검사가 성립하려면 잘려야 한다`);
});

test('② **다음을 부를 길이 있다** — 막다른 답 금지', async () => {
  const r = await 읽기();
  assert.ok(Number.isInteger(r.result?.readWindow?.다음),
    `**더 있는데 다음을 부를 길이 없다**: ${JSON.stringify(r.result?.readWindow)}\n`
    + '파일 손은 이미 `다음은 offset=…` 을 준다. 웹만 안 줬다.');
});

test('③ **부르면 그 자리가 온다** — 문이 실제로 열린다', async () => {
  const 첫판 = await 읽기();
  const 다음 = 첫판.result.readWindow.다음;
  const 둘째 = await 읽기({ offset: 다음 });
  const md2 = 둘째.result?.markdown ?? '';
  assert.ok(md2.length > 0, '다음 창을 불렀는데 빈손이 왔다');
  assert.notEqual(md2, 첫판.result.markdown, '같은 자리를 다시 줬다 — 창이 안 움직였다');
  assert.equal(둘째.result.readWindow.시작, 다음, '부른 자리와 실제 자리가 다르다');
});

test('④ **온도표가 창을 옮기면 실제로 읽힌다** — 라이브에서 잃은 그것', async () => {
  let 본것 = '';
  for (let off = 0, 안전 = 0; 안전 < 12; 안전 += 1) {
    const r = await 읽기({ offset: off });
    본것 += r.result?.markdown ?? '';
    const 다음 = r.result?.readWindow?.다음;
    if (!Number.isInteger(다음)) break;
    off = 다음;
  }
  assert.match(본것, /38\.4 °/,
    '**창을 다 옮겨도 온도표에 못 닿았다** — 그러면 문이 있어도 답에 못 쓴다');
});

test('⑤ **끝이면 끝이라고 한다** — 없는 다음을 가리키지 않는다', async () => {
  const r = await 읽기({ offset: 0, limit: 10_000_000 });
  assert.equal(r.result?.readWindow?.다음, undefined,
    `다 줬는데 다음이 있다고 했다: ${JSON.stringify(r.result?.readWindow)}`);
});

test('⑥ **짧은 페이지는 문이 안 생긴다** — 없는 문을 만들지 않는다', async () => {
  const 짧은판 = makeWebCollector({
    fetchImpl: async () => ({
      ok: true, status: 200, url: 'https://example.test/s',
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => '<html><head><title>짧다</title></head><body><article><p>짧은 본문입니다. 여기까지가 전부예요.</p></article></body></html>',
    }),
  });
  const r = await 짧은판.handler({ request: 'https://example.test/s' });
  assert.equal(r.result?.readWindow?.다음, undefined, '다 준 짧은 글에 다음이 붙었다');
});
