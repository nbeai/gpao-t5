import {
  buildRemoteMcpAuthorizeUrl, createRemoteMcpPkce, exchangeRemoteMcpCode,
  refreshRemoteMcpTokens, startRemoteMcpCallback,
} from './remote-mcp-oauth.js';
import { makeConnectionProtocolStorage } from './connection-protocol-storage.js';
import { makeGoogleDriveApi } from './google-drive-api.js';
import { makeGoogleDriveTool } from './google-drive-tool.js';

const ID = 'google-workspace';
const LABEL = 'Google Workspace';
const DRIVE_API_ROOT = 'https://www.googleapis.com/drive/v3';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const ABOUT_URL = `${DRIVE_API_ROOT}/about?fields=user(permissionId,displayName),storageQuota(usage)`;
const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const SCOPES = Object.freeze(['openid', 'email', 'profile', DRIVE_READ_SCOPE]);
const READ_ACTIONS = Object.freeze(['search', 'metadata', 'download']);
const METADATA = Object.freeze({
  issuer: 'https://accounts.google.com',
  authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_endpoint: 'https://oauth2.googleapis.com/token',
  code_challenge_methods_supported: ['S256'],
});
const CAPABILITIES = Object.freeze({
  search: true, read: true, create: false, update: false, download: true, upload: false,
});

function googleIdentity(userinfo) {
  const accountId = String(userinfo?.sub ?? '').trim().slice(0, 200);
  const accountLabel = String(userinfo?.email ?? '').trim().slice(0, 200);
  if (!accountId || !accountLabel) throw new Error('Google 계정 identity를 확인하지 못했어요.');
  return {
    ownerApplication: 'GPAO-T5', transport: 'google_workspace_api', accountId, accountLabel,
    permissions: [...SCOPES], observed: true,
    resources: [{ id: accountId, label: accountLabel,
      scope: userinfo?.hd ? `workspace:${String(userinfo.hd).slice(0, 120)}` : 'google-account' }],
  };
}

async function jsonRequest(fetchImpl, url, accessToken, message) {
  let response;
  try {
    response = await fetchImpl(url, { headers: {
      accept: 'application/json', authorization: `Bearer ${accessToken}`,
    } });
  } catch {
    throw Object.assign(new Error(message), { reason: 'google_probe_failed' });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object') {
    throw Object.assign(new Error(message), { status: response.status || 502,
      reason: response.status === 401 ? 'credential_rejected' : 'google_probe_failed' });
  }
  return body;
}

