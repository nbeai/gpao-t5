// P5-B-1B · 원격 MCP OAuth — "인증할 손이 없다"를 지운 자리의 검사
//
// 실측(2026-07-27, mcp.notion.com)이 이 대역의 근거다:
//   POST /mcp → 401 + www-authenticate: resource_metadata="…"
//   → /.well-known/oauth-protected-resource/mcp → authorization_servers
//   → /.well-known/oauth-authorization-server → registration_endpoint 있음
// 즉 **사용자가 client_id 를 준비할 필요가 없다.** 그 사실이 이 흐름의 전부다.
//
// 불변식(문구 매칭 아님):
//   ① 사용자가 하는 일은 동의 화면에서 허용 한 번뿐이다 — 그 외 입력이 필요하면 실패다
//   ② 연결의 성공 = 부를 수 있는 손이 올라온 순간(토큰을 받은 순간이 아니다)
//   ③ 토큰은 결과·원장·화면 어디에도 나오지 않는다
//   ④ 껐다 켜도 다시 로그인시키지 않는다(저장된 자격으로 붙는다)
//   ⑤ 끊으면 저장된 자격도 사라진다 — 말과 디스크가 어긋나지 않는다
//   ⑥ 서비스를 모른다 — 지어낸 서비스도 표준만 지키면 그대로 돈다
//   ⑦ 승인하지 않으면 연결이 아니다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConnectorConnectTool } from '../src/runtime/connector-connect.js';
import { ConnectorCredentialStore } from '../src/surface/connector-credential-store.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { runOAuth, resourceMetadataUrl, makePkce } from '../src/runtime/oauth-pkce.js';
import { createHash } from 'node:crypto';

const MCP = 'https://example-service.test/mcp';
const 비밀 = 'tok_SECRET_VALUE_0001';

/**
 * 표준을 지키는 가짜 서비스 — **PKCE 를 실제로 검증한다**(challenge 를 우리가 다시 계산해 본다).
 * 지어낸 서비스다. 러너가 서비스 지식 없이 도는지 이걸로 확인한다(불변식 ⑥).
 */
