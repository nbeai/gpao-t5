// P-RT-1 · Model Provider Adapter 검증. 실 API를 치지 않는다(fetchImpl 주입).
// 반대 검증(원칙 8): 어댑터의 오류 신호가 kernel classifyModelAuth 로 정확히 갈리는지
// 분류기 실물로 확인한다 — 신호가 어긋나면 이 테스트가 실패해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import {
  resolveModelConfig, makeProviderModelClient, selectLiveModel, buildModelMessages, ModelProviderError,
} from '../src/runtime/model-provider.js';
import { classifyModelAuth } from '../src/kernel/l0-evidence/self-state.js';
import { AUTH_STATE } from '../src/kernel/contracts.js';
import { StubModelClient } from '../src/runtime/model-client.js';
import { ModelTimeoutError } from '../src/runtime/model-timeout.js';
import { liveDeps } from '../src/surface/live-context.js';

const TC = {
  currentRequest: '내일 회의 준비 도와줘',
  selfStateFacts: { readyTools: ['web.read'], limits: [] },
  admittedContext: ['사용자는 오전 회의를 선호'],
  authorityFacts: { needsApproval: ['slack.post'], forbidden: [] },
  answerMode: 'complex_work',
  naturalness: 'method_and_language_open',
  evidenceFacts: [{ intended: 'web.read', failureState: 'none', summary: '자료 3건 확인' }],
};

/** 호출을 기록하고 지정 응답을 주는 fetch 흉내 */
function fakeFetch(status, json) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => json };
  };
  return { impl, calls };
}

test('후속 형식 수정은 현재 요청 바로 앞에서 실제 답을 요구한다', () => {
  const built = buildModelMessages({
    ...TC,
    currentRequest: '이번엔 표 말고 한 문장으로 말해줘.',
    recentTurns: [
      { role: 'user', text: '7월 수치를 표로 정리해줘.' },
      { role: 'assistant', text: '| 항목 | 값 |' },
    ],
  });
  assert.match(built.system, /이번 답의 완료 기준/);
  assert.match(built.system, /확인이나 예고만으로 한 턴을 소비하지 않는다/);
  // S1(2026-08-05): 예전엔 둘이 **한 문자열**이라 "요청보다 앞에 있는가"를 인덱스로 쟀다.
  // 이제 커널이 쓴 사실은 system, 사용자가 한 말은 user 로 갈렸다 —
  // **순서는 구조가 보장한다**(system 은 언제나 user 앞이다). 대신 갈림 자체를 잰다.
  assert.equal(built.user.trim(), '이번엔 표 말고 한 문장으로 말해줘.',
    '사용자 메시지에 커널이 쓴 것이 섞였다');
});

test('현재 행동 귀속 판정은 후보와 이번 요청을 모델 입력에 실제로 싣는다', () => {
  const built = buildModelMessages({
    ...TC,
    currentActionAssessment: {
      userRequest: '실제로 끝났어?',
      candidates: [{ index: 0, tool: 'local.file', args: { action: 'delete', path: '옛.csv' } }],
    },
  });
  assert.match(built.system, /이번 요청의 행동 판정/);
  assert.match(built.system, /실제로 끝났어/);
  assert.match(built.system, /local\.file/);
  assert.match(built.system, /옛\.csv/);
  assert.match(built.system, /현재 요청이 지금 요구한 후보의 번호만/);
  assert.match(built.system, /이전 턴의 미완료 행동은 고르지 않는다/);
});

// ── env 해석 ──────────────────────────────────────────────────────────────
test('resolveModelConfig: 자격이 하나도 없으면 미구성(null)', () => {
  assert.equal(resolveModelConfig({}), null);
});

test('resolveModelConfig: ANTHROPIC_API_KEY → anthropic + 기본 claude-opus-4-8', () => {
  const cfg = resolveModelConfig({ ANTHROPIC_API_KEY: 'sk-a' });
  assert.equal(cfg.provider, 'anthropic');
  assert.equal(cfg.modelId, 'claude-opus-4-8');
  assert.equal(cfg.token, 'sk-a');
});

test('resolveModelConfig: 명시 provider 가 추론보다 우선, GPAO_T5_MODEL_ID 오버라이드', () => {
  const cfg = resolveModelConfig({
    GPAO_T5_MODEL_PROVIDER: 'gemini', ANTHROPIC_API_KEY: 'sk-a', GEMINI_API_KEY: 'g-1',
    GPAO_T5_MODEL_ID: 'gemini-2.5-pro',
  });
  assert.equal(cfg.provider, 'gemini');
  assert.equal(cfg.modelId, 'gemini-2.5-pro');
});

