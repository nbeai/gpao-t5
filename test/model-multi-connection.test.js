// P-ONB-1 · 다중 연결 + 선택 + 역할 바인딩 검증. 실 API 미호출(fetchImpl 주입).
// 핵심: v1→v2 이관 · 여러 연결 보관/중복 갱신 · 전환이 다음 respond 에 반영(핫스왑) ·
// 역할 바인딩 우선(없으면 조용히 기본 — 허용목록 아님) · 삭제 시 승계 · 목록에 원본 키 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeModelConnection, ModelConnectionStore, migrateConnectionFile, connectionId, DEFAULT_ROLE,
} from '../src/surface/model-connection.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const TC = {
  currentRequest: '안녕', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'fast_chat', naturalness: 'method_and_language_open',
};

/** provider 별로 다른 답을 주는 fetch — 어느 연결이 실제로 쓰였는지 응답으로 구분한다. */
function multiFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('googleapis.com')) {
      if (url.includes(':generateContent')) return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'gemini 응답' }] } }] }) };
      return { status: 200, json: async () => ({ models: [{ name: 'models/gemini-flash-latest' }] }) };
    }
    if (url.includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'beai-8.6' }] }) };
    return { status: 200, json: async () => ({ choices: [{ message: { content: 'beai 응답' } }] }) };
  };
  return { impl, calls };
}

async function tmpStore() { return new ModelConnectionStore(await mkdtemp(join(tmpdir(), 'gpao-t5-multi-'))); }

async function twoConnections() {
  const store = await tmpStore();
  const env = {};
  const { impl, calls } = multiFetch();
  const mc = makeModelConnection({ env, processEnv: {}, store, fetchImpl: impl });
  const a = await mc.connect({ provider: 'beai', key: 'beai_sk_1' });
  const b = await mc.connect({ provider: 'gemini', key: 'g_key_1' });
  assert.equal(a.connected, true);
  assert.equal(b.connected, true);
  return { mc, env, store, calls };
}

// ── v1 → v2 이관 ──────────────────────────────────────────────────────────
test('migrateConnectionFile: v1 단일 연결이 목록 1건으로 이관되고 기본값이 채워진다', () => {
  const v2 = migrateConnectionFile({ provider: 'beai', key: 'k' });
  assert.equal(v2.version, 2);
  assert.equal(v2.connections.length, 1);
  assert.equal(v2.connections[0].modelId, 'beai-8.6'); // v1 은 modelId 생략 가능 — 이관에서 확정
  assert.equal(v2.activeId, v2.connections[0].id);
  assert.deepEqual(v2.roleBindings, {});
  const oauth = migrateConnectionFile({ kind: 'chatgpt_oauth', credential: { access: 'a', refresh: 'r' } });
  assert.equal(oauth.connections[0].kind, 'chatgpt_oauth');
  assert.equal(oauth.connections[0].modelId, 'gpt-5.5');
  assert.equal(migrateConnectionFile(null), null);
  assert.equal(migrateConnectionFile({ provider: 'unknown-vendor' }), null); // 못 살리는 건 정직하게 버린다
});

test('v2 저장본은 그대로 통과한다(재이관 없음)', () => {
  const same = migrateConnectionFile({ version: 2, connections: [{ id: 'x', provider: 'beai' }], activeId: 'x', roleBindings: { a: 'x' } });
  assert.equal(same.connections.length, 1);
  assert.deepEqual(same.roleBindings, { a: 'x' });
});

// ── 여러 개 보관·전환 ─────────────────────────────────────────────────────
test('두 개를 연결하면 둘 다 보관되고, 마지막 연결이 기본이 된다', async () => {
  const { mc, env } = await twoConnections();
  const l = mc.list();
  assert.equal(l.connections.length, 2);
  assert.equal(l.activeId, connectionId({ provider: 'gemini', modelId: 'gemini-flash-latest' }));
  assert.equal(env.model.id, 'gemini-flash-latest');
  assert.equal(await mc.model.respond(TC), 'gemini 응답');
});

test('전환(activate): 다음 respond 부터 그 모델이 답한다(핫스왑)', async () => {
  const { mc, env } = await twoConnections();
  const beaiId = connectionId({ provider: 'beai', modelId: 'beai-8.6' });
  const r = await mc.activate(beaiId);
  assert.equal(r.ok, true);
  assert.equal(env.model.id, 'beai-8.6');           // SelfState 단일 진실도 함께 이동
  assert.equal(await mc.model.respond(TC), 'beai 응답');
  assert.equal(mc.list().connections.find((c) => c.active).provider, 'beai');
});

test('없는 연결 전환은 정직하게 거절(기존 유지)', async () => {
  const { mc, env } = await twoConnections();
  const before = env.model.id;
  const r = await mc.activate('nope:none');
  assert.equal(r.ok, false);
  assert.equal(env.model.id, before);
});

test('같은 provider·모델을 다시 연결하면 새 항목이 아니라 갱신된다(중복 누적 금지)', async () => {
  const { mc, calls } = await twoConnections();
  await mc.connect({ provider: 'beai', key: 'beai_sk_2' }); // 키 교체
  assert.equal(mc.list().connections.length, 2);
  assert.equal(await mc.model.respond(TC), 'beai 응답');
  const chat = calls.filter((c) => c.url.includes('/chat/completions')).pop();
  assert.equal(chat.init.headers.authorization, 'Bearer beai_sk_2', '갱신된 키로 호출');
});

