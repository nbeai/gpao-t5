// P-RT-3 · ChatGPT 계정 연결 검증. 실 OAuth/백엔드 미호출(fetchImpl 주입).
// 핵심: PKCE·state 무결성, 토큰 교환·선제 refresh·회전 유지, Codex 백엔드 와이어(헤더·SSE 누적),
// 토큰이 어떤 응답에도 안 나감, 저장·복원, 활성은 항상 하나(키 연결과 상호 배타).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPkce, buildAuthorizeUrl, readAccountId, exchangeCode, refreshCredential, isExpired,
  startCallbackListener, CHATGPT_OAUTH,
} from '../src/runtime/chatgpt-oauth.js';
import { makeChatGptModelClient, accumulateResponsesText, CHATGPT_BACKEND_URL } from '../src/runtime/chatgpt-model-client.js';
import { makeModelConnection, ModelConnectionStore } from '../src/surface/model-connection.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

const TC = {
  currentRequest: '안녕', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'fast_chat', naturalness: 'method_and_language_open',
};

const b64url = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idTokenWith = (accountId) =>
  `x.${b64url(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }))}.y`;

const SSE = [
  'data: {"type":"response.output_text.delta","delta":"안녕"}',
  'data: {"type":"response.output_text.delta","delta":"하세요"}',
  'data: {"type":"response.completed"}',
  'data: [DONE]',
].join('\n');

// ── PKCE·authorize ────────────────────────────────────────────────────────
test('PKCE: challenge 는 verifier 의 S256, authorize URL 에 필수 파라미터가 모두 실린다', () => {
  const p = createPkce();
  const expected = createHash('sha256').update(p.verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(p.challenge, expected);
  const u = new URL(buildAuthorizeUrl(p));
  assert.equal(u.origin + u.pathname, CHATGPT_OAUTH.authorizeUrl);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), p.challenge);
  assert.equal(u.searchParams.get('redirect_uri'), CHATGPT_OAUTH.redirectUri);
  assert.equal(u.searchParams.get('client_id'), CHATGPT_OAUTH.clientId);
  assert.equal(u.searchParams.get('state'), p.state);
  assert.ok(!u.search.includes(p.verifier), 'verifier 는 URL 에 실리지 않는다');
});

// ── 무한 대기 금지(감사 B1) ───────────────────────────────────────────────
test('cancel(): 대기 중인 waitForCode 를 취소로 종료한다 — 영원히 안 끝나면 안 된다', async () => {
  const l = startCallbackListener({ state: 's', timeoutMs: 60_000 });
  await l.listening;
  l.cancel();
  const settled = await Promise.race([
    l.waitForCode.then(() => 'resolved', (e) => (e.isLoginCancelled ? 'cancelled' : `other:${e.message}`)),
    new Promise((r) => setTimeout(() => r('still-pending'), 300)),
  ]);
  assert.equal(settled, 'cancelled');
  l.cancel(); // 멱등: 두 번 취소해도 예외 없음
});

test('로그인 재시작·해제: 이전 대기가 매달리지 않고 취소로 닫힌다(감사 B1)', async () => {
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, fetchImpl: async () => ({ status: 200, json: async () => ({}) }) });
  await mc.startChatGptLogin();
  const firstAwait = mc.awaitChatGptLogin();          // 아직 승인 전 — 대기 중
  await mc.startChatGptLogin();                       // 사용자가 버튼을 다시 누름 → 이전 로그인 취소
  const r1 = await Promise.race([firstAwait, new Promise((r) => setTimeout(() => r({ hung: true }), 500))]);
  assert.ok(!r1.hung, '재시작 시 이전 await 가 끝나야 한다');
  assert.equal(r1.connected, false);

  const secondAwait = mc.awaitChatGptLogin();
  await mc.disconnect();                              // 해제도 진행 중 로그인을 닫아야 한다
  const r2 = await Promise.race([secondAwait, new Promise((r) => setTimeout(() => r({ hung: true }), 500))]);
  assert.ok(!r2.hung, '해제 시 대기가 끝나야 한다');
  assert.equal(r2.connected, false);
});