test('resolveModelConfig: openai_compatible 은 baseUrl+modelId 필수, 토큰은 선택(로컬 서버)', () => {
  assert.equal(resolveModelConfig({ GPAO_T5_MODEL_BASE_URL: 'http://localhost:11434/v1' }), null); // modelId 없음
  const cfg = resolveModelConfig({
    GPAO_T5_MODEL_BASE_URL: 'http://localhost:11434/v1', GPAO_T5_MODEL_ID: 'llama3.3',
  });
  assert.equal(cfg.provider, 'openai_compatible');
  assert.equal(cfg.token, undefined); // 무자격 허용 — 헤더에 authorization 이 없어야 한다
});

// ── provider 별 와이어 ────────────────────────────────────────────────────
test('anthropic 와이어: /v1/messages + x-api-key + system/messages, text 블록 추출', async () => {
  const { impl, calls } = fakeFetch(200, { content: [{ type: 'text', text: '준비했어요' }] });
  const cfg = resolveModelConfig({ ANTHROPIC_API_KEY: 'sk-a' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(reply, '준비했어요');
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.headers['x-api-key'], 'sk-a');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'claude-opus-4-8');
  assert.ok(body.system.length);
  assert.ok(body.messages[0].content.includes('내일 회의 준비 도와줘'));
});

test('opts.maxTokens: 계약이 큰 호출은 자기 출력 예산을 넓힐 수 있다(H02 절단 원인)', async () => {
  // H02 실측(2026-08-01): 성장 제안 호출이 기본 상한 1024 에서 **3/3 절단**돼 마지막 boundary
  // 사례가 잘렸고(`proposal_short:boundary_sample`), 4096 에서는 3/3 완결·표본부족 0 이었다.
  // 모델이 못 낸 게 아니라 제품이 계약(5사례)을 담을 공간을 안 준 것이다 — 호출 하나가
  // 자기 예산을 말할 수 있어야 한다. provider 별 토큰 필드는 각자의 형식을 유지한다.
  for (const [env, field] of [
    [{ OPENAI_API_KEY: 'sk-o' }, 'max_completion_tokens'],
    [{ OPENAI_OAUTH_ACCESS_TOKEN: 'oauth-t' }, 'max_tokens'],
    [{ ANTHROPIC_API_KEY: 'sk-a' }, 'max_tokens'],
  ]) {
    const { impl, calls } = fakeFetch(200, {
      choices: [{ message: { content: 'ok' } }],
      content: [{ type: 'text', text: 'ok' }],
    });
    const cfg = resolveModelConfig(env);
    await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC, { maxTokens: 4096 });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body[field], 4096, `${cfg.provider}: opts.maxTokens 가 요청 예산에 실려야 한다`);
    // 옵션이 없으면 기존 그대로다 — 기본 상한을 조용히 올리지 않는다.
    await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
    assert.equal(JSON.parse(calls[1].init.body)[field], cfg.maxTokens, `${cfg.provider}: 기본은 그대로`);
  }
});

test('openai 와이어: /chat/completions + Bearer, choices 추출', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: '네, 준비할게요' } }] });
  const cfg = resolveModelConfig({ OPENAI_API_KEY: 'sk-o' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(reply, '네, 준비할게요');
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer sk-o');
  const body = JSON.parse(init.body);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.max_completion_tokens, cfg.maxTokens);
  assert.equal(body.max_tokens, undefined);
});

test('GPT-5.6 + 도구는 Responses API로 보내고 call_id 영수증을 되돌린다', async () => {
  const { impl, calls } = fakeFetch(200, {
    model: 'gpt-5.6-sol',
    output: [{ type: 'function_call', name: 'local_file', arguments: '{"action":"read","path":"a.tsv"}', call_id: 'call_1' }],
  });
  const cfg = resolveModelConfig({ OPENAI_API_KEY: 'sk-o', GPAO_T5_MODEL_ID: 'gpt-5.6' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC, {
    effort: 'medium', tools: [{ name: 'local.file', description: '파일', parameters: { type: 'object', properties: {} } }],
  });
  assert.deepEqual(reply.toolCalls, [{ name: 'local.file', args: { action: 'read', path: 'a.tsv' }, providerCallId: 'call_1' }]);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.reasoning.effort, 'medium');
  assert.equal(body.tools[0].name, 'local_file');
  assert.equal(body.input.at(-1).content[0].text, TC.currentRequest);
});

