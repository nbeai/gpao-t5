// P-RT-4 · Model Connect UX 검증. 실 API 미호출(fetchImpl 주입).
// 핵심: ①검증 통과만 저장·활성화(실패 키는 기존 연결을 깨지 않음) ②원본 키·원문 진단이 어떤
// 응답에도 없음 ③재시작 지속 ④우선순위(저장>env>stub) ⑤핫스왑(연결 즉시 다음 respond 부터 적용).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeModelConnection, ModelConnectionStore, maskKey } from '../src/surface/model-connection.js';
import { resolveModelConfigFromInput } from '../src/runtime/model-provider.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { liveDeps } from '../src/surface/live-context.js';
import { makeServer, startLiveServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { writeFile, stat } from 'node:fs/promises';

const TC = {
  currentRequest: '안녕', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'fast_chat', naturalness: 'method_and_language_open',
};

/** url 라우팅 fetch 흉내: /models 목록 + /chat/completions 응답, 호출 기록 */
function providerFetch({ models = ['beai-8.6'], reply = '실모델 응답', listStatus = 200, listBody } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/models')) {
      return { status: listStatus, json: async () => listBody ?? { data: models.map((id) => ({ id })) } };
    }
    return { status: 200, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  };
  return { impl, calls };
}

async function tmpStore() {
  return new ModelConnectionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-conn-')));
}

/** v1(단일 연결) 저장본을 그대로 기록한다 — 복원 테스트가 곧 v1→v2 이관 테스트가 된다(P-ONB-1). */
async function saveV1(store, obj) {
  await writeFile(store.file, JSON.stringify(obj), { encoding: 'utf8', mode: 0o600 });
}

// ── 입력 해석 ─────────────────────────────────────────────────────────────
test('resolveModelConfigFromInput: allowlist·기본값·필수 조건', () => {
  assert.equal(resolveModelConfigFromInput({ provider: 'nope', key: 'k' }), null);
  assert.equal(resolveModelConfigFromInput({ provider: 'beai', key: '  ' }), null); // 빈 키
  const beai = resolveModelConfigFromInput({ provider: 'beai', key: 'beai_sk_x' });
  assert.equal(beai.modelId, 'beai-8.6');
  assert.equal(beai.noSystemRole, true);
  assert.equal(resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'llama3.3' }), null); // 주소 없음
  const compat = resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'llama3.3', baseUrl: 'http://localhost:11434/v1' });
  assert.equal(compat.provider, 'openai_compatible');
});

test('저장 파일 권한: 기존 0644 파일을 덮어써도 최종 0600 (감사 B1 — writeFile mode 는 생성 시에만)', async () => {
  const store = await tmpStore();
  await writeFile(store.file, '{}', { mode: 0o644 }); // 과거에 느슨한 권한으로 만들어진 파일
  assert.equal((await stat(store.file)).mode & 0o777, 0o644); // 전제 확인
  await store.save({ provider: 'beai', key: 'k' });
  assert.equal((await stat(store.file)).mode & 0o777, 0o600, '덮어쓰기에서도 소유자 전용');
});

test('baseUrl 검증: http/https 만, URL 자격증명 금지 (감사 권고 — 서버가 직접 fetch 하는 사용자 입력)', () => {
  const ok = resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'm', baseUrl: 'http://localhost:11434/v1' });
  assert.ok(ok);
  assert.equal(resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'm', baseUrl: 'file:///etc/passwd' }), null);
  assert.equal(resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'm', baseUrl: 'javascript:alert(1)' }), null);
  assert.equal(resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'm', baseUrl: 'http://user:pw@host/v1' }), null);
  assert.equal(resolveModelConfigFromInput({ provider: 'openai_compatible', modelId: 'm', baseUrl: '주소아님' }), null);
});

test('maskKey: 원본 복원 불가한 마스킹만', () => {
  assert.equal(maskKey('beai_sk_live_d8afdbf861959bf82c46b874d7f5f89d2ad3fa2204b82790'), 'beai…2790');
  assert.equal(maskKey('short'), '••••');
  assert.equal(maskKey(undefined), null);
});

