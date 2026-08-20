import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';

function httpsUrl(value, label) {
  let url;
  try { url = new URL(String(value)); }
  catch { throw new Error(`${label} is invalid`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must use HTTPS`);
  return url;
}

async function jsonResponse(response, reason) {
  const parsed = await response.json().catch(() => null);
  if (!response.ok || !parsed || typeof parsed !== 'object') {
    throw Object.assign(new Error('Notion 연결 준비를 확인하지 못했어요.'), {
      status: response.status || 502, reason,
    });
  }
  return parsed;
}

export async function discoverNotionOAuth({ serverUrl = NOTION_MCP_URL, fetchImpl = globalThis.fetch } = {}) {
  const server = httpsUrl(serverUrl, 'Notion MCP URL');
  const resourcePath = server.pathname === '/' ? '' : server.pathname.replace(/\/$/u, '');
  const resourceMetadataUrl = new URL(`/.well-known/oauth-protected-resource${resourcePath}`, server.origin);
  const resource = await jsonResponse(await fetchImpl(resourceMetadataUrl, {
    headers: { accept: 'application/json', 'user-agent': 'GPAO-T5-MCP/1.0' },
  }), 'protected_resource_discovery_failed');
  if (!Array.isArray(resource.authorization_servers) || !resource.authorization_servers.length) {
    throw new Error('Notion OAuth discovery returned no authorization server');
  }
  const issuer = httpsUrl(resource.authorization_servers[0], 'Notion authorization server');
  const metadataUrl = new URL('/.well-known/oauth-authorization-server', issuer);
  const metadata = await jsonResponse(await fetchImpl(metadataUrl, {
    headers: { accept: 'application/json', 'user-agent': 'GPAO-T5-MCP/1.0' },
  }), 'authorization_discovery_failed');
  const expectedOrigin = httpsUrl(metadata.issuer ?? issuer, 'Notion OAuth issuer').origin;
  for (const [key, required] of [
    ['authorization_endpoint', true], ['token_endpoint', true], ['registration_endpoint', true],
  ]) {
    if (required && !metadata[key]) throw new Error(`Notion OAuth metadata is missing ${key}`);
    if (metadata[key] && httpsUrl(metadata[key], `Notion ${key}`).origin !== expectedOrigin) {
      throw new Error(`Notion ${key} does not match the discovered issuer`);
    }
  }
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('Notion OAuth metadata does not support PKCE S256');
  }
  return metadata;
}

export function createNotionPkce(random = randomBytes) {
  const verifier = random(48).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: random(24).toString('base64url'),
  };
}

export async function registerNotionClient({ metadata, redirectUri, fetchImpl = globalThis.fetch } = {}) {
  const endpoint = httpsUrl(metadata?.registration_endpoint, 'Notion registration endpoint');
  const redirect = new URL(String(redirectUri));
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1') {
    throw new TypeError('Notion redirect must use local loopback');
  }
  const registered = await jsonResponse(await fetchImpl(endpoint, {
    method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json', 'user-agent': 'GPAO-T5-MCP/1.0',
    },
    body: JSON.stringify({
      client_name: 'GPAO-T5',
      redirect_uris: [redirect.href],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
  }), 'client_registration_failed');
  if (!registered.client_id) throw new Error('Notion client registration returned no client id');
  return {
    client_id: String(registered.client_id),
    ...(registered.client_secret ? { client_secret: String(registered.client_secret) } : {}),
    ...(registered.client_id_issued_at ? { client_id_issued_at: Number(registered.client_id_issued_at) } : {}),
    ...(registered.client_secret_expires_at
      ? { client_secret_expires_at: Number(registered.client_secret_expires_at) } : {}),
  };
}

export function buildNotionAuthorizeUrl({ metadata, client, redirectUri, challenge, state } = {}) {
  const url = httpsUrl(metadata?.authorization_endpoint, 'Notion authorization endpoint');
  if (!client?.client_id || !redirectUri || !challenge || !state) throw new TypeError('Notion authorization input is required');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.client_id);
  url.searchParams.set('redirect_uri', String(redirectUri));
  const scopes = Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.filter(Boolean) : [];
  if (scopes.length) url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', String(state));
  url.searchParams.set('code_challenge', String(challenge));
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

function tokensFrom(value, { now, previous = null } = {}) {
  if (!value?.access_token) throw new Error('Notion token response had no access token');
  const expiresIn = Number(value.expires_in ?? 28_800);
  return {
    accessToken: String(value.access_token),
    refreshToken: value.refresh_token ? String(value.refresh_token) : previous?.refreshToken ?? null,
    expiresAt: now() + Math.max(60, expiresIn - 300) * 1000,
    tokenType: String(value.token_type ?? 'Bearer'),
    scopes: String(value.scope ?? '').split(/\s+/u).filter(Boolean),
    userId: value.user_id ? String(value.user_id) : previous?.userId ?? null,
    workspaceId: value.workspace_id ? String(value.workspace_id) : previous?.workspaceId ?? null,
    emailDomain: value.email_domain ? String(value.email_domain) : previous?.emailDomain ?? null,
  };
}

async function tokenRequest({ metadata, client, params, fetchImpl, now, previous = null }) {
  const body = new URLSearchParams(params);
  body.set('client_id', client.client_id);
  if (client.client_secret) body.set('client_secret', client.client_secret);
  const response = await fetchImpl(httpsUrl(metadata.token_endpoint, 'Notion token endpoint'), {
    method: 'POST', headers: {
      'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
      'user-agent': 'GPAO-T5-MCP/1.0',
    }, body: body.toString(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) {
    throw Object.assign(new Error(response.status === 400 && json?.error === 'invalid_grant'
      ? 'Notion 연결이 만료됐어요. 다시 연결해 주세요.' : 'Notion 연결 자격을 확인하지 못했어요.'), {
      status: response.status || 502,
      reason: response.status === 400 && json?.error === 'invalid_grant'
        ? 'reauth_required' : 'token_request_failed',
    });
  }
  return tokensFrom(json, { now, previous });
}

export function exchangeNotionCode({ metadata, client, redirectUri, code, verifier } = {}, deps = {}) {
  if (!code || !verifier) throw new TypeError('Notion authorization code and verifier are required');
  return tokenRequest({
    metadata, client,
    params: {
      grant_type: 'authorization_code', code: String(code),
      redirect_uri: String(redirectUri), code_verifier: String(verifier),
    },
    fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now ?? Date.now,
  });
}

export function refreshNotionTokens({ metadata, client, tokens } = {}, deps = {}) {
  if (!tokens?.refreshToken) throw new TypeError('Notion refresh token is required');
  return tokenRequest({
    metadata, client,
    params: { grant_type: 'refresh_token', refresh_token: String(tokens.refreshToken) },
    fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now ?? Date.now, previous: tokens,
  });
}

export function startNotionCallback({ state, port = 1456, timeoutMs = 600_000 } = {}) {
  if (!state) throw new TypeError('Notion callback state is required');
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
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
    });
    if (url.searchParams.get('error') || !code || returnedState !== state) {
      response.end('<h3>Notion 연결을 완료하지 못했어요. 이 창을 닫고 T5에서 다시 시도해 주세요.</h3>');
      finish(rejectCode, new Error('Notion OAuth callback was rejected'));
      return;
    }
    response.end('<h3>Notion 연결을 확인했어요. 이 창을 닫고 T5로 돌아가세요.</h3>');
    finish(resolveCode, code);
  });
  const finish = (fn, value) => {
    if (settled) return;
    settled = true; clearTimeout(timer); fn(value); server.close();
  };
  const timer = setTimeout(() => finish(rejectCode, new Error('Notion OAuth login timed out')), timeoutMs);
  timer.unref?.();
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({ port: address.port, redirectUri: `http://127.0.0.1:${address.port}/` });
    });
  });
  return {
    listening, waitForCode,
    cancel() { finish(rejectCode, new Error('Notion OAuth login cancelled')); },
  };
}
