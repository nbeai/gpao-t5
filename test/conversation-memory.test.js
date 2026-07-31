// Phase 2-1 · 대화가 이어진다 — 방금 한 말을 기억한다.
//
// 실측 결함: 모델 입력에 이전 턴이 **한 줄도** 없었다. "이 대화 안에서는 너를 윤이라고 기억할게"라고
// 답한 바로 다음 턴에 "이름을 말한 내용이 확인되지 않아요"가 나왔다. 말투가 한 대화 안에서
// 반말↔존댓말로 뒤집히던 것도 같은 원인(매 턴 처음부터 고른다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recentTurns } from '../src/kernel/l1-intent/conversation.js';
import { buildModelMessages, MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// ── 이력 추출: 사람이 읽는 말만, 오래된 것부터 ────────────────────────────
test('사용자 발화와 T5 답을 순서대로 뽑는다', () => {
  const turns = recentTurns([
    { role: 'user', text: '내 이름은 윤이야' },
    { role: 'assistant', result: { reply: '알겠어, 윤.' } },
    { role: 'user', text: '내 이름 뭐야?' },
  ]);
  assert.deepEqual(turns, [
    { role: 'user', text: '내 이름은 윤이야' },
    { role: 'assistant', text: '알겠어, 윤.' },
    { role: 'user', text: '내 이름 뭐야?' },
  ]);
});

test('확인 질문도 대화의 일부다(흐름이 끊기면 같은 걸 또 묻는다)', () => {
  const turns = recentTurns([{ role: 'assistant', result: { kind: 'clarify', question: '어떤 파일로 할까요?' } }]);
  assert.deepEqual(turns, [{ role: 'assistant', text: '어떤 파일로 할까요?' }]);
});

test('진단면·내부 구조는 모델에 넘기지 않는다', () => {
  const turns = recentTurns([
    { role: 'assistant', result: { reply: '했어요', diagnosticTrace: { stack: 'secret' }, ledger: { confirmed: ['x'] } } },
  ]);
  assert.deepEqual(turns, [{ role: 'assistant', text: '했어요' }]);
  assert.ok(!JSON.stringify(turns).includes('secret'));
});

test('길이를 묶는다 — 넘치면 오래된 것부터 버린다(프롬프트 폭주 금지)', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: `발화${i}` }));
  const turns = recentTurns(many, { maxTurns: 6 });
  assert.equal(turns.length, 6);
  assert.equal(turns.at(-1).text, '발화39', '최근 것이 남는다');
  assert.equal(turns[0].text, '발화34');

  const long = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: 'ㄱ'.repeat(500) + i }));
  const bounded = recentTurns(long, { maxChars: 1200 });
  assert.ok(bounded.length <= 3, `상한을 넘겼다: ${bounded.length}`);
});

// ── 와이어: 이력이 진짜 대화 턴으로 실린다 ────────────────────────────────
const tc = {
  currentRequest: '내 이름 뭐야?',
  selfStateFacts: { model: 'm' },
  recentTurns: [{ role: 'user', text: '내 이름은 윤이야' }, { role: 'assistant', text: '알겠어, 윤.' }],
};

