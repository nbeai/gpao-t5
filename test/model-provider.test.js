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
});

test('openai_oauth: 같은 와이어에 OAuth access token 을 Bearer 로 쓴다(주입 seam)', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: 'ok' } }] });
  const cfg = resolveModelConfig({ OPENAI_OAUTH_ACCESS_TOKEN: 'oauth-t' });
  assert.equal(cfg.provider, 'openai_oauth');
  await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(calls[0].init.headers.authorization, 'Bearer oauth-t');
});

test('openai_compatible: 지정 baseUrl 로 가고, 토큰 없으면 authorization 헤더도 없다', async () => {
  const { impl, calls } = fakeFetch(200, { choices: [{ message: { content: '로컬 응답' } }] });
  const cfg = resolveModelConfig({ GPAO_T5_MODEL_BASE_URL: 'http://localhost:11434/v1', GPAO_T5_MODEL_ID: 'llama3.3' });
  const reply = await makeProviderModelClient(cfg, { fetchImpl: impl }).respond(TC);
  assert.equal(reply, '로컬 응답');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, undefined);
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
test('모델 오류(401 등)에 /turn 은 500 으로 답하고 프로세스는 산다 — 큐 꼬리 unhandledRejection 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-prt1-'));
  const throwingModel = {
    async respond() {
      throw new ModelProviderError({ provider: 'openai', status: 401, authSignal: '401 invalid_api_key' });
    },
  };
  const server = makeServer({ store: new SessionStore(dir), model: throwingModel });
  await new Promise((r) => server.listen(0, r));
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
    assert.equal(r.status, 500); // 정직한 실패(사용자 언어화는 §6.20 후속)
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

test('buildModelMessages: 원문 보존 + 반영 기억·실행 사실·승인 경계를 사실로만 싣는다', () => {
  const m = buildModelMessages(TC);
  assert.ok(m.user.includes('내일 회의 준비 도와줘'));       // 원문
  assert.ok(m.user.includes('사용자는 오전 회의를 선호'));   // admittedContext
  assert.ok(m.user.includes('자료 3건 확인'));               // evidenceFacts(userSafeSummary)
  assert.ok(m.system.includes('slack.post'));                // 승인 필요(아직 실행 안 됨)
  assert.ok(!m.system.includes('반드시'));                   // 장문 지시문 주입 아님(사실 표식만)
});
