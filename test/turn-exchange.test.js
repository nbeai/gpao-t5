// **모델이 실제로 부른 것은 모델의 것으로 돌려준다.**
//
// 실측(실모델 gpt-5.1 한 턴 전문, 2026-08-03): 매 호출의 메시지가 `[system, user]` 두 개뿐이었다.
// `tool` 역할도, `assistant` 의 tool_calls 도 없었다 — 도구 결과가 사용자 메시지 안에
// **3인칭 서술**로 들어갔다("179개를 찾았어요. 부른 인자: …").
//
// 모델 입장에서 그건 자기가 한 일이 아니라 남이 알려준 소식이다. 그래서 같은 폴더를 세 번 읽고,
// 실행을 이어가지 못하고, "다음 턴에 하겠다"고 미루고, 하지 않은 일을 했다고 말했다.
// 헌장에 "네가 T5다"라고 적어도 다음 호출에서 자기 행동이 3인칭으로 돌아오면 그 문장은 힘이 없다 —
// **행동 이력이 지워진 존재에게 selfhood 는 없다.**
//
// 이 검사가 지키는 것은 넷이다:
//   ① 성공한 실행은 대화로 간다(서술이 아니라)
//   ② 확인되지 않은 값은 대화 이력에 사실처럼 심지 않는다(실패 호출은 가림이 있는 서술로)
//   ③ 같은 사실을 두 번 주지 않는다(교환과 서술이 겹치지 않는다)
//   ④ **와이어마다 실제로 실린다** — 한 provider 라도 빼면 그쪽은 결과를 통째로 못 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildModelMessages, MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const selfState = buildSelfState(demoEnv());
const intent = { desiredOutcome: '정리', currentRequest: '그거 정리해줘' };
const 성공 = {
  intended: '파일 읽기', failureState: 'none', userSafeSummary: '견적서.md 을(를) 읽었어요.',
  actualCall: { tool: 'local.file', args: { action: 'read', path: '견적서.md' } },
  result: { path: '/집/견적서.md', text: '내용 알맹이' },
};
const 실패 = {
  intended: '파일 지우기', failureState: 'blocked', userSafeSummary: '그 자리는 밖이에요.',
  actualCall: { tool: 'local.file', args: { action: 'delete', path: '/비밀/폴더/x.md' } },
};
const 못부름 = {
  intended: '연결', failureState: 'blocked', userSafeSummary: '연결 방식이 없어요.', actualCall: null,
};
const tcOf = (receipts) => buildTaskContext({ intent, selfState, receipts });
// S1 슬라이스(`T5_MODEL_SOVEREIGN=1`)는 실패한 호출을 **서술에서 교환으로 옮긴다**(계약 ②).
// 자리는 옮겨도 성질은 안 바뀐다 — 아래 ② 는 그 성질을 **양팔 모두에서** 잰다.
const 주객회복 = process.env.T5_MODEL_SOVEREIGN === '1';

test('성공한 실행은 모델 자신의 도구 호출로 간다', () => {
  const tc = tcOf([성공]);
  const x = tc.turnExchange?.[0];
  assert.ok(x, '성공한 실행이 교환에 없다 — 모델은 자기가 한 일을 모른다');
  assert.equal(x.tool, 'local.file');
  assert.deepEqual(x.args, { action: 'read', path: '견적서.md' }, '무엇으로 불렀는지가 그대로여야 한다');
  assert.match(x.data ?? '', /내용 알맹이/, '결과 알맹이가 빠지면 모델이 되묻는다');
});

// ── ② 확인되지 않은 값을 이력에 심지 않는다 ──────────────────────────────
test('실패한 호출은 확인되지 않은 인자를 사실로 심지 않는다(자리가 어디든)', () => {
  const tc = tcOf([실패]);
  // ── 자리 (S2 에서 플래그를 내렸다 — 팔이 하나다) ────────────────────────
  // 예전엔 플래그 OFF 에서 `turnExchange === undefined` 를 요구했다. 그러면 모델은 자기가
  // 낸 호출이 **통째로 사라진 것**으로 본다 — 원리 ⑤ 위반이다.
  // A/B 실측(2026-08-03·04)이 방향을 정했다: 실물 이동 성공 A 1/4 vs B 5/7.
  assert.equal(tc.evidenceFacts, undefined, '교환으로 옮겼으면 서술에 또 있으면 안 된다');
  assert.equal(tc.turnExchange?.[0]?.failureState, 'blocked', '실패도 자기 행동으로 돌아와야 한다');
  assert.equal(tc.turnExchange[0].data, undefined, '실패 결과는 확인된 값이 아니다 — 내용을 싣지 않는다');
  // ── 성질 (플래그가 열지 않는 것 · 양팔 공통) ──────────────────────────
  const 전부 = JSON.stringify(tc);
  assert.match(전부, /그 자리는 밖이에요/, '실패 사실 자체는 남아야 한다');
  assert.doesNotMatch(전부, /\/비밀\/폴더/, '확인되지 않은 절대 경로는 가려서 남긴다');
});