test('OpenAI 계열: system → 이력 → 이번 발화 순서로 실린다', () => {
  const m = buildModelMessages(tc);
  const body = JSON.parse(MODEL_PROVIDERS.openai.body({ modelId: 'x', maxTokens: 1 }, m));
  assert.deepEqual(body.messages.map((x) => x.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(body.messages[1].content, '내 이름은 윤이야');
  assert.equal(body.messages.at(-1).content.includes('내 이름 뭐야?'), true);
});

test('Anthropic: 이력이 messages 앞에 붙는다(단발 요청이 아니다)', () => {
  const m = buildModelMessages(tc);
  const body = JSON.parse(MODEL_PROVIDERS.anthropic.body({ modelId: 'x', maxTokens: 1 }, m));
  assert.deepEqual(body.messages.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.equal(body.system.length > 0, true, 'system 은 따로 유지');
});

test('Gemini: assistant 는 model 역할로 바뀐다(벤더 표기 차이)', () => {
  const m = buildModelMessages(tc);
  const body = JSON.parse(MODEL_PROVIDERS.gemini.body({ modelId: 'x', baseUrl: 'https://b' }, m));
  assert.deepEqual(body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(body.contents[1].parts[0].text, '알겠어, 윤.');
});

test('system 역할을 못 받는 서버(beai)도 이력은 대화 턴으로 간다', () => {
  const m = buildModelMessages(tc);
  const body = JSON.parse(MODEL_PROVIDERS.beai.body({ modelId: 'x', noSystemRole: true }, m));
  assert.deepEqual(body.messages.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.ok(body.messages.at(-1).content.includes('내 이름 뭐야?'));
});

test('스트리밍 요청에도 이력이 실린다(스트림만 기억을 잃으면 안 된다)', () => {
  const m = buildModelMessages(tc);
  const body = JSON.parse(MODEL_PROVIDERS.openai.streamBody({ modelId: 'x', maxTokens: 1 }, m));
  assert.equal(body.stream, true);
  assert.equal(body.messages.length, 4);
});

// **모든 소비처**가 이력을 실어야 한다. 와이어만 고치고 계정 경로를 빼먹어 라이브에서만
// 대화가 안 이어졌다(테스트는 초록이었다 — 절대원칙 1).
test('ChatGPT 계정 경로도 이력을 싣는다(라이브에서 실제로 쓰이는 경로)', async () => {
  const { makeChatGptModelClient } = await import('../src/runtime/chatgpt-model-client.js');
  let sent;
  const client = makeChatGptModelClient({
    credentials: async () => ({ access: 't' }),
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(init.body);
      return { status: 200, body: null, text: async () => 'data: {"type":"response.output_text.delta","delta":"네"}\n' };
    },
  });
  await client.respond(tc).catch(() => {}); // 응답 해석 실패는 이 테스트의 관심사가 아니다
  const roles = (sent.input ?? []).map((i) => i.role);
  assert.deepEqual(roles, ['user', 'assistant', 'user'], `계정 경로가 이력을 버렸다: ${JSON.stringify(roles)}`);
  assert.equal(sent.input[1].content[0].type, 'output_text', '모델 발화는 output_text 셰이프여야 한다');
});

test('이력이 없으면 예전과 똑같이 동작한다(첫 턴)', () => {
  const m = buildModelMessages({ currentRequest: '안녕', selfStateFacts: {} });
  const body = JSON.parse(MODEL_PROVIDERS.openai.body({ modelId: 'x', maxTokens: 1 }, m));
  assert.deepEqual(body.messages.map((x) => x.role), ['system', 'user']);
});

// ── 산출물: 서버가 실제로 이력을 넘긴다 (절대원칙 1) ──────────────────────
test('서버 /turn: 두 번째 턴의 모델 입력에 첫 턴이 들어 있다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-conv-'));
  const seen = [];
  const model = {
    async respond(taskContext) {
      seen.push(taskContext.recentTurns ?? []);
      return '네';
    },
  };
  const server = makeServer({ store: new SessionStore(dir), model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const s = await (await post('/sessions', {})).json();
    await (await post('/turn', { sessionId: s.id, text: '내 이름은 윤이야' })).json();
    await (await post('/turn', { sessionId: s.id, text: '내 이름 뭐야?' })).json();

    assert.deepEqual(seen[0], [], '첫 턴은 이력이 없다');
    const names = seen[1].map((t) => `${t.role}:${t.text}`);
    assert.ok(names.includes('user:내 이름은 윤이야'), `둘째 턴에 첫 발화가 없다: ${JSON.stringify(names)}`);
    assert.ok(names.some((n) => n.startsWith('assistant:')), 'T5 가 뭐라고 답했는지도 알아야 한다');
    assert.ok(!names.includes('user:내 이름 뭐야?'), '지금 발화는 이력이 아니라 currentRequest 다(두 번 말하지 않는다)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