function 가짜서비스(opts = {}) {
  const 기록 = { registered: 0, authorizeUrl: null, tokenCalls: 0, bearer: [], refreshed: 0 };
  let 발급된코드 = null;
  let challenge = null;
  let 유효토큰 = opts.token ?? 비밀;

  async function fetchImpl(url, init = {}) {
    const u = new URL(String(url));
    const 답 = (status, body, headers = {}) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      json: async () => body, text: async () => JSON.stringify(body),
    });

    if (u.href === MCP) {
      const auth = init.headers?.authorization;
      기록.bearer.push(auth ?? null);
      if (!auth || auth !== `Bearer ${유효토큰}`) {
        return 답(401, { error: 'invalid_token' }, {
          'www-authenticate': `Bearer realm="OAuth", resource_metadata="https://example-service.test/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
        });
      }
      const req = JSON.parse(init.body);
      const result = req.method === 'initialize'
        ? { protocolVersion: '2024-11-05', serverInfo: { name: '가짜서비스' }, capabilities: {} }
        : req.method === 'tools/list'
          ? { tools: [{ name: 'search', description: '문서를 찾는다', inputSchema: { type: 'object' } }] }
          : {};
      return 답(200, { jsonrpc: '2.0', id: req.id, result }, { 'content-type': 'application/json' });
    }
    if (u.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return 답(200, {
        resource: MCP, authorization_servers: ['https://example-service.test'],
        scopes_supported: ['default'], resource_name: '가짜서비스',
      });
    }
    if (u.pathname === '/.well-known/oauth-authorization-server') {
      return 답(200, {
        issuer: 'https://example-service.test',
        authorization_endpoint: 'https://example-service.test/authorize',
        token_endpoint: 'https://example-service.test/token',
        ...(opts.noRegistration ? {} : { registration_endpoint: 'https://example-service.test/register' }),
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (u.pathname === '/register') {
      기록.registered += 1;
      return 답(201, { client_id: 'dyn_client_1', redirect_uris: JSON.parse(init.body).redirect_uris });
    }
    if (u.pathname === '/token') {
      기록.tokenCalls += 1;
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'refresh_token') {
        기록.refreshed += 1;
        유효토큰 = 'tok_REFRESHED_0002';
        return 답(200, { access_token: 유효토큰, refresh_token: 'ref_1', expires_in: 3600 });
      }
      if (p.get('code') !== 발급된코드) return 답(400, { error: 'invalid_grant' });
      // PKCE 를 실제로 검증한다 — verifier 를 해시해서 challenge 와 같아야 한다.
      const calc = createHash('sha256').update(p.get('code_verifier')).digest('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (calc !== challenge) return 답(400, { error: 'invalid_grant', detail: 'pkce' });
      return 답(200, { access_token: 유효토큰, refresh_token: 'ref_1', expires_in: 3600 });
    }
    return 답(404, {});
  }

  /** 사용자가 브라우저에서 "허용"을 누르는 것. **여기 말고 사용자가 할 일은 없다**(불변식 ①). */
  const opener = async (authUrl) => {
    기록.authorizeUrl = authUrl;
    const u = new URL(authUrl);
    challenge = u.searchParams.get('code_challenge');
    const redirect = u.searchParams.get('redirect_uri');
    const state = u.searchParams.get('state');
    if (opts.deny) {
      await fetch(`${redirect}?error=access_denied&state=${encodeURIComponent(state)}`).catch(() => {});
      return;
    }
    발급된코드 = 'code_abc';
    await fetch(`${redirect}?code=${발급된코드}&state=${encodeURIComponent(state)}`).catch(() => {});
  };

  return {
    fetchImpl, opener, 기록, get 토큰() { return 유효토큰; },
    /** 서버 쪽에서 자격을 폐기한다(사용자가 노션에서 앱 연결을 지운 경우가 이것이다). */
    폐기() { 유효토큰 = 'tok_AFTER_REVOKE_0003'; },
  };
}

function 맥락() {
  const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
  return ctx;
}

async function 손만들기(가짜, { dir, connector } = {}) {
  const store = new ConnectorCredentialStore(dir ?? await mkdtemp(join(tmpdir(), 't5-cred-')));
  const c = connector ?? defineConnector({
    id: 'gaja', label: '가짜서비스', kind: 'provider',
    userJobs: ['문서 찾기'], authMethods: [{ kind: 'mcp', url: MCP }],
  });
  const ctx = 맥락();
  const tool = makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [c],
    fetchImpl: 가짜.fetchImpl, opener: 가짜.opener, credentialStore: store,
  });
  return { tool, ctx, c, store };
}

test('원격 OAuth: 허용 한 번으로 발견→등록→동의→토큰→도구 편입까지 간다', async () => {
  const 가짜 = 가짜서비스();
  const { tool, ctx, c, store } = await 손만들기(가짜);

  const r = await tool.handler({ connector: 'gaja' });

  // ② 성공의 정의: 부를 수 있는 손이 올라왔는가
  assert.equal(r.result?.connected, true, `연결 실패: ${r.userSafeSummary}`);
  assert.ok(r.result.tools.length > 0, '도구가 하나도 안 올라왔는데 연결이라 불렀다');
  const 손 = r.result.tools[0];
  assert.ok(ctx.tools.tools[손], '손이 도구함에 없다');
  assert.ok(ctx.descriptors.some((d) => d.id === 손), '선언이 없다 — 모델이 못 본다');
  assert.ok(ctx.env.connections.some((x) => x.id === 손), 'selfState 에 없다');
  assert.equal(c.connected, true);

  // 사용자가 client_id 를 준비하지 않았다 — 우리가 등록했다
  assert.equal(가짜.기록.registered, 1, '동적 등록을 안 했다(사용자에게 client_id 를 요구하게 된다)');
  // PKCE S256 로 갔다
  const auth = new URL(가짜.기록.authorizeUrl);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(auth.searchParams.get('code_challenge'));
  assert.ok(auth.searchParams.get('redirect_uri').startsWith('http://127.0.0.1:'), '루프백이 아니다');

  // ③ 토큰이 밖으로 나가지 않는다
  const 노출 = JSON.stringify(r);
  assert.ok(!노출.includes(비밀), '결과에 토큰이 실렸다');
  assert.ok(!노출.includes('access_token'), '결과에 토큰 필드가 실렸다');
  const 보여줄것 = await store.describe();
  assert.equal(보여줄것.gaja.connected, true);
  assert.ok(!JSON.stringify(보여줄것).includes(비밀), 'describe 가 토큰을 흘렸다');
});

test('껐다 켜도 다시 로그인시키지 않는다 — 저장된 자격으로 붙는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-cred-'));
  const 가짜 = 가짜서비스();
  const 첫번째 = await 손만들기(가짜, { dir });
  assert.equal((await 첫번째.tool.handler({ connector: 'gaja' })).result?.connected, true);
  const 등록횟수 = 가짜.기록.registered;
  가짜.기록.authorizeUrl = null;

  // 새 프로세스인 셈 — 손도 맥락도 새로 만든다. 자격만 디스크에 남아 있다.
  const 두번째 = await 손만들기(가짜, { dir });
  const r = await 두번째.tool.handler({ connector: 'gaja' });

  assert.equal(r.result?.connected, true, '재시작 후 연결이 끊겼다');
  assert.equal(가짜.기록.authorizeUrl, null, '이미 연결했는데 동의 화면을 또 띄웠다');
  assert.equal(가짜.기록.registered, 등록횟수, '다시 등록했다');
});

test('끊으면 저장된 자격도 사라진다 — 말과 디스크가 어긋나지 않는다', async () => {
  const 가짜 = 가짜서비스();
  const { tool, ctx, store } = await 손만들기(가짜);
  const 연결 = await tool.handler({ connector: 'gaja' });
  const 손 = 연결.result.tools[0];

  const r = await tool.handler({ connector: 'gaja', action: 'disconnect' });
  assert.equal(r.result?.connected, false);
  assert.ok(!ctx.tools.tools[손], '끊었는데 손이 남았다(유령)');
  assert.ok(!ctx.descriptors.some((d) => d.id === 손), '끊었는데 선언이 남았다');
  assert.equal(await store.get('gaja'), null, '끊었다고 말하고 토큰은 남겼다');
});

test('승인하지 않으면 연결이 아니다 — 실패를 성공으로 기록하지 않는다', async () => {
  const 가짜 = 가짜서비스({ deny: true });
  const { tool, ctx, c, store } = await 손만들기(가짜);

  const r = await tool.handler({ connector: 'gaja' });

  assert.notEqual(r.result?.connected, true);
  assert.equal(c.connected, false);
  assert.equal(Object.keys(ctx.tools.tools).length, 0, '연결 실패인데 손이 올라왔다');
  assert.equal(await store.get('gaja'), null, '연결 실패인데 자격을 남겼다');
  assert.ok(r.userSafeSummary && !/undefined|error|null/i.test(r.userSafeSummary),
    `사람 말이 아니다: ${r.userSafeSummary}`);
});

test('동적 등록이 없는 서버는 정직하게 못 붙는다고 말한다(지어내지 않는다)', async () => {
  const 가짜 = 가짜서비스({ noRegistration: true });
  const { tool, store } = await 손만들기(가짜);
  const r = await tool.handler({ connector: 'gaja' });
  assert.notEqual(r.result?.connected, true);
  assert.equal(await store.get('gaja'), null);
});

test('만료된 토큰은 조용히 갱신한다 — 사용자에게 재로그인을 시키지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-cred-'));
  const 가짜 = 가짜서비스();
  const 첫번째 = await 손만들기(가짜, { dir });
  await 첫번째.tool.handler({ connector: 'gaja' });

  // 저장된 자격을 만료시킨다(시계를 돌리는 대신 사실을 바꾼다)
  const store = new ConnectorCredentialStore(dir);
  const saved = await store.get('gaja');
  saved.tokens.expires_at = Date.now() - 1000;
  await store.set('gaja', saved);
  가짜.기록.authorizeUrl = null;

  const 두번째 = await 손만들기(가짜, { dir });
  const r = await 두번째.tool.handler({ connector: 'gaja' });

  assert.equal(r.result?.connected, true, `갱신 실패: ${r.userSafeSummary}`);
  assert.equal(가짜.기록.refreshed, 1, 'refresh_token 을 안 썼다');
  assert.equal(가짜.기록.authorizeUrl, null, '갱신하면 되는데 사용자에게 다시 로그인시켰다');
});

// 사용자가 서비스 쪽에서 앱 연결을 지우면 저장된 토큰이 죽는다. 그때 T5 가 "연결돼 있는데
// 왜 안 되지"로 멈추면 사용자는 원인을 알 수 없다 — **막힌 지점을 알고 스스로 다시 뚫어야** 한다.
// 코드는 있었는데 검사가 없던 자리다(오너 감사에서 드러났다).
test('서버가 자격을 폐기하면 스스로 재인증하고 이어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-cred-'));
  const 가짜 = 가짜서비스();
  await (await 손만들기(가짜, { dir })).tool.handler({ connector: 'gaja' });

  가짜.폐기();               // 노션에서 "앱 연결 해제"를 누른 상태
  가짜.기록.authorizeUrl = null;
  const 등록전 = 가짜.기록.registered;

  const 두번째 = await 손만들기(가짜, { dir });
  const r = await 두번째.tool.handler({ connector: 'gaja' });

  assert.equal(r.result?.connected, true, `폐기 후 재인증에 실패했다: ${r.userSafeSummary}`);
  assert.ok(r.result.tools.length > 0, '재인증했다면서 손이 안 올라왔다');
  assert.ok(가짜.기록.authorizeUrl, '죽은 토큰으로 계속 시도했다 — 다시 동의를 받아야 한다');
  assert.equal(가짜.기록.registered, 등록전 + 1, '재인증 때 등록을 다시 하지 않았다');
  // 새 자격으로 갈아탔는가 — 죽은 것을 그대로 들고 있으면 다음 턴에 또 막힌다
  const saved = await 두번째.store.get('gaja');
  assert.equal(saved.tokens.access_token, 가짜.토큰);
});

test('재인증도 실패하면 연결됐다고 하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-cred-'));
  const 성공 = 가짜서비스();
  await (await 손만들기(성공, { dir })).tool.handler({ connector: 'gaja' });

  // 폐기된 데다 사용자가 이번엔 허용하지 않는다 — 두 번 막힌 자리다
  const 거절 = 가짜서비스({ deny: true });
  거절.폐기();
  const 두번째 = await 손만들기(거절, { dir });
  const r = await 두번째.tool.handler({ connector: 'gaja' });

  assert.notEqual(r.result?.connected, true, '재인증 실패인데 연결됐다고 했다');
  assert.equal(Object.keys(두번째.ctx.tools.tools).length, 0, '실패인데 손이 올라왔다');
  assert.equal(await 두번째.store.get('gaja'), null, '죽은 자격을 그대로 남겼다');
  assert.ok(r.userSafeSummary?.length > 0, '왜 막혔는지 말하지 않았다');
});

test('www-authenticate 에서 로그인 위치를 읽는다 — 주소를 짐작하지 않는다', () => {
  assert.equal(
    resourceMetadataUrl('Bearer realm="OAuth", resource_metadata="https://a.test/.well-known/x", error="invalid_token"'),
    'https://a.test/.well-known/x',
  );
  assert.equal(resourceMetadataUrl('Bearer realm="OAuth"'), undefined);
  assert.equal(resourceMetadataUrl(undefined), undefined);
});

test('PKCE: verifier 는 나가지 않고 challenge 만 나간다', () => {
  const { verifier, challenge } = makePkce();
  assert.notEqual(verifier, challenge);
  const calc = createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(calc, challenge);
  assert.ok(!/[+/=]/.test(challenge), 'base64url 이 아니다');
});

test('state 가 다른 콜백은 코드를 받지 않는다(CSRF)', async () => {
  const 가짜 = 가짜서비스();
  // 남이 흘려보낸 콜백을 먼저 때린 뒤, 진짜 사용자가 허용한다.
  const 원래opener = 가짜.opener;
  const opener = async (authUrl) => {
    const redirect = new URL(authUrl).searchParams.get('redirect_uri');
    const res = await fetch(`${redirect}?code=stolen&state=WRONG`).catch(() => null);
    assert.equal(res?.status, 400, 'state 가 틀린 콜백을 받아들였다');
    await 원래opener(authUrl);
  };
  const r = await runOAuth({
    resourceMetadataUrl: 'https://example-service.test/.well-known/oauth-protected-resource/mcp',
    fetchImpl: 가짜.fetchImpl, opener,
  });
  assert.equal(r.ok, true, `정상 흐름이 깨졌다: ${r.reason}`);
});
