import { buildRemoteMcpAuthorizeUrl, createRemoteMcpPkce, discoverRemoteMcpOAuth,
  exchangeRemoteMcpCode, refreshRemoteMcpTokens, registerRemoteMcpClient, startRemoteMcpCallback } from './remote-mcp-oauth.js';
import { makeRemoteMcpRuntime } from './remote-mcp-runtime.js';
import { makeRemoteMcpTool } from './remote-mcp-tool.js';

const emptyCapabilities = () => ({ search: false, read: false, create: false, update: false, download: false, upload: false });
function capabilitiesFromTools(tools) {
  const text = tools.join(' ').toLowerCase();
  return { search: /search|list|find|query/u.test(text), read: /get|read|list|search|find/u.test(text),
    create: /create|add/u.test(text), update: /update|edit|move/u.test(text), download: false, upload: false };
}

function oauthClient(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !String(value.client_id ?? '').trim()) {
    throw new TypeError('Remote MCP pre-registered OAuth client is invalid');
  }
  return { client_id: String(value.client_id),
    ...(value.client_secret ? { client_secret: String(value.client_secret) } : {}) };
}

function oauthScopes(value) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new TypeError('Remote MCP OAuth scopes must be an array');
  const scopes = [...new Set(value.map(String).map((scope) => scope.trim()).filter(Boolean))];
  if (!scopes.length || scopes.length > 64 || scopes.some((scope) => scope.length > 200 || /\s/u.test(scope))) {
    throw new TypeError('Remote MCP OAuth scopes are invalid');
  }
  return scopes;
}

function verifiedIdentity(value, grantedScopes, requireObservedAccount) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const accountId = String(source.accountId ?? '').trim().slice(0, 200);
  const accountLabel = String(source.accountLabel ?? '').trim().slice(0, 200);
  if (requireObservedAccount && !accountId) throw new Error('Remote MCP account identity was not observed');
  const permissions = Array.isArray(source.permissions)
    ? [...new Set(source.permissions.map(String).filter(Boolean))].slice(0, 64) : grantedScopes;
  const resources = Array.isArray(source.resources) ? source.resources.slice(0, 32).flatMap((resource) => {
    const id = String(resource?.id ?? '').trim().slice(0, 200);
    const label = String(resource?.label ?? '').trim().slice(0, 200);
    const scope = String(resource?.scope ?? '').trim().slice(0, 80);
    return id && label && scope ? [{ id, label, scope }] : [];
  }) : [];
  return { ownerApplication: 'GPAO-T5', transport: 'remote_mcp',
    ...(accountId ? { accountId } : {}), ...(accountLabel ? { accountLabel } : {}),
    permissions, resources, observed: Boolean(accountId) };
}

function verifiedCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 32
    || entries.some(([key, available]) => !/^[a-z][a-z0-9_]{0,63}$/u.test(key) || typeof available !== 'boolean')) {
    throw new Error('Remote MCP verifier returned invalid capabilities');
  }
  return Object.fromEntries(entries);
}

