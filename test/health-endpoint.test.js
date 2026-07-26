// P-DIST-1 · /health 계약 검증. 설치 스크립트가 이 한 줄로 "도달했는가"를 판정한다.
// 핵심: **거짓 초록 금지** — 서버가 살아 있으면 ok:true 이되, 모델 연결 여부는 있는 그대로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { OnboardingStore } from '../src/surface/onboarding-store.js';
import { makeModelConnection, ModelConnectionStore } from '../src/surface/model-connection.js';

function providerFetch() {
  return async (url) => {
    if (url.includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'beai-8.6' }] }) };
    return { status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
}

async function withServer(fn, deps = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-health-'));
  const server = makeServer({ store: new SessionStore(dir), onboardingStore: new OnboardingStore(dir), ...deps(dir) });
  await new Promise((r) => server.listen(0, r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('/health: 모델이 없어도 서버가 살아 있으면 ok:true — 다만 connected 를 꾸미지 않는다', async () => {
  await withServer(async (base) => {
    const h = await (await fetch(`${base}/health`)).json();
    assert.equal(h.ok, true);              // 서버는 도달했다
    assert.equal(h.model.connected, false); // 그러나 모델은 없다 — 정직하게
    assert.equal(h.model.id, 'beai5-stub');
    assert.equal(h.onboarding.needed, true); // 설치 직후엔 온보딩이 뜬다(§6.27 전제)
  }, () => ({}));
});

test('/health: 연결되면 connected:true 와 실제 모델 id 가 실리고 온보딩은 불필요해진다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-health2-'));
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl: providerFetch() });
  await mc.connect({ provider: 'beai', key: 'k' });
  const server = makeServer({
    store: new SessionStore(dir), onboardingStore: new OnboardingStore(dir),
    env, model: mc.model, modelConnection: mc,
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const h = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.model.connected, true);
    assert.equal(h.model.id, 'beai-8.6');
    assert.equal(h.model.healthState, 'usable');
    assert.equal(h.onboarding.needed, false);
  } finally { await new Promise((r) => server.close(r)); }
});

test('/health: 검증 안 된 구성은 healthState 를 검증됨이라 말하지 않는다(§6.23 두 축 승계)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-health3-'));
  const env = {};
  // 도달 불가(불확실) — §6.27 정책상 저장·활성되지만 검증됨은 아니다
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await mc.connect({ provider: 'beai', key: 'k' });
  const server = makeServer({ store: new SessionStore(dir), onboardingStore: new OnboardingStore(dir), env, model: mc.model, modelConnection: mc });
  await new Promise((r) => server.listen(0, r));
  try {
    const h = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.model.connected, true);
    assert.equal(h.model.healthState, 'unreachable'); // "usable" 로 꾸미지 않는다
  } finally { await new Promise((r) => server.close(r)); }
});

test('패키지 계약: bin 진입점과 files 화이트리스트가 선언돼 있다(산출물 누락 사고 방지)', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['gpao-t5'], 'bin/gpao-t5.mjs');
  assert.deepEqual(pkg.files, ['bin', 'src']);           // 무엇이 나가는지 명시
  assert.ok(pkg.scripts['verify:package'], '산출물 검증 게이트가 스크립트로 노출된다');
});
