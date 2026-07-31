// S4 · §4.6 실제 모델 호출 신분. **역할 이름과 `provider:model` 문자열은 신분이 아니다.**
//
// 여기서 지키는 사실은 하나다: replay 증거의 자격은 "무엇을 부르려 했는가"가 아니라
// "실제로 어디에 무엇으로 무슨 자격으로 붙었는가"에서 나온다. 그래서 이 검사들은 전부
// **실제 fetch 가 받은 값**(url·body·응답 원문)으로만 판정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeModelConnection, ModelConnectionStore } from '../src/surface/model-connection.js';
import { verifyCallIdentity } from '../src/kernel/l5-growth/tcell-replay.js';

const TC = {
  currentRequest: '안녕', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'fast_chat', naturalness: 'method_and_language_open',
};

/** 실제 호출 url·본문을 기록하고, 응답 model 보고 여부를 시험마다 바꾼다. */
function 낚아채는fetch({ reply = '응답', responseModel = undefined } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/models') && !url.includes(':generateContent')) {
      return {
        status: 200,
        json: async () => ({ data: [{ id: 'beai-8.6' }, { id: 'm-1' }], models: [{ name: 'models/gemini-flash-latest' }] }),
      };
    }
    return {
      status: 200,
      json: async () => ({
        choices: [{ message: { content: reply } }],
        ...(responseModel === undefined ? {} : { model: responseModel }),
        usage: { total_tokens: 7 },
      }),
    };
  };
  return { impl, calls };
}

async function tmp() { return new ModelConnectionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-idn-'))); }

/** 한 번 호출하고 그 호출의 신분을 돌려준다 — 신분은 어댑터가 만들지, 검사가 만들지 않는다. */
async function 신분받기(mc, role, opts = {}) {
  let idn = null;
  await mc.modelFor(role).respond(TC, { ...opts, onCallIdentity: (i) => { idn = i; } });
  return idn;
}

// ── 연결 신분: provider:model 문자열이 아니다 ─────────────────────────────
test('S4: 연결에 불투명한 instance·credential 신분이 붙고, 비밀 원문은 어디에도 없다', async () => {
  const store = await tmp();
  const { impl } = 낚아채는fetch();
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'beai_sk_비밀값' });

  const s = mc.selectionFor('default');
  assert.ok(s.connectionInstanceId, 'instance 신분이 있어야 한다');
  assert.ok(s.credentialRef, 'credential 참조가 있어야 한다');
  // 불투명해야 한다 — 키 원문도, 키에서 뽑은 조각도 아니다.
  const 신분문자열 = `${s.connectionInstanceId}${s.credentialRef}`;
  assert.equal(신분문자열.includes('비밀값'), false);
  assert.equal(신분문자열.includes('beai_sk'), false);
  assert.equal(신분문자열.includes(s.providerId), false, 'provider 이름을 신분으로 쓰지 않는다');
});

test('S4: 같은 provider·같은 model 이라도 자격이 바뀌면 다른 instance 다', async () => {
  const store = await tmp();
  const { impl } = 낚아채는fetch();
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'key-하나', modelId: 'beai-8.6' });
  const 첫번째 = mc.selectionFor('default');
  await mc.connect({ provider: 'beai', key: 'key-둘', modelId: 'beai-8.6' });
  const 두번째 = mc.selectionFor('default');

  assert.notEqual(첫번째.credentialRef, 두번째.credentialRef, '자격이 바뀌면 참조가 갈린다');
  assert.notEqual(첫번째.connectionInstanceId, 두번째.connectionInstanceId, '자격이 다르면 다른 instance 다');
});

test('S4: 같은 model 이라도 endpoint 가 다르면 다른 instance 다', async () => {
  const store = await tmp();
  const { impl } = 낚아채는fetch();
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'openai_compatible', key: 'k', modelId: 'm-1', baseUrl: 'https://a.example/v1' });
  const a = mc.selectionFor('default');
  await mc.connect({ provider: 'openai_compatible', key: 'k', modelId: 'm-1', baseUrl: 'https://b.example/v1' });
  const b = mc.selectionFor('default');

  assert.equal(a.endpointOrigin, 'https://a.example');
  assert.equal(b.endpointOrigin, 'https://b.example');
  assert.notEqual(a.connectionInstanceId, b.connectionInstanceId);
});

