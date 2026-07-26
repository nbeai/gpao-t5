// P-RT-2 · Provider Doctor 검증. 실 API 미호출(fetchImpl 주입).
// 핵심 검증: "구성됨→검증됨"이 리포트로 끝나지 않고 SelfState 단일 진실(env.model)에 실제로
// 착지하는지 — doctor 후 buildSelfState 가 진실을 표시해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkModelHealth, describeUnprobedModel } from '../src/runtime/model-doctor.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { liveDeps } from '../src/surface/live-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

function fakeFetch(status, json) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => json };
  };
  return { impl, calls };
}

// ── state 분기 ────────────────────────────────────────────────────────────
test('doctor: 자격 미구성 → stub (fetch 자체를 하지 않는다)', async () => {
  let called = 0;
  const r = await checkModelHealth({}, { fetchImpl: async () => { called += 1; } });
  assert.equal(r.state, 'stub');
  assert.equal(called, 0);
});

test('doctor: 목록에 설정 모델 있음 → usable (beai 와이어: GET /models + Bearer)', async () => {
  const { impl, calls } = fakeFetch(200, { data: [{ id: 'beai-8.6' }] });
  const r = await checkModelHealth({ BEAI_API_KEY: 'beai_sk_x' }, { fetchImpl: impl });
  assert.equal(r.state, 'usable');
  assert.equal(r.modelListed, true);
  assert.equal(calls[0].url, 'https://chat.beai.kr/api/external/v1/models');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.authorization, 'Bearer beai_sk_x');
});

test('doctor: 키는 유효한데 설정 모델이 목록에 없음 → model_missing + 대안 제시 (gemini 낡음 시나리오)', async () => {
  const { impl } = fakeFetch(200, { models: [{ name: 'models/gemini-3.6-flash' }, { name: 'models/gemini-flash-latest' }] });
  const r = await checkModelHealth(
    { GEMINI_API_KEY: 'g-1', GPAO_T5_MODEL_ID: 'gemini-2.5-flash' }, { fetchImpl: impl });
  assert.equal(r.state, 'model_missing');
  assert.ok(r.userSafeSummary.includes('gemini-2.5-flash'));
  assert.ok(r.nextSafeAction.includes('gemini-3.6-flash')); // 막다른 답 금지 — 대안을 준다
});

