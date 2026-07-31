// P-STR-1 · 답변 토큰 스트리밍 검증. 실 API 미호출.
// 핵심: ①onDelta 없이도 기존과 동일 ②조각 순서대로 흘리고 합계=최종 텍스트 ③델타는 durable 에
// 안 남는다(EventLog 폭증 금지) ④조각이 안 와도 동작 동일 ⑤사용자면 텍스트만(사고 원문 미노출).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeChatGptModelClient, readTextStream, accumulateResponsesText, textDeltaFromLine } from '../src/runtime/chatgpt-model-client.js';
import { makeProviderModelClient, resolveModelConfigFromInput } from '../src/runtime/model-provider.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { makeModelConnection, ModelConnectionStore } from '../src/surface/model-connection.js';

const TC = {
  currentRequest: '안녕', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'fast_chat', naturalness: 'method_and_language_open',
};

/** 여러 청크로 쪼개 흘려보내는 가짜 응답 본문(경계가 줄 중간에서 끊기는 경우 포함). */
function bodyOf(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }),
    }),
  };
}

const CODEX_LINES = [
  'data: {"type":"response.output_text.delta","delta":"안녕"}\n',
  'data: {"type":"response.output_text.delta","delta":"하세"}\n',
  'data: {"type":"response.output_text.delta","delta":"요"}\n',
  'data: {"type":"response.completed"}\n',
  'data: [DONE]\n',
];

// ── SSE 증분 읽기 ─────────────────────────────────────────────────────────
test('readTextStream: 조각을 순서대로 흘리고, 합계가 최종 텍스트와 같다', async () => {
  const seen = [];
  const text = await readTextStream(bodyOf(CODEX_LINES), (t) => seen.push(t));
  assert.deepEqual(seen, ['안녕', '하세', '요']);
  assert.equal(text, '안녕하세요');
  assert.equal(seen.join(''), text, '미리보기 합계 = 진실');
});

test('readTextStream: 줄이 청크 경계에서 잘려도 이어 붙여 파싱한다', async () => {
  const seen = [];
  const chopped = ['data: {"type":"response.output_te', 'xt.delta","delta":"조각"}\n', 'data: [DONE]\n'];
  const text = await readTextStream(bodyOf(chopped), (t) => seen.push(t));
  assert.deepEqual(seen, ['조각']);
  assert.equal(text, '조각');
});

test('readTextStream: 마지막 SSE 이벤트에 개행이 없어도 버리지 않는다', async () => {
  const seen = [];
  const noTrailingNewline = ['data: {"type":"response.output_text.delta","delta":"마지막"}'];
  const text = await readTextStream(bodyOf(noTrailingNewline), (t) => seen.push(t));
  assert.equal(text, '마지막');
  assert.deepEqual(seen, ['마지막']);
});

test('textDeltaFromLine: 사용자면 텍스트만 뽑는다(사고·도구 이벤트는 흘리지 않는다)', () => {
  assert.equal(textDeltaFromLine('data: {"type":"response.reasoning.delta","delta":"내부사고"}'), null);
  assert.equal(textDeltaFromLine('data: {"type":"response.function_call_arguments.delta","delta":"{\\"a\\":1}"}'), null);
  assert.equal(textDeltaFromLine('data: {"type":"response.output_text.delta","delta":"보임"}'), '보임');
  assert.equal(textDeltaFromLine('event: ping'), null);
});

test('accumulateResponsesText: 델타가 있으면 completed 폴백을 중복 사용하지 않는다', () => {
  const withBoth = CODEX_LINES.join('') + 'data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"안녕하세요"}]}]}}\n';
  assert.equal(accumulateResponsesText(withBoth), '안녕하세요'); // 두 번 붙지 않는다
});

// ── 어댑터 계약 ───────────────────────────────────────────────────────────
test('ChatGPT 어댑터: onDelta 를 주면 흘리고, 안 주면 기존처럼 완성문만 반환한다', async () => {
  const fetchImpl = async () => ({ status: 200, body: bodyOf(CODEX_LINES), text: async () => CODEX_LINES.join('') });
  const client = makeChatGptModelClient({ credentials: async () => ({ access: 'at' }), fetchImpl });
  const seen = [];
  assert.equal(await client.respond(TC, { onDelta: (t) => seen.push(t) }), '안녕하세요');
  assert.equal(seen.length, 3);
  assert.equal(await client.respond(TC), '안녕하세요'); // onDelta 없이도 동일(계약 파괴 없음)
});

