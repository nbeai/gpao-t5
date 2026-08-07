// **사장님이 자기 매출을 묻는 것은 가벼운 대화가 아니다.**
//
// PM 방향(2026-08-07): ⑤⑬ 은 계획 단계다. 밟았고 자리를 찾았다.
//
// ```
// "이번 달 얼마 벌었지?"      → answerMode: fast_chat · neededTools: undefined
// "통장이 자꾸 비어"          → fast_chat · undefined
// "그거 진짜 됐어?"           → fast_chat · undefined
// "정산 파일 열어서 정리해줘"  → complex_work · ["local.file"]      ← 이것만 손이 선다
// ```
//
// `ACTION_SIGNALS` 가 전부 **명령 동사**다 —
// `보내|발송|전송|올려|게시|삭제|지워|결제|구매|정리|이동|옮겨|조사|검색|…`
// **행동 요구**만 잡고 **사실 요구**는 안 잡는다. 그래서 커널이 *"손이 필요 없다"* 고
// 단정하고 계획 단계에서 후보가 0개가 된다. 모델이 안 뻗는 게 아니라 **길이 안 열린다.**
//
// 낱말을 더하지 않는다(절대원칙 4 · 누더기 금지). **축을 하나 더 세운다** —
// 지금 축은 *"무엇을 해달라고 했나"* 뿐이고, *"무엇을 알려달라고 했나"* 가 없다.
// 사용자 세계의 사실(내 돈·내 파일·내 일정·지난달…)을 물으면 그 답은 T5 의 상식이 아니라
// **이 컴퓨터 안**에 있다. 그건 손을 뻗어야 하는 일이다.
//
// 계획서 「동반」 기준: 되묻지 않고 스스로 찾아본 뒤 무엇을 봤는지 말한다.
// 말귀 회차가 T5 는 그럴 줄 안다는 걸 보여줬다 — 정보가 없을 때 *"일단 이렇게 가정하고
// 말할게요"* 로 간다. **손이 필요할 때만 묻는다. 그 비대칭이 결함이다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interpret } from '../src/kernel/l1-intent/intent.js';

const 손붙는가 = (t) => {
  const i = interpret(t, {});
  return { mode: i.answerMode, tools: i.neededTools ?? [] };
};

test('내 세계의 사실을 물으면 가벼운 대화가 아니다 — 손을 뻗어야 답이 나온다', () => {
  // **`"오늘 뭐 하기로 했더라"` 는 뺐다.** 일정 이야기 같지만 `"오늘 날씨 어때?"` 와
  // 낱말로는 안 갈린다 — 둘 다 시간 + 의문뿐이다. 가르려면 낱말을 더해야 하고 그게
  // 누더기다(절대원칙 4). 이 문항은 이 축이 아니라 **대화 흐름**(노드 W)이 답할 자리다.
  for (const 말 of ['이번 달 얼마 벌었지?', '통장이 자꾸 비어', '지난달 매출 어땠어?',
    '내 정산 어디까지 됐지?']) {
    const { mode } = 손붙는가(말);
    assert.notEqual(mode, 'fast_chat',
      `**"${말}" 이 잡담으로 분류된다** — 계획 단계에서 손 후보가 0개가 되고, 모델은 되묻는다`);
  }
});

test('찾는 손이 후보에 오른다 — 어디 있는지 몰라도 찾을 수 있다', () => {
  const { tools } = 손붙는가('이번 달 얼마 벌었지?');
  assert.ok(tools.includes('local.locate'),
    `**찾는 손이 후보에 없다** — 파일 이름을 모르면 아무것도 못 한다: ${JSON.stringify(tools)}`);
});

test('진짜 잡담은 그대로 가볍다 — 모든 말에 손을 붙이면 그게 누더기다', () => {
  for (const 말 of ['안녕', '고마워', '오늘 날씨 좋네', '좋아', '알겠어', '고생했어']) {
    assert.equal(손붙는가(말).mode, 'fast_chat',
      `**"${말}" 에 손이 붙는다** — 잡담마다 도구가 실리면 느려지고 비싸진다`);
  }
});

test('상식을 물으면 손이 안 붙는다 — 내 것이 아닌 것은 이 컴퓨터에 없다', () => {
  for (const 말 of ['커피가 몸에 안 좋아?', '피자 만드는 법 알려줘']) {
    assert.ok(!손붙는가(말).tools.includes('local.locate'),
      `**"${말}" 에 파일 손이 붙는다** — 이 컴퓨터에 있을 답이 아니다`);
  }
});

test('명령형은 예전 그대로다 — 있던 길을 안 막는다', () => {
  const { mode, tools } = 손붙는가('정산 파일 열어서 정리해줘');
  assert.equal(mode, 'complex_work');
  assert.ok(tools.includes('local.file'), JSON.stringify(tools));
});

// ── 후보에 올린 손이 실제로 붙는다 ──────────────────────────────────────
// 후보를 올려도 안 움직였다. 밟으니 커널이 손을 **실제로 붙이는** 갈래가
// `local.file` 하나만 본다:
// ```
// turn.js:1106  if (!modelChosen && intent.neededTools?.includes('local.file') && …) {
//                 const fileTools = …filter((t) => t.name === 'local.file');
//                 … requiredTool: 'local.file'
// ```
// `local.locate` 를 후보에 넣어도 이 길을 안 탄다 — **후보만 있고 붙이는 자리가 없다.**
// 오늘 여덟 번째 같은 병이다.
//
// 새 강제를 만드는 게 아니다(⛔). 이 구조는 이미 있고 파일 손에 대해 이미 이렇게 돈다 —
// 같은 길을 **찾는 손까지** 넓힐 뿐이다(`d0365ab` 가 ⑧을 올린 것과 같은 층).
test('로컬 자료 손이 후보에 있으면 커널이 그 손을 붙인다 — 파일 손만 보면 찾는 손은 죽는다', () => {
  const 글 = readFileSync(fileURLToPath(new URL('../src/kernel/turn.js', import.meta.url)), 'utf8');
  const i = 글.indexOf("neededTools?.includes('local.file')");
  assert.ok(i > 0, '그 갈래가 사라졌다 — 자리 이름이 바뀌었으면 이 검사도 옮겨야 한다');
  const 둘레 = 글.slice(Math.max(0, i - 400), i + 700);
  assert.match(둘레, /local\.locate/,
    '**찾는 손이 붙는 자리가 없다** — 후보에 올려도 모델은 그 손을 강제로 받지 못한다');
});
