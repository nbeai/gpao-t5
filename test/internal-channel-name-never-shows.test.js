// **통제 채널 이름은 사용자 화면에 절대 안 나온다** — 앞에 무엇이 붙어 있든.
//
// 라이브 실측(2026-08-04 · 말귀 축 재측정 · gpt-5.5 · 문항 5 "이번 달에 내가 뭐 했는지"):
//   화면에 이렇게 나갔다.
//     참고한 지난 대화 문장:
//     `memory.cite`: "부모님이 집에 오셔서 1~3일 머무는 기준으로 잡고 정리할게."
//     `memory.cite`: "일단 회사 보고서는 …"
//
// 가드는 **있었다**. 2026-08-03 에 같은 사고("답 마지막 줄에 `memory.cite:` 가 나갔다")를
// 겪고 줄 단위로 걷어내게 고쳤다. 그런데 줄 앞에 **허용할 글자를 목록으로 열거했다**:
//   `^[ \t>*-]*` — 공백·탭·인용·별표·하이픈
// 모델이 이번엔 **백틱**으로 감쌌다(` `memory.cite`: ` ). 목록에 백틱이 없어서 통과했다.
//
// **또 목록이 뚫렸다**(절대원칙 8 · §4-6). 같은 자리를 두 번째 뚫린 것이므로, 이번엔
// 목록을 늘리지 않고 **구조**로 바꾼다: 글자(한글·영문)가 나오기 전까지의 **모든 장식**을 넘긴다.
// 마크다운 장식은 늘어날 수 있지만 "글자가 아닌 것"은 늘어나지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userFacingModelText } from '../src/kernel/turn-surface.js';

const 통제이름 = ['memory.cite', 'memory.propose', 'work.state', 'automation.propose', 'skill.propose'];

test('라이브에서 샌 그 모양 — **백틱으로 감싼 채널 이름**이 지워진다', () => {
  const 답 = '참고한 지난 대화 문장:\n`memory.cite`: "부모님이 오신다."\n`memory.cite`: "보고서 틀."\n끝.';
  const 나간것 = userFacingModelText(답);
  assert.doesNotMatch(나간것, /memory\.cite/,
    `내부 채널 이름이 사용자 화면에 나갔다: ${JSON.stringify(나간것)}`);
  assert.match(나간것, /끝\./, '본문까지 지웠다 — 장식만 걷어야 한다');
});

test('장식이 무엇이든 지워진다(목록을 늘리지 않는다)', () => {
  for (const 장식 of ['', ' ', '  ', '> ', '- ', '* ', '`', '**', '_', '· ', '  > `']) {
    const 답 = `앞말.\n${장식}memory.cite: "무언가"\n뒷말.`;
    const 나간것 = userFacingModelText(답);
    assert.doesNotMatch(나간것, /memory\.cite/,
      `장식 ${JSON.stringify(장식)} 앞에 붙으니 샜다: ${JSON.stringify(나간것)}`);
  }
});

test('모든 통제 채널 이름이 같은 계약을 받는다', () => {
  for (const 이름 of 통제이름) {
    const 나간것 = userFacingModelText(`시작.\n\`${이름}\`: "값"\n끝.`);
    assert.equal(나간것.includes(이름), false, `${이름} 이 화면에 남았다: ${나간것}`);
  }
});

test('사람 말은 안 건드린다(과잉 제거 금지)', () => {
  const 답 = '기억하는 방법: 메모를 남기면 돼.\n`ls -al` 은 목록을 보여주는 명령이야.';
  const 나간것 = userFacingModelText(답);
  assert.match(나간것, /메모를 남기면 돼/);
  assert.match(나간것, /ls -al/, '평범한 코드 조각까지 지웠다');
});

test('맨 앞에 붙은 경우도 그대로 지워진다(예전 계약 유지)', () => {
  assert.doesNotMatch(userFacingModelText('memory.cite: "값" 그리고 본문.'), /memory\.cite/);
});
