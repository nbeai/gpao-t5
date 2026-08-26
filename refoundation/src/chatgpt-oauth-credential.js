import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { modelCapabilityManifest } from './model-capabilities.js';

export const CHATGPT_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const CHATGPT_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CHATGPT_OAUTH_SCOPE = 'openid profile email offline_access';

const API_PROVIDERS = Object.freeze({
  openai: Object.freeze({ modelId: 'gpt-5.6-terra', baseUrl: 'https://api.openai.com/v1' }),
  anthropic: Object.freeze({ modelId: 'claude-sonnet-5', baseUrl: 'https://api.anthropic.com' }),
  gemini: Object.freeze({
    modelId: 'gemini-3.6-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  }),
  upstage: Object.freeze({ modelId: 'solar-pro4', baseUrl: 'https://api.upstage.ai/v1' }),
});

export class ModelConnectionError extends Error {
  constructor(message, { provider = null, status = null, reason = null } = {}) {
    super(message);
    this.name = 'ModelConnectionError';
    this.provider = provider;
    this.status = status;
    this.reason = reason;
  }
}

function apiProvider(value) {
  const provider = String(value ?? '').trim().toLowerCase();
  if (!API_PROVIDERS[provider]) throw new TypeError('unsupported API provider');
  return provider;
}

function apiModel(provider, value) {
  const raw = String(value ?? API_PROVIDERS[provider].modelId).trim();
  const modelId = provider === 'gemini' ? raw.replace(/^models\//, '') : raw;
  if (!modelId || modelId.length > 200 || /[\u0000-\u001f\u007f/?#]/u.test(modelId)) {
    throw new TypeError('invalid model id');
  }
  return modelId;
}

function apiSecret(value) {
  const key = String(value ?? '').trim();
  if (!key || key.length > 8_192 || /[\r\n\u0000]/u.test(key)) throw new TypeError('invalid API key');
  return key;
}

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
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await chmod(dirname(file), 0o700);
  const temporary = `${file}.refoundation-${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export function modelCredentialSecretName(id) {
  const digest = createHash('sha256').update(String(id ?? '')).digest('hex').slice(0, 32);
  return `model-credential-${digest}`;
}

function inlineSecret(connection) {
  if (connection?.kind === 'api_key' && connection.key) return { key: connection.key };
  if (connection?.kind === 'chatgpt_oauth' && connection.credential) {
    return { credential: connection.credential };
  }
  return null;
}

async function connectionSecret(connection, secretStore) {
  const inline = inlineSecret(connection);
  if (!secretStore) return inline;
  const ref = connection?.secretRef ?? modelCredentialSecretName(connection?.id);
  return secretStore.get(ref);
}

export async function migrateStoredModelCredentials({ file, secretStore } = {}) {
  if (!file || !secretStore?.get || !secretStore?.set || !secretStore?.clear) {
    throw new TypeError('model connection file and secure store are required');
  }
  const state = await readState(file);
  if (!state) return { migrated: 0 };
  let migrated = 0;
  const next = structuredClone(state);
  for (const connection of next.connections ?? []) {
    const secret = inlineSecret(connection);
    if (!secret) continue;
    const secretRef = modelCredentialSecretName(connection.id);
    await secretStore.set(secretRef, secret);
    const verified = await secretStore.get(secretRef);
    if (JSON.stringify(verified) !== JSON.stringify(secret)) {
      throw new Error('Secure model credential verification failed');
    }
    delete connection.key;
    delete connection.credential;
    connection.secretRef = secretRef;
    migrated += 1;
  }
  if (migrated) await atomicSave(file, next);
  return { migrated };
}

function validationRequest(provider, modelId, key) {
  const baseUrl = API_PROVIDERS[provider].baseUrl;
  if (provider === 'openai') return {
    url: `${baseUrl}/models/${encodeURIComponent(modelId)}`,
    headers: { authorization: `Bearer ${key}` },
  };
  if (provider === 'anthropic') return {
    url: `${baseUrl}/v1/models/${encodeURIComponent(modelId)}`,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  };
  if (provider === 'upstage') return {
    url: `${baseUrl}/chat/completions`, method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelId, messages: [{ role: 'user', content: 'Reply with OK only.' }],
      reasoning_effort: 'low', stream: false,
    }),
  };
  const resource = modelId.replace(/^models\//, '');
  return {
    url: `${baseUrl}/models/${encodeURIComponent(resource)}`,
    headers: { 'x-goog-api-key': key },
  };
}

function validationFailure(provider, modelId, status) {
  const reason = status === 401 || status === 403 ? 'authentication_failed'
    : status === 404 ? 'model_unavailable' : 'provider_unavailable';
  return { valid: false, provider, modelId, reason, status };
}

export async function validateApiKeyConnection({
  provider: providerValue, apiKey, modelId: modelValue, fetchImpl = globalThis.fetch,
} = {}) {
  const provider = apiProvider(providerValue);
  const modelId = apiModel(provider, modelValue);
  const key = apiSecret(apiKey);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const request = validationRequest(provider, modelId, key);
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method ?? 'GET', headers: request.headers,
      ...(request.body ? { body: request.body } : {}),
    });
  }
  catch { return validationFailure(provider, modelId, null); }
  if (!response.ok) return validationFailure(provider, modelId, response.status);
  let json;
  try { json = await response.json(); }
  catch { return validationFailure(provider, modelId, response.status); }
  if (provider === 'gemini') {
    const methods = json?.supportedGenerationMethods ?? json?.supportedActions;
    if (Array.isArray(methods) && !methods.includes('generateContent')) {
      return { valid: false, provider, modelId, reason: 'model_lacks_generation', status: response.status };
    }
  }
  if (provider === 'upstage' && !json?.choices?.[0]?.message) {
    return validationFailure(provider, modelId, response.status);
  }
  const observedModelId = provider === 'gemini'
    ? String(json?.name ?? '').replace(/^models\//, '')
    : provider === 'upstage' ? String(json?.model ?? '') : String(json?.id ?? '');
  if (!observedModelId) return validationFailure(provider, modelId, response.status);
  return {
    valid: true, provider, modelId,
    ...(observedModelId ? { observedModelId } : {}), status: response.status,
  };
}

export async function saveApiKeyConnection({
  file, provider: providerValue, apiKey, modelId: modelValue, fetchImpl = globalThis.fetch,
  secretStore = null,
} = {}) {
  if (!file) throw new TypeError('model connection file is required');
  const provider = apiProvider(providerValue);
  const modelId = apiModel(provider, modelValue);
  const key = apiSecret(apiKey);
  const validation = await validateApiKeyConnection({ provider, apiKey: key, modelId, fetchImpl });
  if (!validation.valid) throw new ModelConnectionError('Model connection validation failed', {
    provider, status: validation.status, reason: validation.reason,
  });
  const state = await readState(file)
    ?? { version: 2, connections: [], activeId: null, roleBindings: {} };
  if (state.version !== 2 || !Array.isArray(state.connections)) {
    throw new ModelConnectionError('Stored model connection format is unsupported');
  }
  const id = `api_key:${provider}:${modelId}`;
  const secretRef = secretStore ? modelCredentialSecretName(id) : null;
  if (secretStore) await secretStore.set(secretRef, { key });
  const record = {
    id, kind: 'api_key', provider, modelId, ...(secretStore ? { secretRef } : { key }),
    baseUrl: API_PROVIDERS[provider].baseUrl,
    validation: {
      verifiedAt: new Date().toISOString(), observedModelId: validation.observedModelId ?? null,
    },
  };
  const index = state.connections.findIndex((connection) => connection.id === id);
  if (index >= 0) state.connections[index] = record;
  else state.connections.push(record);
  state.activeId = id;
  await atomicSave(file, state);
  return { connected: true, id, provider, modelId, activeId: id };
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
  secretStore = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) {
  if (!file) throw new TypeError('model connection file is required');
  let refreshing = null;

  async function loadConnection() {
    const state = await readState(file);
    const connection = activeConnection(state, 'chatgpt_oauth');
    const secret = connection ? await connectionSecret(connection, secretStore) : null;
    return { state, connection, credential: secret?.credential ?? null };
  }

  return {
    async inspect() {
      const { connection, credential } = await loadConnection();
      if (!connection || !credential?.access) {
        return { available: false, provider: 'chatgpt_oauth', modelId: connection?.modelId ?? null,
          accountIdPresent: false };
      }
      return {
        available: true,
        provider: 'chatgpt_oauth',
        modelId: connection.modelId ?? null,
        accountIdPresent: Boolean(credential?.accountId),
      };
    },
    async get() {
      const { state, connection, credential } = await loadConnection();
      if (!credential?.access) throw new Error('No stored ChatGPT OAuth connection is available');
      if (!credential.expiresAt || credential.expiresAt <= now()) {
        refreshing ??= (async () => {
          connection.credential = credential;
          await refreshOAuth(connection, { fetchImpl, now });
          if (secretStore) await secretStore.set(
            connection.secretRef ?? modelCredentialSecretName(connection.id),
            { credential: connection.credential },
          );
          else await atomicSave(file, state);
        })().finally(() => { refreshing = null; });
        await refreshing;
      }
      const current = secretStore
        ? (await connectionSecret(connection, secretStore))?.credential : connection.credential;
      return {
        access: current.access,
        refresh: current.refresh,
        expiresAt: current.expiresAt,
        accountId: current.accountId,
        modelId: connection.modelId ?? null,
      };
    },
  };
}

/** Public metadata for both connection kinds. Secret values never leave `select`. */
export function makeStoredModelCredentialCatalog({ file, secretStore = null } = {}) {
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
        capabilityManifest: modelCapabilityManifest(connection),
        ...(connection.validation?.verifiedAt
          ? { verifiedAt: connection.validation.verifiedAt } : {}),
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
        const official = API_PROVIDERS[connection.provider];
        if (!official) throw new Error(`Unsupported API provider: ${connection.provider}`);
        const secret = await connectionSecret(connection, secretStore);
        if (!secret?.key) throw new Error('Stored model credential is unavailable');
        return {
          kind: 'api_key', provider: connection.provider, apiKey: secret.key,
          modelId: connection.modelId, baseUrl: official.baseUrl,
          capabilityManifest: modelCapabilityManifest(connection),
        };
      }
      if (connection.kind === 'chatgpt_oauth') {
        return {
          kind: 'chatgpt_oauth', id: connection.id, modelId: connection.modelId,
          capabilityManifest: modelCapabilityManifest(connection),
        };
      }
      throw new Error(`Unsupported stored connection kind: ${connection.kind}`);
    },
    async activate(id) {
      const state = await readState(file);
      if (!state?.connections?.some((connection) => connection.id === id)) {
        throw new ModelConnectionError('Model connection not found');
      }
      state.activeId = id;
      await atomicSave(file, state);
      return { activeId: id };
    },
    async remove(id) {
      const state = await readState(file);
      if (!state?.connections) throw new ModelConnectionError('Model connection not found');
      const next = state.connections.filter((connection) => connection.id !== id);
      if (next.length === state.connections.length) throw new ModelConnectionError('Model connection not found');
      const removed = state.connections.find((connection) => connection.id === id);
      if (secretStore && removed) {
        await secretStore.clear(removed.secretRef ?? modelCredentialSecretName(removed.id));
      }
      state.connections = next;
      if (state.activeId === id) state.activeId = next[0]?.id ?? null;
      await atomicSave(file, state);
      return { removed: true, activeId: state.activeId };
    },
  };
}
