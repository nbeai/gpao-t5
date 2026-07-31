// S5-2/3 보강 · 통제 채널을 **현실 공급으로** 안내한다.
//
// 라이브 실측(2026-07-31): 원리가 입장하고 답이 그대로 따랐는데도 `memory.cite` 호출 0,
// 사용자가 명백히 정정했는데도 `memory.correction` 호출 0이었다. 배선은 멀쩡했다 —
// 손 5개에 통제 채널 4개가 다 붙어 있었다. 원인은 **설명**이었다.
//
// 내가 "참고하지 않았으면 부르지 않는다 · 부르지 않아도 아무 문제 없다 · 확신이 없으면
// 부르지 않는다"라고 써 뒀다. 안전하게 쓴다는 게 모델에게는 **건너뛰어도 되는 것**으로 읽힌다.
//
// 고치는 방향은 금지문이 아니다(그건 모델을 압박해 없는 인용을 만들게 한다). **사실을 준다** —
// T5 는 무엇을 보여줬는지는 알지만 무엇이 도움이 됐는지는 모른다는 사실, 그리고 그 표식으로
// 무엇을 하는지를 알려 준다. 그리고 그 안내를 **쓸 자리에서**(기억을 보여주는 그 자리) 준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_CONTROL_SCHEMAS } from '../src/kernel/l2-plan/model-control.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 설명 = (name) => MODEL_CONTROL_SCHEMAS.find((s) => s.name === name)?.description ?? '';

test('S5-2/3: 통제 채널 설명에 면제 문구를 두지 않는다', () => {
  for (const name of ['memory.cite', 'memory.correction']) {
    const d = 설명(name);
    assert.ok(d, `${name} 설명이 있다`);
    for (const 면제 of ['부르지 않아도', '안 부르는 것이 정상', '확신이 없으면 부르지 않는다']) {
      assert.equal(d.includes(면제), false, `${name} 설명에 면제 문구 '${면제}' 가 남아 있다`);
    }
  }
});

test('S5-2/3: 설명은 금지가 아니라 **사실**을 준다', () => {
  const cite = 설명('memory.cite');
  // T5 가 무엇을 모르는지, 이 표식으로 무엇을 하는지가 들어 있어야 한다.
  assert.match(cite, /도움이 됐는지|무엇이 실제로/, 'T5 가 모르는 사실을 알려 준다');
  const corr = 설명('memory.correction');
  assert.match(corr, /한 번으로는|여러 번/, '한 번으로는 아무 것도 안 바뀐다는 사실을 준다');
  // 압박 문구를 쓰지 않는다 — 없는 인용을 만들어 내면 통계가 통째로 거짓이 된다.
  for (const 압박 of ['반드시', '항상 불러', '무조건']) {
    assert.equal(cite.includes(압박), false, `cite 설명에 압박 문구 '${압박}'`);
    assert.equal(corr.includes(압박), false, `correction 설명에 압박 문구 '${압박}'`);
  }
});

// ── 쓸 자리에서 안내한다 ───────────────────────────────────────────────────
const tc = (over = {}) => ({
  currentRequest: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4',
  selfStateFacts: {}, admittedContext: [], authorityFacts: {},
  answerMode: 'complex_work', naturalness: 'method_and_language_open', ...over,
});

test('S5-2: 기억을 보여준 자리에서 인용 안내를 함께 준다', () => {
  const m = buildModelMessages(tc({ admittedContext: ['월별 수치는 표로 정리한다'] }));
  assert.match(m.user, /\[반영된 기억\]/);
  assert.match(m.user, /memory\.cite/, '보여준 그 자리에서 안내한다');
});

test('S5-2: 보여준 것이 없으면 인용 안내도 없다(없는 것을 가리키게 하지 않는다)', () => {
  const m = buildModelMessages(tc({ admittedContext: [] }));
  assert.equal(/memory\.cite/.test(m.user), false);
});

test('S5-2: 이어받을 작업만 있어도 안내가 붙는다', () => {
  const m = buildModelMessages(tc({ carryableWork: ['지난 정리 — 정리한 답이 남아 있음'] }));
  assert.match(m.user, /\[다른 대화에서 이어받을 수 있는 작업\]/);
  assert.match(m.user, /memory\.cite/);
});

test('S5-2: 안내가 사실 목록을 밀어내지 않는다(기억 문장이 그대로 간다)', () => {
  const 문장 = '월별 수치는 표로 정리한다';
  const m = buildModelMessages(tc({ admittedContext: [문장] }));
  assert.ok(m.user.includes(문장), '기억 문장은 그대로 간다');
  assert.equal(m.user.includes('p-원리'), false, '내부 ID 는 여전히 안 나간다');
});

test('S5-3: 직전 답이 놓고 쓴 문장을 이번 턴에 사실로 준다(지목할 목록)', () => {
  const m = buildModelMessages(tc({ priorShown: ['월별 수치는 표로 정리한다'] }));
  assert.match(m.user, /memory\.correction/, '정정이 가능한 자리에서 알려 준다');
  assert.ok(m.user.includes('월별 수치는 표로 정리한다'), '지목할 대상을 실제로 보여준다');
});

test('S5-3: 직전 턴에 보인 것이 없으면 그 안내를 주지 않는다', () => {
  assert.equal(/memory\.correction/.test(buildModelMessages(tc({})).user), false);
  assert.equal(/memory\.correction/.test(buildModelMessages(tc({ priorShown: [] })).user), false);
});

test('S5-2: 인용 안내에 면제 문구를 두지 않는다(쉬운 출구를 만들지 않는다)', () => {
  const m = buildModelMessages(tc({ admittedContext: ['월별 수치는 표로 정리한다'] }));
  assert.equal(m.user.includes('없으면 넣지 않는다'), false, '렌더 안내는 사실만 준다');
});
