// L3 · OAuth 인증 실행기 (P5-B-1B, 연결 방식 kind: oauth)
//
// **서비스를 모른다.** 노션·구글이라는 단어가 여기 없다 — 표준(RFC 8414 발견 · RFC 7591 동적
// 등록 · RFC 7636 PKCE · RFC 9728 보호 리소스)만 안다. 표준을 따르는 서버면 무엇이든 붙는다.
//
// 실측(2026-07-27, mcp.notion.com):
//   401 → www-authenticate: resource_metadata="…/.well-known/oauth-protected-resource/mcp"
//   → authorization_servers → /.well-known/oauth-authorization-server
//   → registration_endpoint 있음 → **client_id 를 우리가 발급받는다**(사용자가 준비할 것이 없다)
//
// 경계:
//   · 로그인·동의는 **사용자가 자기 브라우저에서** 한다. T5 는 비밀번호를 보지도 받지도 않는다.
//   · 토큰은 0600 저장소에만 산다. transcript·receipt·로그·UI 노출 금지.
//   · 실패는 실패다 — 토큰을 못 받았는데 연결됐다고 말하지 않는다.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE 한 쌍. verifier 는 우리만 알고 challenge 만 동의 화면으로 나간다(RFC 7636). */
export function makePkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

/** 401 응답의 www-authenticate 에서 보호 리소스 메타데이터 주소를 꺼낸다(RFC 9728). */
export function resourceMetadataUrl(wwwAuthenticate) {
  return String(wwwAuthenticate ?? '').match(/resource_metadata="([^"]+)"/)?.[1];
}

/**
 * 인증 서버 엔드포인트 발견. **주소를 우리가 짐작하지 않는다** — 서버가 알려준 것만 쓴다.
 * @returns {Promise<{authorize:string, token:string, register?:string, issuer:string}|undefined>}
 */
export async function discoverAuthServer(resourceUrl, { fetchImpl = globalThis.fetch } = {}) {
  const meta = await fetchImpl(resourceUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const issuer = meta?.authorization_servers?.[0];
  if (!issuer) return undefined;
  // RFC 8414: issuer 기준 well-known. 두 형태를 다 시도한다(서버마다 다르다).
  for (const u of [
    `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
  ]) {
    const as = await fetchImpl(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (as?.authorization_endpoint && as?.token_endpoint) {
      return {
        issuer, authorize: as.authorization_endpoint, token: as.token_endpoint,
        register: as.registration_endpoint,
        scopes: meta?.scopes_supported, resource: meta?.resource,
      };
    }
  }
  return undefined;
}

/** 동적 클라이언트 등록(RFC 7591) — **사용자가 client_id 를 준비할 필요가 없게 한다.** */
export async function registerClient(registerUrl, redirectUri, { fetchImpl = globalThis.fetch } = {}) {
  const r = await fetchImpl(registerUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'GPAO-T5',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // 설치형 앱 — client secret 이 없다(PKCE 로 대체)
    }),
  }).catch(() => null);
  if (!r || (r.status !== 200 && r.status !== 201)) return undefined;
  const j = await r.json().catch(() => null);
  return j?.client_id ? { clientId: j.client_id, clientSecret: j.client_secret } : undefined;
}

/**
 * 루프백 수신기 — 동의 후 코드를 한 번만 받는다. state 불일치는 거절(CSRF).
 * **아무도 안 기다리는 사이의 거부로 프로세스가 죽지 않게** 한다(chatgpt-oauth.js 가 남긴 교훈:
 * 기다리는 쪽이 없을 때의 reject 가 T3 "갑자기 멈춤"이었다). settled 로 한 번만 끝낸다.
 */
export function startLoopback({ state, timeoutMs = 180_000 } = {}) {
  let resolveCode; let rejectCode;
  const code = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  code.catch(() => {}); // unhandled rejection 방지 — 등록 실패로 일찍 빠져나가는 길이 있다
  let settled = false;
  const settle = (fn, v) => { if (settled) return; settled = true; fn(v); };
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/oauth/callback') { res.writeHead(404).end(); return; }
    if (u.searchParams.get('state') !== state) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('요청이 일치하지 않아요.');
      return; // 다른 데서 흘러든 요청 — 코드를 받지 않는다
    }
    if (u.searchParams.get('error')) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('연결을 허용하지 않으셨어요. 이 창은 닫으셔도 돼요.');
      settle(rejectCode, Object.assign(new Error('denied'), { denied: true }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">연결됐어요. 이 창은 닫고 T5 로 돌아가세요.</body>');
    settle(resolveCode, u.searchParams.get('code'));
  });
  const timer = setTimeout(
    () => settle(rejectCode, Object.assign(new Error('timeout'), { timedOut: true })), timeoutMs,
  );
  timer.unref?.();
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => res({
      url: `http://127.0.0.1:${server.address().port}/oauth/callback`,
      code,
      close: () => {
        clearTimeout(timer); server.close();
        settle(rejectCode, Object.assign(new Error('closed'), { closed: true })); // 이미 끝났으면 no-op
      },
    }));
  });
}

