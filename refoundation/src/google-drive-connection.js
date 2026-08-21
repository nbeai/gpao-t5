import {
  buildGoogleDriveAuthorizeUrl, createGoogleDrivePkce, exchangeGoogleDriveCode,
  GOOGLE_DRIVE_SCOPE, refreshGoogleDriveCredential, startGoogleDriveCallback,
} from './google-drive-oauth.js';

const PROVIDER = 'google-workspace';
const ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user(permissionId),storageQuota(limit,usage)';

async function verifyAccess(credential, fetchImpl) {
  const response = await fetchImpl(ABOUT_URL, {
    headers: { authorization: `Bearer ${credential.accessToken}` },
  });
  if (!response.ok) {
    throw Object.assign(new Error('Google Drive 연결 상태를 확인하지 못했어요.'), {
      status: response.status, reason: response.status === 401 ? 'credential_rejected' : 'drive_probe_failed',
    });
  }
  const json = await response.json().catch(() => null);
  if (!json || typeof json !== 'object') {
    throw Object.assign(new Error('Google Drive 연결 응답을 확인하지 못했어요.'), {
      status: 502, reason: 'drive_probe_invalid',
    });
  }
  return true;
}

export function makeGoogleDriveConnection({
  store, clientId = null, fetchImpl = globalThis.fetch, now = Date.now,
  browserAvailable = true, localSyncAvailable = async () => false, desktopRoute = null,
} = {}) {
  if (!store || typeof store.get !== 'function' || typeof store.setVerified !== 'function') {
    throw new TypeError('Google Drive workspace credential store is required');
  }
  let pending = null;

  async function credential() {
    const record = await store.get(PROVIDER);
    if (!record?.credential) throw Object.assign(new Error('Google Drive 연결이 필요해요.'), {
      status: 409, reason: 'not_connected',
    });
    let current = record.credential;
    if (Number(current.expiresAt ?? 0) <= now() + 60_000) {
      if (!clientId) throw Object.assign(new Error('Google Drive 연결을 갱신할 준비가 필요해요.'), {
        status: 503, reason: 'oauth_client_missing',
      });
      current = await refreshGoogleDriveCredential({ clientId, credential: current }, { fetchImpl, now });
      await store.setVerified(PROVIDER, {
        credential: current, scopes: current.scopes ?? record.scopes, verifiedAt: now(),
      });
    }
    return current;
  }

  return {
    id: PROVIDER,
    label: 'Google Workspace',
    category: 'workspace',
    provider: PROVIDER,
    async inspect(options = {}) {
      const availableBrowser = options.browserAvailable ?? browserAvailable;
      const publicState = (await store.describe())[PROVIDER] ?? null;
      const connected = publicState?.connected === true;
      const connecting = pending != null;
      const desktop = desktopRoute ? await desktopRoute.inspect() : null;
      const localSync = desktop?.state === 'ready'
        || await Promise.resolve().then(() => localSyncAvailable()).catch(() => false);
      const state = connected ? 'connected'
        : localSync ? 'ready'
          : desktop?.state ?? (clientId ? 'needs_connection'
            : availableBrowser ? 'needs_connection' : 'unavailable');
      const reason = connected ? 'verified_drive_connection'
        : connecting ? 'oauth_in_progress'
          : desktop?.reason ?? (localSync ? 'local_sync_available'
            : clientId ? 'oauth_not_connected'
              : availableBrowser ? 'oauth_client_missing' : 'no_available_route');
      const userSafeSummary = connected
        ? 'Google Drive 전용 연결을 사용할 수 있어요.'
        : connecting
          ? 'Google 계정 연결 화면에서 사용자 확인을 기다리고 있어요.'
          : desktop?.userSafeSummary ?? (localSync
            ? 'Finder에 연결된 Google Drive의 일반 파일을 찾고 읽고 저장할 수 있어요.'
            : clientId
              ? 'Google 계정 연결을 시작할 수 있어요.'
              : availableBrowser
                ? '전용 연결 준비가 필요하고, 지금은 연결한 내 브라우저에서 로그인할 수 있어요.'
                : 'Google Drive 전용 연결 준비가 필요해요.');
      return {
        state, reason, userSafeSummary,
        capabilities: {
          search: connected || localSync, read: connected || localSync,
          create: connected || localSync, update: connected || localSync,
          download: connected || localSync, upload: connected || localSync,
        },
        routes: [
          {
            kind: 'official', label: 'Google Drive 전용 연결',
            state: connected ? 'connected' : clientId ? 'needs_connection' : 'unavailable',
            canStart: Boolean(clientId && !connected && !connecting),
          },
          ...(availableBrowser ? [{
            kind: 'browser', label: '내 브라우저', state: 'ready', canStart: true,
            startUrl: 'https://drive.google.com/',
          }] : []),
          ...(desktop?.routes ?? (localSync ? [{
            kind: 'local_sync', label: 'Finder의 Google Drive', state: 'ready', canStart: false,
          }] : [])),
        ],
        actions: connected ? [{
          id: 'disconnect', label: '연결 해제', kind: 'disconnect',
          endpoint: '/connections/google-workspace/disconnect',
        }] : connecting ? [{
          id: 'cancel', label: '연결 취소', kind: 'cancel',
          endpoint: '/connections/google-workspace/cancel',
        }] : desktop?.actions?.length ? desktop.actions : clientId ? [{
          id: 'connect', label: 'Google 계정 연결', kind: 'oauth',
          startEndpoint: '/connections/google-workspace/start',
          awaitEndpoint: '/connections/google-workspace/await',
        }] : [],
      };
    },
    async start() {
      if (!clientId) throw Object.assign(new Error('Google Drive 전용 연결 준비가 필요해요.'), {
        status: 503, reason: 'oauth_client_missing',
      });
      if (pending) throw Object.assign(new Error('Google 계정 연결을 이미 진행하고 있어요.'), {
        status: 409, reason: 'oauth_in_progress',
      });
      pending = { phase: 'starting' };
      let callback = null;
      try {
        const pkce = createGoogleDrivePkce();
        callback = startGoogleDriveCallback({ state: pkce.state });
        let callbackAddress;
        try { callbackAddress = await callback.listening; }
        catch (error) { callback.cancel(); throw error; }
        pending = { pkce, callback, redirectUri: callbackAddress.redirectUri };
        return {
          authorizeUrl: buildGoogleDriveAuthorizeUrl({
            clientId, redirectUri: pending.redirectUri,
            challenge: pkce.challenge, state: pkce.state,
          }),
          notice: 'Google 계정 연결을 시작했어요.',
        };
      } catch (error) {
        callback?.cancel();
        pending = null;
        throw error;
      }
    },
    async awaitConnection() {
      const current = pending;
      if (!current) throw Object.assign(new Error('Google 계정 연결을 먼저 시작해 주세요.'), {
        status: 409, reason: 'oauth_not_started',
      });
      try {
        const code = await current.callback.waitForCode;
        const connectedCredential = await exchangeGoogleDriveCode({
          clientId, code, verifier: current.pkce.verifier, redirectUri: current.redirectUri,
        }, { fetchImpl, now });
        await verifyAccess(connectedCredential, fetchImpl);
        await store.setVerified(PROVIDER, {
          credential: connectedCredential,
          scopes: connectedCredential.scopes ?? [GOOGLE_DRIVE_SCOPE],
          verifiedAt: now(),
        });
        return {
          connected: true, provider: PROVIDER,
          userSafeSummary: 'Google Drive를 연결했어요.',
        };
      } finally {
        current.callback.cancel();
        if (pending === current) pending = null;
      }
    },
    async verify() {
      const current = await credential();
      await verifyAccess(current, fetchImpl);
      return { connected: true, provider: PROVIDER };
    },
    credential,
    async performAction(actionId) {
      if (!desktopRoute || typeof desktopRoute.perform !== 'function') {
        throw Object.assign(new Error('Google Drive 사용자 행동을 시작할 수 없어요.'), { status: 409 });
      }
      return desktopRoute.perform(actionId);
    },
    async cancelPending() {
      if (!pending) return {
        cancelled: false, provider: PROVIDER, userSafeSummary: '진행 중인 Google 연결이 없어요.',
      };
      const current = pending;
      pending = null;
      current.callback?.cancel();
      return { cancelled: true, provider: PROVIDER, userSafeSummary: 'Google 계정 연결을 취소했어요.' };
    },
    async disconnect() {
      await this.cancelPending();
      await store.clear(PROVIDER);
      return { disconnected: true, provider: PROVIDER, userSafeSummary: 'Google Drive 연결을 해제했어요.' };
    },
    close() {
      pending?.callback?.cancel(); pending = null;
    },
  };
}