test('readAccountId: id_token claim 에서 계정 id 를 읽고, 깨진 토큰은 null', () => {
  assert.equal(readAccountId(idTokenWith('acct_1')), 'acct_1');
  assert.equal(readAccountId('깨짐'), null);
});

// ── 토큰 교환·갱신 ────────────────────────────────────────────────────────
test('exchangeCode: code+verifier 를 보내고 만료 시각·계정 id 를 담은 자격을 만든다', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    return { status: 200, json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idTokenWith('acct_9') }) };
  };
  const cred = await exchangeCode({ code: 'c1', verifier: 'v1' }, { fetchImpl, now: 1_000_000 });
  assert.equal(cred.access, 'at');
  assert.equal(cred.accountId, 'acct_9');
  assert.equal(cred.expiresAt, 1_000_000 + (3600 - 60) * 1000); // 60s 여유
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), 'v1');
  assert.equal(calls[0].url, CHATGPT_OAUTH.tokenUrl);
});

test('exchangeCode 실패는 정직하게 throw (응답을 지어내지 않는다)', async () => {
  const fetchImpl = async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) });
  await assert.rejects(() => exchangeCode({ code: 'bad', verifier: 'v' }, { fetchImpl }));
});

test('refreshCredential: 회전 안 된 refresh 토큰·계정 id 는 유지된다', async () => {
  const fetchImpl = async () => ({ status: 200, json: async () => ({ access_token: 'at2', expires_in: 3600 }) });
  const next = await refreshCredential({ access: 'old', refresh: 'rt', accountId: 'acct_1' }, { fetchImpl, now: 0 });
  assert.equal(next.access, 'at2');
  assert.equal(next.refresh, 'rt');
  assert.equal(next.accountId, 'acct_1');
  assert.equal(isExpired(next, 0), false);
  assert.equal(isExpired({ expiresAt: 10 }, 20), true);
});

// ── Codex 백엔드 와이어 ───────────────────────────────────────────────────
test('accumulateResponsesText: SSE delta 를 이어 붙인다', () => {
  assert.equal(accumulateResponsesText(SSE), '안녕하세요');
});

test('ChatGPT ModelClient: 백엔드 URL·Bearer·계정 헤더·Responses 셰이프(stream/store:false)', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 200, text: async () => SSE }; };
  const client = makeChatGptModelClient({
    credentials: async () => ({ access: 'at', accountId: 'acct_7' }), fetchImpl,
  });
  assert.equal(await client.respond(TC), '안녕하세요');
  const { url, init } = calls[0];
  assert.equal(url, CHATGPT_BACKEND_URL);
  assert.equal(init.headers.authorization, 'Bearer at');
  assert.equal(init.headers['chatgpt-account-id'], 'acct_7');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'gpt-5.5'); // 계정 경로 실측 기본(codex 접미는 400 거절)
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.equal(body.input[0].content[0].text.includes('안녕'), true);
});

test('ChatGPT ModelClient: 비2xx 는 ModelProviderError(원문은 authSignal 내부값)', async () => {
  const fetchImpl = async () => ({ status: 401, text: async () => 'unauthorized token xyz' });
  const client = makeChatGptModelClient({ credentials: async () => ({ access: 'bad' }), fetchImpl });
  await assert.rejects(() => client.respond(TC), (e) => e.name === 'ModelProviderError' && e.status === 401);
});