/** 사용자 **기본 브라우저**로 연다 — T5 의 임시 프로필이 아니라 로그인이 살아 있는 곳. */
function defaultOpener(url) {
  return new Promise((resolve) => {
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => resolve());
  });
}

async function postForm(url, params, fetchImpl) {
  const r = await fetchImpl(url, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

/**
 * 발견 → (필요하면) 등록 → 동의 → 토큰. **서비스 지식 0.**
 * @returns {Promise<{ok:true, tokens:object, clientId:string, endpoints:object}|{ok:false, reason:string}>}
 */
export async function runOAuth({ resourceMetadataUrl: metaUrl, fetchImpl = globalThis.fetch,
  opener = defaultOpener, timeoutMs, now = () => Date.now(), scopes, resource } = {}) {
  const eps = await discoverAuthServer(metaUrl, { fetchImpl });
  if (!eps) return { ok: false, reason: '이 서비스의 로그인 방식을 확인하지 못했어요' };

  // **수신기를 먼저 한 번만 연다.** 등록에 쓴 redirect_uri 와 동의 화면에 보내는 redirect_uri 가
  // 글자 하나라도 다르면(포트가 바뀌면) 서버가 거절한다 — 같은 것이어야 한다.
  const state = b64url(randomBytes(16));
  const loop = await startLoopback({ state, timeoutMs });
  try {
    let clientId = null;
    if (eps.register) clientId = (await registerClient(eps.register, loop.url, { fetchImpl }))?.clientId;
    if (!clientId) return { ok: false, reason: '이 서비스에 T5 를 등록하지 못했어요' };

    const { verifier, challenge } = makePkce();
    const auth = new URL(eps.authorize);
    auth.search = new URLSearchParams({
      client_id: clientId, redirect_uri: loop.url, response_type: 'code', state,
      code_challenge: challenge, code_challenge_method: 'S256',
      ...(scopes?.length ? { scope: scopes.join(' ') } : {}),
      ...(resource ? { resource } : {}), // RFC 8707 — 어느 리소스용 토큰인지
    }).toString();
    await opener(auth.toString());

    let code;
    try { code = await loop.code; } catch (e) {
      return { ok: false, reason: e?.denied ? '연결을 허용하지 않으셨어요' : '승인 창에서 응답이 오지 않았어요' };
    }
    const tok = await postForm(eps.token, {
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: clientId, redirect_uri: loop.url, ...(resource ? { resource } : {}),
    }, fetchImpl);
    if (tok.status !== 200 || !tok.json?.access_token) {
      return { ok: false, reason: '승인은 됐는데 토큰을 받지 못했어요' };
    }
    return {
      ok: true, clientId, endpoints: eps,
      tokens: {
        access_token: tok.json.access_token,
        refresh_token: tok.json.refresh_token,
        expires_at: now() + (tok.json.expires_in ?? 3600) * 1000,
      },
    };
  } finally { loop.close(); }
}

/**
 * **앱 등록형 OAuth.** 발견·동적 등록이 없는 서비스를 위한 길이다.
 *
 * 노션은 `registration_endpoint` 가 있어서 T5 가 스스로 client_id 를 받아 왔다(runOAuth).
 * 구글·카페24 같은 곳은 그 통로가 없다 — **사용자가 그 서비스 개발자 화면에서 앱을 만들어
 * client_id 를 받아야 한다.** 그게 이 길에서 사용자가 넘을 유일한 문턱이고, 나머지(동의 URL
 * 조립 · PKCE · 콜백 수신 · 토큰 교환 · 갱신)는 전부 T5 가 한다.
 *
 * **서비스를 모르는 것은 그대로다.** 주소도 scope 도 커넥터 선언에서 온다 — 여기엔 서비스
 * 이름이 없다. client_secret 은 **선택값**이다 — 설치형 앱은 공개 클라이언트라 표준·구글 공식
 * 문서 모두 Optional 로 둔다. 선언이 요구한 경우에만 안전 입력면으로 들어와 여기서 받아 쓴다.
 *
 * @param {{endpoints:{authorize:string, token:string}, clientId:string, clientSecret?:string,
 *          scopes?:string[], opener?:Function, timeoutMs?:number, fetchImpl?:Function, now?:Function}} p
 * @returns {Promise<{ok:true, tokens:object, clientId:string, endpoints:object}|{ok:false, reason:string}>}
 */
export async function runDeclaredOAuth({ endpoints, clientId, clientSecret,
  scopes, opener = defaultOpener, timeoutMs, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!endpoints?.authorize || !endpoints?.token) {
    return { ok: false, reason: '이 서비스의 로그인 주소가 선언돼 있지 않아요' };
  }
  if (!clientId) return { ok: false, reason: '그 서비스에서 받은 앱 아이디가 아직 없어요' };

  // 수신기를 **한 번만** 연다 — 등록한 redirect_uri 와 동의 화면의 redirect_uri 가 같아야 한다.
  const state = b64url(randomBytes(16));
  const loop = await startLoopback({ state, timeoutMs });
  try {
    const { verifier, challenge } = makePkce();
    const auth = new URL(endpoints.authorize);
    // 선언이 이미 담은 질의(access_type 등)는 지우지 않는다 — 서비스별 요구를 커넥터가 말한다.
    for (const [k, v] of Object.entries({
      client_id: clientId, redirect_uri: loop.url, response_type: 'code', state,
      code_challenge: challenge, code_challenge_method: 'S256',
      ...(scopes?.length ? { scope: scopes.join(' ') } : {}),
    })) auth.searchParams.set(k, v);
    await opener(auth.toString());

    let code;
    try { code = await loop.code; } catch (e) {
      // **거절은 실패가 아니라 사실이다.** 사용자가 안 하겠다고 한 것을 오류로 말하지 않는다.
      return { ok: false, denied: Boolean(e?.denied), reason: e?.denied ? '연결을 허용하지 않으셨어요' : '승인 창에서 응답이 오지 않았어요' };
    }
    const tok = await postForm(endpoints.token, {
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: clientId, redirect_uri: loop.url,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }, fetchImpl);
    if (tok.status !== 200 || !tok.json?.access_token) {
      return { ok: false, reason: '승인은 됐는데 토큰을 받지 못했어요' };
    }
    return {
      ok: true, clientId, endpoints,
      tokens: {
        access_token: tok.json.access_token,
        refresh_token: tok.json.refresh_token,
        expires_at: now() + (tok.json.expires_in ?? 3600) * 1000,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      },
    };
  } finally { loop.close(); }
}

/** 만료됐으면 갱신 — 사용자에게 재로그인을 시키지 않는다(§18 지속성). 실패는 정직하게 null. */
export async function refreshTokens(saved, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!saved?.tokens?.access_token) return null;
  if (saved.tokens.expires_at && saved.tokens.expires_at - now() > 60_000) return saved.tokens.access_token;
  if (!saved.tokens.refresh_token || !saved.endpoints?.token) return null;
  const r = await postForm(saved.endpoints.token, {
    grant_type: 'refresh_token', refresh_token: saved.tokens.refresh_token, client_id: saved.clientId,
    // **있으면 함께 보낸다.** 설치형 앱은 공개 클라이언트라 client_secret 이 Optional 이다
    // (구글 공식 데스크톱 문서 — 토큰 교환·갱신 모두). 요구하는 서버에 한해 저장돼 있을 뿐이다.
    ...(saved.tokens.client_secret ? { client_secret: saved.tokens.client_secret } : {}),
  }, fetchImpl);
  if (r.status !== 200 || !r.json?.access_token) return null;
  saved.tokens.access_token = r.json.access_token;
  if (r.json.refresh_token) saved.tokens.refresh_token = r.json.refresh_token;
  saved.tokens.expires_at = now() + (r.json.expires_in ?? 3600) * 1000;
  return saved.tokens.access_token;
}
