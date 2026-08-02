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

// ── H 진단 계열 ④ · 도구를 쥔 턴의 스트리밍 (P1) ─────────────────────────────
//
// 라이브 진단에서 25턴 전부 `answer_delta` 가 0 이었다. provider(openai/gpt-5.1)는 스트리밍이
// 되는데, T5 는 거의 모든 턴에 도구(통제 채널 포함)를 주고, 게이트가 `!opts.tools?.length` 로
// 도구 턴의 스트리밍을 전부 막았다 — 사용자는 최대 22.9초 동안 답을 한 글자도 못 봤다.
//
// 함정: `OPENAI_WIRE.streamBody` 는 opts 를 안 받았다. 게이트만 걷으면 **스트리밍 요청에서
// 도구 스키마가 사라진다.** 그래서 이 계약은 넷을 함께 잰다 — ① 스트리밍 본문에 비스트리밍과
// 같은 도구 스키마 ② `tool_calls` 조각의 index 별 누적(분할 arguments·복수 도구) ③ 도구만
// 고른 응답은 빈 답이 아니다 ④ 파서 없는 provider 는 가장하지 않고 단발 유지.
import { MODEL_PROVIDERS as 전체와이어, buildModelMessages as 메시지로 } from '../src/runtime/model-provider.js';

const 계열4도구 = [
  { name: 'local.file', description: '파일 손', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'memory.propose', description: '기억 제안', parameters: { type: 'object', properties: { statement: { type: 'string' } } } },
];
const 도구조각 = (index, fn) => `data: {"choices":[{"delta":{"tool_calls":[${JSON.stringify({ index, ...fn })}]}}]}\n`;

test('계열④: 스트리밍 본문에 비스트리밍과 동일한 도구 스키마가 실린다', async () => {
  const calls = [];
  const lines = ['data: {"choices":[{"delta":{"content":"조각"}}]}\n', 'data: [DONE]\n'];
  const fetchImpl = async (url, init) => { calls.push(JSON.parse(init.body)); return { status: 200, body: bodyOf(lines) }; };
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k' });
  const seen = [];
  const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: (t) => seen.push(t), tools: 계열4도구 });
  assert.equal(calls[0].stream, true, '도구를 줘도 스트리밍으로 나간다');
  const 단발 = JSON.parse(전체와이어.openai.body(cfg, 메시지로(TC), { tools: 계열4도구 }));
  assert.deepEqual(calls[0].tools, 단발.tools, '스트리밍 본문의 도구 스키마 = 비스트리밍 본문의 도구 스키마');
  assert.deepEqual(seen, ['조각'], '텍스트 조각은 즉시 흐른다');
  assert.equal(out.text, '조각');
  assert.deepEqual(out.toolCalls, [], '도구를 안 고른 스트림은 빈 호출 목록');
});

test('계열④: 도구만 고른 스트림은 빈 답 오류가 아니고, 분할 arguments 를 완성해 정확히 한 번 반환한다', async () => {
  const lines = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
    도구조각(0, { id: 'call_1', type: 'function', function: { name: 'memory_propose', arguments: '' } }),
    도구조각(0, { function: { arguments: '{"statement":"줄글' } }),
    도구조각(0, { function: { arguments: '로"}' } }),
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
    'data: [DONE]\n',
  ];
  const fetchImpl = async () => ({ status: 200, body: bodyOf(lines) });
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k' });
  const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: () => {}, tools: 계열4도구 });
  assert.equal(out.text, '');
  assert.deepEqual(out.toolCalls, [{ name: 'memory.propose', args: { statement: '줄글로' } }],
    '와이어 이름을 커널 이름으로 되돌리고, 조각난 인자를 완성한다');
});

test('계열④: 텍스트와 도구가 함께 온 스트림은 둘 다 보존한다', async () => {
  const lines = [
    'data: {"choices":[{"delta":{"content":"잠깐 "}}]}\n',
    도구조각(0, { id: 'c1', type: 'function', function: { name: 'local_file', arguments: '{"path":"a.txt"}' } }),
    'data: {"choices":[{"delta":{"content":"볼게요."}}]}\n',
    'data: [DONE]\n',
  ];
  const fetchImpl = async () => ({ status: 200, body: bodyOf(lines) });
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k' });
  const seen = [];
  const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: (t) => seen.push(t), tools: 계열4도구 });
  assert.equal(out.text, '잠깐 볼게요.');
  assert.deepEqual(seen, ['잠깐 ', '볼게요.']);
  assert.deepEqual(out.toolCalls, [{ name: 'local.file', args: { path: 'a.txt' } }]);
});