// ── 연결 관리자 통합 ──────────────────────────────────────────────────────
async function tmpStore() { return new ModelConnectionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-oauth-'))); }

/** v1(단일 연결) 저장본을 그대로 기록한다 — 복원 테스트가 곧 v1→v2 이관 테스트가 된다(P-ONB-1). */
async function saveV1(store, obj) {
  await writeFile(store.file, JSON.stringify(obj), { encoding: 'utf8', mode: 0o600 });
}

test('저장·복원: 계정 연결이 재시작 후 살아나고, 만료 토큰은 첫 요청에서 선제 갱신된다', async () => {
  const store = await tmpStore();
  const cred = { access: 'at1', refresh: 'rt1', expiresAt: 0, accountId: 'acct_1' }; // 이미 만료
  await saveV1(store, { kind: 'chatgpt_oauth', credential: cred, modelId: 'gpt-5.5' });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    if (url === CHATGPT_OAUTH.tokenUrl) return { status: 200, json: async () => ({ access_token: 'at2', expires_in: 3600 }) };
    return { status: 200, text: async () => SSE };
  };
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl });
  await mc.init();
  assert.equal(mc.status().provider, 'chatgpt_oauth');
  assert.equal(env.model.id, 'gpt-5.5');
  assert.equal(await mc.model.respond(TC), '안녕하세요');
  assert.equal(seen[0], CHATGPT_OAUTH.tokenUrl, '만료 → 먼저 refresh');
  assert.equal((await store.load()).connections[0].credential.access, 'at2', '갱신된 토큰이 재저장된다');
});

test('status/doctor: 토큰·refresh 원문이 어떤 응답에도 없다(마스킹조차 노출 금지)', async () => {
  const store = await tmpStore();
  await saveV1(store, { kind: 'chatgpt_oauth', credential: { access: 'SECRET_ACCESS', refresh: 'SECRET_REFRESH', expiresAt: Date.now() + 600_000 } });
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: async () => ({ status: 200, json: async () => ({}) }) });
  await mc.init();
  const st = mc.status();
  assert.equal(st.keyMasked, 'ChatGPT 계정');
  assert.equal(st.unofficial, true); // 화면 고지 근거
  const report = await mc.doctor();
  const dump = JSON.stringify(st) + JSON.stringify(report);
  assert.ok(!dump.includes('SECRET_ACCESS') && !dump.includes('SECRET_REFRESH'));
  assert.ok(!('authSignal' in report));
});

test('doctor: refresh 실패는 auth_failed 로 갈리고 SelfState 에 반영된다(재로그인 안내)', async () => {
  const store = await tmpStore();
  await saveV1(store, { kind: 'chatgpt_oauth', credential: { access: 'a', refresh: 'r', expiresAt: 0 } });
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) }) });
  await mc.init();
  const report = await mc.doctor();
  assert.equal(report.state, 'auth_failed');
  assert.ok(report.nextSafeAction.includes('로그인'));
  assert.equal(buildSelfState(env).modelAuthState, 'auth_failed');
});

test('턴 중 refresh 실패: ModelProviderError 로 정규화되고 상태가 auth_failed 로 내려간다(감사 B2)', async () => {
  const store = await tmpStore();
  await saveV1(store, { kind: 'chatgpt_oauth', credential: { access: 'a', refresh: 'SECRET_REFRESH', expiresAt: 0 } });
  const env = {};
  const mc = makeModelConnection({
    env, processEnv: {}, store,
    fetchImpl: async () => ({ status: 400, json: async () => ({ error: 'invalid_grant' }) }),
  });
  await mc.init();
  assert.equal(buildSelfState(env).modelAuthState, 'usable'); // 실행 전에는 낙관적 표시
  await assert.rejects(
    () => mc.model.respond(TC),
    (e) => {
      assert.equal(e.name, 'ModelProviderError');       // 기존 오류 경로(turn·스트림)가 다룰 수 있는 형태
      assert.equal(e.provider, 'chatgpt_oauth');
      assert.ok(!String(e.message).includes('SECRET_REFRESH')); // 원문 토큰 미노출
      return true;
    },
  );
  // 칩이 "준비됨"으로 거짓말하지 않는다 — 다음 턴부터 재로그인 안내
  const after = buildSelfState(env);
  assert.equal(after.modelAuthState, 'auth_failed');
  assert.ok(after.limits.some((l) => l.includes('모델 상태')));
  const report = await mc.doctor();
  assert.equal(report.state, 'auth_failed');
  assert.ok(!JSON.stringify(report).includes('SECRET_REFRESH'));
});