export function makeRemoteMcpConnection({
  id, label, category = 'workspace', serverUrl, resource = null,
  secretStore, fetchImpl = globalThis.fetch, now = Date.now, callbackPort = 0,
  runtimeFactory = makeRemoteMcpRuntime, oauthClient: configuredOAuthClient = null,
  requestedScopes: configuredScopes = null, verifyConnection = null, requireObservedAccount = false,
  authorizationParameters = null,
} = {}) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(String(id ?? '')) || !label || !/^https:\/\//u.test(String(serverUrl ?? ''))) {
    throw new TypeError('Remote MCP connection identity is required');
  }
  if (!secretStore?.get || !secretStore?.set || !secretStore?.clear) throw new TypeError('Remote MCP secure store is required');
  const preRegisteredClient = oauthClient(configuredOAuthClient);
  const requestedScopes = oauthScopes(configuredScopes);
  if (verifyConnection != null && typeof verifyConnection !== 'function') throw new TypeError('Remote MCP verifier is invalid');
  const secretName = `remote-mcp-${id}`; let pending = null; let runtime = null; let refreshQueue = Promise.resolve();
  async function bundle() { return secretStore.get(secretName); }
  async function refresh(force = false) {
    const work = refreshQueue.then(async () => {
      const current = await bundle();
      if (!current?.tokens) throw Object.assign(new Error(`${label} 연결이 필요해요.`), { status: 409, reason: 'not_connected' });
      if (!force && Number(current.tokens.expiresAt ?? 0) > now() + 10 * 60_000) return current.tokens;
      try {
        const tokens = await refreshRemoteMcpTokens({ metadata: current.metadata, client: current.client,
          tokens: current.tokens, label }, { fetchImpl, now });
        await secretStore.set(secretName, { ...current, tokens, verifiedAt: now() }); runtime?.invalidate?.(); return tokens;
      } catch (error) {
        if (error?.reason === 'reauth_required') { const { tokens: _tokens, ...registration } = current;
          await secretStore.set(secretName, registration); await runtime?.close?.().catch(() => {}); runtime = null; }
        throw error;
      }
    }); refreshQueue = work.catch(() => {}); return work;
  }
  async function credential() { return refresh(false); }
  async function activeRuntime() {
    if (!runtime) runtime = runtimeFactory({ serverUrl, credential, onUnauthorized: () => refresh(true) });
    return runtime;
  }
  return { id, label, category, toolName: id,
    async inspect() {
      const current = await bundle(); const connected = Boolean(current?.verifiedAt && current?.tokens);
      const connecting = pending != null;
      return { state: connected ? 'connected' : 'needs_connection',
        reason: connected ? 'verified_remote_mcp' : connecting ? 'oauth_in_progress' : 'remote_mcp_not_connected',
        userSafeSummary: connected ? `${label}에 연결되어 있어요.`
          : connecting ? `${label} 연결 화면에서 사용자 확인을 기다리고 있어요.` : `${label} 계정 연결을 시작할 수 있어요.`,
        capabilities: connected ? current.capabilities ?? capabilitiesFromTools(current.tools ?? []) : emptyCapabilities(),
        ...(connected && current.identity ? { identity: current.identity } : {}),
        routes: [{ kind: 'remote_mcp', label: `${label} 공식 연결`, state: connected ? 'connected' : 'needs_connection', canStart: !connected && !connecting }],
        actions: connected ? [{ id: 'disconnect', label: '연결 해제', kind: 'disconnect', endpoint: `/connections/${id}/disconnect` }]
          : connecting ? [{ id: 'cancel', label: '연결 취소', kind: 'cancel', endpoint: `/connections/${id}/cancel` }]
            : [{ id: 'connect', label: `${label} 계정 연결`, kind: 'oauth', startEndpoint: `/connections/${id}/start`, awaitEndpoint: `/connections/${id}/await` }],
      };
    },
    async start() {
      if (pending) throw Object.assign(new Error(`${label} 연결을 이미 진행하고 있어요.`), { status: 409, reason: 'oauth_in_progress' });
      pending = { phase: 'starting' }; let callback = null;
      try {
        const pkce = createRemoteMcpPkce(); callback = startRemoteMcpCallback({ state: pkce.state, label, port: callbackPort });
        const address = await callback.listening; let current = await bundle();
        if (!current?.metadata || !current?.client || current.redirectUri !== address.redirectUri
          || Boolean(preRegisteredClient) !== (current.clientMode === 'pre_registered')) {
          const metadata = await discoverRemoteMcpOAuth({ serverUrl, fetchImpl, label });
          const client = preRegisteredClient ?? await registerRemoteMcpClient({
            metadata, redirectUri: address.redirectUri, fetchImpl, label,
          });
          current = { version: 1, redirectUri: address.redirectUri, metadata, client,
            clientMode: preRegisteredClient ? 'pre_registered' : 'dynamic_registration' };
          await secretStore.set(secretName, current);
        }
        pending = { pkce, callback, bundle: current };
        return { authorizeUrl: buildRemoteMcpAuthorizeUrl({ metadata: current.metadata, client: current.client,
          redirectUri: current.redirectUri, challenge: pkce.challenge, state: pkce.state, resource,
          requestedScopes, authorizationParameters }), notice: `${label} 연결을 시작했어요.` };
      } catch (error) { callback?.cancel(); pending = null; throw error; }
    },
    async awaitConnection() {
      const current = pending;
      if (!current) throw Object.assign(new Error(`${label} 연결을 먼저 시작해 주세요.`), { status: 409, reason: 'oauth_not_started' });
      try {
        const code = await current.callback.waitForCode;
        const tokens = await exchangeRemoteMcpCode({ metadata: current.bundle.metadata, client: current.bundle.client,
          redirectUri: current.bundle.redirectUri, code, verifier: current.pkce.verifier,
          requestedScopes: requestedScopes ?? [], label }, { fetchImpl, now });
        if (requestedScopes?.some((scope) => !tokens.scopes.includes(scope))) {
          throw new Error(`${label} 연결에 필요한 권한이 허용되지 않았어요.`);
        }
        await secretStore.set(secretName, { ...current.bundle, tokens });
        const tools = await (await activeRuntime()).listTools();
        if (!tools.length) throw new Error(`${label} 연결에서 사용할 도구를 확인하지 못했어요.`);
        const observed = verifyConnection ? await verifyConnection({
          runtime: await activeRuntime(), tools: structuredClone(tools), grantedScopes: [...tokens.scopes],
          credential: { accessToken: tokens.accessToken },
        }) : null;
        const identity = verifiedIdentity(observed, tokens.scopes, requireObservedAccount);
        const capabilities = verifiedCapabilities(observed?.capabilities);
        await secretStore.set(secretName, { ...current.bundle, tokens, tools: tools.map((tool) => tool.name), identity,
          ...(capabilities ? { capabilities } : {}), verifiedAt: now() });
        return { connected: true, provider: id, userSafeSummary: `${label}을 연결했어요.` };
      } catch (error) { const saved = await bundle(); if (saved?.tokens && !saved.verifiedAt) {
        const { tokens: _tokens, ...registration } = saved; await secretStore.set(secretName, registration).catch(() => {}); }
        throw error;
      } finally { current.callback.cancel(); if (pending === current) pending = null; }
    },
    async makeTool({ authorizeEffect }) { return (await this.inspect()).state === 'connected'
      ? makeRemoteMcpTool({ id, label, runtime: await activeRuntime(), authorizeEffect }) : null; },
    async cancelPending() { if (!pending) return { cancelled: false, userSafeSummary: `진행 중인 ${label} 연결이 없어요.` };
      const current = pending; pending = null; current.callback.cancel(); return { cancelled: true, userSafeSummary: `${label} 연결을 취소했어요.` }; },
    async disconnect() { await this.cancelPending(); await runtime?.close?.().catch(() => {}); runtime = null; await secretStore.clear(secretName);
      return { disconnected: true, userSafeSummary: `${label} 연결을 해제했어요.` }; },
    async close() { pending?.callback?.cancel(); pending = null; await runtime?.close?.().catch(() => {}); runtime = null; },
  };
}