test('계열④: 복수 도구를 index 별로 나눠 누적한다(섞여 와도)', async () => {
  const lines = [
    도구조각(0, { id: 'c1', type: 'function', function: { name: 'local_file', arguments: '{"pa' } }),
    도구조각(1, { id: 'c2', type: 'function', function: { name: 'memory_propose', arguments: '{"stat' } }),
    도구조각(0, { function: { arguments: 'th":"b.txt"}' } }),
    도구조각(1, { function: { arguments: 'ement":"둘"}' } }),
    'data: [DONE]\n',
  ];
  const fetchImpl = async () => ({ status: 200, body: bodyOf(lines) });
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k' });
  const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: () => {}, tools: 계열4도구 });
  assert.deepEqual(out.toolCalls, [
    { name: 'local.file', args: { path: 'b.txt' } },
    { name: 'memory.propose', args: { statement: '둘' } },
  ]);
});

test('계열④: 깨진 arguments 는 그 호출만 버린다(반쪽 인자로 실행하지 않는다)', async () => {
  const lines = [
    'data: {"choices":[{"delta":{"content":"답은 남는다"}}]}\n',
    도구조각(0, { id: 'c1', type: 'function', function: { name: 'local_file', arguments: '{"path":' } }), // 미완 JSON
    도구조각(1, { id: 'c2', type: 'function', function: { name: 'memory_propose', arguments: '{"statement":"산다"}' } }),
    'data: [DONE]\n',
  ];
  const fetchImpl = async () => ({ status: 200, body: bodyOf(lines) });
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k' });
  const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: () => {}, tools: 계열4도구 });
  assert.equal(out.text, '답은 남는다');
  assert.deepEqual(out.toolCalls, [{ name: 'memory.propose', args: { statement: '산다' } }]);
});

test('계열④: 중복 완료 이벤트가 와도 텍스트·도구는 정확히 한 번이다', async () => {
  const lines = [
    'data: {"choices":[{"delta":{"content":"한 번"}}]}\n',
    도구조각(0, { id: 'c1', type: 'function', function: { name: 'local_file', arguments: '{"path":"x"}' } }),
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
    'data: [DONE]\n',
    'data: [DONE]\n',
  ];
  const fetchImpl = async () => ({ status: 200, body: bodyOf(lines) });
  const cfg = resolveModelConfigFromInput({ provider: 'openai', key: 'k' });
  const seen = [];
  const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: (t) => seen.push(t), tools: 계열4도구 });
  assert.deepEqual(seen, ['한 번']);
  assert.equal(out.toolCalls.length, 1, '완료 이벤트가 겹쳐도 도구 호출은 하나다');
});

test('계열④: 도구 스트림 파서가 없는 provider 는 가장하지 않고 단발을 유지한다', async () => {
  // openai 와이어만 고쳤다 — anthropic·gemini 는 tool_call 조각 파서가 없으므로 도구 턴은
  // 단발로 남는다. 이걸 "전체 provider 스트리밍"이라고 말하는 순간 그 말이 거짓이 된다.
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
    const out = await makeProviderModelClient(cfg, { fetchImpl }).respond(TC, { onDelta: () => {}, tools: 계열4도구 });
    assert.equal(out.text, '단발', provider);
    assert.notEqual(bodies[0].stream, true, `${provider}: 도구 턴을 스트리밍으로 가장하면 도구 스키마가 사라진다`);
    assert.ok(bodies[0].tools ?? bodies[0].tools?.length !== 0, `${provider}: 도구 스키마가 실려야 한다`);
  }
});

// ── 계열 ④ · 제품 SSE 경로 — 이벤트 순서와 미리보기=최종 답 계약 ──────────────
import { demoTools as 제품도구, demoEnv as 제품환경 } from '../src/surface/demo-context.js';

