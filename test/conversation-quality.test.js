// Phase 2-2 · 모델 입력 다이어트 + 대화 헌장.
//
// 실측 결함: `answerMode`(fast_chat/complex_work)를 계산해 놓고 **쓰지 않아서**, 인사 한 마디에도
// 삭제 요청과 똑같은 647자를 보냈다. 그 안에 능력 설명이 통째로 있어 모델이 인사에 능력을 번호
// 목록으로 되읊었다. 그리고 정작 "너 뭐 할 수 있어?"는 능력 문서를 꺼내는 조건에 안 걸렸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { selfhoodLookup } from '../src/kernel/l1-intent/selfhood-lookup.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const messagesFor = (text, opts = {}) => {
  const intent = interpret(text, { selfState });
  const detail = selfhoodLookup(text).needed ? '[능력 문서 대목]' : undefined;
  return buildModelMessages(buildTaskContext({ intent, selfState, selfhoodDetail: detail, ...opts }));
};

// ── 다이어트의 자리가 바뀌었다(F-115 · 2026-08-14) ────────────────────────
//
// 여기 있던 검사는 *"가벼운 대화에는 능력 설명 문장을 싣지 않는다(도구 이름까지만)"* 였다.
// **그 다이어트가 손을 못 뻗게 만든 자리였다.** `저장해줘`·`남겨줘`·`요약해줘`·`세서 알려줘`
// 는 `ACTION_SIGNALS` 에 없어서 전부 `fast_chat` 이고, 그 턴에 빠지는 문장 안에
// *"사용자에게 명령어를 적어 주지 않는다"* 가 있었다 — 떠넘김을 막는 문장이 떠넘김이 나는
// 턴에만 안 갔다(라이브 4회차 · 터미널 호출 0회).
//
// 잘라야 할 것은 **요청과 무관한 사실**이지 **모델이 손을 고를 재료**가 아니다.
// 능력 문장·한계는 이제 분류와 무관하게 늘 간다(아래 F-115 검사가 그것을 문다).
test('가벼운 대화에도 손을 고를 재료가 실린다 — 분류가 재료를 빼앗지 않는다(F-115)', () => {
  const sys = messagesFor('고마워').system;
  assert.ok(sys.includes('로컬 파일'), '무엇이 있는지는 알아야 과장하지 않는다');
  assert.ok(sys.includes('아직 안 되는 것'), '가벼운 턴이라고 "무엇을 못 하는지"를 지우면 모델은 짐작으로 답한다');
});

test('도구를 실제로 쓰는 턴에는 능력 설명과 한계를 싣는다', () => {
  const sys = messagesFor('메모.md 지워줘').system;
  assert.ok(/읽고|정리|되돌/.test(sys), '무엇을 어디까지 하는지가 판단에 필요하다');
  assert.ok(sys.includes('아직 안 되는 것'), '못 하는 것도 같이 말해야 과장이 아니다');
});

test('능력을 물으면 가벼운 대화라도 문서 대목을 꺼낸다', () => {
  const sys = messagesFor('너 뭐 할 수 있어?').system;
  assert.ok(sys.includes('[능력 문서 대목]'), '정작 물었을 때 안 꺼내면 다이어트가 아니라 손실이다');
});

