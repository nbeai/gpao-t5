// **손이 쥐어 준 다음 길이 모델에게 간다** — 와이어 넷 전부 (지도 §11 말미 · §12 J1·J2·J3)
//
// 지도 §11 의 결론 문장 그대로다:
//   *"손이 쥐어 준 다음 길이 모델에게 안 간다 — 영수증의 `다음수단·다른후보·막힌곳·nextSafeAction`
//     은 패킷에는 실리는데 **어떤 와이어도 그 칸을 안 읽는다**. 검사는 "패킷에 필드가 있는가"까지만
//     재서 초록이었다."*
//
// 그래서 이 파일은 **패킷을 재지 않는다.** `web-next-moves-reach-model.test.js`(패킷)와
// 밭이 갈린다 — 여기서 재는 것은 **와이어 몸통에 그 글자가 있는가** 하나뿐이다.
//
// 밟은 라이브 둘이 정의역이다:
//   · 「팔식당」   `web.search` 가 후보 여덟을 물어 왔는데 읽기가 막히자 T5 가 한 곳도 안 열고
//                 사용자에게 주소 복사를 요구했다. 후보는 턴이 쥐고 있었다.
//   · 「펜션.pdf」 읽기가 막히며 손이 `nextSafeAction` 을 적어 줬는데 모델에게 안 갔다.
//
// 오픈북(비교군이 이 축을 어떻게 하는가):
//   · Hermes `tools/registry.py:930` `tool_error(message, **extra)` — 실패도 **성공과 같은
//     JSON 그릇**으로 나가고, `extra` 에 실린 「다음에 뭘 하면 되는가」가 같은 문자열에 붙는다.
//     `agent/conversation_loop.py:6306-6313` 이 그 문자열을 `{"role":"tool", "content": …}`
//     **그대로** 다음 입력에 싣는다 — 렌더가 칸을 골라 읽지 않는다.
//   · Hermes `model_tools.py:707,710-723` `_sanitize_tool_error` — 실패 원문을 2,000자로만
//     자르고 **일반 tool 메시지로** 보낸다(우리 `실패원문상한` 이 이미 흡수한 축).
//   · OpenClaw `docs/concepts/agent-loop.md:132` — *"Tool results are sanitized for size and
//     image payloads"* — 크기와 그림만 손대고 **칸을 고르지 않는다**.
//   · 클로드코드(이 세션) — 도구 결과도 에러도 원문 그대로 온다. 렌더가 칸을 고르는 층이 없다.
//
// 즉 비교군 셋 전부 **「고르지 않는다」가 축**이다. T5 만 와이어 렌더에서 칸을 골라 읽었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { blockedReceipt } from '../src/kernel/l0-evidence/tool-receipt.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages, MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { responsesInput } from '../src/runtime/chatgpt-model-client.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'web.search', connected: true, executable: true }],
});

/**
 * 모든 와이어를 한 자리에 세운다 — 하나라도 빠지면 여기가 빈다(`cu-every-wire…` 와 같은 축).
 *
 * ChatGPT(Responses)는 시스템을 `instructions`, 나머지를 `input` 으로 **따로** 보낸다
 * (chatgpt-model-client.js:275·278). 커널블록은 시스템 쪽에 사니 둘을 함께 세워야
 * 「모델이 실제로 받는 것」이 된다 — `input` 만 재면 커널블록 갈래를 통째로 놓친다.
 */
const 와이어들 = (tc) => {
  const m = buildModelMessages(tc);
  return [
    ...Object.entries(MODEL_PROVIDERS).map(([이름, spec]) => ({
      이름, 몸통: String(spec.body({ modelId: 'x', maxTokens: 10, baseUrl: 'https://x/v1' }, m, {})),
    })),
    { 이름: 'chatgpt', 몸통: JSON.stringify({ instructions: m.system, input: responsesInput(m) }) },
  ];
};

/** 그 글자를 떨어뜨리는 와이어 이름들. 빈 배열이 초록이다. */
const 떨어뜨린곳 = (tc, 조각) => 와이어들(tc)
  .filter(({ 몸통 }) => !몸통.includes(조각)).map(({ 이름 }) => 이름);