// ── 연결 성공: 저장 + 활성화 + 단일 진실 + 핫스왑 ─────────────────────────
test('connect(usable): 저장·활성화·env 동기화, 다음 respond 부터 새 키 사용(핫스왑)', async () => {
  const env = {};
  const store = await tmpStore();
  const { impl, calls } = providerFetch();
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: impl });
  assert.equal(env.model.id, 'beai5-stub'); // 연결 전: stub 정직 표시

  const r = await mc.connect({ provider: 'beai', key: 'beai_sk_new' });
  assert.equal(r.connected, true);
  assert.equal(r.report.state, 'usable');
  assert.ok(!('authSignal' in r.report), '공개면 위생 유지(P-RT-2 B2)');
  assert.equal(env.model.id, 'beai-8.6');
  assert.equal(env.model.healthState, 'usable');
  assert.equal((await store.load()).connections[0].key, 'beai_sk_new'); // 검증 통과 → 저장됨

  const reply = await mc.model.respond(TC); // 재시작 없이 같은 model 참조로 실 provider
  assert.equal(reply, '실모델 응답');
  const chat = calls.find((c) => c.url.includes('/chat/completions'));
  assert.equal(chat.init.headers.authorization, 'Bearer beai_sk_new');
});

test('connect(실패 키): 저장 안 함 + 기존 연결(stub) 유지 — 잘못된 키가 동작을 깨지 않는다', async () => {
  const env = {};
  const store = await tmpStore();
  const { impl } = providerFetch({ listStatus: 401, listBody: { error: { code: 'invalid_api_key', message: 'bad sk-secret-xyz' } } });
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: impl });
  const r = await mc.connect({ provider: 'openai', key: 'sk-secret-xyz' });
  assert.equal(r.connected, false);
  assert.equal(r.report.state, 'auth_failed');
  assert.ok(!JSON.stringify(r).includes('sk-secret-xyz'), '원본 키 미노출');
  assert.equal(await store.load(), null);                  // 저장 안 됨
  assert.equal(env.model.id, 'beai5-stub');                // 기존(stub) 유지
  assert.equal(buildSelfState(env).modelAuthState, 'usable'); // 실패 시도가 activeEnv 를 오염 안 함
  const reply = await mc.model.respond(TC);
  assert.ok(reply.includes('이해했어요'), 'stub 이 계속 답한다');
});

test('connect(model_missing): 활성화 안 함 + 대안 안내', async () => {
  const env = {};
  const { impl } = providerFetch({ models: ['beai-9'] });
  const mc = makeModelConnection({ env, processEnv: {}, fetchImpl: impl });
  const r = await mc.connect({ provider: 'beai', key: 'k', modelId: 'beai-old' });
  assert.equal(r.connected, false);
  assert.equal(r.report.state, 'model_missing');
  assert.ok(r.report.nextSafeAction.includes('beai-9'));
  assert.equal(env.model.id, 'beai5-stub');
});

// ── 지속·해제·우선순위 ────────────────────────────────────────────────────
test('재시작 지속: 새 관리자 init() 이 저장 연결을 복원한다(source: saved)', async () => {
  const store = await tmpStore();
  const { impl } = providerFetch();
  const mc1 = makeModelConnection({ env: {}, processEnv: {}, store, fetchImpl: impl });
  await mc1.connect({ provider: 'beai', key: 'beai_sk_persist' });

  const env2 = {};
  const mc2 = makeModelConnection({ env: env2, processEnv: {}, store, fetchImpl: impl });
  await mc2.init();
  const st = mc2.status();
  assert.equal(st.connected, true);
  assert.equal(st.source, 'saved');
  assert.equal(env2.model.id, 'beai-8.6');
  assert.equal(await mc2.model.respond(TC), '실모델 응답');
});

test('disconnect: 저장 제거 → env 구성으로, env 도 없으면 stub 으로 복귀', async () => {
  const store = await tmpStore();
  const { impl } = providerFetch({ models: ['beai-8.6', 'gemini-flash-latest'] });
  // env 폴백이 있는 경우
  const envA = {};
  const mcA = makeModelConnection({ env: envA, processEnv: { GEMINI_API_KEY: 'g-1' }, store, fetchImpl: impl });
  await mcA.connect({ provider: 'beai', key: 'beai_sk_u' });
  assert.equal(envA.model.id, 'beai-8.6');                 // 저장 연결 > env
  await mcA.disconnect();
  assert.equal(mcA.status().source, 'env');
  assert.equal(envA.model.id, 'gemini-flash-latest');      // env 로 복귀
  assert.equal(await store.load(), null);
  // env 도 없는 경우
  const envB = {};
  const mcB = makeModelConnection({ env: envB, processEnv: {}, fetchImpl: impl });
  await mcB.connect({ provider: 'beai', key: 'k' });
  await mcB.disconnect();
  assert.equal(envB.model.id, 'beai5-stub');
});

