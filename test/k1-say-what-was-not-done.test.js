// **노드 K — 한 일을 한 대로 말한다.**
//
// 계획서 `4dc9a17` 노드 K. 판 5판: ③ 1/3 · ④ 0/3 · ⑦ 0/3 · ⑧ 0/3.
// 말이 기계 사실에서 나오지 않는다 — **안 한 일을 했다고 하고, 한 일을 안 했다고 한다.**
//
// ```
// ③  원장 0 인데  "방금 다시 직접 열어봤어요"           ← 거짓 성공 (절대 게이트)
// ⑦  후보 3/3 생성됐는데  "스스로 먼저 말 걸 수 없어요"  ← 거짓 실패
// ④  사실이 실려 갔는데  "볼 방법이 없어요"
// ⑧  앞 턴에 한 일이 없는데  이유를 못 만든다
// ```
//
// PM 이 밟아 둔 구멍 셋에서 출발한다. **문구 목록으로 고치지 않는다**(계획서 ⛔ ·
// `F-12` 가 2026-08-04 에 증명했다 — 그물을 넓히면 정상 문장까지 걸린다).
// **말이 나오는 재료를 바꾼다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 짓기 = (tc) => String(buildModelMessages({ currentRequest: '테스트', ...tc }).system ?? '');

// ── 구멍 ① 안 한 것을 안 말한다 → ③⑧ ────────────────────────────────
// `if (tc.evidenceFacts?.length)` — 손을 안 썼으면 **블록이 통째로 없다.**
// 없는 것과 말 안 한 것을 모델이 구분 못 하고, 그 빈자리를 상상으로 메운다:
// *"방금 다시 직접 열어봤어요"*(원장 0). 거짓 성공은 **절대 게이트**다.
test('손을 안 썼으면 안 썼다고 말한다 — 빈자리를 모델이 메우게 두지 않는다', () => {
  const 글 = 짓기({ evidenceFacts: [] });
  assert.match(글, /이번 턴 실행 사실/,
    '**블록이 통째로 없다** — 모델은 "안 한 것"과 "말 안 한 것"을 구분 못 한다');
  assert.match(글, /없|안 (불렀|썼|했)/,
    `**0 을 0 이라고 말하지 않는다** — 그 빈자리에 "방금 열어봤어요"가 들어선다: ${글.slice(-400)}`);
});

test('손을 썼으면 예전 그대로다 — 있는 사실을 덮지 않는다', () => {
  // **가짜가 실물 모양이어야 한다** — `evidenceFacts` 는 문자열이 아니라
  // `{summary, failureState, …}` 객체다(오늘 두 번 밟은 병).
  const 글 = 짓기({
    evidenceFacts: [{ summary: '6월 정산내역.csv 를 읽었어요', failureState: 'none' }],
  });
  assert.match(글, /6월 정산내역\.csv/, `실제 사실이 사라졌다: ${글.slice(-300)}`);
});

// ── 구멍 ② 한 일인데 사실이 되지 못한다 → ⑦ ──────────────────────────
// `automationProposal` 은 `turn.js` 에서 만들어져 표면까지 가는데
// `model-provider.js` 에 **한 번도 안 나온다.** 그래서 T5 는 예약 후보를 실제로 만들어
// 놓고도 *"스스로 먼저 말 걸 수 없어요"* 라고 답한다 — **거짓 실패**다.
test('예약 후보를 만들었으면 모델이 그것을 안다 — 해 놓고 못 한다고 말하지 않는다', () => {
  const 글 = 짓기({
    automationProposal: { statement: '매주 월요일 09:00 에 지난주 정산을 정리해 알려드릴까요?' },
  });
  assert.match(글, /매주 월요일 09:00/,
    `**만든 것이 모델에게 안 간다** — T5 가 "그런 기능이 없어요"라고 답한다: ${글.slice(-400)}`);
});

test('후보가 없으면 그 말을 안 만든다 — 없는 것을 있다고 하지 않는다', () => {
  assert.doesNotMatch(짓기({}), /예약 후보/, '없는 예약을 이야기한다');
});

// ── 구멍 ③ 사실이 갔는데 딱지가 버리게 만든다 → ④ ────────────────────
// `[저장된 기본값 — 현재 요청과 충돌하면 적용하지 않음]` + *"지금 실행할 명령이 아니다"* 가
// **사용자에 대한 사실**에도 붙는다. 그래서 *"아침에 보리차 마셨어"* 가 실려 갔는데도
// 모델이 *"볼 방법이 없어요"* 라고 답한다.
//
// **갈라야 할 선은 "과거냐"가 아니라 "지시냐 사실이냐"다.** 그리고 그 선은 이미
// 재료에 있다 — `context-mesh.js` 가 `kind` 를 달아 준다(문법으로 안 가른다).
const 사실 = [{ kind: 'preference', statement: '아침에 보리차를 마셨다' }];
const 지시 = [{ kind: 'instruction', statement: '보고서는 항상 표로 만들어라' }];