// ── J1. 손이 쥐어 준 다음 길 ────────────────────────────────────────────────

const 후보여덟 = Array.from({ length: 8 }, (_, i) => ({
  title: `을지로 노포 ${i + 1}`, url: `https://place.example.kr/no${i + 1}`,
}));

/** 「팔식당」 — 검색이 여덟을 물어 왔고, 읽기가 막혔다. */
const 팔식당턴 = () => buildTaskContext({
  intent: interpret('을지로 노포 식당 알려줘'),
  selfState,
  receipts: [
    {
      intended: '식당 찾기',
      actualCall: { tool: 'web.search', args: { query: '을지로 노포 식당' } },
      failureState: 'none',
      userSafeSummary: '여덟 곳을 찾았어요.',
      result: { 다른후보: 후보여덟 },
    },
    {
      intended: '식당 정보 읽기',
      actualCall: { tool: 'web.collect', args: { url: 'https://map.example.kr/blocked' } },
      failureState: 'failed',
      userSafeSummary: '그곳은 못 읽었어요.',
      diagnosticTrace: { 오류: 'HTTP 403' },
      nextSafeAction: '찾아 둔 다른 곳을 열어 볼 수 있어요.',
      막힌곳: [{ url: 'https://map.example.kr/blocked', fetchState: 'blocked' }],
    },
  ],
});

/**
 * **손이 스스로 쥔 다음 길만 든 턴.** 성공한 손이 없으므로 `data`(compactResult)로도,
 * 호출 인자로도 이 표식이 샐 수 없다 — 와이어 렌더가 그 칸을 읽어야만 몸통에 뜬다.
 * (첫 판에서 팔식당 턴으로 재다가 검색 결과의 `data` 가 같은 주소를 실어 **가짜 초록**이 났다.)
 */
const 손이쥔턴 = () => buildTaskContext({
  intent: interpret('그 페이지 읽어줘'),
  selfState,
  receipts: [{
    intended: '페이지 읽기',
    actualCall: { tool: 'web.collect', args: { url: 'https://부른곳.example.kr/zzz' } },
    failureState: 'failed',
    userSafeSummary: '그곳은 못 읽었어요.',
    diagnosticTrace: { 오류: 'HTTP 403' },
    다른후보: [{ title: '후보표식AAA', url: 'https://후보.example.kr/aaa' }],
    다음수단: [{ 방법: 'read_url', url: 'https://후보.example.kr/aaa', 왜: '수단표식BBB' }],
    막힌곳: [{ url: 'https://벽표식CCC.example.kr', fetchState: 'blocked' }],
    nextSafeAction: '수단표식DDD',
  }],
});

test('J1-① 손이 쥔 **다른 후보**가 와이어 넷 전부에 실린다 — 왼손이 쥔 것을 오른손이 쓴다', () => {
  const tc = 손이쥔턴();
  // 선행 확인: 패킷에는 이미 있다(기존 계약). 없으면 진단이 틀린 것이다.
  const x = (tc.turnExchange ?? [])[0];
  assert.ok(x?.다른후보?.length, `패킷 단계에서 이미 없다 — 진단이 틀렸다: ${JSON.stringify(x)}`);

  assert.deepEqual(떨어뜨린곳(tc, '후보표식AAA'), [],
    '**후보를 쥐고도 모델에게 말하지 않는다** — 라이브 「팔식당」 그대로다.'
    + ' 모델은 열 곳을 모르니 사용자에게 주소 복사를 요구한다.');
});

test('J1-② 손이 쥔 **다음 수단**이 와이어 넷 전부에 실린다 — 막다른 답이 되지 않게', () => {
  assert.deepEqual(떨어뜨린곳(손이쥔턴(), '수단표식BBB'), [],
    '**다음 수단이 와이어에서 증발한다.**');
});

