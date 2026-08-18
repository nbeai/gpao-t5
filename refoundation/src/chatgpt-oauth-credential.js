import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const CHATGPT_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CHATGPT_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CHATGPT_OAUTH_SCOPE = 'openid profile email offline_access';

function activeConnection(state, kind) {
  const connections = Array.isArray(state?.connections) ? state.connections : [];
  const active = connections.find((connection) => connection.id === state.activeId);
  if (active?.kind === kind) return active;
  return connections.find((connection) => connection.kind === kind) ?? null;
}

async function readState(file) {
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try { return JSON.parse(raw); }
  catch { throw new Error('Stored model connection file is invalid JSON'); }
}

async function atomicSave(file, state) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.refoundation-${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

async function refreshOAuth(connection, { fetchImpl, now }) {
  const credential = connection.credential;
  if (!credential?.refresh) throw new Error('Stored ChatGPT OAuth connection has no refresh token');
  const response = await fetchImpl(CHATGPT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh,
      client_id: CHATGPT_OAUTH_CLIENT_ID,
      scope: CHATGPT_OAUTH_SCOPE,
    }).toString(),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.access_token) {
    throw Object.assign(new Error('ChatGPT OAuth refresh failed'), { status: response.status });
  }
  connection.credential = {
    ...credential,
    access: json.access_token,
    refresh: json.refresh_token ?? credential.refresh,
    expiresAt: now() + (Number(json.expires_in ?? 3600) - 60) * 1000,
  };
  return connection.credential;
}

/** Read and refresh the existing console's OAuth credential without importing the legacy runtime. */
export function makeStoredChatGptCredentialSource({
  file,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  if (!file) throw new TypeError('model connection file is required');
  let refreshing = null;

  async function loadConnection() {
    const state = await readState(file);
    const connection = activeConnection(state, 'chatgpt_oauth');
    return { state, connection };
  }

  return {
    async inspect() {
      const { connection } = await loadConnection();
      if (!connection) return { available: false, provider: 'chatgpt_oauth', modelId: null, accountIdPresent: false };
      return {
        available: true,
        provider: 'chatgpt_oauth',
        modelId: connection.modelId ?? null,
        accountIdPresent: Boolean(connection.credential?.accountId),
      };
    },
    async get() {
      const { state, connection } = await loadConnection();
      if (!connection?.credential?.access) throw new Error('No stored ChatGPT OAuth connection is available');
      if (!connection.credential.expiresAt || connection.credential.expiresAt <= now()) {
        refreshing ??= (async () => {
          await refreshOAuth(connection, { fetchImpl, now });
          await atomicSave(file, state);
        })().finally(() => { refreshing = null; });
        await refreshing;
      }
      return {
        access: connection.credential.access,
        refresh: connection.credential.refresh,
        expiresAt: connection.credential.expiresAt,
        accountId: connection.credential.accountId,
        modelId: connection.modelId ?? null,
      };
    },
  };
}

/** Public metadata for both connection kinds. Secret values never leave `select`. */
export function makeStoredModelCredentialCatalog({ file } = {}) {
  if (!file) throw new TypeError('model connection file is required');
  return {
    async list() {
      const state = await readState(file);
      return (state?.connections ?? []).map((connection) => ({
        id: connection.id,
        kind: connection.kind,
        provider: connection.provider,
        modelId: connection.modelId ?? null,
        active: connection.id === state.activeId,
      }));
    },
    async select(id) {
      const state = await readState(file);
      const connections = state?.connections ?? [];
      const connection = id
        ? connections.find((candidate) => candidate.id === id)
        : (connections.find((candidate) => candidate.id === state.activeId) ?? connections[0]);
      if (!connection) throw new Error('No stored model connection is available');
      if (connection.kind === 'api_key') {
        return {
          kind: 'api_key', provider: connection.provider, apiKey: connection.key,
          modelId: connection.modelId, baseUrl: connection.baseUrl,
        };
      }
      if (connection.kind === 'chatgpt_oauth') {
        return { kind: 'chatgpt_oauth', id: connection.id, modelId: connection.modelId };
      }
      throw new Error(`Unsupported stored connection kind: ${connection.kind}`);
    },
  };
}