test('OpenAI 계열 어댑터(호환 서버·OpenAI): stream:true 로 요청하고 delta.content 를 흘린다', async () => {
  const calls = [];
  const lines = [
    'data: {"choices":[{"delta":{"content":"실"}}]}\n',
    'data: {"choices":[{"delta":{"content":"모델"}}]}\n',
    'data: [DONE]\n',
  ];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, body: bodyOf(lines), text: async () => lines.join('') };
  };
  const cfg = resolveModelConfigFromInput({ provider: 'openai_compatible', key: 'k', modelId: 'llama3.3', baseUrl: 'http://localhost:11434/v1' });
  const client = makeProviderModelClient(cfg, { fetchImpl });
  const seen = [];
  assert.equal(await client.respond(TC, { onDelta: (t) => seen.push(t) }), '실모델');
  assert.deepEqual(seen, ['실', '모델']);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.stream, true);
  assert.equal(calls[0].init.headers.accept, 'text/event-stream');
});

test('OpenAI 계열: onDelta 가 없으면 스트림을 쓰지 않는다(기존 단발 경로 유지)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return { status: 200, json: async () => ({ choices: [{ message: { content: '단발' } }] }) };
  };
  const cfg = resolveModelConfigFromInput({ provider: 'beai', key: 'k' });
  assert.equal(await makeProviderModelClient(cfg, { fetchImpl }).respond(TC), '단발');
  assert.equal(calls[0].stream, undefined);
});

test('스트림이 텍스트를 하나도 못 주면 빈 답을 성공처럼 돌려주지 않는다', async () => {
  const fetchImpl = async () => ({ status: 200, body: bodyOf(['data: [DONE]\n']), text: async () => '' });
  const cfg = resolveModelConfigFromInput({ provider: 'beai', key: 'k' });
  await assert.rejects(
    () => makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: () => {} }),
    (e) => e.name === 'ModelProviderError',
  );
});

test('onDelta 가 던져도 응답은 깨지지 않는다(화면 갱신 실패가 대화를 죽이지 않는다)', async () => {
  const fetchImpl = async () => ({ status: 200, body: bodyOf(CODEX_LINES), text: async () => CODEX_LINES.join('') });
  const client = makeChatGptModelClient({ credentials: async () => ({ access: 'at' }), fetchImpl });
  assert.equal(await client.respond(TC, { onDelta: () => { throw new Error('render fail'); } }), '안녕하세요');
});

// ── durable 경계 ──────────────────────────────────────────────────────────
test('실제 스트림 턴: 조각은 화면으로 흐르지만 EventLog(durable)에는 안 쌓인다', async () => {
  // 토큰마다 append 하면 §6.21 후속의 "EventLog 무한 성장"을 우리가 직접 만드는 셈이다.
  // 진실은 지속된 완성 결과 하나뿐 — 조각은 비지속 미리보기.
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-str-'));
  const lines = ['data: {"choices":[{"delta":{"content":"흐"}}]}\n', 'data: {"choices":[{"delta":{"content":"른다"}}]}\n', 'data: [DONE]\n'];
  const fetchImpl = async (url) => {
    if (url.includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'llama3.3' }] }) };
    return { status: 200, body: bodyOf(lines), text: async () => lines.join('') };
  };
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl });
  // beai 는 스트리밍 미지원(실측) — 스트림 계약 검증에는 스트리밍되는 provider 를 쓴다.
  await mc.connect({ provider: 'openai_compatible', key: 'k', modelId: 'llama3.3', baseUrl: 'http://localhost:11434/v1' });
  const sessionStore = new SessionStore(dir);
  const eventLog = new EventLog(dir);
  const server = makeServer({ store: sessionStore, eventLog, env, model: mc.model, modelConnection: mc });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const start = await (await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    })).json();
    const sse = await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();

    // 화면으로는 조각이 흘렀다
    assert.ok(sse.includes('event: answer_delta'), '조각이 스트림으로 나간다');
    assert.ok(sse.includes('"흐"') && sse.includes('"른다"'));
    assert.ok(sse.includes('event: complete'));

    // durable 에는 조각이 없다
    const durable = await eventLog.since(s.id, 0);
    assert.ok(durable.length > 0, 'durable 이벤트 자체는 있다(trace_status·complete)');
    assert.equal(durable.filter((e) => e.type === 'answer_delta').length, 0, '조각은 durable 에 안 남는다');

    // 진실은 지속된 완성 결과 하나
    const saved = await sessionStore.load(s.id);
    const last = saved.transcript[saved.transcript.length - 1];
    assert.equal(last.role, 'assistant');
    assert.equal(last.result.reply, '흐른다');
  } finally { await new Promise((r) => server.close(r)); }
});

