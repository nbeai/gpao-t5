// E · 범위 있는 API — **앱 등록형 OAuth** 실행기와 scope 경계.
//
// 노션은 동적 등록(RFC 7591)이 있어서 T5 가 스스로 앱을 등록했다. 구글 같은 곳은 그 통로가
// 없다 — 사용자가 그 서비스 개발자 화면에서 앱을 만들어 아이디를 받아야 한다. **그 문턱 하나만**
// 사용자 몫이고 동의 URL 조립·PKCE·콜백 수신·토큰 교환·갱신은 T5 가 한다.
//
// 실계정 없이 닫을 수 있는 것을 여기서 닫는다(오너 판정 2026-07-29): 동의 거부 · 토큰 만료
// 자동 갱신 · 429. 실제 구글 계정과 앱 등록이 필요한 구간만 라이브로 남긴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runDeclaredOAuth, refreshTokens } from '../src/runtime/oauth-pkce.js';
import { EXECUTABLE_KINDS } from '../src/runtime/connector-connect.js';
import { probeHttpTool } from '../src/runtime/http-tool.js';

/** 표준만 흉내 내는 가짜 인증 서버. 서비스 이름을 모른다. */
async function 가짜인증서버({ 토큰응답, 만료초 = 3600 } = {}) {
  const 받은것 = { authorize: null, token: null };
  const srv = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/auth') {
      받은것.authorize = Object.fromEntries(u.searchParams);
      res.writeHead(302, { location: `${받은것.authorize.redirect_uri}?code=CODE&state=${받은것.authorize.state}` });
      return res.end();
    }
    if (u.pathname === '/token') {
      let body = ''; for await (const c of req) body += c;
      받은것.token = Object.fromEntries(new URLSearchParams(body));
      const j = 토큰응답 ?? { access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 만료초 };
      res.writeHead(j.__status ?? 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(j));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, 받은것, endpoints: { authorize: `${base}/auth`, token: `${base}/token` }, close: () => srv.close() };
}

/** 동의 화면을 사용자가 대신 열어 준 것처럼 — 실제로는 우리가 그 URL 을 그냥 부른다. */
const 브라우저열기 = (fetchImpl) => async (url) => { await fetchImpl(url, { redirect: 'follow' }).catch(() => {}); };

test('실행기 목록에 앱 등록형 OAuth 가 있고 handler 분기와 어긋나지 않는다', () => {
  assert.ok(EXECUTABLE_KINDS.includes('oauth_pkce'),
    '선언은 있는데 실행기 목록에 없으면 모델이 못 지킬 약속을 한다');
});

test('최소 scope 만 동의 화면으로 나간다 — 쓰기를 미리 받아 두지 않는다', async () => {
  const s = await 가짜인증서버();
  try {
    const r = await runDeclaredOAuth({
      endpoints: s.endpoints, clientId: 'CID', clientSecret: 'CSEC',
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      opener: 브라우저열기(globalThis.fetch), timeoutMs: 8000,
    });
    assert.equal(r.ok, true, r.reason);
    assert.equal(s.받은것.authorize.scope, 'https://www.googleapis.com/auth/drive.readonly');
    assert.ok(!/drive\.file|drive$/.test(s.받은것.authorize.scope), '쓰기 scope 가 섞였다');
    // PKCE: verifier 는 나가지 않고 challenge 만
    assert.equal(s.받은것.authorize.code_challenge_method, 'S256');
    assert.ok(s.받은것.authorize.code_challenge);
    assert.equal(s.받은것.authorize.code_verifier, undefined, 'verifier 가 동의 화면으로 나갔다');
    // 앱 비밀은 토큰 교환에서만 쓰인다
    assert.equal(s.받은것.token.client_secret, 'CSEC');
    assert.equal(s.받은것.token.code_verifier?.length > 0, true);
  } finally { s.close(); }
});

test('선언이 담은 질의(access_type 등)를 지우지 않는다', async () => {
  const s = await 가짜인증서버();
  try {
    await runDeclaredOAuth({
      endpoints: { authorize: `${s.base}/auth?access_type=offline&prompt=consent`, token: `${s.base}/token` },
      clientId: 'CID', scopes: ['read'], opener: 브라우저열기(globalThis.fetch), timeoutMs: 8000,
    });
    assert.equal(s.받은것.authorize.access_type, 'offline', '커넥터가 선언한 질의가 사라졌다');
    assert.equal(s.받은것.authorize.prompt, 'consent');
  } finally { s.close(); }
});

test('동의를 거절하면 연결됐다고 하지 않는다', async () => {
  const s = await 가짜인증서버();
  try {
    // 사용자가 거절한 것처럼 — 콜백에 error 가 온다
    const 거절열기 = async (url) => {
      const u = new URL(url);
      await globalThis.fetch(`${u.searchParams.get('redirect_uri')}?error=access_denied&state=${u.searchParams.get('state')}`).catch(() => {});
    };
    const r = await runDeclaredOAuth({
      endpoints: s.endpoints, clientId: 'CID', scopes: ['read'], opener: 거절열기, timeoutMs: 8000,
    });
    assert.equal(r.ok, false);
    assert.equal(r.denied, true, '거절을 오류로 뭉갰다');
    assert.match(r.reason, /허용하지 않으셨어요/);
  } finally { s.close(); }
});

