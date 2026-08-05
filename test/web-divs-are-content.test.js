// **`div`·`span` 으로 그린 내용도 내용이다.**
//
// 라이브(오너 2026-08-05): 날씨를 고치고도 `내일 날씨 어때?` 에 T5 가 또 지어냈다
// ("아침 최저 약 24도 / 낮 최고 약 31도" — 근거 없음).
//
// 재 보니 일별 예보는 **HTML 안에 다 있었다**:
//     원본 HTML 안의 온도 표기 62개(`&#xB0;` 로 인코딩)
//     통짜 본문 텍스트 2,458자 · 온도 19종 (36° 28° 47° 42° 37° 44° …)
//     그런데 `extractReadable` → 573자 · 온도 **0종**
//
// 원인은 이 한 줄이었다:
//     const blockRe = /<(h[1-6]|p|li|blockquote|pre|tr)\b[^>]*>…/gi
// **아는 태그 여섯 개만 훑는다.** 예보 카드는 `div`/`span` 이라 통째로 안 보였다.
//
// 이 저장소가 네 번째 만나는 같은 매듭이다 —
//   `이름낱말`(S3) · `needs`(S8) · `HYDRATION_KEYS`(오늘) · 그리고 여기.
//
// 다만 태그를 다 없앨 수는 없다. 그래서 **역할을 바꾼다**:
//   전(前): 태그 목록이 **무슨 내용이 살아남는지**를 정했다 → 빠진 이름은 내용을 통째로 잃는다.
//   후(後): 태그 목록은 **줄을 어디서 나눌지**만 정한다 → 빠진 이름은 줄이 붙을 뿐, 내용은 남는다.
// 손실이 나는 곳과 안 나는 곳을 가른 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractReadable } from '../src/runtime/readable.js';

// 판을 만들 때 주의: 아는 태그를 **하나도** 안 넣으면 기존 빈손 대비책(`out` 이 비면 통짜 텍스트)이
// 대신 물어 준다. 그러면 검사는 통과하는데 **라이브는 그대로 깨진다** — 실제 페이지엔 껍데기
// 블록이 43개 있어서 그 대비책이 안 돈다. 그래서 판에도 껍데기 블록을 넣는다.
const 껍데기블록 = '<p>브라우저 알림을 켜면 경보를 바로 받아 보실 수 있습니다.</p>'
  + '<ul><li>오늘</li><li>시간별</li><li>10일</li><li>레이더</li><li>월간</li></ul>';

/** AccuWeather 일별 예보 모양 — 내용은 전부 `div`/`span`, 껍데기만 아는 태그. */
const 예보카드 = `<html><head><title>일일 날씨</title></head><body>
${껍데기블록}
<div class="daily-list">
  <div class="daily-list-item"><div class="date"><span>8/5</span><span>화</span></div>
    <div class="temp"><span class="high">36&#xB0;</span><span class="low">28&#xB0;</span></div>
    <div class="phrase">무더움. 소나기</div></div>
  <div class="daily-list-item"><div class="date"><span>8/6</span><span>수</span></div>
    <div class="temp"><span class="high">33&#xB0;</span><span class="low">26&#xB0;</span></div>
    <div class="phrase">구름 많고 비</div></div>
</div></body></html>`;

test('① **div 로 그린 예보가 본문에 온다** — 라이브에서 잃은 그것', () => {
  const { markdown } = extractReadable(예보카드);
  const 온도 = [...new Set(markdown.match(/\d{1,2}°/g) ?? [])];
  assert.ok(온도.length >= 4,
    `**div 안의 값이 통째로 사라졌다** — 온도 ${온도.length}종.\n`
    + `아는 태그(h1~h6·p·li·blockquote·pre·tr)만 훑으면 이렇게 된다. 실측 그대로다.\n`
    + `받은 것: ${JSON.stringify(markdown.slice(0, 200))}`);
  assert.match(markdown, /무더움/, '설명 문구도 못 건졌다');
  assert.match(markdown, /8\/6/, '날짜도 못 건졌다');
});

test('② **줄이 섞이지 않는다** — 값이 서로 붙어 다른 숫자가 되면 안 된다', () => {
  const { markdown } = extractReadable(예보카드);
  assert.doesNotMatch(markdown, /36°28°/, `값이 붙어 버렸다: ${JSON.stringify(markdown.slice(0, 160))}`);
});

test('③ **문서형 페이지의 구조는 그대로 남는다** — 되던 것을 안 깬다(회귀)', () => {
  const 글 = `<html><body><article>
    <h2>제목입니다</h2>
    <p>이것은 충분히 긴 본문 문단입니다. 스무 자를 넘습니다.</p>
    <ul><li>첫째 항목</li><li>둘째 항목</li></ul>
    <blockquote>인용한 말입니다</blockquote>
    <table><tr><td>가</td><td>나</td></tr></table>
  </article></body></html>`;
  const { markdown } = extractReadable(글);
  assert.match(markdown, /^## 제목입니다$/m, `제목 표시가 사라졌다:\n${markdown}`);
  assert.match(markdown, /^- 첫째 항목$/m, `목록 표시가 사라졌다:\n${markdown}`);
  assert.match(markdown, /^> 인용한 말입니다$/m, `인용 표시가 사라졌다:\n${markdown}`);
  assert.match(markdown, /\|\s*가\s*\|\s*나\s*\|/, `표 표시가 사라졌다:\n${markdown}`);
});

test('④ **껍데기 문구는 여전히 버린다** — 쿠키 배너가 본문이 되지 않는다', () => {
  const { markdown } = extractReadable(
    '<html><body><div>쿠키 설정</div><div>로그인</div><div>실제 내용은 여기 있습니다. 충분히 깁니다.</div></body></html>',
  );
  assert.doesNotMatch(markdown, /^쿠키 설정$/m, `껍데기 문구가 본문에 남았다:\n${markdown}`);
  assert.match(markdown, /실제 내용은 여기 있습니다/);
});

test('⑤ **같은 말이 연달아 반복되면 한 번만** — 메뉴가 본문을 밀어내지 않는다', () => {
  const { markdown } = extractReadable(
    `<html><body>${'<div>서울특별시, 서울시</div>'.repeat(6)}<div>오늘 최고 36도입니다.</div></body></html>`,
  );
  assert.equal((markdown.match(/서울특별시, 서울시/g) ?? []).length, 1,
    `같은 줄이 반복해 실렸다:\n${markdown}`);
});

test('⑥ **상한을 지킨다**', () => {
  const 긴것 = `<html><body>${'<div>아주 긴 본문 조각입니다. </div>'.repeat(2000)}</body></html>`;
  assert.ok(extractReadable(긴것, { maxChars: 500 }).markdown.length <= 500);
});