// P2-5a 이후 이 불변식의 대상이 바뀌었다. 잘라야 할 것은 **요청과 무관한 사실**이지 판단의 순서가
// 아니다. 헌장은 매 턴 같아 캐시에 얹히고, 부풀면 곤란한 것은 턴마다 달라지는 사실 쪽이다.
//
// **재는 축이 바뀌었다(F-115 · 2026-08-14).** 옛 불변식은 *"가벼운 대화의 사실 구역 ≤ 400자"*
// 였고, 그 400자를 지키는 방법이 **손 쓰는 법을 빼는 것**이었다 — 아낀 자수만큼 모델이
// 손을 못 골랐다. 게다가 그 다이어트는 안정 접두를 **발화에 따라 갈랐다**(실측: 지문 2종,
// 3,450자 ↔ 5,118자). 잡담과 일이 번갈아 오는 평범한 대화에서 접두가 매번 무효였다 —
// 도구 스키마(실측 9,836자)까지 통째로 재청구다. **자수를 아끼려다 캐시를 잃은 것이다.**
//
// 그래서 여기서 재는 것은 크기가 아니라 **불변성**이다: 같은 설치면 무슨 말을 해도 사실
// 구역이 글자 하나 안 달라야 하고, 그래야 접두에 얹혀 한 번만 청구된다. 크기 상한은
// 조용한 성장만 막게 넉넉히 둔다(실측 1,807자).
test('불변식: 사실 구역이 발화에 따라 갈리지 않는다(캐시 접두에 얹히는 조건 · F-115)', () => {
  const 잰것 = ['안녕', '고마워', '오늘 날씨 좋네', '메모.md 지워줘', '순매출.tsv 로 저장해줘'].map((text) => {
    const sys = messagesFor(text).system;
    const at = sys.indexOf('[환경]');
    assert.ok(at > 0, '사실 구역이 있어야 헌장과 구분된다');
    return [text, sys.slice(at)];
  });
  const [기준글, 기준] = 잰것[0];
  for (const [text, 사실구역] of 잰것.slice(1)) {
    assert.equal(사실구역.length, 기준.length,
      `"${text}"(${사실구역.length}자)와 "${기준글}"(${기준.length}자)의 사실 구역이 다르다 —`
      + ' 발화가 접두를 가르면 캐시는 번갈아 나오는 대화에서 매 턴 미스다(F-73 과 같은 병).');
    assert.equal(사실구역, 기준, `"${text}" 의 사실 구역 내용이 갈렸다 — 접두 지문이 쪼개진다`);
  }
  assert.ok(기준.length <= 2200, `사실 구역이 ${기준.length}자로 조용히 자랐다(상한 2200 · 실측 1807)`);
});

test('지금 언제·어디인지를 사실로 싣는다(안 주면 "오늘"을 몰라 되묻는다)', () => {
  const sys = messagesFor('오늘 날씨 좀 알려줄래?').system;
  assert.match(sys, /\[지금\] .*20\d\d년/, '현재 시각이 없으면 모델은 오늘이 언제인지 모른다');
  assert.match(sys, /사용자 시간대: \w+\/\w+/, '지역을 매번 되묻지 않게 사실을 준다(지시가 아니라)');
});

// ── "뭐 할 수 있어?" 를 못 알아듣던 것 ────────────────────────────────────
test('가장 흔한 능력 질문 형태를 알아듣는다', () => {
  for (const t of ['너 뭐 할 수 있어?', '오늘 뭐 도와줄 수 있어?', '무엇을 할 수 있니', '어디까지 되는거야']) {
    assert.equal(selfhoodLookup(t).needed, true, `못 알아들었다: ${t}`);
  }
});

test('능력 질문이 아닌 말에는 문서를 꺼내지 않는다(과잉 주입 금지)', () => {
  for (const t of ['안녕', '고마워', '점심 뭐 먹었어?', '그거 뭐야?']) {
    assert.equal(selfhoodLookup(t).needed, false, `엉뚱하게 꺼냈다: ${t}`);
  }
});

// ── 대화 헌장: 형식의 과잉만 막고 문장은 모델에 남긴다 ────────────────────
test('헌장은 모든 턴에 있고, 문장을 지정하지 않는다', () => {
  const sys = messagesFor('안녕').system;
  assert.ok(sys.includes('대화하듯'), '형식 과잉 억제는 매 턴 필요하다');
  assert.ok(sys.includes('말투'), '한 대화 안에서 말투가 뒤집히던 것을 막는다');
  assert.ok(!/["'].{0,40}(라고 답|라고 말)/.test(sys), '문장을 지정하면 템플릿 응답이 된다(§10.2)');
});