test('앱 아이디가 없으면 로그인 창을 열지 않는다', async () => {
  let 열렸나 = false;
  const r = await runDeclaredOAuth({
    endpoints: { authorize: 'https://x/auth', token: 'https://x/token' },
    clientId: '', opener: async () => { 열렸나 = true; },
  });
  assert.equal(r.ok, false);
  assert.equal(열렸나, false, '받아 온 값도 없이 사용자에게 로그인 창을 띄웠다');
});

test('만료된 토큰은 조용히 갱신한다 — 저장된 앱 비밀이 있으면 함께 보낸다', async () => {
  const s = await 가짜인증서버();
  try {
    const 자격 = {
      clientId: 'CID', endpoints: s.endpoints,
      tokens: { access_token: 'OLD', refresh_token: 'RT-1', expires_at: 1, client_secret: 'CSEC' },
    };
    const t = await refreshTokens(자격, { now: () => 1_000_000 });
    assert.equal(t, 'AT-1', '갱신이 안 됐다 — 사용자에게 재로그인을 시키게 된다');
    assert.equal(s.받은것.token.grant_type, 'refresh_token');
    assert.equal(s.받은것.token.client_secret, 'CSEC', '저장돼 있는 비밀이 갱신에 함께 안 나갔다');
  } finally { s.close(); }
});

// 오너 감사 정정(2026-07-29): 설치형 앱은 공개 클라이언트 — 구글 공식 데스크톱 문서는 토큰
// 교환·갱신 모두에서 client_secret 을 Optional 로 명시한다. secret 없이도 전 구간이 성공해야
// 하고, 없는 값을 빈 문자열로라도 지어 보내면 안 된다.
test('앱 비밀 없이 토큰 교환이 성공한다 — 없는 값을 지어 보내지 않는다', async () => {
  const s = await 가짜인증서버();
  try {
    const r = await runDeclaredOAuth({
      endpoints: s.endpoints, clientId: 'CID', // clientSecret 없음 — 공개 클라이언트
      scopes: ['read'], opener: 브라우저열기(globalThis.fetch), timeoutMs: 8000,
    });
    assert.equal(r.ok, true, r.reason);
    assert.equal(s.받은것.token.client_secret, undefined, '없는 비밀을 토큰 교환에 지어 보냈다');
    assert.ok(s.받은것.token.code_verifier, 'PKCE 없이 교환했다 — 공개 클라이언트의 유일한 증명이 빠졌다');
    assert.equal(r.tokens.client_secret, undefined, '없는 비밀이 저장 자격에 생겼다');
  } finally { s.close(); }
});

test('앱 비밀 없이 갱신이 성공한다', async () => {
  const s = await 가짜인증서버();
  try {
    const t = await refreshTokens({
      clientId: 'CID', endpoints: s.endpoints,
      tokens: { access_token: 'OLD', refresh_token: 'RT-1', expires_at: 1 }, // client_secret 없음
    }, { now: () => 1_000_000 });
    assert.equal(t, 'AT-1', 'secret 이 없다고 갱신을 못 하면 사용자가 재로그인하게 된다');
    assert.equal(s.받은것.token.client_secret, undefined, '없는 비밀을 갱신에 지어 보냈다');
  } finally { s.close(); }
});

test('갱신이 실패하면 연결을 성공으로 보고하지 않는다', async () => {
  const s = await 가짜인증서버({ 토큰응답: { __status: 400, error: 'invalid_grant' } });
  try {
    const t = await refreshTokens({
      clientId: 'CID', endpoints: s.endpoints,
      tokens: { access_token: 'OLD', refresh_token: 'RT', expires_at: 1 },
    }, { now: () => 1_000_000 });
    assert.equal(t, null, '갱신 실패를 성공으로 읽었다');
  } finally { s.close(); }
});

test('429 는 "값이 틀렸다"가 아니다 — 손을 올리지 않고 그 사실로 남는다', async () => {
  const 호출 = [];
  const r = await probeHttpTool({
    tool: {
      name: 'x', request: { url: 'https://api.example.com/v1/files?q={query}', headers: { Authorization: 'Bearer {access_token}' } },
      probeArgs: { query: 'a' },
    },
    secrets: { access_token: 'AT' },
    fetchImpl: async (u) => { 호출.push(u); return { status: 429, ok: false, json: async () => ({ error: 'rateLimitExceeded' }), text: async () => '' }; },
  });
  assert.equal(r.ok, false, '429 인데 되는 손으로 올렸다');
  assert.equal(호출.length, 1);
});

test('허용 범위 밖(403)도 손으로 올리지 않는다', async () => {
  const r = await probeHttpTool({
    tool: { name: 'x', request: { url: 'https://api.example.com/v1/files', headers: {} }, probeArgs: {} },
    secrets: {},
    fetchImpl: async () => ({ status: 403, ok: false, json: async () => ({ error: 'insufficientPermissions' }), text: async () => '' }),
  });
  assert.equal(r.ok, false, 'scope 가 모자란데 되는 손으로 올렸다');
});
