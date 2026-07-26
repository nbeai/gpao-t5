// P-ONB-2 · 첫 실행 온보딩 + 웰컴 검증. 실 API 미호출(fetchImpl 주입).
// 핵심: ①needed 판정은 서버측 단일 진실(연결 0 && 미건너뜀) ②건너뛰기 영속 ③연결되면 자동 해제
// ④확실한 무효만 저장 거절(불확실은 저장하되 미검증) ⑤인사말은 모델 생성·미연결이면 미생성
// ⑥숨은 지시가 transcript 에 남지 않음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OnboardingStore, onboardingNeeded } from '../src/surface/onboarding-store.js';
import { buildWelcomeContext, makeWelcome, NOT_CONNECTED_NOTICE } from '../src/surface/welcome.js';
import { makeModelConnection, ModelConnectionStore, CERTAINLY_INVALID } from '../src/surface/model-connection.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

function providerFetch({ listStatus = 200, listBody, reply = '연결된 모델의 답' } = {}) {
  const impl = async (url) => {
    if (url.includes('/models')) return { status: listStatus, json: async () => listBody ?? { data: [{ id: 'beai-8.6' }] } };
    return { status: 200, json: async () => ({ choices: [{ message: { content: reply } }] }) };
  };
  return { impl };
}

// ── needed 판정(단일 진실) ────────────────────────────────────────────────
test('onboardingNeeded: 연결 0 + 미건너뜀이면 필요, 연결이 생기면 자동으로 불필요', () => {
  assert.equal(onboardingNeeded({}, { connectionCount: 0 }), true);
  assert.equal(onboardingNeeded({}, { connectionCount: 1 }), false); // 완료 클릭 없이 자동 해제
  assert.equal(onboardingNeeded({ skippedAt: '2026-07-26T00:00:00Z' }, { connectionCount: 0 }), false);
});

test('OnboardingStore: 상태는 파일 하나에 누적되고 재시작 후에도 남는다(T3 4곳 분산 반대)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-onb-'));
  const s1 = new OnboardingStore(dir);
  assert.deepEqual(await s1.load(), {});
  await s1.patch({ skippedAt: 'T1' });
  await s1.patch({ seenWelcome: true });
  const s2 = new OnboardingStore(dir); // 재시작
  const st = await s2.load();
  assert.equal(st.skippedAt, 'T1');
  assert.equal(st.seenWelcome, true);
});

// ── 저장 정책 보정 ────────────────────────────────────────────────────────
test('불확실(도달 불가)은 저장·활성하되 검증됨이라 말하지 않는다 — 사내 프록시 사용자를 막지 않는다', async () => {
  const env = {};
  const store = new ModelConnectionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-onb2-')));
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await mc.connect({ provider: 'beai', key: 'beai_sk_proxy' });
  assert.equal(r.connected, true);
  assert.equal(r.verified, false);                 // 저장됐다 ≠ 검증됐다
  assert.equal(r.report.state, 'unreachable');
  assert.equal(env.model.id, 'beai-8.6');
  assert.equal(env.model.healthState, 'unreachable');
  // 거짓 초록 금지(§6.23): 칩이 "준비됨"으로 남지 않는다
  assert.ok(buildSelfState(env).limits.some((l) => l.includes('모델 확인 필요')));
  assert.equal((await store.load()).connections.length, 1);
});

test('rate_limited 도 저장 허용(혼잡은 무효가 아니다)', async () => {
  const env = {};
  const { impl } = providerFetch({ listStatus: 429, listBody: { error: { message: 'rate limit exceeded' } } });
  const mc = makeModelConnection({ env, processEnv: {}, fetchImpl: impl });
  const r = await mc.connect({ provider: 'beai', key: 'k' });
  assert.equal(r.connected, true);
  assert.equal(r.verified, false);
});

test('확실한 무효(자격 거부·모델 없음·결제)는 여전히 거절한다', async () => {
  assert.deepEqual([...CERTAINLY_INVALID].sort(), ['auth_failed', 'billing_blocked', 'model_missing']);
  const env = {};
  const { impl } = providerFetch({ listStatus: 401, listBody: { error: { code: 'invalid_api_key' } } });
  const mc = makeModelConnection({ env, processEnv: {}, fetchImpl: impl });
  const r = await mc.connect({ provider: 'beai', key: 'bad' });
  assert.equal(r.connected, false);
  assert.equal(env.model.id, 'beai5-stub'); // 기존 유지
});

// ── 웰컴 ──────────────────────────────────────────────────────────────────
test('buildWelcomeContext: 규격만 지시하고 문장은 모델에 맡긴다(사실은 자기상태에서)', () => {
  const tc = buildWelcomeContext(buildSelfState(demoEnv()));
  assert.equal(tc.answerMode, 'fast_chat');
  assert.ok(tc.currentRequest.includes('1~3문장'));
  assert.ok(tc.currentRequest.includes('언급하지 마'));      // 내부 단계·도구 id 금지
  assert.ok(Array.isArray(tc.selfStateFacts.readyTools));    // 근거는 실제 자기상태
  assert.deepEqual(tc.authorityFacts.needsApproval, []);     // 인사는 실행이 아니다
});