// ── 역할 바인딩 ───────────────────────────────────────────────────────────
test('역할 바인딩: 그 역할만 다른 모델을 쓰고, 기본 역할은 그대로다', async () => {
  const { mc } = await twoConnections(); // 기본 = gemini
  const beaiId = connectionId({ provider: 'beai', modelId: 'beai-8.6' });
  const r = await mc.bind('research', beaiId);
  assert.equal(r.ok, true);
  assert.equal(await mc.modelFor('research').respond(TC), 'beai 응답');
  assert.equal(await mc.modelFor(DEFAULT_ROLE).respond(TC), 'gemini 응답');
  assert.equal(await mc.model.respond(TC), 'gemini 응답');
  assert.deepEqual(mc.list().connections.find((c) => c.id === beaiId).roles, ['research']);
});

test('바인딩 없는 역할은 막히지 않고 조용히 기본으로 간다(허용목록 아님 — T3 사고 방지)', async () => {
  const { mc } = await twoConnections();
  assert.equal(await mc.modelFor('처음보는역할').respond(TC), 'gemini 응답');
});

test('바인딩 해제(id=null) 후에는 기본으로 돌아간다', async () => {
  const { mc } = await twoConnections();
  await mc.bind('research', connectionId({ provider: 'beai', modelId: 'beai-8.6' }));
  await mc.bind('research', null);
  assert.equal(await mc.modelFor('research').respond(TC), 'gemini 응답');
  assert.deepEqual(mc.list().roleBindings, {});
});

test('바인딩된 연결을 삭제하면 바인딩도 사라지고 기본으로 폴백한다(막다른 답 금지)', async () => {
  const { mc } = await twoConnections();
  const beaiId = connectionId({ provider: 'beai', modelId: 'beai-8.6' });
  await mc.bind('research', beaiId);
  const r = await mc.remove(beaiId);
  assert.equal(r.ok, true);
  assert.deepEqual(mc.list().roleBindings, {});
  assert.equal(await mc.modelFor('research').respond(TC), 'gemini 응답');
});

test('활성 연결을 삭제하면 남은 것이 승계하고, 마지막까지 지우면 stub 으로 복귀', async () => {
  const { mc, env, store } = await twoConnections();
  const geminiId = connectionId({ provider: 'gemini', modelId: 'gemini-flash-latest' });
  await mc.remove(geminiId);                      // 활성이었던 것 삭제
  assert.equal(env.model.id, 'beai-8.6');         // 남은 것이 승계
  assert.equal(await mc.model.respond(TC), 'beai 응답');
  await mc.remove(connectionId({ provider: 'beai', modelId: 'beai-8.6' }));
  assert.equal(env.model.id, 'beai5-stub');       // 0개 → 정직하게 stub
  assert.equal(await store.load(), null);
});

// ── 지속·위생 ─────────────────────────────────────────────────────────────
test('재시작: 목록·기본·역할 바인딩이 그대로 복원된다', async () => {
  const { mc, store } = await twoConnections();
  const beaiId = connectionId({ provider: 'beai', modelId: 'beai-8.6' });
  await mc.activate(beaiId);
  await mc.bind('research', connectionId({ provider: 'gemini', modelId: 'gemini-flash-latest' }));

  const env2 = {};
  const { impl } = multiFetch();
  const mc2 = makeModelConnection({ env: env2, processEnv: {}, store, fetchImpl: impl });
  await mc2.init();
  const l = mc2.list();
  assert.equal(l.connections.length, 2);
  assert.equal(l.activeId, beaiId);
  assert.equal(l.roleBindings.research, connectionId({ provider: 'gemini', modelId: 'gemini-flash-latest' }));
  assert.equal(await mc2.model.respond(TC), 'beai 응답');
  assert.equal(await mc2.modelFor('research').respond(TC), 'gemini 응답');
});

test('목록 응답에 원본 키가 없다(마스킹만)', async () => {
  const { mc } = await twoConnections();
  const dump = JSON.stringify(mc.list());
  assert.ok(!dump.includes('beai_sk_1'));
  assert.ok(!dump.includes('g_key_1'));
  assert.ok(dump.includes('…'), '마스킹은 남는다');
});

test('서버: /model/connections 목록·전환·바인딩·삭제가 HTTP 로 동작하고 키는 안 나간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-multisrv-'));
  const env = {};
  const { impl } = multiFetch();
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl: impl });
  await mc.connect({ provider: 'beai', key: 'beai_sk_http' });
  await mc.connect({ provider: 'gemini', key: 'g_key_http' });
  const server = makeServer({ store: new SessionStore(dir), env, model: mc.model, modelConnection: mc, modelDoctor: () => mc.doctor() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const raw = await (await fetch(`${base}/model/connections`)).text();
    assert.ok(!raw.includes('beai_sk_http') && !raw.includes('g_key_http'));
    const l = JSON.parse(raw);
    assert.equal(l.connections.length, 2);

    const beaiId = connectionId({ provider: 'beai', modelId: 'beai-8.6' });
    await post('/model/connections/activate', { id: beaiId });
    assert.equal(env.model.id, 'beai-8.6');

    await post('/model/connections/bind', { role: 'research', id: connectionId({ provider: 'gemini', modelId: 'gemini-flash-latest' }) });
    assert.equal((await (await fetch(`${base}/model/connections`)).json()).roleBindings.research, 'gemini:gemini-flash-latest');

    const removed = await (await post('/model/connections/remove', { id: beaiId })).json();
    assert.equal(removed.ok, true);
    assert.equal(removed.connections.length, 1);
  } finally { await new Promise((r) => server.close(r)); }
});

test('서버: 연결 관리자 미배선(demo)이면 목록은 빈 값, 변경은 400', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-multisrv2-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual((await (await fetch(`${base}/model/connections`)).json()).connections, []);
    const r = await fetch(`${base}/model/connections/activate`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});