test('doctor: 401 → auth_failed / 429 quota → billing_blocked (kernel 분류 단일 소스)', async () => {
  const auth = await checkModelHealth({ OPENAI_API_KEY: 'sk-bad' },
    { fetchImpl: fakeFetch(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key' } }).impl });
  assert.equal(auth.state, 'auth_failed');
  assert.ok(auth.userSafeSummary.includes('키'));
  const billing = await checkModelHealth({ OPENAI_API_KEY: 'sk-o' },
    { fetchImpl: fakeFetch(429, { error: { code: 'insufficient_quota', message: 'exceeded your current quota' } }).impl });
  assert.equal(billing.state, 'billing_blocked');
});

test('doctor: 네트워크 불가 → unreachable / 5xx → unreachable(일시 장애, 자격 오염 없음)', async () => {
  const net = await checkModelHealth({ BEAI_API_KEY: 'k' }, { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(net.state, 'unreachable');
  const server5xx = await checkModelHealth({ BEAI_API_KEY: 'k' }, { fetchImpl: fakeFetch(503, {}).impl });
  assert.equal(server5xx.state, 'unreachable');
});

test('doctor: 목록 미구현 호환 서버(빈 목록) → usable + modelListed:null (정직한 한계 표시)', async () => {
  const r = await checkModelHealth(
    { GPAO_T5_MODEL_BASE_URL: 'http://localhost:11434/v1', GPAO_T5_MODEL_ID: 'llama3.3' },
    { fetchImpl: fakeFetch(200, {}).impl });
  assert.equal(r.state, 'usable');
  assert.equal(r.modelListed, null);
  assert.ok(r.userSafeSummary.includes('확인 못 했'));
});

// ── 단일 진실 착지: doctor → env.model → buildSelfState ──────────────────
test('liveDeps.modelDoctor: 자격 실패가 SelfState 에 실제로 반영된다(구성됨→검증됨)', async () => {
  const { impl } = fakeFetch(401, { error: { code: 'invalid_api_key', message: 'bad key' } });
  const d = liveDeps({ OPENAI_API_KEY: 'sk-expired' }, { fetchImpl: impl });
  // doctor 전: 구성됨 = 낙관적 ok
  assert.equal(buildSelfState(d.env).modelAuthState, 'usable');
  const report = await d.modelDoctor();
  assert.equal(report.state, 'auth_failed');
  // doctor 후: 같은 env 를 읽는 SelfState 가 진실을 표시(기존 칩 limits 가 자동 표면)
  const after = buildSelfState(d.env);
  assert.equal(after.modelAuthState, 'auth_failed');
  assert.ok(after.limits.some((l) => l.includes('모델 상태')));
});

test('liveDeps.modelDoctor: 재검증으로 회복되면 표시도 회복된다(ok 복귀)', async () => {
  let status = 401, body = { error: { code: 'invalid_api_key', message: 'bad' } };
  const impl = async () => ({ status, json: async () => body });
  const d = liveDeps({ BEAI_API_KEY: 'k' }, { fetchImpl: impl });
  await d.modelDoctor();
  assert.equal(buildSelfState(d.env).modelAuthState, 'auth_failed');
  status = 200; body = { data: [{ id: 'beai-8.6' }] };
  const r2 = await d.modelDoctor();
  assert.equal(r2.state, 'usable');
  assert.equal(buildSelfState(d.env).modelAuthState, 'usable');
});

test('liveDeps.modelDoctor: model_missing 은 자격(authSignal)을 오염시키지 않는다', async () => {
  const { impl } = fakeFetch(200, { models: [{ name: 'models/gemini-flash-latest' }] });
  const d = liveDeps({ GEMINI_API_KEY: 'g-1', GPAO_T5_MODEL_ID: 'stale-model' }, { fetchImpl: impl });
  const report = await d.modelDoctor();
  assert.equal(report.state, 'model_missing');
  assert.equal(buildSelfState(d.env).modelAuthState, 'usable'); // 자격은 유효 — 리포트로만 안내
});

// ── 서버 표면 ─────────────────────────────────────────────────────────────
test('GET /model/health: doctor 배선 시 실 리포트, 미배선(demo)은 stub/unverified 로 정직하게', async () => {
  // 배선된 서버
  const dir1 = await mkdtemp(join(tmpdir(), 'gpao-t5-doc1-'));
  const { impl } = fakeFetch(200, { data: [{ id: 'beai-8.6' }] });
  const d = liveDeps({ BEAI_API_KEY: 'k' }, { fetchImpl: impl });
  const s1 = makeServer({ store: new SessionStore(dir1), env: d.env, model: d.model, modelDoctor: d.modelDoctor });
  await new Promise((r) => s1.listen(0, r));
  try {
    const r = await (await fetch(`http://127.0.0.1:${s1.address().port}/model/health`)).json();
    assert.equal(r.state, 'usable');
  } finally { await new Promise((r) => s1.close(r)); }
  // 미배선(demo 기본) 서버 — 검증 안 됨을 검증됨처럼 말하지 않는다
  const dir2 = await mkdtemp(join(tmpdir(), 'gpao-t5-doc2-'));
  const s2 = makeServer({ store: new SessionStore(dir2) });
  await new Promise((r) => s2.listen(0, r));
  try {
    const r = await (await fetch(`http://127.0.0.1:${s2.address().port}/model/health`)).json();
    assert.equal(r.state, 'stub'); // demo env 는 beai5-stub
  } finally { await new Promise((r) => s2.close(r)); }
});

test('describeUnprobedModel: 실 모델 id 인데 미검증이면 unverified (과장 금지)', () => {
  assert.equal(describeUnprobedModel({ id: 'beai5-stub' }).state, 'stub');
  const r = describeUnprobedModel({ id: 'gpt-5.1' });
  assert.equal(r.state, 'unverified');
  assert.ok(r.userSafeSummary.includes('아직'));
});
