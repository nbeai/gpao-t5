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

// ── 다이어트: 요청과 무관한 사실은 싣지 않는다(§11) ──────────────────────
test('가벼운 대화에는 능력 설명 문장을 싣지 않는다(도구 이름까지만)', () => {
  const sys = messagesFor('고마워').system;
  assert.ok(sys.includes('로컬 파일'), '무엇이 있는지는 알아야 과장하지 않는다');
  assert.ok(!sys.includes('되돌릴 수 있게'), `설명 문장이 실렸다:\n${sys}`);
  assert.ok(!sys.includes('현재 한계'), '잡담에 연결 상태 목록은 소음이다');
});

test('도구를 실제로 쓰는 턴에는 능력 설명과 한계를 싣는다', () => {
  const sys = messagesFor('메모.md 지워줘').system;
  assert.ok(/읽고|정리|되돌/.test(sys), '무엇을 어디까지 하는지가 판단에 필요하다');
  assert.ok(sys.includes('현재 한계'), '못 하는 것도 같이 말해야 과장이 아니다');
});

test('능력을 물으면 가벼운 대화라도 문서 대목을 꺼낸다', () => {
  const sys = messagesFor('너 뭐 할 수 있어?').system;
  assert.ok(sys.includes('[능력 문서 대목]'), '정작 물었을 때 안 꺼내면 다이어트가 아니라 손실이다');
});

test('불변식: 가벼운 대화의 모델 입력이 다시 부풀지 않는다', () => {
  for (const text of ['안녕', '고마워', '오늘 날씨 좋네']) {
    const len = messagesFor(text).system.length;
    assert.ok(len <= 600, `"${text}" 입력이 ${len}자로 부풀었다(상한 600)`);
  }
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