test('J1-②b 「팔식당」 — 검색이 물어 온 후보로 커널이 메운 **다음 수단**도 와이어까지 간다', () => {
  // 이 표식(`이번 턴에 찾아 둔 곳`)은 `막힌자리메우기` 만 만든다 — 검색 결과의 `data` 로는 못 샌다.
  const tc = 팔식당턴();
  const x = (tc.turnExchange ?? []).find((e) => e.tool === 'web.collect');
  assert.ok(x?.다음수단?.length, `패킷 단계에서 이미 없다 — 진단이 틀렸다: ${JSON.stringify(x)}`);

  assert.deepEqual(떨어뜨린곳(tc, '이번 턴에 찾아 둔 곳'), [],
    '**턴이 쥔 후보로 메운 다음 수가 와이어에서 증발한다** — 후보 여덟을 받고도 한 곳도 안 연다.');
});

test('J1-③ **막힌 곳**이 와이어 넷 전부에 실린다 — 같은 벽에 두 번 부딪히지 않게', () => {
  // 부른 주소(`부른곳…zzz`)와 **다른** 주소로 잰다 — 호출 인자로 새는 길을 막는다.
  const tc = 손이쥔턴();
  assert.deepEqual(떨어뜨린곳(tc, '벽표식CCC'), [],
    '**어디서 막혔는지가 모델에게 안 간다** — 모델은 방금 막힌 곳을 다시 고른다.');
});

test('J1-④ 손이 적어 준 **nextSafeAction** 이 와이어 넷 전부에 실린다 — 라이브 「펜션.pdf」', () => {
  const tc = 손이쥔턴();
  assert.deepEqual(떨어뜨린곳(tc, '수단표식DDD'), [],
    '**손이 적어 준 다음 손이 모델에게 안 간다** — 읽기가 막히며 길을 줬는데 증발했다.');
});

test('J1-⑤ 승인 전에 막혀 서술로 남는 손(evidenceFacts)의 다음 길도 실린다', () => {
  // `turnExchange` 가 아니라 `evidenceFacts` 로 가는 갈래. 손 이름이 없는 영수증
  // (`blockedReceipt` — `approvalEligibility` 거절 · turn.js:1627·2721)이 이쪽으로 온다.
  // 같은 사실이 갈래에 따라 사라지면 그건 두 진실이다.
  const tc = buildTaskContext({
    intent: interpret('그 파일 읽어줘'),
    selfState,
    receipts: [blockedReceipt(
      '파일 도구 실행', 'local.file',
      '그 파일은 지금 못 읽었어요.',
      '수단표식EEE',
    )],
  });
  const f = (tc.evidenceFacts ?? [])[0];
  assert.equal(f?.nextSafeAction, '수단표식EEE',
    `패킷 단계에서 이미 없다 — 진단이 틀렸다: ${JSON.stringify(f)}`);

  assert.deepEqual(떨어뜨린곳(tc, '수단표식EEE'), [],
    '**evidenceFacts 렌더가 다음 길 칸을 안 읽는다** — 갈래가 다르다고 사실이 달라지지 않는다.');
});

test('J1-반례 잘 된 손에는 없는 말을 붙이지 않는다 — 늘 같은 잔소리가 늘지 않는다', () => {
  const tc = buildTaskContext({
    intent: interpret('그 파일 읽어줘'),
    selfState,
    receipts: [{
      intended: '자료 읽기',
      actualCall: { tool: 'local.file', args: { action: 'read', path: '/방/정산.csv' } },
      failureState: 'none',
      userSafeSummary: '정산.csv 를 읽었어요.',
      result: { path: '/방/정산.csv', text: '항목,금액\n임대료,500000\n' },
    }],
  });
  for (const { 이름, 몸통 } of 와이어들(tc)) {
    assert.doesNotMatch(몸통, /다음 수|막힌 곳|다른 후보/,
      `성공한 손에 다음 길 잔소리가 붙었다(${이름})`);
  }
});

// ── J2. 지난 턴의 실패가 성공처럼 보인다 ────────────────────────────────────

const 앞턴실패 = {
  summary: '카카오톡 창을 앞으로 못 옮겼어요.',
  tool: 'desktop.act',
  args: { action: 'focus', app: 'KakaoTalk' },
  ref: 'c9',
  failureState: 'failed',
};

