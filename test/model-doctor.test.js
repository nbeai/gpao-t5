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

test('liveDeps.modelDoctor: model_missing — 자격은 오염 없이, 별도 축으로 "준비됨"을 막는다(감사 B1)', async () => {
  const { impl } = fakeFetch(200, { models: [{ name: 'models/gemini-flash-latest' }] });
  const d = liveDeps({ GEMINI_API_KEY: 'g-1', GPAO_T5_MODEL_ID: 'stale-model' }, { fetchImpl: impl });
  const report = await d.modelDoctor();
  assert.equal(report.state, 'model_missing');
  const after = buildSelfState(d.env);
  assert.equal(after.modelAuthState, 'usable');                 // 자격 축은 유효(오염 없음)
  assert.equal(after.modelHealthState, 'model_missing');        // readiness 축이 진실을 나른다
  assert.ok(after.limits.some((l) => l.includes('모델 확인 필요')), '한계로 정직 표시');
  const { selfStateSummary } = await import('../src/kernel/l0-evidence/self-state.js');
  const summary = selfStateSummary(after);
  assert.equal(summary.modelHealthState, 'model_missing');      // 칩까지 도달 — "준비됨"으로 남지 못한다
});

test('칩 매핑: index.html 이 model_missing/unreachable 을 "모델 확인 필요"로 표시한다(감사 B1)', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('모델 확인 필요'), '칩 문구 존재');
  assert.ok(html.includes('modelStatus'), '칩이 auth·health·id 결합 정본을 실제로 읽는다');
  assert.ok(!html.includes('const healthIssue = s.modelHealthState'), '화면이 health를 다시 합성한다');
});

test('초기 화면은 stub 를 준비됨으로 꾸미지 않고 저장된 연결 사실을 즉시 갱신한다', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('beai5-stub · 준비됨'), false,
    '실제 연결을 읽기 전 정적 stub 를 준비된 모델로 노출한다');
  assert.ok(html.includes('모델 확인 중…'), '연결 확인 전 중립 상태가 없다');
  assert.ok(html.includes('async function refreshInitialModelStatus()'), '첫 턴 전 연결 상태 갱신 경로가 없다');
  assert.ok(html.includes('await refreshInitialModelStatus();'), '초기화가 연결 상태 갱신을 실제로 부르지 않는다');
  for (const id of ['brandSearch', 'settingsbtn', 'theme']) {
    assert.match(html, new RegExp(`<button[^>]+id="${id}"`), `${id} 가 누를 수 있는 button 이 아니다`);
  }
});

test('공개 리포트 위생: provider 원문(키 조각 포함)·authSignal 이 /model/health 로 새지 않는다(감사 B2)', async () => {
  const { impl } = fakeFetch(401, { error: { code: 'invalid_api_key', message: 'bad key sk-secret-abc leaked-internal-code' } });
  const d = liveDeps({ OPENAI_API_KEY: 'sk-secret-abc' }, { fetchImpl: impl });
  // 1) doctor 공개 리포트 자체가 깨끗해야 한다
  const report = await d.modelDoctor();
  const reportJson = JSON.stringify(report);
  assert.ok(!reportJson.includes('sk-secret-abc'), '키 조각 미노출');
  assert.ok(!('authSignal' in report), 'authSignal 은 내부 전용');
  assert.equal(report.state, 'auth_failed'); // 상태·사용자 언어는 유지
  // 2) 내부 갱신은 여전히 동작(env.model 로만)
  assert.equal(buildSelfState(d.env).modelAuthState, 'auth_failed');
  // 3) HTTP 표면에서도 동일
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-doc3-'));
  const s = makeServer({ store: new SessionStore(dir), env: d.env, model: d.model, modelDoctor: d.modelDoctor });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  try {
    const raw = await (await fetch(`http://127.0.0.1:${s.address().port}/model/health`)).text();
    assert.ok(!raw.includes('sk-secret-abc'));
    assert.ok(!raw.includes('authSignal'));
  } finally { await new Promise((r) => s.close(r)); }
});

// ── 서버 표면 ─────────────────────────────────────────────────────────────
test('GET /model/health: doctor 배선 시 실 리포트, 미배선(demo)은 stub/unverified 로 정직하게', async () => {
  // 배선된 서버
  const dir1 = await mkdtemp(join(tmpdir(), 'gpao-t5-doc1-'));
  const { impl } = fakeFetch(200, { data: [{ id: 'beai-8.6' }] });
  const d = liveDeps({ BEAI_API_KEY: 'k' }, { fetchImpl: impl });
  const s1 = makeServer({ store: new SessionStore(dir1), env: d.env, model: d.model, modelDoctor: d.modelDoctor });
  await new Promise((r) => s1.listen(0, '127.0.0.1', r));
  try {
    const r = await (await fetch(`http://127.0.0.1:${s1.address().port}/model/health`)).json();
    assert.equal(r.state, 'usable');
  } finally { await new Promise((r) => s1.close(r)); }
  // 미배선(demo 기본) 서버 — 검증 안 됨을 검증됨처럼 말하지 않는다
  const dir2 = await mkdtemp(join(tmpdir(), 'gpao-t5-doc2-'));
  const s2 = makeServer({ store: new SessionStore(dir2) });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
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
