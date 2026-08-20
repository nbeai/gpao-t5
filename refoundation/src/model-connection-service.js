import {
  makeStoredModelCredentialCatalog, saveApiKeyConnection,
} from './chatgpt-oauth-credential.js';
import {
  buildChatGptAuthorizeUrl, createPkce, exchangeChatGptCode,
  saveChatGptOAuthConnection, startChatGptCallback,
} from './chatgpt-oauth-login.js';

const API_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'openai', label: 'OpenAI', kind: 'api_key', defaultModel: 'gpt-5.6-terra' }),
  Object.freeze({ id: 'anthropic', label: 'Claude', kind: 'api_key', defaultModel: 'claude-sonnet-5' }),
  Object.freeze({ id: 'gemini', label: 'Gemini', kind: 'api_key', defaultModel: 'gemini-3.6-flash' }),
  Object.freeze({ id: 'upstage', label: 'Upstage', kind: 'api_key', defaultModel: 'solar-pro4' }),
]);

export function modelConnectionProviders() {
  return {
    providers: API_PROVIDERS.map((provider) => structuredClone(provider)),
    oauth: [{ id: 'chatgpt_oauth', label: 'ChatGPT 계정', kind: 'oauth' }],
    chatgptOAuth: true,
  };
}

export function makeModelConnectionService({
  file, fetchImpl = globalThis.fetch, oauthPort = 1455, oauthModel = 'gpt-5.5',
} = {}) {
  if (!file) throw new TypeError('model connection file is required');
  const catalog = makeStoredModelCredentialCatalog({ file });
  let pendingOAuth = null;

  return {
    providers: modelConnectionProviders,
    list: () => catalog.list(),
    activate: (id) => catalog.activate(id),
    remove: (id) => catalog.remove(id),
    async disconnect(id) {
      const list = await catalog.list();
      const target = id ?? list.find((connection) => connection.active)?.id;
      if (!target) return { removed: false, activeId: null };
      return catalog.remove(target);
    },
    async connect({ provider, key, modelId } = {}) {
      return saveApiKeyConnection({
        file, provider, apiKey: key, modelId, fetchImpl,
      });
    },
    async startChatGpt() {
      if (pendingOAuth) throw Object.assign(new Error('ChatGPT connection is already in progress'), { status: 409 });
      const pkce = createPkce();
      const callback = startChatGptCallback({ state: pkce.state, port: oauthPort });
      try { await callback.listening; }
      catch (error) { callback.cancel(); throw error; }
      pendingOAuth = { pkce, callback };
      return {
        authorizeUrl: buildChatGptAuthorizeUrl({ ...pkce, port: oauthPort }),
        notice: 'ChatGPT 계정 연결을 시작했어요.',
      };
    },
    async awaitChatGpt() {
      const pending = pendingOAuth;
      if (!pending) throw Object.assign(new Error('ChatGPT connection was not started'), { status: 409 });
      try {
        const code = await pending.callback.waitForCode;
        const credential = await exchangeChatGptCode({
          code, verifier: pending.pkce.verifier, port: oauthPort,
        }, { fetchImpl });
        const saved = await saveChatGptOAuthConnection({ file, credential, modelId: oauthModel });
        return { ...saved, userSafeSummary: 'ChatGPT 계정을 연결했어요.' };
      } finally {
        pending.callback.cancel();
        pendingOAuth = null;
      }
    },
    close() {
      pendingOAuth?.callback.cancel();
      pendingOAuth = null;
    },
  };
}
