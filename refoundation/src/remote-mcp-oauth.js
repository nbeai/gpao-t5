import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

function httpsUrl(value, label) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error(`${label} is invalid`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} must use HTTPS`);
  return url;
}

async function jsonResponse(response, message, reason) {
  const parsed = await response.json().catch(() => null);
  if (!response.ok || !parsed || typeof parsed !== 'object') {
    throw Object.assign(new Error(message), { status: response.status || 502, reason });
  }
  return parsed;
}

export async function discoverRemoteMcpOAuth({ serverUrl, fetchImpl = globalThis.fetch, label = '서비스' } = {}) {
  const server = httpsUrl(serverUrl, 'Remote MCP URL');
  const resourcePath = server.pathname === '/' ? '' : server.pathname.replace(/\/$/u, '');
  const headers = { accept: 'application/json', 'user-agent': 'GPAO-T5-MCP/1.0' };
  const resourceCandidates = [...new Set([
    new URL(`/.well-known/oauth-protected-resource${resourcePath}`, server.origin).href,
    new URL('/.well-known/oauth-protected-resource', server.origin).href,
  ])];
  let resource = null;
  for (const candidate of resourceCandidates) {
    const response = await fetchImpl(candidate, { headers });
    if (response.status === 404) continue;
    resource = await jsonResponse(response, `${label} 연결 준비를 확인하지 못했어요.`, 'protected_resource_discovery_failed');
    break;
  }
  if (!resource) throw Object.assign(new Error(`${label} 연결 준비를 확인하지 못했어요.`), {
    status: 404, reason: 'protected_resource_discovery_failed',
  });
  if (!Array.isArray(resource.authorization_servers) || !resource.authorization_servers.length) {
    throw new Error(`${label} OAuth discovery returned no authorization server`);
  }
  let protectedResource = null;
  if (resource.resource != null) {
    const declared = httpsUrl(resource.resource, 'Remote MCP protected resource');
    if (declared.search || declared.hash || declared.origin !== server.origin) {
      throw new Error(`${label} protected resource does not cover the MCP server`);
    }
    const basePath = declared.pathname.replace(/\/$/u, '') || '/';
    if (basePath !== '/' && server.pathname !== basePath && !server.pathname.startsWith(`${basePath}/`)) {
      throw new Error(`${label} protected resource does not cover the MCP server`);
    }
    protectedResource = declared.href.replace(/\/$/u, '');
  }
  const issuer = httpsUrl(resource.authorization_servers[0], 'Remote MCP authorization server');
  const metadataCandidates = [
    new URL('/.well-known/oauth-authorization-server', issuer).href,
    new URL('/.well-known/openid-configuration', issuer).href,
  ];
  let metadata = null;
  for (const candidate of metadataCandidates) {
    const response = await fetchImpl(candidate, { headers });
    if (response.status === 404) continue;
    metadata = await jsonResponse(response, `${label} 연결 준비를 확인하지 못했어요.`, 'authorization_discovery_failed');
    break;
  }
  if (!metadata) throw Object.assign(new Error(`${label} 연결 준비를 확인하지 못했어요.`), {
    status: 404, reason: 'authorization_discovery_failed',
  });
  const discoveredIssuer = issuer.href.replace(/\/$/u, '');
  const metadataIssuer = httpsUrl(metadata.issuer ?? issuer, 'Remote MCP issuer').href.replace(/\/$/u, '');
  if (metadataIssuer !== discoveredIssuer) throw new Error(`${label} OAuth metadata issuer does not match discovery`);
  for (const key of ['authorization_endpoint', 'token_endpoint']) {
    if (!metadata[key]) throw new Error(`${label} OAuth metadata is missing ${key}`);
    httpsUrl(metadata[key], `Remote MCP ${key}`);
  }
  if (metadata.registration_endpoint) httpsUrl(metadata.registration_endpoint, 'Remote MCP registration_endpoint');
  if (!metadata.code_challenge_methods_supported?.includes('S256')) {
    throw new Error(`${label} OAuth metadata does not support PKCE S256`);
  }
  return { ...metadata, ...(protectedResource ? { protected_resource: protectedResource } : {}) };
}

export function createRemoteMcpPkce(random = randomBytes) {
  const verifier = random(48).toString('base64url');
  return {
    verifier, challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: random(24).toString('base64url'),
  };
}

export async function registerRemoteMcpClient({ metadata, redirectUri, fetchImpl = globalThis.fetch, label = '서비스' } = {}) {
  const endpoint = httpsUrl(metadata?.registration_endpoint, 'Remote MCP registration endpoint');
  const redirect = new URL(String(redirectUri));
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1') {
    throw new TypeError('Remote MCP redirect must use local loopback');
  }
  const registered = await jsonResponse(await fetchImpl(endpoint, {
    method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json', 'user-agent': 'GPAO-T5-MCP/1.0',
    },
    body: JSON.stringify({
      client_name: 'GPAO-T5', redirect_uris: [redirect.href],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  }), `${label} 연결 준비를 확인하지 못했어요.`, 'client_registration_failed');
  if (!registered.client_id) throw new Error(`${label} client registration returned no client id`);
  return {
    client_id: String(registered.client_id),
    ...(registered.client_secret ? { client_secret: String(registered.client_secret) } : {}),
  };
}

export function buildRemoteMcpAuthorizeUrl({
  metadata, client, redirectUri, challenge, state, resource = null, requestedScopes = null,
  authorizationParameters = null,
} = {}) {
  const url = httpsUrl(metadata?.authorization_endpoint, 'Remote MCP authorization endpoint');
  if (!client?.client_id || !redirectUri || !challenge || !state) throw new TypeError('Remote MCP authorization input is required');
  url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', client.client_id);
  url.searchParams.set('redirect_uri', String(redirectUri));
  const supported = Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.filter(Boolean).map(String) : [];
  const scopes = requestedScopes == null ? supported : [...new Set(requestedScopes.map(String).filter(Boolean))];
  if (scopes.length) url.searchParams.set('scope', scopes.join(' '));
  if (resource) url.searchParams.set('resource', String(resource));
  url.searchParams.set('state', String(state)); url.searchParams.set('code_challenge', String(challenge));
  url.searchParams.set('code_challenge_method', 'S256'); url.searchParams.set('prompt', 'consent');
  if (authorizationParameters != null) {
    if (!authorizationParameters || typeof authorizationParameters !== 'object' || Array.isArray(authorizationParameters)) {
      throw new TypeError('Remote MCP authorization parameters are invalid');
    }
    const allowed = { access_type: new Set(['offline']), include_granted_scopes: new Set(['true']) };
    for (const [name, raw] of Object.entries(authorizationParameters)) {
      const value = String(raw);
      if (!allowed[name]?.has(value)) throw new TypeError('Remote MCP authorization parameter is not allowed');
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

function tokens(value, { now, previous = null, requestedScopes = [], label }) {
  if (!value?.access_token) throw new Error(`${label} token response had no access token`);
  const hasExpiry = value.expires_in != null && Number.isFinite(Number(value.expires_in));
  const expiresIn = hasExpiry ? Number(value.expires_in) : null;
  return {
    accessToken: String(value.access_token),
    refreshToken: value.refresh_token ? String(value.refresh_token) : previous?.refreshToken ?? null,
    expiresAt: expiresIn == null ? null : now() + Math.max(60, expiresIn - 300) * 1000,
    tokenType: String(value.token_type ?? 'Bearer'),
    scopes: value.scope == null
      ? [...new Set((previous?.scopes ?? requestedScopes).map(String).filter(Boolean))]
      : String(value.scope).split(/\s+/u).filter(Boolean),
  };
}

async function tokenRequest({ metadata, client, params, fetchImpl, now, previous, requestedScopes, label, signal }) {
  const body = new URLSearchParams(params); body.set('client_id', client.client_id);
  if (client.client_secret) body.set('client_secret', client.client_secret);
  const response = await fetchImpl(httpsUrl(metadata.token_endpoint, 'Remote MCP token endpoint'), {
    method: 'POST', headers: {
      'content-type': 'application/x-www-form-urlencoded', accept: 'application/json',
      'user-agent': 'GPAO-T5-MCP/1.0',
    }, body: body.toString(), signal,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) throw Object.assign(new Error(
    response.status === 400 && json?.error === 'invalid_grant'
      ? `${label} 연결이 만료됐어요. 다시 연결해 주세요.` : `${label} 연결 자격을 확인하지 못했어요.`,
  ), { status: response.status || 502, reason: response.status === 400 && json?.error === 'invalid_grant'
    ? 'reauth_required' : 'token_request_failed' });
  return tokens(json, { now, previous, requestedScopes, label });
}

export function exchangeRemoteMcpCode(input = {}, deps = {}) {
  if (!input.code || !input.verifier) throw new TypeError('Remote MCP authorization code and verifier are required');
  return tokenRequest({
    metadata: input.metadata, client: input.client,
    params: { grant_type: 'authorization_code', code: String(input.code),
      redirect_uri: String(input.redirectUri), code_verifier: String(input.verifier) },
    fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now ?? Date.now,
    previous: null, requestedScopes: input.requestedScopes ?? [], label: input.label ?? '서비스', signal: deps.signal,
  });
}

export function refreshRemoteMcpTokens(input = {}, deps = {}) {
  if (!input.tokens?.refreshToken) throw new TypeError('Remote MCP refresh token is required');
  return tokenRequest({
    metadata: input.metadata, client: input.client,
    params: { grant_type: 'refresh_token', refresh_token: String(input.tokens.refreshToken) },
    fetchImpl: deps.fetchImpl ?? globalThis.fetch, now: deps.now ?? Date.now,
    previous: input.tokens, requestedScopes: input.tokens.scopes ?? [], label: input.label ?? '서비스', signal: deps.signal,
  });
}

export function startRemoteMcpCallback({ state, label = '서비스', port = 0, timeoutMs = 600_000 } = {}) {
  if (!state) throw new TypeError('Remote MCP callback state is required');
  let resolveCode; let rejectCode; let settled = false;
  const waitForCode = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  waitForCode.catch(() => {});
  const server = createServer((request, response) => {
    const address = server.address(); const redirectUri = `http://127.0.0.1:${address.port}/`;
    const url = new URL(request.url ?? '/', redirectUri);
    if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
    const code = url.searchParams.get('code'); const returnedState = url.searchParams.get('state');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff' });
    if (url.searchParams.get('error') || !code || returnedState !== state) {
      response.end(`<h3>${label} 연결을 완료하지 못했어요. 이 창을 닫고 T5에서 다시 시도해 주세요.</h3>`);
      finish(rejectCode, new Error('Remote MCP OAuth callback was rejected')); return;
    }
    response.end(`<h3>${label} 승인을 받았어요. T5에서 연결을 확인하고 있어요.</h3>`);
    finish(resolveCode, code);
  });
  const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); server.close(); };
  const timer = setTimeout(() => finish(rejectCode, new Error('Remote MCP OAuth login timed out')), timeoutMs);
  timer.unref?.();
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, '127.0.0.1', () => {
      const address = server.address(); resolve({ port: address.port, redirectUri: `http://127.0.0.1:${address.port}/` });
    });
  });
  return { listening, waitForCode, cancel() { finish(rejectCode, new Error('Remote MCP OAuth login cancelled')); } };
}
