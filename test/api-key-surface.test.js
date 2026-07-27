// P5-B-1B · 비밀 입력은 **산출물에서** 검증한다 (절대원칙 1: 소스가 아니라 사용자에게 닿는 것)
//
// 커널 검사가 전부 초록인데 화면이 계약 필드를 안 그려서 사용자가 못 본 일이 이미 있었다
// (승인 카드의 scope). 비밀 입력은 그보다 위험하다 — 화면이 없으면 모델에게 남는 길은
// **"키를 여기 붙여넣어 주세요"** 하나뿐이고, 그 순간 비밀이 대화 기록에 남는다.
//
// 불변식:
//   ① 화면이 비밀 입력 요청을 실제로 그린다 · 기본은 가림 · 저장 후 칸을 비운다
//   ② 값은 대화 통로가 아니라 전용 통로로만 간다
//   ③ 그 통로를 지나도 **세션 기록 어디에도 값이 없다**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { ConnectorCredentialStore } from '../src/surface/connector-credential-store.js';
import { makeConnectorConnectTool } from '../src/runtime/connector-connect.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { demoTools, demoChannels } from '../src/surface/demo-context.js';

const html = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'surface', 'web', 'index.html'),
  'utf8',
);

// ── ① 화면 ────────────────────────────────────────────────────────────
test('화면이 비밀 입력 요청을 그린다 — 없으면 모델이 채팅으로 키를 달라고 한다', () => {
  assert.match(html, /surfaceRequest\?\.kind === 'secret_input'/, '요청을 읽는 곳이 없다');
  assert.match(html, /function renderSecretInput/, '그리는 곳이 없다');
});

test('비밀 칸은 기본이 가림이고, 보기 토글이 있다', () => {
  assert.match(html, /f\.secret \? 'password' : 'text'/, '비밀 칸이 그대로 보인다');
  assert.match(html, /textContent = '보기'/, '보기/숨기기가 없다 — 오타를 확인할 방법이 없다');
});

test('저장 뒤 입력칸을 비운다 — 화면에 남은 값도 유출 경로다', () => {
  assert.match(html, /for \(const input of 칸들\.values\(\)\) input\.value = ''/);
});

test('값은 대화 통로가 아니라 전용 통로로 간다', () => {
  assert.match(html, /fetch\('\/connectors\/secret'/, '전용 통로가 없다');
  // 대화 전송(turn)에 값이 실리면 그 순간 transcript 에 남는다
  const 카드 = html.slice(html.indexOf('function renderSecretInput'), html.indexOf('function renderSuggestion'));
  assert.ok(!/turn\(\{/.test(카드), '비밀 카드가 대화 턴으로 값을 보낸다');
});

// ── ②③ 통로와 기록 ────────────────────────────────────────────────────
const 비밀 = 'sk_LIVE_TEST_7c1d9e';

async function 서버() {
  const dir = await mkdtemp(join(tmpdir(), 't5-keysurf-'));
  const credDir = await mkdtemp(join(tmpdir(), 't5-keycred-'));
  const c = defineConnector({
    id: 'gagagg', label: '가가상점', kind: 'provider',
    authMethods: [{
      kind: 'api_key',
      fields: [{ name: 'client_secret', label: '클라이언트 시크릿', secret: true }],
      verify: { url: 'https://gaga.test/ok', okWhen: { status: 200 } },
    }],
  });
  const tools = demoTools();
  const store = new ConnectorCredentialStore(credDir);
  tools.tools['connector.connect'] = makeConnectorConnectTool({
    ctx: () => ({ tools, descriptors: [], env: { connections: [] } }),
    connectors: () => [c], credentialStore: store,
    fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({}), text: async () => '' }),
  });
  const server = makeServer({
    sessionStore: new SessionStore(dir), tools, channels: demoChannels(), connectors: [c],
  });
  return { server, dir, store, c };
}

/** **진짜로 띄워서 진짜로 부른다.** 가짜 req/res 로는 본문 전달 같은 것이 조용히 어긋난다. */
async function 부르기(server, path, body) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.text() };
  } finally { await new Promise((r) => server.close(r)); }
}

test('전용 통로로 값이 들어가 연결까지 되고, 응답에 값이 없다', async () => {
  const { server, store } = await 서버();
  const r = await 부르기(server, '/connectors/secret', { connector: 'gagagg', values: { client_secret: 비밀 } });
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true, `연결 실패: ${j.userSafeSummary}`);
  assert.ok(!r.body.includes(비밀), '응답에 값이 실렸다');
  assert.deepEqual(j.result.filled, ['client_secret'], '무엇을 채웠는지가 없다');
  // 저장은 됐는가(값 자체는 여기서만 산다)
  assert.equal((await store.get('gagagg')).values.client_secret, 비밀);
});

test('세션 기록 어디에도 값이 없다 — 통로가 턴을 지나지 않는다', async () => {
  const { server, dir } = await 서버();
  await 부르기(server, '/connectors/secret', { connector: 'gagagg', values: { client_secret: 비밀 } });
  for (const f of await readdir(dir)) {
    const text = await readFile(join(dir, f), 'utf8').catch(() => '');
    assert.ok(!text.includes(비밀), `세션 파일 ${f} 에 값이 남았다`);
  }
});

test('틀린 값이면 값을 지우고, 왜 막혔는지만 말한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-keysurf-'));
  const credDir = await mkdtemp(join(tmpdir(), 't5-keycred-'));
  const c = defineConnector({
    id: 'gagagg', label: '가가상점',
    authMethods: [{
      kind: 'api_key', fields: [{ name: 'client_secret', label: '시크릿', secret: true }],
      verify: { url: 'https://gaga.test/ok', okWhen: { status: 200 } },
    }],
  });
  const tools = demoTools();
  const store = new ConnectorCredentialStore(credDir);
  tools.tools['connector.connect'] = makeConnectorConnectTool({
    ctx: () => ({ tools, descriptors: [], env: { connections: [] } }),
    connectors: () => [c], credentialStore: store,
    fetchImpl: async () => ({ status: 401, ok: false, json: async () => ({ echo: 비밀 }), text: async () => 비밀 }),
  });
  const server = makeServer({ sessionStore: new SessionStore(dir), tools, channels: demoChannels(), connectors: [c] });

  const r = await 부르기(server, '/connectors/secret', { connector: 'gagagg', values: { client_secret: 비밀 } });
  assert.equal(r.status, 400);
  assert.ok(!r.body.includes(비밀), '서비스가 되비친 값을 사용자에게 그대로 옮겼다');
  assert.equal(await store.get('gagagg'), null, '안 되는 값을 그대로 들고 있다');
  assert.ok(JSON.parse(r.body).nextSafeAction, '막다른 답으로 끝났다');
});