test('GPT-5.6 Responses 다음 호출은 같은 call_id에 실제 도구 영수증을 붙인다', async () => {
  const { impl, calls } = fakeFetch(200, { model: 'gpt-5.6-sol', output_text: '읽은 내용을 반영했어요.', output: [] });
  const cfg = resolveModelConfig({ OPENAI_API_KEY: 'sk-o', GPAO_T5_MODEL_ID: 'gpt-5.6' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond({
    ...TC,
    turnExchange: [{
      tool: 'local.file', args: { action: 'read', path: 'sales.tsv' }, providerCallId: 'call_sales',
      summary: 'sales.tsv를 읽었어요.', result: { text: 'A\\t10' }, ref: 'internal-ref',
    }],
  }, { tools: [{ name: 'local.file', description: '파일', parameters: { type: 'object', properties: {} } }] });
  assert.equal(reply.text, '읽은 내용을 반영했어요.');
  const input = JSON.parse(calls[0].init.body).input;
  const call = input.find((item) => item.type === 'function_call');
  const output = input.find((item) => item.type === 'function_call_output');
  assert.equal(call.call_id, 'call_sales');
  assert.equal(output.call_id, 'call_sales');
  assert.match(output.output, /sales\.tsv를 읽었어요/);
});

test('openai_oauth: 같은 와이어에 OAuth access token 을 Bearer 로 쓴다(주입 seam)', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: 'ok' } }] });
  const cfg = resolveModelConfig({ OPENAI_OAUTH_ACCESS_TOKEN: 'oauth-t' });
  assert.equal(cfg.provider, 'openai_oauth');
  await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(calls[0].init.headers.authorization, 'Bearer oauth-t');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.max_tokens, cfg.maxTokens, '현재 정상인 OAuth 요청 형식은 유지한다');
  assert.equal(body.max_completion_tokens, undefined);
});

test('openai_compatible: 지정 baseUrl 로 가고, 토큰 없으면 authorization 헤더도 없다', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: '로컬 응답' } }] });
  const cfg = resolveModelConfig({ GPAO_T5_MODEL_BASE_URL: 'http://localhost:11434/v1', GPAO_T5_MODEL_ID: 'llama3.3' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(reply, '로컬 응답');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, undefined);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.max_tokens, cfg.maxTokens, '호환 서버에 공식 OpenAI 전용 필드를 강제하지 않는다');
  assert.equal(body.max_completion_tokens, undefined);
});

test('beai 와이어: 자사 V1 — Bearer + user/assistant 만(system 사실은 user 턴에 합침)', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: '안녕하세요' } }] });
  const cfg = resolveModelConfig({ BEAI_API_KEY: 'beai_sk_x' });
  assert.equal(cfg.provider, 'beai');
  assert.equal(cfg.modelId, 'beai-8.6');
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(reply, '안녕하세요');
  const { url, init } = calls[0];
  assert.equal(url, 'https://chat.beai.kr/api/external/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer beai_sk_x');
  const body = JSON.parse(init.body);
  assert.equal(body.messages.length, 1);                       // system role 없음(V1 제약 실측)
  assert.equal(body.messages[0].role, 'user');
  assert.ok(body.messages[0].content.includes('slack.post'));  // system 사실이 user 턴에 실려 간다
  assert.ok(body.messages[0].content.includes('내일 회의 준비 도와줘'));
});

test('openai_compatible: GPAO_T5_MODEL_NO_SYSTEM_ROLE=1 이면 같은 방식으로 합친다(일반형)', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: 'ok' } }] });
  const cfg = resolveModelConfig({
    GPAO_T5_MODEL_BASE_URL: 'http://localhost:11434/v1', GPAO_T5_MODEL_ID: 'llama3.3',
    GPAO_T5_MODEL_NO_SYSTEM_ROLE: '1',
  });
  await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
});

