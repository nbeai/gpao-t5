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

test('성공한 실행은 모델 자신의 도구 호출로 간다', () => {
  const tc = tcOf([성공]);
  const x = tc.turnExchange?.[0];
  assert.ok(x, '성공한 실행이 교환에 없다 — 모델은 자기가 한 일을 모른다');
  assert.equal(x.tool, 'local.file');
  assert.deepEqual(x.args, { action: 'read', path: '견적서.md' }, '무엇으로 불렀는지가 그대로여야 한다');
  assert.match(x.data ?? '', /내용 알맹이/, '결과 알맹이가 빠지면 모델이 되묻는다');
});

// ── ② 확인되지 않은 값을 이력에 심지 않는다 ──────────────────────────────
test('실패한 호출은 교환에 넣지 않는다 — 확인되지 않은 인자를 사실로 심지 않는다', () => {
  const tc = tcOf([실패]);
  assert.equal(tc.turnExchange, undefined, '실패한 호출이 모델의 실행 이력이 되면 안 된다');
  const 서술 = JSON.stringify(tc.evidenceFacts);
  assert.match(서술, /그 자리는 밖이에요/, '실패 사실 자체는 남아야 한다');
  assert.doesNotMatch(서술, /\/비밀\/폴더/, '확인되지 않은 절대 경로는 가려서 남긴다');
});

test('부르지도 못한 것은 서술로 남는다', () => {
  const tc = tcOf([못부름]);
  assert.equal(tc.turnExchange, undefined);
  assert.match(JSON.stringify(tc.evidenceFacts), /연결 방식이 없어요/);
});

// ── ③ 같은 사실을 두 번 주지 않는다 ──────────────────────────────────────
test('교환과 서술이 겹치지 않는다', () => {
  const tc = tcOf([성공, 실패, 못부름]);
  assert.equal(tc.turnExchange.length, 1, '성공한 것만 교환으로');
  assert.equal(tc.evidenceFacts.length, 2, '나머지는 서술로');
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

test('실행이 없으면 아무 것도 얹지 않는다(빈 대화를 만들지 않는다)', () => {
  const m = buildModelMessages(tcOf([]));
  assert.deepEqual(m.exchange, []);
  const body = JSON.parse(MODEL_PROVIDERS.openai.body({ modelId: 'm', maxTokens: 100, baseUrl: 'http://x' }, m, { tools: [] }));
  assert.deepEqual(body.messages.map((x) => x.role), ['system', 'user'], '실행이 없는데 도구 대화가 생기면 안 된다');
});