test('J2-① 지난 턴의 **실패**는 「미확인」 표식을 달고 선다 — 성공과 같은 얼굴로 서지 않는다', () => {
  const tc = buildTaskContext({
    intent: interpret('내가 아까 뭐 해달라고 했지?'),
    selfState, receipts: [], priorExchange: [앞턴실패],
  });
  const p = (tc.priorExchange ?? [])[0];
  assert.equal(p?.failureState, 'failed',
    `앞 턴 실패 사실이 패킷에서 지워진다 — 렌더가 볼 것이 없다: ${JSON.stringify(p)}`);

  const 몸통 = 와이어들(tc)[0].몸통;
  const 자리 = 몸통.indexOf('못 옮겼어요');
  assert.notEqual(자리, -1, '앞 턴 줄 자체가 없다');
  assert.match(몸통.slice(자리, 자리 + 120), /미확인/,
    '**지난 턴 실패가 표식 없이 선다.** 모델은 그것을 한 일로 읽고 없는 기억을 사실로 답한다.');
});

test('J2-② 지난 턴의 **성공**은 표식이 안 붙는다 — 전부 미확인으로 만들지 않는다', () => {
  const tc = buildTaskContext({
    intent: interpret('아까 뭐 읽었지?'),
    selfState,
    receipts: [],
    priorExchange: [{ summary: '정산.csv 를 읽었어요.', tool: 'local.file', ref: 'c1' }],
  });
  const 몸통 = 와이어들(tc)[0].몸통;
  const 자리 = 몸통.indexOf('정산.csv 를 읽었어요');
  assert.notEqual(자리, -1, '앞 턴 줄 자체가 없다');
  assert.doesNotMatch(몸통.slice(자리, 자리 + 60), /미확인/,
    '성공한 앞 턴에 미확인 표식이 붙었다 — 반대쪽으로 넘어갔다');
});

test('J2-③ 앞 턴 실패의 **결과 원문은 그대로 안 싣는다** — 기존 계약(E1)을 안 깬다', () => {
  const tc = buildTaskContext({
    intent: interpret('아까 그거 어떻게 됐어?'),
    selfState,
    receipts: [],
    priorExchange: [{ ...앞턴실패, data: '내부원문표식ZZ', 실패원문: '내부원문표식ZZ' }],
  });
  const p = (tc.priorExchange ?? [])[0];
  assert.equal(p.data, undefined, '앞 턴 결과 원문이 실렸다 — E1 계약 위반');
  assert.equal(p.실패원문, undefined, '앞 턴 실패 원문이 실렸다 — E1 계약 위반');
  for (const { 이름, 몸통 } of 와이어들(tc)) {
    assert.doesNotMatch(몸통, /내부원문표식ZZ/, `앞 턴 원문이 와이어로 샜다(${이름})`);
  }
});

// ── J3. 공급자마다 다른 사실을 받는다 ───────────────────────────────────────

test('J3 와이어 넷이 **같은 사실**을 싣는다 — 계정 경로만 실패를 못 보는 일이 없다', () => {
  const tc = buildTaskContext({
    intent: interpret('카카오톡 창을 앞으로 띄워줘'),
    selfState,
    receipts: [{
      intended: '창 앞으로',
      actualCall: { tool: 'desktop.act', args: { action: 'focus', app: 'KakaoTalk' } },
      failureState: 'failed',
      userSafeSummary: '그 창을 앞으로 못 옮겼어요.',
      diagnosticTrace: { 오류: 'AXUIElementPerformAction kAXErrorCannotComplete (-25204)' },
      nextSafeAction: '창을 직접 눌러 주시면 이어서 할 수 있어요.',
    }],
  });
  for (const 조각 of ['kAXError', '확인 안 됨', 'failed']) {
    assert.deepEqual(떨어뜨린곳(tc, 조각), [],
      `**같은 실패인데 와이어마다 다른 사실을 받는다** — 빠진 조각: ${조각}`);
  }
});