test('gemini 와이어: :generateContent + x-goog-api-key, parts 추출', async () => {
  const { impl, calls } = fakeFetch(200, { candidates: [{ content: { parts: [{ text: '알겠' }, { text: '어요' }] } }] });
  const cfg = resolveModelConfig({ GEMINI_API_KEY: 'g-1' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(reply, '알겠어요');
  const { url, init } = calls[0];
  assert.ok(url.endsWith('/models/gemini-flash-latest:generateContent'));
  assert.equal(init.headers['x-goog-api-key'], 'g-1');
  const body = JSON.parse(init.body);
  assert.ok(body.system_instruction.parts[0].text.length);
  assert.ok(body.contents[0].parts[0].text.includes('내일 회의 준비 도와줘'));
});

// ── 오류 신호 → kernel 분류(반대 검증: 분류기 실물로 확인) ────────────────
async function signalOf(cfgEnv, status, json) {
  const { impl } = fakeFetch(status, json);
  const cfg = resolveModelConfig(cfgEnv);
  try {
    await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
    assert.fail('오류가 던져져야 한다');
  } catch (e) {
    assert.ok(e instanceof ModelProviderError);
    return e.authSignal;
  }
}

test('401 invalid api key → classifyModelAuth = AUTH_FAILED', async () => {
  const sig = await signalOf({ OPENAI_API_KEY: 'sk-bad' }, 401,
    { error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } });
  assert.equal(classifyModelAuth(sig), AUTH_STATE.AUTH_FAILED);
});

test('429 rate limit → RATE_LIMITED, insufficient_quota → BILLING_BLOCKED (T3 오분류 재발 방지)', async () => {
  const rate = await signalOf({ ANTHROPIC_API_KEY: 'sk-a' }, 429,
    { error: { type: 'rate_limit_error', message: 'Too many requests' } });
  assert.equal(classifyModelAuth(rate), AUTH_STATE.RATE_LIMITED);
  const billing = await signalOf({ OPENAI_API_KEY: 'sk-o' }, 429,
    { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } });
  assert.equal(classifyModelAuth(billing), AUTH_STATE.BILLING_BLOCKED); // rate 아님 — billing 먼저
});

test('gemini API_KEY_INVALID(400) 도 AUTH_FAILED 로 갈린다(벤더 표기 정규 토큰 보강)', async () => {
  const sig = await signalOf({ GEMINI_API_KEY: 'g-bad' }, 400,
    { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.',
      details: [{ reason: 'API_KEY_INVALID' }] } });
  assert.equal(classifyModelAuth(sig), AUTH_STATE.AUTH_FAILED);
});

// ── 타임아웃: fetch 실제 취소 후 기존 사용자 언어 경로 ─────────────────────
test('타임아웃 시 fetch 를 실제로 abort 하고 ModelTimeoutError 를 던진다', async () => {
  let seenSignal;
  const hangingFetch = (url, init) => new Promise((_resolve, reject) => {
    seenSignal = init.signal;
    init.signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const cfg = resolveModelConfig({ OPENAI_API_KEY: 'sk-o' });
  const client = makeProviderModelClient(cfg, { fetchImpl: hangingFetch, timeoutMs: 20 });
  await assert.rejects(() => client.respond(TC), (e) => e instanceof ModelTimeoutError);
  assert.equal(seenSignal.aborted, true); // 진짜 취소 — orphan 요청을 남기지 않는다
});

// ── 라이브 배선 단일 진실 ─────────────────────────────────────────────────
test('selectLiveModel: 미구성이면 stub + beai5-stub (실 모델처럼 보이지 않는다)', () => {
  const { model, envModel } = selectLiveModel({});
  assert.ok(model instanceof StubModelClient);
  assert.equal(envModel.id, 'beai5-stub');
});

test('selectLiveModel: 구성되면 envModel.id 가 실제 모델 id — 보이는 것=실제', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: 'ok' } }] });
  const { model, envModel } = selectLiveModel({ OPENAI_API_KEY: 'sk-o' }, { fetchImpl: impl });
  assert.equal(envModel.id, 'gpt-5.1');
  await model.respond(TC);
  assert.equal(calls.length, 1); // stub 이 아니라 실 어댑터가 응답
});