test('우선순위: 저장된 사용자 연결 > env(개발자)', async () => {
  const store = await tmpStore();
  await saveV1(store, { provider: 'beai', key: 'beai_sk_saved' }); // v1 저장본 → 이관 검증 겸용
  const env = {};
  const { impl, calls } = providerFetch();
  const mc = makeModelConnection({ env, processEnv: { GEMINI_API_KEY: 'g-1' }, store, fetchImpl: impl });
  assert.equal(env.model.id, 'gemini-flash-latest'); // init 전엔 env
  await mc.init();
  assert.equal(env.model.id, 'beai-8.6');            // init 후 저장 연결이 이긴다
  await mc.model.respond(TC);
  const chat = calls.find((c) => c.url.includes('/chat/completions'));
  assert.equal(chat.init.headers.authorization, 'Bearer beai_sk_saved');
});

// ── HTTP 표면 ─────────────────────────────────────────────────────────────
test('서버: connect→턴이 실모델로, 응답 어디에도 원본 키·authSignal 없음, status 는 마스킹', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-connsrv-'));
  const { impl } = providerFetch({ reply: '연결된 모델의 답' });
  const d = liveDeps({}, { fetchImpl: impl, connectionStore: new ModelConnectionStore(dir) });
  const server = makeServer({ store: new SessionStore(dir), env: d.env, tools: d.tools, model: d.model, modelDoctor: d.modelDoctor, modelConnection: d.modelConnection });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const raw = await (await fetch(`${base}/model/connect`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'beai', key: 'beai_sk_live_supersecret9999' }),
    })).text();
    assert.ok(!raw.includes('supersecret'), 'connect 응답에 원본 키 없음');
    assert.ok(!raw.includes('authSignal'));
    assert.equal(JSON.parse(raw).connected, true);

    const st = await (await fetch(`${base}/model/connection`)).json();
    assert.equal(st.keyMasked, 'beai…9999');
    assert.ok(!JSON.stringify(st).includes('supersecret'));

    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const turn = await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    })).json();
    assert.equal(turn.reply, '연결된 모델의 답');           // 화면 연결 → 즉시 실모델 턴
    assert.equal(turn.selfStateSummary.model, 'beai-8.6'); // 단일 진실
  } finally { await new Promise((r) => server.close(r)); }
});

test('부팅 순서: 저장 연결이 있으면 listen 전에 복원 — 첫 /turn 부터 저장 모델 (감사 B2)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-boot-'));
  const connectionStore = new ModelConnectionStore(dir);
  await saveV1(connectionStore, { provider: 'beai', key: 'beai_sk_boot' });
  const { impl, calls } = providerFetch({ reply: '재시작 후에도 저장 모델' });
  const server = await startLiveServer({
    port: 0, processEnv: {}, sessionStore: new SessionStore(dir), connectionStore,
    fetchImpl: impl, startScheduler: false,
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 사람이 하는 그대로: 화면을 열면 신분이 붙고, 그 다음부터 API 가 열린다(P-DIST-1 §3).
    const 쿠키 = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    // startLiveServer resolve 즉시(대기 없이) 첫 턴 — 복원이 listen 전에 끝났어야 통과한다.
    const s = await (await fetch(`${base}/sessions`, { method: 'POST', headers: { cookie: 쿠키 } })).json();
    const turn = await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 쿠키 },
      body: JSON.stringify({ sessionId: s.id, text: '안녕' }),
    })).json();
    assert.equal(turn.reply, '재시작 후에도 저장 모델');
    assert.equal(turn.selfStateSummary.model, 'beai-8.6');
    const chat = calls.find((c) => c.url.includes('/chat/completions'));
    assert.equal(chat.init.headers.authorization, 'Bearer beai_sk_boot');
  } finally { await new Promise((r) => server.close(r)); }
});