/** SSE 원문에서 answer_delta 조각을 순서대로 모은다. */
const 조각누적 = (sse) => [...sse.matchAll(/event: answer_delta\ndata: (.*)\n/g)]
  .map((m) => JSON.parse(m[1]).text).join('');

async function 제품서버로(fetchImpl, tools) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-str4-'));
  // demo 환경을 그대로 쓴다 — 손(연결된 도구)이 있어야 제품처럼 도구 스키마가 매 턴 실린다.
  const env = 제품환경();
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl });
  await mc.connect({ provider: 'openai_compatible', key: 'k', modelId: 'llama3.3', baseUrl: 'http://localhost:11434/v1' });
  const sessionStore = new SessionStore(dir);
  const eventLog = new EventLog(dir);
  const server = makeServer({ store: sessionStore, eventLog, env, model: mc.model, modelConnection: mc, tools });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, sessionStore };
}

test('계열④ 제품 경로: 도구가 붙은 일반 턴도 answer_delta 가 complete 전에 오고, 미리보기 누적 = 저장된 최종 답', async () => {
  const 모델요청 = [];
  const lines = ['data: {"choices":[{"delta":{"content":"안"}}]}\n', 'data: {"choices":[{"delta":{"content":"녕하세요!"}}]}\n', 'data: [DONE]\n'];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'llama3.3' }] }) };
    모델요청.push(JSON.parse(init.body));
    return { status: 200, body: bodyOf(lines), json: async () => ({ choices: [{ message: { content: '안녕하세요!' } }] }) };
  };
  const { server, base, sessionStore } = await 제품서버로(fetchImpl, 제품도구());
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const start = await (await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    })).json();
    const sse = await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();

    // 이 턴의 모델 요청에는 도구가 실려 있었고(제품 현실), 그런데도 스트리밍으로 나갔다.
    assert.ok(모델요청.some((b) => b.tools?.length && b.stream === true), '도구를 쥔 제품 턴이 스트리밍으로 나가지 않았다');
    const 첫조각 = sse.indexOf('event: answer_delta');
    const 완료 = sse.indexOf('event: complete');
    assert.ok(첫조각 >= 0, 'answer_delta 가 한 번도 오지 않았다(계열 ④ 재발)');
    assert.ok(첫조각 < 완료, 'answer_delta 는 complete 보다 먼저 와야 한다');

    const saved = await sessionStore.load(s.id);
    const last = saved.transcript[saved.transcript.length - 1];
    assert.equal(last.result.reply, 조각누적(sse), '미리보기 누적문과 지속된 최종 답이 다르다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('계열④ 제품 경로: 도구를 고른 턴 — 도구 실행 정확히 1회, 조각으로 흐른 말은 버려지지 않는다', async () => {
  let 모델호출 = 0;
  const 첫턴 = [
    'data: {"choices":[{"delta":{"content":"잠깐 볼게요."}}]}\n',
    도구조각(0, { id: 'c1', type: 'function', function: { name: 'session_search', arguments: '{"query":"지난 얘기"}' } }),
    'data: [DONE]\n',
  ];
  const 마무리 = ['data: {"choices":[{"delta":{"content":"찾아봤어요."}}]}\n', 'data: [DONE]\n'];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'llama3.3' }] }) };
    모델호출 += 1;
    const lines = 모델호출 === 1 ? 첫턴 : 마무리;
    return { status: 200, body: bodyOf(lines), json: async () => ({ choices: [{ message: { content: '찾아봤어요.' } }] }) };
  };
  const 도구함 = 제품도구();
  const 실행된 = [];
  const 원래run = 도구함.run.bind(도구함);
  도구함.run = async (id, args, ss) => { 실행된.push(id); return 원래run(id, args, ss); };
  const { server, base, sessionStore } = await 제품서버로(fetchImpl, 도구함);
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const start = await (await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    })).json();
    const sse = await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();

    assert.deepEqual(실행된.filter((id) => id === 'session.search'), ['session.search'], '도구 실행은 정확히 한 번이다');
    const saved = await sessionStore.load(s.id);
    const last = saved.transcript[saved.transcript.length - 1];
    assert.ok(조각누적(sse).length > 0, '조각이 흐르지 않았다');
    assert.equal(last.result.reply, 조각누적(sse), '화면에 이미 나간 말과 저장된 답이 갈렸다');
    assert.ok(String(last.result.reply).includes('잠깐 볼게요.'), '도구를 고르며 이미 한 말을 버렸다');
    assert.ok(String(last.result.reply).includes('찾아봤어요.'), '도구 실행 뒤 최종 답이 빠졌다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('계열④ 제품 경로: 조각을 못 주는 모델도 최종 답이 complete 전에 조각으로 도착한다', async () => {
  // 스트리밍 파서가 없는 provider 는 와이어를 가장하지 않는다(단발 유지). 그래도 **표면 계약은
  // 같다** — 답이 정해지는 순간 그 전체가 한 조각으로 흐르고, 미리보기 누적 = 지속된 답이다.
  const { mkdtemp: mkdtempD } = await import('node:fs/promises');
  const dir = await mkdtempD(join(tmpdir(), 'gpao-t5-str4single-'));
  const sessionStore = new SessionStore(dir);
  const server = makeServer({ store: sessionStore, tools: 제품도구(), model: { respond: async () => '단발 답이에요.' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const start = await (await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    })).json();
    const sse = await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();
    const 첫조각 = sse.indexOf('event: answer_delta');
    assert.ok(첫조각 >= 0 && 첫조각 < sse.indexOf('event: complete'), '최종 답이 완료 전에 조각으로 도착해야 한다');
    const saved = await sessionStore.load(s.id);
    assert.equal(saved.transcript[saved.transcript.length - 1].result.reply, 조각누적(sse));
  } finally { await new Promise((r) => server.close(r)); }
});