// ── P0-3: 전 provider 스트리밍 (능력 일관성 — 모델을 바꿔도 체감이 같아야 한다) ──
test('anthropic: stream:true 로 요청하고 content_block_delta 만 흘린다', async () => {
  const lines = [
    'data: {"type":"message_start","message":{"id":"m1"}}\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}\n',
    'data: {"type":"ping"}\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"하세요"}}\n',
    'data: {"type":"message_stop"}\n',
  ];
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, body: bodyOf(lines) }; };
  const cfg = resolveModelConfigFromInput({ provider: 'anthropic', key: 'sk-ant-x' });
  const seen = [];
  const text = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: (t) => seen.push(t) });
  assert.equal(text, '안녕하세요');
  assert.deepEqual(seen, ['안녕', '하세요'], 'message_start·ping 같은 비텍스트 이벤트는 흘리지 않는다');
  assert.equal(JSON.parse(calls[0].init.body).stream, true);
  assert.ok(calls[0].url.endsWith('/v1/messages'));
});

test('gemini: 별도 엔드포인트(:streamGenerateContent&alt=sse)로 흘린다', async () => {
  const lines = [
    'data: {"candidates":[{"content":{"parts":[{"text":"제미"}]}}]}\n',
    'data: {"candidates":[{"content":{"parts":[{"text":"나이"}]}}]}\n',
  ];
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, body: bodyOf(lines) }; };
  const cfg = resolveModelConfigFromInput({ provider: 'gemini', key: 'g-1' });
  const seen = [];
  const text = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: (t) => seen.push(t) });
  assert.equal(text, '제미나이');
  assert.deepEqual(seen, ['제미', '나이']);
  assert.ok(calls[0].url.includes(':streamGenerateContent'), '단발 엔드포인트로 가면 안 된다');
  assert.ok(calls[0].url.includes('alt=sse'));
});

test('능력 일관성: 모든 provider 가 스트리밍하거나, 못 하면 명시적으로 선언돼 있다', async () => {
  const { MODEL_PROVIDERS } = await import('../src/runtime/model-provider.js');
  // 실측으로 확인된 미지원(beai V1: 400 "Streaming is not supported")은 streaming:false 로 **명시**한다.
  // 선언 없이 조용히 빠지면 "왜 이 모델만 느리지?"를 아무도 설명 못 한다.
  const unclear = Object.entries(MODEL_PROVIDERS)
    .filter(([, spec]) => (typeof spec.streamBody !== 'function' || typeof spec.streamDelta !== 'function')
      && spec.streaming !== false)
    .map(([id]) => id);
  assert.deepEqual(unclear, [], `스트리밍 여부가 불분명한 provider: ${unclear.join(', ')}`);
});

test('스트리밍 미지원 provider 는 onDelta 를 줘도 단발로 돈다(켜서 깨뜨리지 않는다)', async () => {
  // 실사용 사고: beai 에 stream:true 를 보내자 400 으로 **응답 자체가 실패**했다.
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return { status: 200, json: async () => ({ choices: [{ message: { content: '단발 응답' } }] }) };
  };
  const cfg = resolveModelConfigFromInput({ provider: 'beai', key: 'k' });
  const text = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: () => {} });
  assert.equal(text, '단발 응답');
  assert.notEqual(bodies[0].stream, true, 'stream 을 켜면 beai V1 은 400 으로 깨진다');
});

test('onDelta 없이 호출하면 provider 무관하게 단발 경로를 쓴다(계약 파괴 없음)', async () => {
  for (const [provider, key] of [['anthropic', 'k'], ['gemini', 'k'], ['beai', 'k']]) {
    const bodies = [];
    const fetchImpl = async (url, init) => {
      bodies.push(JSON.parse(init.body));
      return { status: 200, json: async () => ({
        content: [{ type: 'text', text: '단발' }],
        candidates: [{ content: { parts: [{ text: '단발' }] } }],
        choices: [{ message: { content: '단발' } }],
      }) };
    };
    const cfg = resolveModelConfigFromInput({ provider, key });
    assert.equal(await makeProviderModelClient(cfg, { fetchImpl }).respond(TC), '단발', provider);
    assert.notEqual(bodies[0].stream, true, `${provider}: onDelta 없으면 stream 을 켜지 않는다`);
  }
});

