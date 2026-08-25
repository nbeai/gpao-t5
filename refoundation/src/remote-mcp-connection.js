import { buildRemoteMcpAuthorizeUrl, createRemoteMcpPkce, discoverRemoteMcpOAuth,
  exchangeRemoteMcpCode, refreshRemoteMcpTokens, registerRemoteMcpClient, startRemoteMcpCallback } from './remote-mcp-oauth.js';
import { makeRemoteMcpRuntime } from './remote-mcp-runtime.js';
import { makeRemoteMcpTool } from './remote-mcp-tool.js';
import { makeConnectionProtocolStorage } from './connection-protocol-storage.js';

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

function enforceOAuthPolicy(metadata, policy) {
  if (policy == null) return;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('Remote MCP OAuth policy is invalid');
  const fields = { issuer: 'issuer', authorizationEndpoint: 'authorization_endpoint', tokenEndpoint: 'token_endpoint' };
  for (const [policyName, metadataName] of Object.entries(fields)) {
    if (policy[policyName] != null && String(metadata?.[metadataName] ?? '') !== String(policy[policyName])) {
      throw Object.assign(new Error('Remote MCP provider OAuth contract changed'), { reason: 'provider_contract_changed' });
    }
  }
  if (policy.expectedResource != null
    && String(metadata?.protected_resource ?? '') !== String(policy.expectedResource)) {
    throw Object.assign(new Error('Remote MCP protected resource contract changed'), { reason: 'provider_contract_changed' });
  }
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
  authorizationParameters = null, stateStore = null, credentialCoordinator = null,
  t5UserId = 'local-owner', connectionSlotId = id, makeId = undefined,
  readOnlyOnly = false, allowedToolNames = null,
  oauthPolicy = null, stability = 'stable',
} = {}) {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(String(id ?? '')) || !label || !/^https:\/\//u.test(String(serverUrl ?? ''))) {
    throw new TypeError('Remote MCP connection identity is required');
  }
  if (!secretStore?.get || !secretStore?.set || !secretStore?.clear) throw new TypeError('Remote MCP secure store is required');
  const preRegisteredClient = oauthClient(configuredOAuthClient);
  const requestedScopes = oauthScopes(configuredScopes);
  if (verifyConnection != null && typeof verifyConnection !== 'function') throw new TypeError('Remote MCP verifier is invalid');
  const secretName = `remote-mcp-${id}`; let pending = null; let runtime = null; let refreshQueue = Promise.resolve();
  const durable = stateStore && credentialCoordinator ? makeConnectionProtocolStorage({
    id, serverUrl, oauthClientId: preRegisteredClient?.client_id, stateStore, credentialCoordinator,
    secretStore, t5UserId, connectionSlotId, ...(makeId ? { makeId } : {}), now,
  }) : null;
  let migrationPromise = null;
  async function bundle() {
    if (!durable) return secretStore.get(secretName);
    await durable.reconcile();
    let current = await durable.read();
    if (!current && durable.state().generation === 0) {
      migrationPromise ??= durable.migrateLegacy(secretName, (legacy) => {
        if (!legacy?.verifiedAt || !legacy?.tokens || !legacy?.metadata?.issuer || !legacy?.identity?.accountId) return null;
        try { enforceOAuthPolicy(legacy.metadata, oauthPolicy); } catch { return null; }
        return { credential: legacy, issuer: legacy.metadata.issuer, identity: legacy.identity,
          scopes: legacy.tokens.scopes ?? legacy.identity.permissions ?? [],
          capabilities: legacy.capabilities ?? capabilitiesFromTools(legacy.tools ?? []) };
      }).finally(() => { migrationPromise = null; });
      current = await migrationPromise;
    }
    if (current?.credential && oauthPolicy) {
      try { enforceOAuthPolicy(current.credential.metadata, oauthPolicy); }
      catch { return null; }
    }
    return current?.credential ?? null;
  }
  async function refresh(force = false, rejectedGeneration = null) {
    if (durable && !force) {
      const snapshot = await durable.read(); const state = snapshot?.state; const current = snapshot?.credential;
      if (state?.state === 'ready' && current?.tokens && (current.tokens.expiresAt == null
        || Number(current.tokens.expiresAt) > now() + 10 * 60_000)) {
        return { ...current.tokens, generation: state.generation };
      }
    }
    if (durable) return durable.withLease(async ({ lease, signal, assertLease }) => {
      const currentState = durable.state(); const currentRead = await durable.read(); const current = currentRead?.credential;
      if (!current?.tokens) throw Object.assign(new Error(`${label} 연결이 필요해요.`), { status: 409, reason: 'not_connected' });
      if (force && Number.isInteger(rejectedGeneration) && currentState.generation !== rejectedGeneration) {
        return { ...current.tokens, generation: currentState.generation };
      }
      if (!force && (current.tokens.expiresAt == null
        || Number(current.tokens.expiresAt) > now() + 10 * 60_000)) return { ...current.tokens, generation: currentState.generation };
      if (!current.tokens.refreshToken) {
        durable.markWithLease({ lease, expectedGeneration: currentState.generation, state: 'needs_reauth' });
        throw Object.assign(new Error(`${label} 연결이 만료됐어요. 다시 연결해 주세요.`), { status: 401, reason: 'reauth_required' });
      }
      try {
        const tokens = await refreshRemoteMcpTokens({ metadata: current.metadata, client: current.client,
          tokens: current.tokens, label }, { fetchImpl, now, signal });
        assertLease();
        await durable.commitWithLease({ lease, expectedGeneration: currentState.generation,
          credential: { ...current, tokens, verifiedAt: now() }, issuer: current.metadata.issuer,
          identity: currentState.identity, scopes: tokens.scopes, capabilities: currentState.capabilities });
        const latest = await durable.read();
        return { ...(latest?.credential?.tokens ?? tokens), generation: latest?.state?.generation ?? currentState.generation + 1 };
      } catch (error) {
        if (error?.reason === 'reauth_required') {
          durable.markWithLease({ lease, expectedGeneration: currentState.generation, state: 'needs_reauth' });
        }
        throw error;
      }
    });
    const work = refreshQueue.then(async () => {
      const current = await bundle();
      if (!current?.tokens) throw Object.assign(new Error(`${label} 연결이 필요해요.`), { status: 409, reason: 'not_connected' });
      if (!force && (current.tokens.expiresAt == null
        || Number(current.tokens.expiresAt) > now() + 10 * 60_000)) return current.tokens;
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
  async function activeRuntime() {
    if (!runtime) {
      const onAuthRejected = async ({ failedGeneration } = {}) => {
        if (durable && Number.isInteger(failedGeneration)) await durable.markIfCurrent('needs_reauth', failedGeneration);
        else if (durable) await durable.mark('needs_reauth');
        else { const current = await bundle(); if (current) { const { tokens: _tokens, ...registration } = current;
          await secretStore.set(secretName, registration); } }
      };
      const onAdditionalPermissionRequired = async ({ failedGeneration, requiredScopes = [] } = {}) => {
        if (durable && Number.isInteger(failedGeneration)) {
          await durable.markIfCurrent('needs_additional_permission', failedGeneration, requiredScopes);
        }
      };
      runtime = runtimeFactory({ serverUrl, credential: () => refresh(false),
        onUnauthorized: ({ failedGeneration } = {}) => refresh(true, failedGeneration),
        onAuthRejected, onAdditionalPermissionRequired, fetchImpl });
    }
    return runtime;
  }
  return { id, label, category, toolName: id,
    async inspect() {
      const current = await bundle(); const protocolState = durable?.state();
      const connected = durable ? protocolState.state === 'ready' && Boolean(current?.verifiedAt && current?.tokens)
        : Boolean(current?.verifiedAt && current?.tokens);
      const connecting = pending != null;
      return { state: connected ? 'connected' : 'needs_connection', stability,
        reason: connected ? 'verified_remote_mcp' : connecting ? 'oauth_in_progress'
          : protocolState?.state === 'needs_reauth' ? 'reauth_required'
            : protocolState?.state === 'needs_additional_permission' ? 'additional_permission_required'
            : protocolState?.state === 'revoked' ? 'credential_revoked' : 'remote_mcp_not_connected',
        userSafeSummary: connected ? `${label}에 연결되어 있어요.${stability === 'developer_preview' ? ' 현재 개발자 미리보기로 제공돼요.' : ''}`
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
      pending = { phase: 'starting' }; let callback = null; let durableAttempt = null;
      try {
        const pkce = createRemoteMcpPkce(); callback = startRemoteMcpCallback({ state: pkce.state, label, port: callbackPort });
        const address = await callback.listening; let current = await bundle();
        let cachedPolicyValid = true;
        try { enforceOAuthPolicy(current?.metadata, oauthPolicy); } catch { cachedPolicyValid = false; }
        if (!current?.metadata || !current?.client || current.redirectUri !== address.redirectUri
          || Boolean(preRegisteredClient) !== (current.clientMode === 'pre_registered') || !cachedPolicyValid) {
          const metadata = await discoverRemoteMcpOAuth({ serverUrl, fetchImpl, label });
          enforceOAuthPolicy(metadata, oauthPolicy);
          const client = preRegisteredClient ?? await registerRemoteMcpClient({
            metadata, redirectUri: address.redirectUri, fetchImpl, label,
          });
          current = { version: 1, redirectUri: address.redirectUri, metadata, client,
            clientMode: preRegisteredClient ? 'pre_registered' : 'dynamic_registration' };
          if (!durable) await secretStore.set(secretName, current);
        }
        current = { version: 1, redirectUri: current.redirectUri, metadata: current.metadata,
          client: current.client, clientMode: current.clientMode };
        const authorizationScopes = [...new Set([...(requestedScopes ?? []),
          ...(durable?.state().pendingScopes ?? [])])];
        let attempt = null;
        if (durable) {
          attempt = await durable.beginAttempt({ state: pkce.state, redirectUri: current.redirectUri,
            requestedScopes: authorizationScopes, payload: { pkce, bundle: current,
              requestedScopes: authorizationScopes } });
          durableAttempt = attempt;
        }
        pending = { pkce, callback, bundle: current, attempt, requestedScopes: authorizationScopes };
        return { authorizeUrl: buildRemoteMcpAuthorizeUrl({ metadata: current.metadata, client: current.client,
          redirectUri: current.redirectUri, challenge: pkce.challenge, state: pkce.state, resource,
          requestedScopes: authorizationScopes, authorizationParameters }), notice: `${label} 연결을 시작했어요.` };
      } catch (error) { callback?.cancel();
        if (durable && durableAttempt) await durable.failAttempt(durableAttempt, error?.reason ?? 'start_failed').catch(() => {});
        pending = null; throw error; }
    },
    async awaitConnection() {
      const current = pending;
      if (!current) throw Object.assign(new Error(`${label} 연결을 먼저 시작해 주세요.`), { status: 409, reason: 'oauth_not_started' });
      let candidateRuntime = null;
      const qualify = async ({ authorization, code, attempt = null, lease = null, signal = undefined }) => {
        const registration = authorization.bundle; const pkce = authorization.pkce;
        const authorizationScopes = authorization.requestedScopes ?? requestedScopes ?? [];
        const tokens = await exchangeRemoteMcpCode({ metadata: registration.metadata, client: registration.client,
          redirectUri: registration.redirectUri, code, verifier: pkce.verifier,
          requestedScopes: authorizationScopes, label }, { fetchImpl, now, signal });
        if (authorizationScopes.some((scope) => !tokens.scopes.includes(scope))) {
          throw new Error(`${label} 연결에 필요한 권한이 허용되지 않았어요.`);
        }
        if (!durable) await secretStore.set(secretName, { ...registration, tokens });
        else candidateRuntime = runtimeFactory({ serverUrl, credential: async () => ({ ...tokens, generation: 0 }), fetchImpl });
        const verifiedRuntime = candidateRuntime ?? await activeRuntime(); const tools = await verifiedRuntime.listTools();
        if (!tools.length) throw new Error(`${label} 연결에서 사용할 도구를 확인하지 못했어요.`);
        const observed = verifyConnection ? await verifyConnection({
          runtime: verifiedRuntime, tools: structuredClone(tools), grantedScopes: [...tokens.scopes],
          credential: { accessToken: tokens.accessToken },
        }) : null;
        const identity = verifiedIdentity(observed, tokens.scopes, requireObservedAccount);
        const capabilities = verifiedCapabilities(observed?.capabilities); const existingIdentity = durable?.state().identity;
        if (existingIdentity?.accountId && identity.accountId
          && String(existingIdentity.accountId) !== String(identity.accountId)) {
          throw Object.assign(new Error(`${label}에서 다른 계정이 확인됐어요. 기존 연결을 해제한 뒤 다시 연결해 주세요.`), {
            reason: 'account_mismatch',
          });
        }
        const verifiedBundle = { ...registration, tokens, tools: tools.map((tool) => tool.name), identity,
          ...(capabilities ? { capabilities } : {}), verifiedAt: now() };
        if (durable) {
          await durable.commitWithLease({ lease, expectedGeneration: attempt.baseGeneration,
            credential: verifiedBundle, issuer: registration.metadata.issuer, identity, scopes: tokens.scopes,
            capabilities: capabilities ?? capabilitiesFromTools(verifiedBundle.tools), attemptId: attempt.attemptId });
          await runtime?.close?.().catch(() => {}); runtime = null;
        } else await secretStore.set(secretName, verifiedBundle);
        return { connected: true, provider: id, userSafeSummary: `${label}을 연결했어요.` };
      };
      try {
        const code = await current.callback.waitForCode;
        if (durable) {
          return await durable.runClaimedAttempt(current.pkce.state, async ({ attempt, payload, lease, signal }) => {
            if (attempt.attemptId !== current.attempt?.attemptId) throw new Error(`${label} 연결 요청이 만료됐어요.`);
            return qualify({ authorization: payload, code, attempt, lease, signal });
          });
        }
        return await qualify({ authorization: current, code });
      } catch (error) { if (durable && current.attempt
          && durable.state().generation === current.attempt.baseGeneration) {
          await durable.failAttempt(current.attempt, error?.reason ?? 'verification_failed').catch(() => {});
        }
        const saved = await bundle(); if (!durable && saved?.tokens && !saved.verifiedAt) {
        const { tokens: _tokens, ...registration } = saved; await secretStore.set(secretName, registration).catch(() => {}); }
        throw error;
      } finally { await candidateRuntime?.close?.().catch(() => {});
        current.callback.cancel(); if (pending === current) pending = null; }
    },
    async makeTool({ authorizeEffect }) { return (await this.inspect()).state === 'connected'
      ? makeRemoteMcpTool({ id, label, runtime: await activeRuntime(), authorizeEffect,
        readOnlyOnly, allowedToolNames }) : null; },
    async cancelPending() { if (!pending) return { cancelled: false, userSafeSummary: `진행 중인 ${label} 연결이 없어요.` };
      const current = pending; pending = null; current.callback.cancel();
      if (durable && current.attempt) await durable.cancelAttempt(current.attempt).catch(() => {});
      return { cancelled: true, userSafeSummary: `${label} 연결을 취소했어요.` }; },
    async disconnect() { await this.cancelPending(); await runtime?.close?.().catch(() => {}); runtime = null;
      if (durable) await durable.clear(); else await secretStore.clear(secretName);
      return { disconnected: true, userSafeSummary: `${label} 연결을 해제했어요.` }; },
    async close() { const current = pending; current?.callback?.cancel(); pending = null;
      if (durable && current?.attempt) await durable.cancelAttempt(current.attempt, 'connection_closed').catch(() => {});
      await runtime?.close?.().catch(() => {}); runtime = null; },
  };
}