export function makeGoogleWorkspaceApiConnection({
  secretStore, stateStore, credentialCoordinator, clientId,
  callbackPort = 0, fetchImpl = globalThis.fetch, now = Date.now,
  callbackFactory = startRemoteMcpCallback, t5UserId = 'local-owner',
  connectionSlotId = ID, makeId = undefined,
} = {}) {
  const oauthClientId = String(clientId ?? '').trim();
  if (!oauthClientId) throw new TypeError('T5 Google OAuth application registration is required');
  if (!Number.isInteger(callbackPort) || callbackPort < 0 || callbackPort > 65_535) {
    throw new TypeError('Google OAuth callback port is invalid');
  }
  const client = { client_id: oauthClientId };
  const durable = makeConnectionProtocolStorage({
    id: ID, serverUrl: DRIVE_API_ROOT, oauthClientId, stateStore, credentialCoordinator,
    secretStore, t5UserId, connectionSlotId, ...(makeId ? { makeId } : {}), now,
  });
  let pending = null;

  async function bundle() {
    await durable.reconcile();
    return durable.read();
  }

  async function credential(force = false, rejectedGeneration = null) {
    const snapshot = await bundle();
    if (!snapshot?.credential?.tokens) throw Object.assign(new Error('Google 계정 연결이 필요해요.'), {
      status: 409, reason: 'not_connected',
    });
    if (!force && (snapshot.credential.tokens.expiresAt == null
      || Number(snapshot.credential.tokens.expiresAt) > now() + 10 * 60_000)) {
      return { ...snapshot.credential.tokens, generation: snapshot.state.generation };
    }
    return durable.withLease(async ({ lease, signal, assertLease }) => {
      const currentState = durable.state();
      const latest = await durable.read();
      const current = latest?.credential;
      if (!current?.tokens) throw Object.assign(new Error('Google 계정 연결이 필요해요.'), {
        status: 409, reason: 'not_connected',
      });
      if (force && Number.isInteger(rejectedGeneration)
        && currentState.generation !== rejectedGeneration) {
        return { ...current.tokens, generation: currentState.generation };
      }
      if (!force && (current.tokens.expiresAt == null
        || Number(current.tokens.expiresAt) > now() + 10 * 60_000)) {
        return { ...current.tokens, generation: currentState.generation };
      }
      if (!current.tokens.refreshToken) {
        durable.markWithLease({ lease, expectedGeneration: currentState.generation, state: 'needs_reauth' });
        throw Object.assign(new Error('Google 연결이 만료됐어요. 다시 연결해 주세요.'), {
          status: 401, reason: 'reauth_required',
        });
      }
      let tokens;
      try {
        tokens = await refreshRemoteMcpTokens({
          metadata: METADATA, client, tokens: current.tokens, label: LABEL,
        }, { fetchImpl, now, signal });
      } catch (error) {
        if (error?.reason === 'reauth_required') {
          durable.markWithLease({ lease, expectedGeneration: currentState.generation, state: 'needs_reauth' });
        }
        throw error;
      }
      assertLease();
      await durable.commitWithLease({ lease, expectedGeneration: currentState.generation,
        credential: { ...current, tokens, verifiedAt: now() }, issuer: METADATA.issuer,
        identity: currentState.identity, scopes: tokens.scopes,
        capabilities: currentState.capabilities });
      const committed = await durable.read();
      return { ...committed.credential.tokens, generation: committed.state.generation };
    });
  }

  return {
    id: ID, label: LABEL, category: 'workspace', toolName: 'google_drive',
    async inspect() {
      const current = await bundle();
      const state = durable.state();
      const connected = state.state === 'ready' && Boolean(current?.credential?.verifiedAt);
      const connecting = pending != null;
      return {
        state: connected ? 'connected' : 'needs_connection',
        reason: connected ? 'verified_google_workspace_api'
          : connecting ? 'oauth_in_progress'
            : state.state === 'needs_reauth' ? 'reauth_required' : 'google_not_connected',
        userSafeSummary: connected
          ? `${state.identity?.accountLabel ?? 'Google 계정'}의 Drive를 읽을 수 있어요.`
          : connecting ? 'Google 로그인과 권한 확인을 기다리고 있어요.'
            : 'Google 계정 연결을 시작할 수 있어요.',
        capabilities: connected ? { ...CAPABILITIES }
          : { search: false, read: false, create: false, update: false, download: false, upload: false },
        ...(connected && state.identity ? { identity: structuredClone(state.identity) } : {}),
        routes: [{ kind: 'official_api', label: 'Google 공식 계정 연결',
          state: connected ? 'connected' : 'needs_connection', canStart: !connected && !connecting }],
        actions: connected
          ? [{ id: 'disconnect', label: '연결 해제', kind: 'disconnect',
            endpoint: `/connections/${ID}/disconnect` }]
          : connecting
            ? [{ id: 'cancel', label: '연결 취소', kind: 'cancel', endpoint: `/connections/${ID}/cancel` }]
            : [{ id: 'connect', label: 'Google 계정 연결', kind: 'oauth',
              startEndpoint: `/connections/${ID}/start`, awaitEndpoint: `/connections/${ID}/await` }],
      };
    },
    async start() {
      if (pending) throw Object.assign(new Error('Google 계정 연결을 이미 진행하고 있어요.'), {
        status: 409, reason: 'oauth_in_progress',
      });
      pending = { phase: 'starting' };
      let callback = null; let attempt = null;
      try {
        const pkce = createRemoteMcpPkce();
        callback = callbackFactory({ state: pkce.state, label: 'Google', port: callbackPort });
        const address = await callback.listening;
        const requestedScopes = [...new Set([...SCOPES, ...(durable.state().pendingScopes ?? [])])];
        attempt = await durable.beginAttempt({ state: pkce.state, redirectUri: address.redirectUri,
          requestedScopes, payload: { pkce, redirectUri: address.redirectUri, requestedScopes } });
        pending = { callback, pkce, attempt };
        return { authorizeUrl: buildRemoteMcpAuthorizeUrl({ metadata: METADATA, client,
          redirectUri: address.redirectUri, challenge: pkce.challenge, state: pkce.state,
          requestedScopes, authorizationParameters: {
            access_type: 'offline', include_granted_scopes: 'true',
          } }), notice: 'Google 계정 연결을 시작했어요.' };
      } catch (error) {
        callback?.cancel();
        if (attempt) await durable.failAttempt(attempt, error?.reason ?? 'start_failed').catch(() => {});
        pending = null; throw error;
      }
    },
    async awaitConnection() {
      const current = pending;
      if (!current) throw Object.assign(new Error('Google 계정 연결을 먼저 시작해 주세요.'), {
        status: 409, reason: 'oauth_not_started',
      });
      try {
        const code = await current.callback.waitForCode;
        return await durable.runClaimedAttempt(current.pkce.state,
          async ({ attempt, payload, lease, signal }) => {
            if (attempt.attemptId !== current.attempt.attemptId) throw new Error('Google 연결 요청이 만료됐어요.');
            const tokens = await exchangeRemoteMcpCode({ metadata: METADATA, client,
              redirectUri: payload.redirectUri, code, verifier: payload.pkce.verifier,
              requestedScopes: payload.requestedScopes, label: LABEL }, { fetchImpl, now, signal });
            if (payload.requestedScopes.some((scope) => !tokens.scopes.includes(scope))) {
              throw new Error('Google Drive 연결에 필요한 읽기 권한이 허용되지 않았어요.');
            }
            const userinfo = await jsonRequest(fetchImpl, USERINFO_URL, tokens.accessToken,
              'Google 계정 identity를 확인하지 못했어요.');
            await jsonRequest(fetchImpl, ABOUT_URL, tokens.accessToken,
              'Google Drive 읽기 권한을 확인하지 못했어요.');
            const identity = googleIdentity(userinfo);
            const previous = durable.state().identity;
            if (previous?.accountId && previous.accountId !== identity.accountId) {
              throw Object.assign(new Error('다른 Google 계정이 확인됐어요. 기존 연결을 해제한 뒤 다시 연결해 주세요.'), {
                reason: 'account_mismatch',
              });
            }
            await durable.commitWithLease({ lease, expectedGeneration: attempt.baseGeneration,
              credential: { tokens, identity, verifiedAt: now() }, issuer: METADATA.issuer,
              identity, scopes: tokens.scopes, capabilities: CAPABILITIES,
              attemptId: attempt.attemptId });
            return { connected: true, provider: ID, userSafeSummary: 'Google Drive를 연결했어요.' };
          });
      } catch (error) {
        if (durable.state().generation === current.attempt.baseGeneration) {
          await durable.failAttempt(current.attempt, error?.reason ?? 'verification_failed').catch(() => {});
        }
        throw error;
      } finally {
        current.callback.cancel();
        if (pending === current) pending = null;
      }
    },
    credential,
    async makeTool({ attachments, sessionId, authorizeEffect, authorizeUploadPath }) {
      if ((await this.inspect()).state !== 'connected') return null;
      return makeGoogleDriveTool({
        api: makeGoogleDriveApi({ credential, fetchImpl,
          onUnauthorized: ({ failedGeneration }) => credential(true, failedGeneration),
          onAuthRejected: ({ failedGeneration }) => durable.markIfCurrent('needs_reauth', failedGeneration),
        }), attachments, sessionId,
        authorizeEffect, authorizeUploadPath, allowedActions: READ_ACTIONS,
      });
    },
    async cancelPending() {
      if (!pending) return { cancelled: false, userSafeSummary: '진행 중인 Google 연결이 없어요.' };
      const current = pending; pending = null; current.callback.cancel();
      await durable.cancelAttempt(current.attempt).catch(() => {});
      return { cancelled: true, userSafeSummary: 'Google 계정 연결을 취소했어요.' };
    },
    async disconnect() {
      await this.cancelPending(); await durable.clear();
      return { disconnected: true, provider: ID, userSafeSummary: 'Google Drive 연결을 해제했어요.' };
    },
    async close() {
      const current = pending; pending = null; current?.callback?.cancel();
      if (current?.attempt) await durable.cancelAttempt(current.attempt, 'connection_closed').catch(() => {});
    },
  };
}