test('계열④ 제품 경로: 서버 후처리가 답을 늘려도(민감 기억 안내) 미리보기 누적 = 지속된 답', async () => {
  // 커널은 반환 전에 정렬하지만, 민감 기억 안내는 **지속 직전** 서버에서 붙는다. 그 꼬리가
  // 미리보기로 안 흐르면 사용자가 본 것과 저장된 답이 갈린다 — 완료 전에 꼬리를 마저 흘린다.
  const { mkdtemp: mkdtempF } = await import('node:fs/promises');
  const dir = await mkdtempF(join(tmpdir(), 'gpao-t5-str4tail-'));
  const model = {
    async respond(tc, opts = {}) {
      opts.onDelta?.('키 확인했어요.');
      return { text: '키 확인했어요.', toolCalls: [{ name: 'memory.propose', args: {
        kind: 'preference', statement: 'API 키는 sk-abcdEFGH1234567890abcdEFGH 야',
        evidence: { utteranceQuote: 'API 키는 sk-abcdEFGH1234567890abcdEFGH 야', speechAct: 'declaration', appliesTo: 'from_now_on' },
      } }] };
    },
  };
  const sessionStore = new SessionStore(dir);
  const server = makeServer({ store: sessionStore, tools: 제품도구(), model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const start = await (await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '내 API 키 기억해' }),
    })).json();
    const sse = await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();
    const saved = await sessionStore.load(s.id);
    const last = saved.transcript[saved.transcript.length - 1];
    assert.ok(String(last.result.reply).length > '키 확인했어요.'.length, '후처리 안내가 붙는 시나리오여야 한다');
    assert.equal(last.result.reply, 조각누적(sse), '후처리로 늘어난 답이 미리보기와 갈렸다');
  } finally { await new Promise((r) => server.close(r)); }
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
  const 받은문맥 = [];
  let 호출 = 0;
  const model = {
    async respond(tc, opts = {}) {
      호출 += 1;
      받은옵션.push({ 도구있음: Boolean(opts.tools?.length), onDelta있음: Boolean(opts.onDelta) });
      받은문맥.push({ answerOnly: tc.answerOnly, toolBudgetSpent: tc.toolBudgetSpent });
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
    assert2.equal(받은문맥.at(-1).answerOnly, true, '최종 답만 달라는 정직한 상태가 없다');
    assert2.equal(받은문맥.at(-1).toolBudgetSpent, undefined, '실제로 안 쓴 도구 예산을 소진했다고 말했다');

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