test('liveDeps: 모델 자격이 env.model(SelfState)과 model(실행)에 함께 반영된다', async () => {
  const { impl } = fakeFetch(200, { choices: [{ message: { content: 'ok' } }] });
  const withKey = liveDeps({ OPENAI_API_KEY: 'sk-o' }, { fetchImpl: impl });
  assert.equal(withKey.env.model.id, 'gpt-5.1');
  assert.ok(withKey.model);
  const without = liveDeps({});
  assert.equal(without.env.model.id, 'beai5-stub');
  // P-RT-4: model 은 핫스왑 위임 객체 — 구조(instanceof) 대신 동작으로 검증: stub 의 canned 응답.
  const stubReply = await without.model.respond(TC); // TC 는 complex_work + evidenceFacts
  assert.ok(stubReply.includes('확인한 것'));
});

// ── 안정성 회귀: 실 모델의 정직한 실패가 프로세스를 죽이면 안 된다 ─────────
// 라이브 실측(2026-07-26)에서 발견: withSessionQueue 의 체인 꼬리(tail)가 task 거부를 아무도 받지
// 않는 promise 로 남겨 unhandledRejection → 서버 프로세스 사망. stub 은 라이브에서 안 던져 잠복했고,
// 실 provider 의 첫 401 이 드러냈다. 수정 전 이 테스트는 실패한다(반대 검증).
test('모델 오류(401 등)에도 /turn 은 사용자 발화와 미실행 사실을 남기고 프로세스는 산다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-prt1-'));
  const throwingModel = {
    async respond() {
      throw new ModelProviderError({ provider: 'openai', status: 401, authSignal: '401 invalid_api_key' });
    },
  };
  const server = makeServer({ store: new SessionStore(dir), model: throwingModel });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const rejections = [];
  const onRej = (err) => rejections.push(err);
  process.on('unhandledRejection', onRej);
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const r = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    });
    assert.equal(r.status, 200);
    const result = await r.json();
    assert.equal(result.kind, 'reply');
    assert.match(result.reply, /아직 실행하지 않았어요/);
    assert.equal(result.modelUnavailable, true);
    const restored = await (await fetch(`${base}/sessions/${s.id}`)).json();
    assert.deepEqual(restored.transcript.map((entry) => entry.role), ['user', 'assistant']);
    assert.match(restored.transcript[0].text, /안녕/);
    assert.match(restored.transcript[1].result.reply, /아직 실행하지 않았어요/);
    await new Promise((r2) => setTimeout(r2, 50)); // 꼬리 rejection 이 돌 시간을 준다
    assert.deepEqual(rejections, [], '큐 꼬리가 unhandledRejection 을 만들면 프로세스가 죽는다');
  } finally {
    process.off('unhandledRejection', onRej);
    await new Promise((r2) => server.close(r2));
  }
});

// ── 모델 입력(§11): 사실만, 원문 보존 ────────────────────────────────────
test('buildModelMessages: 자기 모델명과 능력 경계를 싣는다(오너 실사용 회귀)', () => {
  // 2026-07-26 실사용: "넌 지금 어떤 모델이지?" → "확인할 권한이 없다"고 답했다(패킷엔 있는데
  // 프롬프트에 안 실려서). 그리고 라벨만 보고 검색·다중 페이지 순회 같은 없는 기능을 약속했다.
  const m = buildModelMessages({ ...TC, selfStateFacts: { model: 'gpt-5.5', readyTools: ['웹 자료 수집'], limits: [] } });
  assert.ok(m.system.includes('gpt-5.5'), '자기 모델명을 안다(Operational Selfhood §6)');
  // §24: 경계는 남기되 "확실하지 않으면 확인이 필요하다고 말해라"는 뺐다 — 그 한 줄이 모델을
  // 겁쟁이로 만들어 "오늘 날씨"에 되묻고 헤지하게 했다(오너 실사용).
  assert.ok(m.system.includes('없는 도구를 있다고 하지 않는다'), '없는 능력을 주장하지 않는 경계는 남는다(헌장)');
  assert.ok(!/확인이 필요하다/.test(m.system), '헤지를 시키는 규칙은 없어야 한다');
});

test('CHAT 완료 판정은 최종 답 호출에도 결과 형태 사실로 전달된다', () => {
  const m = buildModelMessages({ ...TC, chatOutputContract: true });
  assert.match(m.system, /이번 결과 형태/);
  assert.match(m.system, /대화에 바로 보여주는 답/);
  assert.match(m.system, /파일명 확인은 이번 요청의 결과가 아니다/);
});

