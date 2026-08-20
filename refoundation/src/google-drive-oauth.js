import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function createGoogleDrivePkce(random = randomBytes) {
  const verifier = random(48).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: random(24).toString('base64url'),
  };
}

export function buildGoogleDriveAuthorizeUrl({ clientId, redirectUri, challenge, state } = {}) {
  if (!clientId || !redirectUri || !challenge || !state) {
    throw new TypeError('Google OAuth client, redirect, PKCE challenge, and state are required');
  }
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1') {
    throw new TypeError('Google OAuth redirect must use the local loopback address');
  }
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', String(clientId));
  url.searchParams.set('redirect_uri', redirect.href);
  url.searchParams.set('scope', GOOGLE_DRIVE_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('code_challenge', String(challenge));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', String(state));
  return url.toString();
}

function credentialFromToken(json, { now, existingRefreshToken = null } = {}) {
  if (!json?.access_token) throw new Error('Google OAuth token response had no access token');
  const expiresIn = Number(json.expires_in ?? 3600);
  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : existingRefreshToken,
    expiresAt: now() + Math.max(60, expiresIn - 60) * 1000,
    tokenType: String(json.token_type ?? 'Bearer'),
    scopes: String(json.scope ?? GOOGLE_DRIVE_SCOPE).split(/\s+/u).filter(Boolean),
  };
}

async function tokenRequest(params, { fetchImpl, now, existingRefreshToken = null } = {}) {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) {
    throw Object.assign(new Error('Google 계정 연결 자격을 확인하지 못했어요.'), {
      status: response.status || 500, reason: 'token_exchange_failed',
    });
  }
  return credentialFromToken(json, { now, existingRefreshToken });
}

export function exchangeGoogleDriveCode({ clientId, code, verifier, redirectUri } = {}, deps = {}) {
  if (!clientId || !code || !verifier || !redirectUri) throw new TypeError('Google OAuth code exchange input is required');
  return tokenRequest({
    grant_type: 'authorization_code', client_id: String(clientId), code: String(code),
    code_verifier: String(verifier), redirect_uri: String(redirectUri),
  }, { fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now ?? Date.now });
}

export function refreshGoogleDriveCredential({ clientId, credential } = {}, deps = {}) {
  if (!clientId || !credential?.refreshToken) throw new TypeError('Google refresh token and client id are required');
  return tokenRequest({
    grant_type: 'refresh_token', client_id: String(clientId), refresh_token: String(credential.refreshToken),
  }, {
    fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now ?? Date.now,
    existingRefreshToken: credential.refreshToken,
  });
}

export function startGoogleDriveCallback({ state, timeoutMs = 300_000 } = {}) {
  if (!state) throw new TypeError('Google OAuth callback state is required');
  let resolveCode;
  let rejectCode;
  let settled = false;
  const waitForCode = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  waitForCode.catch(() => {});
  const server = createServer((request, response) => {
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/`;
    const url = new URL(request.url ?? '/', redirectUri);
    if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    });
    if (oauthError || !code || returnedState !== state) {
      response.end('<h3>Google 연결을 완료하지 못했어요. 이 창을 닫고 T5에서 다시 시도해 주세요.</h3>');
      finish(rejectCode, new Error('Google OAuth callback was rejected'));
      return;
    }
    response.end('<h3>Google 연결을 확인했어요. 이 창을 닫고 T5로 돌아가세요.</h3>');
    finish(resolveCode, code);
  });
  const finish = (fn, value) => {
    if (settled) return;
    settled = true; clearTimeout(timer); fn(value); server.close();
  };
  const timer = setTimeout(() => finish(rejectCode, new Error('Google OAuth login timed out')), timeoutMs);
  timer.unref?.();
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ port: address.port, redirectUri: `http://127.0.0.1:${address.port}/` });
    });
  });
  return {
    listening, waitForCode,
    cancel() { finish(rejectCode, new Error('Google OAuth login cancelled')); },
  };
}