// ── 역할 해석: 바인딩은 허용목록이 아니다(막다른 답 금지) ─────────────────
test('S4: role 해석 경로가 selection 에 사실대로 남는다(bound·active·env·stub)', async () => {
  const stub = makeModelConnection({ env: {}, processEnv: {} });
  assert.equal(stub.selectionFor('growth').resolution, 'stub');

  const envMc = makeModelConnection({
    env: {},
    processEnv: { GPAO_T5_MODEL_PROVIDER: 'beai', BEAI_API_KEY: 'env-키' },
  });
  const e = envMc.selectionFor('growth');
  assert.equal(e.resolution, 'env');
  assert.ok(e.credentialRef, 'env 자격도 참조를 갖는다');
  assert.equal(`${e.credentialRef}${e.connectionInstanceId}`.includes('env-키'), false);

  const store = await tmp();
  const { impl } = 낚아채는fetch();
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'k1' });
  // 바인딩 없는 역할은 조용히 기본으로 간다 — 그런데 그 사실이 증거에 남아야 한다.
  assert.equal(mc.selectionFor('growth').resolution, 'active');
  await mc.connect({ provider: 'gemini', key: 'k2' });
  await mc.bind('growth', mc.list().connections.find((c) => c.provider === 'beai').id);
  const bound = mc.selectionFor('growth');
  assert.equal(bound.resolution, 'bound');
  assert.equal(bound.providerId, 'beai', '요청 역할이 아니라 실제 선택이 신분이다');
});

test('S4: stub 은 replay 증거 자격이 없다(자격 없는 실행으로 원리가 서지 않는다)', async () => {
  const stub = makeModelConnection({ env: {}, processEnv: {} });
  const idn = await 신분받기(stub, 'growth');
  const v = verifyCallIdentity(idn);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'identity_not_instance_scoped');
});

// ── 실제 호출 관통: 증거는 fetch 가 받은 값에서만 나온다 ──────────────────
test('S4: 신분은 실제 fetch 의 url·본문에서 나온다(선택값 복사가 아니다)', async () => {
  const store = await tmp();
  const { impl, calls } = 낚아채는fetch({ responseModel: 'beai-8.6' });
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'k', modelId: 'beai-8.6' });

  const idn = await 신분받기(mc, 'growth');
  const 실제호출 = calls.filter((c) => !c.url.includes('/models')).at(-1);
  assert.equal(idn.actualEndpointOrigin, new URL(실제호출.url).origin);
  assert.equal(idn.actualRequestModelId, JSON.parse(실제호출.init.body).model);
  assert.ok(idn.startedAt && idn.finishedAt >= idn.startedAt);
  assert.equal(verifyCallIdentity(idn).ok, true);
});

test('S4: 응답이 model 을 보고하면 응답 신분을 검증하고, 보고하지 않으면 주장하지 않는다', async () => {
  const store = await tmp();
  const 보고 = 낚아채는fetch({ responseModel: 'beai-8.6' });
  const mc1 = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: 보고.impl });
  await mc1.connect({ provider: 'beai', key: 'k', modelId: 'beai-8.6' });
  const a = await 신분받기(mc1, 'growth');
  assert.equal(a.responseIdentitySource, 'response_field');
  assert.equal(verifyCallIdentity(a).responseIdentityVerified, true);

  const store2 = await tmp();
  const 미보고 = 낚아채는fetch({ responseModel: undefined });
  const mc2 = makeModelConnection({ env: {}, processEnv: {}, store: store2, fetchImpl: 미보고.impl });
  await mc2.connect({ provider: 'beai', key: 'k', modelId: 'beai-8.6' });
  const b = await 신분받기(mc2, 'growth');
  assert.equal(b.responseIdentitySource, 'not_reported');
  assert.equal(b.responseModelId, null);
  // 실행은 유효하되 "응답 모델 검증됨"이라 부르지 않는다.
  assert.equal(verifyCallIdentity(b).ok, true);
  assert.equal(verifyCallIdentity(b).responseIdentityVerified, false);
});

test('S4: 응답 model 이 요청과 다르면 그 산출물은 증거가 아니다', async () => {
  const store = await tmp();
  const { impl } = 낚아채는fetch({ responseModel: '다른-모델-9' });
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'k', modelId: 'beai-8.6' });
  const idn = await 신분받기(mc, 'growth');
  const v = verifyCallIdentity(idn);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'response_model_incompatible');
});

test('S4: 저장본 복원에서 신분이 1회 부여되고 다음 부팅에도 같다', async () => {
  const store = await tmp();
  const { impl } = 낚아채는fetch();
  const 첫 = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await 첫.connect({ provider: 'beai', key: 'k' });
  // 신분 필드가 없던 옛 저장본을 흉내낸다.
  const saved = await store.load();
  for (const c of saved.connections) { delete c.instanceId; delete c.credentialRef; }
  await store.save(saved);

  const 둘 = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await 둘.init();
  const s1 = 둘.selectionFor('default');
  assert.ok(s1.connectionInstanceId, '이관에서 신분을 1회 부여한다');

  const 셋 = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await 셋.init();
  assert.equal(셋.selectionFor('default').connectionInstanceId, s1.connectionInstanceId, '부팅마다 신분이 바뀌면 신분이 아니다');
  assert.equal(셋.selectionFor('default').credentialRef, s1.credentialRef);
});