// **S2(2026-08-05): 부르지도 못한 것도 모델에게 돌아간다.**
// 예전 계약은 "서술로 남는다"였다. 그런데 모델이 낸 호출이면 그 신분(providerCallId)이 있고,
// 구조로 돌려주지 않으면 모델은 "내가 시킨 게 어디 갔지"를 이을 수 없다.
// **손이 아예 없어서 T5 가 만들어 본 적도 없는 호출**만 서술로 남는다 — 그건 모델의 행동이 아니다.
test('모델이 낸 호출은 못 불렀어도 자기 행동 이력으로 돌아온다', () => {
  const tc = tcOf([{ ...못부름, 제안한호출: { tool: 'x.hand', args: {}, providerCallId: 'call_NX', callRef: 'cN' } }]);
  const x = (tc.turnExchange ?? []).find((e) => e.providerCallId === 'call_NX');
  assert.ok(x, '모델이 낸 호출이 행동 이력에서 사라졌다');
  assert.ok(x.failureState && x.failureState !== 'none', '못 부른 사실이 상태로 안 왔다');
  assert.match(JSON.stringify(tc), /연결 방식이 없어요/, '왜 못 불렀는지가 사라졌다');
});

test('모델이 낸 적 없는 것은 서술로 남는다(모델의 행동이 아니다)', () => {
  const tc = tcOf([못부름]);
  assert.equal(tc.turnExchange, undefined, '모델이 낸 적 없는 것을 모델 행동으로 만들면 안 된다');
  assert.match(JSON.stringify(tc.evidenceFacts), /연결 방식이 없어요/);
});

// ── ③ 같은 사실을 두 번 주지 않는다 ──────────────────────────────────────
test('교환과 서술이 겹치지 않는다', () => {
  const tc = tcOf([성공, 실패, 못부름]);
  // S2: 모델이 낸 호출(성공·실패)은 교환으로, 모델이 낸 적 없는 것(못부름)만 서술로.
  assert.equal(tc.turnExchange.length, 2, '모델이 낸 호출이 교환에 다 안 왔다');
  assert.equal(tc.evidenceFacts.length, 1, '모델이 낸 적 없는 것은 서술로');
  // 셋을 넣었으면 셋이 나온다 — 자리가 갈려도 하나가 증발하면 안 된다.
  assert.equal(tc.turnExchange.length + tc.evidenceFacts.length, 3);
  assert.doesNotMatch(JSON.stringify(tc.evidenceFacts), /견적서\.md 을\(를\) 읽었어요/,
    '같은 실행을 두 자리에서 주면 프롬프트가 두 배가 되고 사실이 두 벌이 된다');
});

// ── ④ 여기가 이 검사의 핵심: 와이어마다 실제로 실린다 ────────────────────
test('모든 provider 와이어가 실행 이력을 실제로 싣는다', () => {
  const m = buildModelMessages(tcOf([성공]));
  const cfg = { modelId: 'm', maxTokens: 100, baseUrl: 'http://x' };
  const 빠진곳 = [];
  for (const [name, spec] of Object.entries(MODEL_PROVIDERS)) {
    if (typeof spec.body !== 'function') continue;
    const body = spec.body(cfg, m, { tools: [] });
    if (!body.includes('내용 알맹이') || !body.includes('견적서.md')) 빠진곳.push(name);
  }
  assert.deepEqual(빠진곳, [], `이 provider 들은 실행 이력을 못 받는다 — 그쪽 사용자만 조용히 눈이 먼다: ${빠진곳.join(', ')}`);
});

// **`MODEL_PROVIDERS` 밖의 와이어도 여기 온다.** ChatGPT 계정 경로는 별도 클라이언트라 위
// 순회에 안 잡혔고, 그래서 교환이 통째로 빠진 채 오래 초록이었다(실측 2026-08-04 — 그 경로
// 사용자만 자기 도구 대화를 못 받았다). 목록형 검사는 목록 밖을 못 본다 — 그 자리를 막는다.
test('ChatGPT 계정 경로(Responses)도 실행 이력을 싣는다', async () => {
  const { responsesInput } = await import('../src/runtime/chatgpt-model-client.js');
  const 실린것 = JSON.stringify(responsesInput(buildModelMessages(tcOf([성공]))));
  assert.ok(실린것.includes('내용 알맹이'), '이 경로 사용자만 결과를 통째로 못 본다');
  assert.ok(실린것.includes('function_call_output'), 'Responses 규약의 결과 아이템이 없다');
  assert.ok(실린것.includes('견적서.md'), '무엇으로 불렀는지가 빠졌다');
});

test('실행이 없으면 아무 것도 얹지 않는다(빈 대화를 만들지 않는다)', () => {
  const m = buildModelMessages(tcOf([]));
  assert.deepEqual(m.exchange, []);
  const body = JSON.parse(MODEL_PROVIDERS.openai.body({ modelId: 'm', maxTokens: 100, baseUrl: 'http://x' }, m, { tools: [] }));
  assert.deepEqual(body.messages.map((x) => x.role), ['system', 'user'], '실행이 없는데 도구 대화가 생기면 안 된다');
});