// ── 빈 답을 사용자에게 돌려주지 않는다 (H 진단 계열 ③ · P1) ────────────────
//
// 라이브 진단에서 25턴 중 7턴이 **빈 답**이었다. `kind: reply` 인데 본문이 없고, 도구·능력·
// 승인 경로도 아니었다. 그리고 그 요청은 **다음 턴 답에 합쳐져** 나왔다 — 사용자는 한 번
// 무시당하고, 다음 턴에 엉뚱하게 두 개를 한꺼번에 받는다.
//
// 원인은 하나다. 빠른 경로가 모델이 준 텍스트를 **빈 것인지 보지 않고 그대로 돌려줬다.**
// 모델이 그 턴을 통제 호출(기억 제안·철회 등)에만 쓰고 텍스트를 안 내면 그대로 빈 답이 된다.
// 도구 경로에는 재시도가 있었는데 빠른 경로에는 없었다 — **최종 답을 만드는 자리가 둘인데
// 계약이 하나가 아니었다.**
import { test as 시험 } from 'node:test';
import assert2 from 'node:assert/strict';
import { mkdtemp as mkdtemp2 } from 'node:fs/promises';
import { tmpdir as tmpdir2 } from 'node:os';
import { join as join2 } from 'node:path';
import { makeServer as makeServer2 } from '../src/surface/server.js';
import { SessionStore as SessionStore2 } from '../src/surface/session-store.js';
import { demoTools as demoTools2 } from '../src/surface/demo-context.js';

시험('통제 호출만 낸 턴도 사용자에게 빈 답을 주지 않는다', async () => {
  const dir = await mkdtemp2(join2(tmpdir2(), 'gpao-t5-empty-'));
  const 받은옵션 = [];
  let 호출 = 0;
  const model = {
    async respond(tc, opts = {}) {
      호출 += 1;
      받은옵션.push({ 도구있음: Boolean(opts.tools?.length), onDelta있음: Boolean(opts.onDelta) });
      // 첫 호출: 기억만 적고 **텍스트는 안 낸다**(라이브에서 실제로 이렇게 왔다).
      if (호출 === 1) {
        return { text: '', toolCalls: [{ name: 'memory.propose', args: {
          kind: 'preference', statement: '이번만 줄글로 길게 써줘.',
          evidence: { utteranceQuote: '이번만 줄글로 길게 써줘.', speechAct: 'declaration', appliesTo: 'this_turn_only' },
        } }] };
      }
      return '알겠어요, 줄글로 길게 쓸게요.';
    },
  };
  const server = makeServer2({ store: new SessionStore2(dir), tools: demoTools2(), model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
  try {
    const s = await post('/sessions');
    const r = await post('/turn', { sessionId: s.id, text: '이번만 줄글로 길게 써줘.' });
    assert2.ok(String(r.reply ?? '').trim(), '사용자가 빈 답을 받았다');
    assert2.ok(호출 >= 2, '텍스트가 없으면 한 번 더 물어야 한다');

    // **재시도는 도구 없이 간다.** 다시 쥐여 주면 또 고르고 또 텍스트가 없을 수 있다.
    assert2.equal(받은옵션.at(-1).도구있음, false, '재시도에 도구를 다시 줬다');

    // **그리고 같은 스트리밍 계약을 쓴다.** `/turn` 에는 조각 통로가 아예 없으니(단발 경로)
    // 계약은 조각이 흐르는 자리에서 재야 한다 — 화면이 쓰는 스트림 경로다. 여기서 빠지면
    // 하필 제일 오래 기다린 답만 조각으로 안 흐른다.
    호출 = 0; 받은옵션.length = 0;
    const s2 = await post('/sessions');
    const st = await post('/turn/stream-start', { sessionId: s2.id, text: '이번만 줄글로 길게 써줘.' });
    await fetch(`${base}/turn/stream?sessionId=${s2.id}&streamId=${st.streamId}`).then((r) => r.text());
    assert2.equal(받은옵션.at(-1).onDelta있음, true, '재시도가 스트리밍 계약 밖에 있다');
  } finally { await new Promise((r) => server.close(r)); }
});
