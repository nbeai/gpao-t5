// L3 · ChatGPT OAuth (P-RT-3) — 사용자의 ChatGPT 계정으로 모델을 쓰는 로그인 플로우.
// 오너 재가(2026-07-26): T3 가 실제로 쓰는 방식과 동일한 원리를 T5 계약 안으로 흡수한다(코드 복제 아님).
// 경계:
//   - 비공식 경로다(공식 서드파티 구독 사용 OAuth 없음). 화면에 고지하고, 차단 시 정직하게 실패한다.
//   - 자격은 사용자 것 — 우리는 저장·갱신만 대행한다. 토큰은 0600 저장소에만, 응답엔 절대 안 나간다.
//   - 로그인은 사용자의 브라우저에서 사용자가 직접 한다. 우리는 URL 을 열어줄 뿐 계정 입력을 대행하지 않는다.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const CHATGPT_OAUTH = Object.freeze({
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann', // Codex CLI 공개 client(우리 것이 아님 — 비공식 경로 표식)
  redirectUri: 'http://localhost:1455/auth/callback',
  callbackPort: 1455,
  callbackPath: '/auth/callback',
  scope: 'openid profile email offline_access',
});

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE(S256) 한 쌍 + state. 값은 로그·응답에 싣지 않는다. */
export function createPkce(rand = randomBytes) {
  const verifier = b64url(rand(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: b64url(rand(16)) };
}

/** 사용자가 브라우저에서 열 로그인 주소. */
export function buildAuthorizeUrl({ challenge, state }) {
  const u = new URL(CHATGPT_OAUTH.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', CHATGPT_OAUTH.clientId);
  u.searchParams.set('redirect_uri', CHATGPT_OAUTH.redirectUri);
  u.searchParams.set('scope', CHATGPT_OAUTH.scope);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  return u.toString();
}

/** id_token(JWT) 에서 chatgpt account id 를 읽는다(서명 검증은 발급처 신뢰 — 요청 헤더 용도). */
export function readAccountId(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
  } catch { return null; }
}

function toCredential(json, now) {
  if (!json?.access_token) return null;
  return {
    provider: 'chatgpt_oauth',
    access: json.access_token,
    refresh: json.refresh_token,
    // 만료 여유 60s — 경계에서 실패하지 않게 선제 갱신한다.
    expiresAt: now + (Number(json.expires_in ?? 3600) - 60) * 1000,
    accountId: json.id_token ? readAccountId(json.id_token) : undefined,
  };
}

/** authorization code → 토큰. 실패는 정직하게 throw(원문은 내부 진단용). */
export async function exchangeCode({ code, verifier }, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? Date.now();
  const r = await fetchImpl(CHATGPT_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CHATGPT_OAUTH.redirectUri,
      client_id: CHATGPT_OAUTH.clientId,
      code_verifier: verifier,
    }).toString(),
  });
  const json = await r.json().catch(() => null);
  const cred = r.status >= 200 && r.status < 300 ? toCredential(json, now) : null;
  if (!cred) throw Object.assign(new Error('oauth code exchange failed'), { status: r.status, detail: json?.error });
  return cred;
}

/** refresh_token 으로 갱신. refresh 가 회전되면 새 값을 유지한다. */
export async function refreshCredential(cred, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? Date.now();
  const r = await fetchImpl(CHATGPT_OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cred.refresh,
      client_id: CHATGPT_OAUTH.clientId,
      scope: CHATGPT_OAUTH.scope,
    }).toString(),
  });
  const json = await r.json().catch(() => null);
  const next = r.status >= 200 && r.status < 300 ? toCredential(json, now) : null;
  if (!next) throw Object.assign(new Error('oauth refresh failed'), { status: r.status, detail: json?.error });
  return { ...next, refresh: next.refresh ?? cred.refresh, accountId: next.accountId ?? cred.accountId };
}

export function isExpired(cred, now = Date.now()) {
  return !cred?.expiresAt || cred.expiresAt <= now;
}

export class OAuthLoginCancelledError extends Error {
  constructor(message = 'oauth login cancelled') {
    super(message);
    this.name = 'OAuthLoginCancelledError';
    this.isLoginCancelled = true; // 사용자 안전 문구를 고르는 표식(진단 원문 아님)
  }
}

/**
 * localhost 콜백을 한 번만 받는다(로그인 1회용). 사용자가 브라우저에서 승인하면 code 가 돌아온다.
 * **취소·타임아웃은 반드시 waitForCode 를 reject 한다** — 기다리는 쪽이 영원히 매달리지 않게(감사 B1,
 * T3 "갑자기 멈춤" 재발 지점). 이미 끝난 뒤의 cancel 은 무해(멱등).
 * @returns {{listening:Promise, waitForCode:Promise<string>, cancel:Function}}
 */
export function startCallbackListener({ state, timeoutMs = 300_000 } = {}) {
  let resolveCode, rejectCode;
  const waitForCode = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  waitForCode.catch(() => {}); // 아무도 안 기다리는 사이의 거부로 프로세스가 죽지 않게(unhandled 방지)
  let settled = false;
  const settle = (fn, v) => { if (settled) return; settled = true; fn(v); };
  const server = createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${CHATGPT_OAUTH.callbackPort}`);
    if (u.pathname !== CHATGPT_OAUTH.callbackPath) { res.writeHead(404); res.end(); return; }
    const code = u.searchParams.get('code');
    const gotState = u.searchParams.get('state');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (!code || (state && gotState !== state)) {
      res.end('<h3>로그인을 완료하지 못했어요. 창을 닫고 다시 시도해 주세요.</h3>');
      settle(rejectCode, new Error('oauth callback rejected'));
    } else {
      res.end('<h3>연결됐어요. 이 창을 닫고 GPAO-T5로 돌아가세요.</h3>');
      settle(resolveCode, code);
    }
    close();
  });
  const timer = setTimeout(() => {
    settle(rejectCode, new OAuthLoginCancelledError('oauth login timed out'));
    close();
  }, timeoutMs);
  timer.unref?.();
  /** 서버를 닫고, 아직 안 끝난 대기를 취소로 종료한다(무한 대기 금지). */
  function close() {
    clearTimeout(timer);
    server.close();
    settle(rejectCode, new OAuthLoginCancelledError()); // 이미 끝났으면 no-op
  }
  const listening = new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(CHATGPT_OAUTH.callbackPort, '127.0.0.1', res);
  });
  return { listening, waitForCode, cancel: close };
}
