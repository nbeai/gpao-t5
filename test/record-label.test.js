// **접힌 작업 기록의 이름은 숫자가 아니라 사실이다** (오너 결정 2026-08-03).
//
// 실측(라이브, 2026-08-03): 턴이 끝나면 진행 표시(`steps`)는 제거되고 복원 경로가 0 이다.
// 그때 화면에 남는 것은 최종 답 한 줄과 **접힌 머리 하나**뿐인데, 그 머리가 "도구 1개"라고
// 말했다. 참이지만 사용자가 알고 싶은 것이 아니다 — 팀원이 "진행을 본 적 없다"고 한 이유는
// 정보가 사라져서가 아니라 **접힌 이름이 아무것도 말하지 않아서**였다.
// (오너 규칙: 「대리지표를 결과로 세우지 말 것」)
//
// 앵커는 **사용자에게 실제로 도달하는 문자열**이다. `index.html` 에 그 낱말이 있는지 세지 않고,
// 배포되는 그 함수를 꺼내 **출력을 잰다** — 문자열 검색은 함수가 안 불려도 초록이 된다(M2 교훈).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

/** 배포되는 표면에서 그 함수 원문을 그대로 꺼내 부른다(복사본을 재지 않는다). */
function 꺼내기(이름) {
  const at = html.indexOf(`function ${이름}(`);
  assert.ok(at > 0, `${이름} 이 표면에서 사라졌다 — 라벨 계약의 주인이 없어졌다`);
  let i = html.indexOf('{', at); let depth = 0; let end = i;
  for (; end < html.length; end += 1) {
    if (html[end] === '{') depth += 1;
    else if (html[end] === '}') { depth -= 1; if (depth === 0) break; }
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${html.slice(at, end + 1)}; return ${이름};`)();
}

const 기록라벨 = 꺼내기('기록라벨');

test('확인된 사실이 있으면 그 문장이 접힌 이름이 된다(숫자가 아니라)', () => {
  const 라벨 = 기록라벨({ confirmed: ['견적서.md 을(를) 읽었어요.'], unconfirmed: [], estimated: [] });
  assert.match(라벨, /견적서\.md/, `대상을 말하지 않는다: ${라벨}`);
  assert.ok(!/도구 \d+개/.test(라벨), `숫자를 결과 자리에 세웠다: ${라벨}`);
});

test('여러 건이면 첫 사실 + 나머지 건수 — 사실이 먼저다', () => {
  const 라벨 = 기록라벨({
    confirmed: ['견적서.md 을(를) 읽었어요.', '정리본.md 에 저장했어요.'], unconfirmed: [], estimated: [],
  });
  assert.match(라벨, /견적서\.md/);
  assert.match(라벨, /외 1건/, `나머지가 있다는 사실을 숨겼다: ${라벨}`);
});

// ── 여기가 이 검사의 핵심 ────────────────────────────────────────────────
test('확인되지 않은 것을 사실인 척 라벨에 올리지 않는다 — 표를 달아서 올린다', () => {
  // 실측(2026-08-03): 막힌 턴에서 확인된 사실이 없다고 "도구 1개"로 떨어뜨렸더니, 화면에
  // 남는 것은 모델 산문("확인했어요.") 한 줄뿐이고 진짜 사실은 접힌 채 숨었다.
  // 못 한 것도 사실이므로 올리되, **확인처럼 적지는 않는다.**
  const 라벨 = 기록라벨({ confirmed: [], unconfirmed: ['메일을 보내지 못했어요.'], estimated: [] });
  assert.match(라벨, /^미확인: /, `미확인을 확인처럼 적었다 — 펼치지 않는 사용자는 됐다고 믿는다: ${라벨}`);
  assert.match(라벨, /보내지 못했어요/, `막힌 사실이 접힌 이름에서 사라졌다: ${라벨}`);
  assert.ok(!/도구 \d+개/.test(라벨), `말할 사실이 있는데 숫자로 뭉갰다: ${라벨}`);
});

test('확인이 있으면 확인이 먼저다(미확인이 헤드라인을 가로채지 않는다)', () => {
  const 라벨 = 기록라벨({ confirmed: ['견적서.md 을(를) 읽었어요.'], unconfirmed: ['메일 실패'], estimated: [] });
  assert.match(라벨, /^견적서\.md/);
  assert.match(라벨, /외 1건/);
});

test('아무 사실도 없으면 세는 쪽이 정직하다', () => {
  assert.match(기록라벨({ confirmed: [], unconfirmed: [], estimated: ['아마 3건'] }), /도구 1개/);
});

test('추정은 여전히 라벨에 올리지 않는다 — 확인도 미확인도 아닌 것은 사실이 아니다', () => {
  const 라벨 = 기록라벨({ confirmed: [], unconfirmed: [], estimated: ['아마 3건 처리'] });
  assert.ok(!/3건 처리/.test(라벨), `추정을 사실 자리에 올렸다: ${라벨}`);
});

test('확인된 것이 하나라도 있으면 미확인 건수는 "외 N건"으로 함께 센다', () => {
  const 라벨 = 기록라벨({ confirmed: ['견적서.md 을(를) 읽었어요.'], unconfirmed: ['메일 전송'], estimated: [] });
  assert.match(라벨, /외 1건/, `남은 것이 있는데 접힌 줄이 완결처럼 보인다: ${라벨}`);
});