test('buildModelMessages: 원문 보존 + 반영 기억·실행 사실·승인 경계를 사실로만 싣는다', () => {
  const m = buildModelMessages(TC);
  // S1(2026-08-05): **원문은 사용자 메시지에만 있다.** 커널이 쓴 사실은 시스템 공간으로 갈렸다.
  assert.equal(m.user.trim(), '내일 회의 준비 도와줘');        // 원문 — 오직 여기
  assert.ok(!m.system.includes('내일 회의 준비 도와줘'), '커널 자리에 사용자 원문이 새 들어갔다');
  assert.ok(m.system.includes('사용자는 오전 회의를 선호'));   // admittedContext
  assert.ok(m.system.includes('자료 3건 확인'));               // evidenceFacts(userSafeSummary)
  assert.ok(m.system.includes('slack.post'));                // 승인 필요(아직 실행 안 됨)
  assert.ok(!m.system.includes('반드시'));                   // 장문 지시문 주입 아님(사실 표식만)
});

test('buildModelMessages: 기억 채널에 충돌 시 현재 요청 우선이 구조로 실린다 — "이번만"이 기억에 지지 않는다', () => {
  // v1(r41): 한 줄 우선순위 계약 — 쌍 2 실측에서 모델이 우선순위를 뒤집어 패배(§5-J).
  // v2(감사 승인): 기억을 인용된 기본값 데이터로 격리 — 충돌 시 미적용이 블록 이름에 있다.
  const m = buildModelMessages(TC);
  assert.ok(m.system.includes('저장된 기본값'));
  assert.ok(m.system.includes('현재 요청과 충돌하면 적용하지 않음'),
    '충돌 시 현재 요청이 우선한다는 사실이 기억 블록의 이름이어야 한다');
});

test('buildModelMessages: 반영 기억이 없으면 기본값 블록도 없다(빈 채널에 지시문을 싣지 않는다)', () => {
  const m = buildModelMessages({ ...TC, admittedContext: [] });
  assert.ok(!m.system.includes('저장된 기본값'));
});

// ── 감사 승인 렌더 수정(1회 한정): 기억은 명령이 아니라 **인용된 기본값 데이터**로 격리 ──
// §5-J 원시: 저장된 명령형 원문("앞으로 …정리해줘")이 현재 명령과 같은 층위에서 경쟁했고,
// 쌍 2에서 모델이 "이번 요청을 우선할 수가 없어"라고 우선순위를 뒤집었다. 의미 재서술은
// 금지 — 원문은 따옴표 인용으로 보존하고, 명령이 아님을 채널 문법으로 격리한다.

test('기억 렌더: 저장 원문이 벌거벗은 명령이 아니라 인용된 기록으로 격리된다', () => {
  const m = buildModelMessages({ ...TC, admittedContext: ['앞으로 보고서는 표보다 짧은 목록으로 정리해줘.'] });
  assert.ok(m.system.includes('저장된 기본값'), '기본값 데이터 블록 이름이 있어야 한다');
  assert.ok(m.system.includes('지금 실행할 명령이 아니다'), '명령 아님 격리 문장이 있어야 한다');
  assert.ok(m.system.includes('기록 원문: "앞으로 보고서는 표보다 짧은 목록으로 정리해줘."'),
    '원문은 의미 재서술 없이 따옴표 인용으로 보존된다');
  assert.ok(!/^- 앞으로 보고서는/m.test(m.user), '원문이 벌거벗은 명령 줄로 나오면 안 된다');
  assert.ok(m.system.includes('현재 요청과 충돌하면 적용하지 않음'), '충돌 시 현재 요청 우선이 블록 이름에 있다');
});

test('기억 렌더: 현재 요청은 마지막 독립 블록이다 — 기본값 데이터가 그 뒤에 오지 않는다', () => {
  const m = buildModelMessages({ ...TC, admittedContext: ['사용자는 오전 회의를 선호'] });
  const 요청위치 = m.user.lastIndexOf('내일 회의 준비 도와줘');
  const 기본값위치 = m.user.lastIndexOf('저장된 기본값');
  assert.ok(요청위치 > 기본값위치, '현재 요청이 기본값 블록 뒤(마지막)여야 한다');
});

test('기억 렌더: 기억이 없는 턴의 입력은 기본값 블록이 없다(불변)', () => {
  const m = buildModelMessages({ ...TC, admittedContext: [] });
  assert.ok(!m.system.includes('저장된 기본값'));
  assert.ok(!m.user.includes('지금 실행할 명령이 아니다'));
});