test('서버: 연결 관리자 미배선(demo)이면 connect 는 400, connection 은 미연결 정직 표시', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-connsrv2-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(`${base}/model/connect`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 400);
    const st = await (await fetch(`${base}/model/connection`)).json();
    assert.equal(st.connected, false);
  } finally { await new Promise((r) => server.close(r)); }
});

// ── E-3 (오너 결정 2026-08-02) · 설정을 바꾸면 무엇이 무엇으로 바뀌었는지 남긴다 ──
//
// 감사 지적(항목 35): 커넥터 경로는 `approvalEligibility`·`previewOf` 로 현재 상태를 먼저 읽고
// 카드에 싣는데, 모델 연결 변경 경로(`/model/connections/activate|bind|remove`)는 현재 상태를
// 보지도 남기지도 않고 바로 바꾼다. 오너 결정은 **승인 단계를 늘리지 않는다**(자동성이 의무다).
// 대신 바뀌기 전 사실을 결과에 실어 T5 가 "무엇을 무엇으로 바꿨는지" 정직하게 말할 수 있게 한다.
// 실패한 변경에는 `changed` 를 싣지 않는다 — 안 바뀐 것을 바꿨다고 말하면 그게 거짓 성공이다.
/**
 * 연결 두 개를 만든 상태. id 는 제품이 정하므로 **만든 뒤에 읽어 쓴다**(내가 지어낸 id 로
 * 검사하면 제품이 아니라 내 가정이 통과한다). 첫 번째를 활성으로 두고 시작한다.
 */
async function 두연결() {
  const { impl } = providerFetch({ models: ['beai-8.6', 'gemini-flash-latest'] });
  const mc = makeModelConnection({ env: {}, processEnv: {}, store: await tmpStore(), fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'beai_sk_one' });
  await mc.connect({ provider: 'gemini', key: 'g_sk_two' });
  const ids = mc.list().connections.map((c) => c.id);
  assert.equal(ids.length, 2, `전제: 연결 두 개여야 한다 — ${JSON.stringify(ids)}`);
  await mc.activate(ids[0]);
  return { mc, ids };
}

test('E-3: 기본 연결 전환은 바뀌기 전 값을 함께 남긴다', async () => {
  const { mc, ids } = await 두연결();
  const before = mc.list().activeId;
  const r = await mc.activate(ids[1]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.changed, { what: 'activeId', from: before, to: ids[1] },
    '무엇이 무엇에서 무엇으로 바뀌었는지가 없으면 T5 는 "바꿨어요"밖에 말할 수 없다');
});

test('E-3: 역할 바인딩 설정·해제도 이전 값을 남긴다', async () => {
  const { mc, ids } = await 두연결();
  const set = await mc.bind('growth', ids[1]);
  assert.deepEqual(set.changed, { what: 'roleBindings.growth', from: null, to: ids[1] });
  const unset = await mc.bind('growth', null);
  assert.deepEqual(unset.changed, { what: 'roleBindings.growth', from: ids[1], to: null });
});

test('E-3: 연결 해제도 이전 값을 남긴다', async () => {
  const { mc, ids } = await 두연결();
  const r = await mc.remove(ids[0]);
  assert.equal(r.ok, true);
  assert.equal(r.changed.what, 'connections');
  assert.ok(r.changed.from.includes(ids[0]), '무엇이 없어졌는지 알 수 없으면 되돌릴 수도 없다');
  assert.ok(!r.changed.to.includes(ids[0]));
});

test('E-3: 실패한 변경에는 바뀐 사실을 싣지 않는다(거짓 성공 금지)', async () => {
  const { mc } = await 두연결();
  for (const r of [await mc.activate('없는것'), await mc.bind('growth', '없는것'), await mc.remove('없는것')]) {
    assert.equal(r.ok, false);
    assert.equal(r.changed, undefined, '안 바뀌었는데 바뀐 사실이 남으면 원장이 거짓이 된다');
  }
});

test('E-3: 같은 값으로 다시 바꾸면 바뀐 사실을 싣지 않는다', async () => {
  const { mc, ids } = await 두연결();
  await mc.activate(ids[1]);
  const 다시 = await mc.activate(ids[1]);
  assert.equal(다시.ok, true);
  assert.equal(다시.changed, undefined, '안 바뀐 것을 바뀌었다고 하면 사용자가 원인을 잘못 짚는다');
});