test('makeWelcome: 연결됐으면 모델이 만든 문장을 쓰고, 미연결이면 인사를 지어내지 않는다', async () => {
  const selfState = buildSelfState(demoEnv());
  let asked = null;
  const model = { respond: async (tc) => { asked = tc; return '안녕하세요, 무엇부터 도와드릴까요?'; } };
  const ok = await makeWelcome({ model, selfState, connected: true });
  assert.equal(ok.state, 'greeted');
  assert.equal(ok.text, '안녕하세요, 무엇부터 도와드릴까요?');
  assert.ok(asked.currentRequest.length, '모델에게 규격을 넘겼다');

  const none = await makeWelcome({ model: { respond: async () => '지어낸 인사' }, selfState, connected: false });
  assert.equal(none.state, 'not_connected');
  assert.equal(none.text, undefined);
  assert.equal(none.userSafeSummary, NOT_CONNECTED_NOTICE.userSafeSummary);
});

// ── 서버 표면 ─────────────────────────────────────────────────────────────
test('서버: 첫 실행이면 needed=true, 연결하면 false, 건너뛰면 영속적으로 false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-onbsrv-'));
  const env = {};
  const { impl } = providerFetch();
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl: impl });
  const onboardingStore = new OnboardingStore(dir);
  const server = makeServer({ store: new SessionStore(dir), env, model: mc.model, modelConnection: mc, onboardingStore });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/onboarding`)).json()).needed, true);
    await fetch(`${base}/onboarding/skip`, { method: 'POST' });
    const afterSkip = await (await fetch(`${base}/onboarding`)).json();
    assert.equal(afterSkip.needed, false);
    assert.equal(afterSkip.skipped, true); // 영속 탈출구 — 다시 조르지 않는다
    assert.equal((await onboardingStore.load()).skippedAt !== undefined, true);

    await mc.connect({ provider: 'beai', key: 'k' });
    assert.equal((await (await fetch(`${base}/onboarding`)).json()).needed, false);
  } finally { await new Promise((r) => server.close(r)); }
});

test('서버 /welcome: 인사를 transcript 에 남기되 숨은 지시는 남기지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-onbsrv2-'));
  const env = {};
  const { impl } = providerFetch({ reply: '반가워요. 무엇을 도와드릴까요?' });
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'k' });
  const sessionStore = new SessionStore(dir);
  const server = makeServer({ store: sessionStore, env, model: mc.model, modelConnection: mc, onboardingStore: new OnboardingStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const w = await (await fetch(`${base}/welcome`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id }),
    })).json();
    assert.equal(w.state, 'greeted');
    assert.equal(w.text, '반가워요. 무엇을 도와드릴까요?');

    const saved = await sessionStore.load(s.id);
    assert.equal(saved.transcript.length, 1);
    assert.equal(saved.transcript[0].role, 'assistant');       // 사용자 발화로 위장하지 않는다
    assert.ok(!saved.transcript.some((e) => e.role === 'user'));
    assert.equal((await (await fetch(`${base}/onboarding`)).json()).seenWelcome, true); // 1회성
  } finally { await new Promise((r) => server.close(r)); }
});

test('서버 /welcome: 이미 오간 대화에는 인사가 끼어들지 않는다(라이브 실측 회귀)', async () => {
  // 2026-07-26 실사용에서 발견: 진행 중이던 대화 한가운데 첫인사가 붙어 흐름을 끊었다.
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-onbsrv4-'));
  const env = {};
  const { impl } = providerFetch({ reply: '끼어든 인사' });
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'k' });
  const sessionStore = new SessionStore(dir);
  const server = makeServer({ store: sessionStore, env, model: mc.model, modelConnection: mc, onboardingStore: new OnboardingStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const session = await sessionStore.load(s.id);
    session.transcript.push({ role: 'user', text: '이미 대화 중' }); // 진행 중인 대화
    await sessionStore.save(session);

    const w = await (await fetch(`${base}/welcome`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id }),
    })).json();
    assert.equal(w.state, 'skipped_existing');
    assert.equal(w.text, undefined);
    const after = await sessionStore.load(s.id);
    assert.equal(after.transcript.length, 1, '대화에 인사가 추가되지 않는다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('서버 /welcome: 모델 미연결이면 인사를 만들지 않고 정직하게 안내한다(fail-closed)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-onbsrv3-'));
  const server = makeServer({ store: new SessionStore(dir), onboardingStore: new OnboardingStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const w = await (await fetch(`${base}/welcome`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id }),
    })).json();
    assert.equal(w.state, 'not_connected');
    assert.ok(w.userSafeSummary.includes('연결'));
    assert.equal(w.text, undefined);
    const saved = await new SessionStore(dir).load(s.id);
    assert.equal(saved.transcript.length, 0); // 가짜 인사를 남기지 않는다
    // 라이브 실측 회귀: 미연결로 한 번 열었다고 1회성 표식이 켜지면 나중에 연결해도 첫인사를 못 받는다
    assert.equal((await (await fetch(`${base}/onboarding`)).json()).seenWelcome, false);
  } finally { await new Promise((r) => server.close(r)); }
});