test('옛 codex 모델로 저장된 계정 연결은 재로그인 없이 현재 기본으로 이관된다(라이브 실측 회귀)', async () => {
  // 2026-07-26 오너 실계정: gpt-5.3-codex 는 계정 경로에서 400("not supported when using Codex
  // with a ChatGPT account"). 이미 저장된 사용자를 재로그인시키지 않고 이관해야 한다.
  const store = await tmpStore();
  await saveV1(store, { kind: 'chatgpt_oauth', credential: { access: 'a', refresh: 'r', expiresAt: Date.now() + 600_000 }, modelId: 'gpt-5.3-codex' });
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: async () => ({ status: 200, text: async () => SSE }) });
  await mc.init();
  assert.equal(env.model.id, 'gpt-5.5');
  assert.equal(mc.status().modelId, 'gpt-5.5');
  // 이관 결과가 저장돼 다음 부팅에서 또 고치지 않는다
  assert.equal((await store.load()).connections[0].modelId, 'gpt-5.5');
});

test('모델 거절(계정 경로 미지원)은 자격 실패가 아니라 readiness 축으로 갈린다', async () => {
  const fetchImpl = async () => ({ status: 400, text: async () => '{"detail":"The \'x-codex\' model is not supported when using Codex with a ChatGPT account."}' });
  const client = makeChatGptModelClient({ credentials: async () => ({ access: 'at' }), fetchImpl });
  await assert.rejects(() => client.respond(TC), (e) => {
    assert.ok(e.authSignal.startsWith('model_missing '), '키가 잘못됐다고 오해하게 만들지 않는다');
    return true;
  });
});

test('활성은 항상 하나: 계정 연결 상태에서 키 연결이 오면 키가 이긴다', async () => {
  const store = await tmpStore();
  await saveV1(store, { kind: 'chatgpt_oauth', credential: { access: 'a', refresh: 'r', expiresAt: Date.now() + 600_000 } });
  const env = {};
  const fetchImpl = async (url) => {
    if (url.includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'beai-8.6' }] }) };
    return { status: 200, json: async () => ({ choices: [{ message: { content: '키 연결 응답' } }] }) };
  };
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl });
  await mc.init();
  assert.equal(mc.status().provider, 'chatgpt_oauth');
  const r = await mc.connect({ provider: 'beai', key: 'beai_sk_x' });
  assert.equal(r.connected, true);
  assert.equal(mc.status().provider, 'beai');
  assert.equal(await mc.model.respond(TC), '키 연결 응답');
});

// ── HTTP 표면 ─────────────────────────────────────────────────────────────
test('서버: 계정 연결 미배선(demo)이면 로그인 라우트는 400으로 정직하게 거절', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-oauthsrv-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/model/chatgpt/login`, { method: 'POST' })).status, 400);
    assert.equal((await fetch(`${base}/model/chatgpt/await`, { method: 'POST' })).status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});

test('서버: 계정 연결 상태의 /model/connection 은 비공식 고지 포함·토큰 미노출', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-oauthsrv2-'));
  const store = new ModelConnectionStore(dir);
  await saveV1(store, { kind: 'chatgpt_oauth', credential: { access: 'TOKEN_SECRET', refresh: 'R', expiresAt: Date.now() + 600_000 } });
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: async () => ({ status: 200, text: async () => SSE }) });
  await mc.init();
  const server = makeServer({ store: new SessionStore(dir), env, model: mc.model, modelConnection: mc, modelDoctor: () => mc.doctor() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const raw = await (await fetch(`${base}/model/connection`)).text();
    assert.ok(!raw.includes('TOKEN_SECRET'));
    const st = JSON.parse(raw);
    assert.equal(st.unofficial, true);
    assert.equal(st.modelId, 'gpt-5.5');
  } finally { await new Promise((r) => server.close(r)); }
});
