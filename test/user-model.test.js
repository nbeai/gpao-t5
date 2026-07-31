import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeInferredTrait, makeOperatingPreference, confirmOperatingPreference, projectUserModel, USER_MODEL_KINDS } from '../src/kernel/l1-intent/user-model.js';
import { isInfluenceEligible, admittedContext } from '../src/kernel/l1-intent/context-mesh.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// P6-17 Slice-3 User Model 분리 — 추정된 성향(관찰만, 영향 0) ↔ 승인된 운영 선호(userConfirmed 후 좁게 입장).
// 둘은 kind/lane에서 섞이지 않는다.

// ── 추정 성향: 관찰만, 어떤 경우에도 영향 0 ──
test('inferred_trait은 영향 자격 없음 — userConfirmed를 강제해도 eligible 아님', () => {
  const trait = makeInferredTrait('t1', '아마 아침에 활동적일 거예요', ['오전 로그인 잦음']);
  assert.equal(trait.kind, 'inferred_trait');
  assert.equal(trait.admitted, false);
  assert.equal(isInfluenceEligible(trait), false);
  // 방어적 이중화: 누군가 userConfirmed/ admitted를 강제로 켜도 kind로 거부한다.
  assert.equal(isInfluenceEligible({ ...trait, userConfirmed: true, admitted: true }), false, '추정은 kind로 영구 차단');
});

test('inferred_trait은 promoted 레인에 잘못 들어가도 admittedContext에 안 섞인다', () => {
  const trait = makeInferredTrait('t1', '보고서를 표로 받는 걸 좋아할 수도', []);
  // 레인이 뚫려(promoted에 들어가고 userConfirmed까지 켜진) 최악의 경우에도 gate가 막는다.
  const leaked = { ...trait, userConfirmed: true, admitted: true };
  assert.deepEqual(admittedContext({ promoted: [leaked] }, '보고서를 표로 정리해줘'), [], '추정은 절대 answer 맥락에 안 들어간다');
});

// ── 승인된 운영 선호: userConfirmed 후에만 좁게 입장 ──
test('operating_preference는 확인 전 영향 0, 확인 후 관련될 때만 입장', () => {
  const pref = makeOperatingPreference('p1', '표로 정리해서 주세요');
  assert.equal(pref.kind, 'operating_preference');
  assert.equal(isInfluenceEligible(pref), false, '후보는 영향 0');
  assert.deepEqual(admittedContext({ promoted: [pref] }, '매출 표로 정리해줘'), [], '확인 전엔 입장 안 함');
  const { ok, entry } = confirmOperatingPreference(pref);
  assert.equal(ok, true);
  assert.equal(isInfluenceEligible(entry), true, '확인 후 영향 자격');
  assert.deepEqual(admittedContext({ promoted: [entry] }, '매출 표로 정리해줘'), [pref.statement], '관련되면 좁게 입장');
  assert.deepEqual(admittedContext({ promoted: [entry] }, '오늘 날씨 어때'), [], '무관하면 입장 안 함');
});

// ── 분리: 추정과 승인 선호가 섞이지 않는다 ──
test('projectUserModel: 추정됨(influence:none)과 운영 선호(pending/admitted) 분리', () => {
  const { ok, entry } = confirmOperatingPreference(makeOperatingPreference('p2', '글로 요약해줘'));
  const memory = {
    observed: [makeInferredTrait('t1', '아침형일 수도', [])],
    candidates: [makeOperatingPreference('p1', '표로 주세요')],
    promoted: [entry],
  };
  const view = projectUserModel(memory);
  assert.equal(view.inferredTraits.length, 1);
  assert.equal(view.inferredTraits[0].influence, 'none');
  assert.equal(view.inferredTraits[0].admitted, false);
  // 운영 선호: pending 1 + admitted 1, 추정은 여기 안 섞인다.
  assert.equal(view.operatingPreferences.length, 2);
  assert.ok(view.operatingPreferences.some((p) => p.status === 'pending_confirm'));
  assert.ok(view.operatingPreferences.some((p) => p.status === 'admitted' && p.admitted === true));
  assert.ok(view.operatingPreferences.every((p) => p.statement !== '아침형일 수도'), '추정이 운영 선호로 새지 않음');
  assert.ok(USER_MODEL_KINDS.includes('inferred_trait') && USER_MODEL_KINDS.includes('operating_preference'));
});

// ── 서버 최소 API ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-um-'));
  const store = new SessionStore(dir);
  const server = makeServer({ store, env: demoEnv(), tools: demoTools() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`, store); }
  finally { await new Promise((r) => server.close(r)); }
}

test('서버: 추정은 관찰(influence none), 운영 선호는 확인 후 admitted — GET에서 분리', async () => {
  await withServer(async (base) => {
    // 추정 기록
    const t = await (await post(base, '/user-model/traits', { statement: '아침에 활동적일 수도', evidence: ['오전 로그인'] })).json();
    assert.equal(t.trait.admitted, false);
    assert.equal(t.trait.influence, 'none');
    // 운영 선호 후보 → 확인
    const p = await (await post(base, '/user-model/preferences', { statement: '표로 정리해서 주세요' })).json();
    assert.equal(p.preference.status, 'pending_confirm');
    let view = await getj(base, '/user-model');
    assert.equal(view.inferredTraits.length, 1);
    assert.equal(view.operatingPreferences.find((x) => x.id === p.preference.id).status, 'pending_confirm');
    const conf = await (await post(base, `/user-model/preferences/${p.preference.id}/confirm`)).json();
    assert.equal(conf.ok, true);
    assert.equal(conf.status, 'admitted');
    view = await getj(base, '/user-model');
    // 추정은 여전히 관찰만, 운영 선호는 admitted로.
    assert.ok(view.inferredTraits.every((x) => x.admitted === false && x.influence === 'none'));
    assert.ok(view.operatingPreferences.some((x) => x.status === 'admitted'));
  });
});

test('서버: 추정 성향은 promoted에 안 들어가 admittedContext에 안 섞인다(저장 확인)', async () => {
  await withServer(async (base, store) => {
    await post(base, '/user-model/traits', { statement: '보고서를 표로 좋아할 수도', evidence: [] });
    // 저장된 메모리를 직접 읽어 promoted에는 없고 observed에만 있음을 확인.
    const { MemoryStore } = await import('../src/surface/memory-store.js');
    const memory = await new MemoryStore(store.dir).load();
    assert.equal(memory.observed.length, 1, 'observed 레인에 기록');
    assert.equal((memory.promoted ?? []).length, 0, 'promoted엔 없음');
    assert.deepEqual(admittedContext(memory, '보고서를 표로 정리해줘'), [], '추정은 admittedContext에 안 섞인다');
  });
});

test('서버: 빈 statement는 400(추정·선호 둘 다)', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, '/user-model/traits', {})).status, 400);
    assert.equal((await post(base, '/user-model/preferences', { statement: '  ' })).status, 400);
  });
});