/** SSE 본문을 실제 스트림으로 준다 — 스트리밍 경로를 진짜로 태우기 위해서다. */
function 스트림(text) {
  return new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  });
}

test('S4: 어댑터가 사실을 내지 않은 호출은 증거가 아니다(스트리밍 경로 — 없는 신분을 지어내지 않는다)', async () => {
  const store = await tmp();
  const SSE = 'data: {"choices":[{"delta":{"content":"안녕"}}]}\n\ndata: [DONE]\n';
  const impl = async (url) => {
    if (url.includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'm-1' }] }) };
    return { status: 200, body: 스트림(SSE) };
  };
  const mc = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc.connect({ provider: 'openai_compatible', key: 'k', modelId: 'm-1', baseUrl: 'https://a.example/v1' });

  // 선택은 멀쩡하다(자격·주소·모델 다 있다). 그런데 **실제 호출 사실을 못 받았다**.
  const 선택 = mc.selectionFor('growth');
  assert.ok(선택.credentialRef && 선택.endpointOrigin);
  const idn = await 신분받기(mc, 'growth', { onDelta: () => {} });
  assert.equal(idn.actualEndpointOrigin, null, '못 받은 사실을 선택값으로 채우면 안 된다');
  assert.equal(idn.actualRequestModelId, null);
  assert.equal(verifyCallIdentity(idn).ok, false, '사실 없는 호출은 replay 증거가 아니다');
});

test('S4: 계정 경로(ChatGPT) 호출도 실제 신분을 남긴다', async () => {
  const store = await tmp();
  const SSE = [
    'data: {"type":"response.output_text.delta","delta":"안녕"}',
    'data: {"type":"response.completed","response":{"model":"gpt-5.5","output":[]}}',
    'data: [DONE]',
  ].join('\n');
  await store.save({
    connections: [{
      id: 'chatgpt_oauth:gpt-5.5', kind: 'chatgpt_oauth', provider: 'chatgpt_oauth',
      modelId: 'gpt-5.5', credential: { access: 'tok', expiresAt: Date.now() + 3_600_000 },
    }],
    activeId: 'chatgpt_oauth:gpt-5.5',
    roleBindings: {},
  });
  const mc = makeModelConnection({
    env: { model: {} }, processEnv: {}, store,
    fetchImpl: async () => ({ status: 200, text: async () => SSE }),
  });
  await mc.init();

  const idn = await 신분받기(mc, 'growth');
  assert.equal(idn.actualEndpointOrigin, 'https://chatgpt.com');
  assert.equal(idn.actualRequestModelId, 'gpt-5.5');
  assert.equal(idn.responseIdentitySource, 'response_field');
  assert.equal(verifyCallIdentity(idn).ok, true);
  assert.equal(verifyCallIdentity(idn).responseIdentityVerified, true);
});

test('S4: 계정 경로가 응답 model 을 보고하지 않으면 미보고로 남긴다(검증됨이라 하지 않는다)', async () => {
  const store = await tmp();
  // 델타만 오고 완료 이벤트에 model 이 없는 응답 — 실제로 흔한 모양이다.
  const SSE = 'data: {"type":"response.output_text.delta","delta":"안녕"}\ndata: [DONE]';
  await store.save({
    connections: [{
      id: 'chatgpt_oauth:gpt-5.5', kind: 'chatgpt_oauth', provider: 'chatgpt_oauth',
      modelId: 'gpt-5.5', credential: { access: 'tok', expiresAt: Date.now() + 3_600_000 },
    }],
    activeId: 'chatgpt_oauth:gpt-5.5',
    roleBindings: {},
  });
  const mc = makeModelConnection({
    env: { model: {} }, processEnv: {}, store,
    fetchImpl: async () => ({ status: 200, text: async () => SSE }),
  });
  await mc.init();

  const idn = await 신분받기(mc, 'growth');
  assert.equal(idn.responseModelId, null, '안 준 값을 요청 모델로 메우지 않는다');
  assert.equal(idn.responseIdentitySource, 'not_reported');
  assert.equal(verifyCallIdentity(idn).ok, true, '실행 자체는 유효하다');
  assert.equal(verifyCallIdentity(idn).responseIdentityVerified, false, '응답 신분은 검증됐다고 하지 않는다');
});