test('사용자에 대한 사실은 버리라고 하지 않는다 — 알고 있는데 모른다고 답한다', () => {
  const 글 = 짓기({ admittedRich: 사실, admittedContext: 사실.map((e) => e.statement) });
  const 자리 = 글.indexOf('보리차');
  assert.ok(자리 >= 0, '사실이 아예 안 갔다');
  const 앞 = 글.slice(Math.max(0, 자리 - 300), 자리);
  assert.doesNotMatch(앞, /지금 실행할 명령이 아니다|충돌하면 적용하지 않음/,
    `**사실에 "쓰지 마라" 딱지가 붙는다** — 모델이 그걸 읽고 "볼 방법이 없어요"라고 답한다:\n${앞}`);
});

test('저장된 지시는 여전히 격리된다 — 과거 명령이 이번 요청과 경쟁하면 안 된다', () => {
  const 글 = 짓기({ admittedRich: 지시, admittedContext: 지시.map((e) => e.statement) });
  const 자리 = 글.indexOf('표로 만들어라');
  assert.ok(자리 >= 0, '지시가 안 갔다');
  assert.match(글.slice(Math.max(0, 자리 - 300), 자리), /지금 실행할 명령이 아니다/,
    '**과거 명령의 격리가 풀렸다** — 쌍 2 실측에서 모델이 우선순위를 뒤집었다(§5-J)');
});

test('종류를 모르면 격리 쪽이다 — 모르는 것을 사실로 승격하지 않는다', () => {
  const 것 = [{ statement: '종류표시없는기록ZZ' }];
  const 글 = 짓기({ admittedRich: 것, admittedContext: ['종류표시없는기록ZZ'] });
  const 자리 = 글.indexOf('종류표시없는기록ZZ');
  assert.match(글.slice(Math.max(0, 자리 - 300), 자리), /지금 실행할 명령이 아니다/,
    '모르는 것을 사실 쪽에 세운다');
});

test('신분 없이 문장만 와도 안 터진다 — 옛 호출부가 그대로 돈다', () => {
  const 글 = 짓기({ admittedContext: ['그냥 문장'] });
  assert.match(글, /그냥 문장/, `문장이 사라졌다: ${글.slice(-200)}`);
});

// ── 재료가 실제로 손까지 온다 ───────────────────────────────────────────
// **여기가 끊기면 위 여덟 검사가 다 초록인데 제품은 그대로다.** 오늘 그 병을 다섯 번 봤다 —
// 함수는 옳은데 인자가 안 채워져서 가르침이 한 번도 안 실린 그 모양(`connectedTools`).
// 그래서 `buildTaskContext → buildModelMessages` 를 **한 벌로 태운다.**
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';

const 태우기 = (p) => String(buildModelMessages({
  currentRequest: '내가 뭘 마시는지 알아?',
  ...buildTaskContext({
    // **가짜가 실물 조건을 채워야 계약을 재는 것이다** — `selfState` 는 `currentModel.id`
    // 까지 본다(오늘 세 번째 밟은 병).
    processEnv: {},
    selfState: { currentModel: { id: 'test-model' }, connectedTools: [], riskyActions: [], limits: {} },
    intent: { answerMode: 'work', goal: 'x', currentRequest: '내가 뭘 마시는지 알아?' },
    plan: { autoAllowed: [], needsApproval: [], forbidden: [] }, receipts: [],
    ...p,
  }),
}).system ?? '');

test('기억의 신분이 커널을 지나 모델까지 간다 — 문장만 가면 사실이 격리된다', () => {
  const 글 = 태우기({
    admittedContext: ['아침에 보리차를 마셨다'],
    admittedRich: [{ kind: 'preference', statement: '아침에 보리차를 마셨다' }],
  });
  const 자리 = 글.indexOf('보리차');
  assert.ok(자리 >= 0, `**기억이 모델까지 안 간다**: ${글.slice(-300)}`);
  assert.doesNotMatch(글.slice(Math.max(0, 자리 - 300), 자리), /지금 실행할 명령이 아니다/,
    '**커널이 신분을 버린다** — 모델 쪽만 고치면 아무 효과가 없다');
});

test('예약 후보가 커널을 지나 모델까지 간다 — 만든 것이 사실이 되어야 한다', () => {
  const 글 = 태우기({
    automationProposal: { statement: '매주 월요일 09:00 에 지난주 정산을 정리해 알려드릴까요?' },
  });
  assert.match(글, /매주 월요일 09:00/,
    `**커널이 예약 후보를 안 나른다** — T5 가 만들어 놓고 "기능이 없다"고 답한다: ${글.slice(-300)}`);
});

test('손을 안 쓴 턴은 커널을 지나도 0 이라고 말한다', () => {
  assert.match(태우기({}), /도구를 한 번도 부르지 않았다/,
    '**빈자리가 그대로 남는다** — 그 자리에 "방금 열어봤어요"가 들어선다');
});
