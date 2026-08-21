import {
  buildNotionAuthorizeUrl, createNotionPkce, discoverNotionOAuth, exchangeNotionCode,
  NOTION_MCP_URL, refreshNotionTokens, registerNotionClient, startNotionCallback,
} from './notion-mcp-oauth.js';
import { makeNotionMcpRuntime } from './notion-mcp-runtime.js';
import { makeNotionTool } from './notion-tool.js';

const SECRET_NAME = 'notion';

function capabilitiesFromTools(tools) {
  const names = new Set(tools.map((tool) => tool.name));
  const some = (pattern) => [...names].some((name) => pattern.test(name));
  return {
    search: some(/(?:^|-)search$/u),
    read: some(/(?:^|-)fetch$/u),
    create: some(/(?:^|-)create-/u),
    update: some(/(?:^|-)(?:update|move|duplicate)-/u),
    download: false,
    upload: false,
  };
}

function workspaceFromSelf(result) {
  const text = result?.content?.find((block) => block?.type === 'text')?.text;
  let parsed;
  try { parsed = JSON.parse(String(text ?? '')); }
  catch { throw new Error('Notion MCP workspace identity response was invalid'); }
  const workspace = parsed?.self?.workspace;
  if (!workspace?.id || !workspace?.name) throw new Error('Notion MCP workspace identity was missing');
  return {
    id: String(workspace.id), name: String(workspace.name).slice(0, 200),
    toolAccess: parsed.self.current_tool_access && typeof parsed.self.current_tool_access === 'object'
      ? structuredClone(parsed.self.current_tool_access) : {},
  };
}

export function makeNotionMcpConnection({
  secretStore, fetchImpl = globalThis.fetch, now = Date.now, callbackPort = 1456,
  runtimeFactory = makeNotionMcpRuntime, browserAvailable = true,
  cliInspect = async () => ({
    installed: false, authenticated: false, state: 'unavailable', reason: 'notion_cli_not_inspected',
  }),
} = {}) {
  if (!secretStore || typeof secretStore.get !== 'function' || typeof secretStore.set !== 'function') {
    throw new TypeError('Notion secure credential store is required');
  }
  let pending = null;
  let runtime = null;
  let refreshQueue = Promise.resolve();

  async function bundle() { return secretStore.get(SECRET_NAME); }

  async function refreshIfNeeded(force = false) {
    const work = refreshQueue.then(async () => {
      const current = await bundle();
      if (!current?.tokens) throw Object.assign(new Error('Notion 연결이 필요해요.'), {
        status: 409, reason: 'not_connected',
      });
      if (!force && Number(current.tokens.expiresAt ?? 0) > now() + 10 * 60_000) return current.tokens;
      let tokens;
      try {
        tokens = await refreshNotionTokens({
          metadata: current.metadata, client: current.client, tokens: current.tokens,
        }, { fetchImpl, now });
      } catch (error) {
        if (error?.reason === 'reauth_required') {
          const { tokens: _discarded, ...registration } = current;
          await secretStore.set(SECRET_NAME, registration);
          await runtime?.close?.().catch(() => {}); runtime = null;
        }
        throw error;
      }
      await secretStore.set(SECRET_NAME, { ...current, tokens, verifiedAt: now() });
      runtime?.invalidate?.();
      return tokens;
    });
    refreshQueue = work.catch(() => {});
    return work;
  }

  async function credential() { return refreshIfNeeded(false); }

  async function activeRuntime() {
    if (!runtime) runtime = runtimeFactory({
      credential,
      onUnauthorized: async () => { await refreshIfNeeded(true); },
    });
    return runtime;
  }

  return {
    id: 'notion', label: 'Notion', category: 'workspace', toolName: 'notion',
    async inspect(options = {}) {
      const availableBrowser = options.browserAvailable ?? browserAvailable;
      const current = await bundle();
      const connected = Boolean(current?.tokens?.accessToken || current?.tokens?.refreshToken);
      const cli = await Promise.resolve().then(() => cliInspect()).catch(() => ({
        installed: false, authenticated: false, state: 'needs_attention', reason: 'notion_cli_check_failed',
      }));
      const cliReady = cli.authenticated === true;
      const connecting = pending != null;
      const capabilities = connected
        ? capabilitiesFromTools((current.tools ?? []).map((name) => ({ name })))
        : { search: false, read: false, create: false, update: false, download: false, upload: false };
      if (cliReady) Object.assign(capabilities, {
        search: true, read: true, create: true, update: true, download: true, upload: true,
      });
      return {
        state: connected ? 'connected' : cliReady ? 'ready' : 'needs_connection',
        reason: connected ? 'verified_notion_mcp' : connecting ? 'oauth_in_progress'
          : cliReady ? 'notion_cli_authenticated' : 'remote_mcp_not_connected',
        userSafeSummary: connected
          ? `${current.workspace?.name ?? 'Notion 업무공간'}에 연결되어 있어요.`
          : connecting
            ? 'Notion 계정 연결 화면에서 사용자 확인을 기다리고 있어요.'
          : cliReady
            ? '컴퓨터에 연결된 Notion 계정으로 페이지와 파일 작업을 할 수 있어요.'
            : 'Notion 원격 연결을 시작할 수 있어요.',
        capabilities,
        routes: [
          {
            kind: 'remote_mcp', label: 'Notion 원격 연결',
            state: connected ? 'connected' : 'needs_connection', canStart: !connected && !connecting,
          },
          {
            kind: 'authenticated_cli', label: '컴퓨터의 Notion 연결',
            state: cli.state, canStart: cli.installed === true && !cliReady,
          },
          ...(availableBrowser ? [{
            kind: 'browser', label: '내 브라우저', state: 'ready', canStart: true,
            startUrl: 'https://www.notion.so/',
          }] : []),
        ],
        actions: connected ? [{
          id: 'disconnect', label: '연결 해제', kind: 'disconnect',
          endpoint: '/connections/notion/disconnect',
        }] : connecting ? [{
          id: 'cancel', label: '연결 취소', kind: 'cancel',
          endpoint: '/connections/notion/cancel',
        }] : [{
          id: 'connect', label: 'Notion 계정 연결', kind: 'oauth',
          startEndpoint: '/connections/notion/start', awaitEndpoint: '/connections/notion/await',
        }],
      };
    },
    async start() {
      if (pending) throw Object.assign(new Error('Notion 연결을 이미 진행하고 있어요.'), {
        status: 409, reason: 'oauth_in_progress',
      });
      pending = { phase: 'starting' };
      let callback = null;
      try {
        if ((await this.inspect()).state === 'connected') throw Object.assign(new Error('Notion이 이미 연결되어 있어요.'), {
          status: 409, reason: 'already_connected',
        });
        const pkce = createNotionPkce();
        callback = startNotionCallback({ state: pkce.state, port: callbackPort });
        let callbackAddress;
        try { callbackAddress = await callback.listening; }
        catch (error) { callback.cancel(); throw error; }
        let current = await bundle();
        if (!current?.metadata || !current?.client || current.redirectUri !== callbackAddress.redirectUri) {
          const metadata = await discoverNotionOAuth({ serverUrl: NOTION_MCP_URL, fetchImpl });
          const client = await registerNotionClient({
            metadata, redirectUri: callbackAddress.redirectUri, fetchImpl,
          });
          current = { version: 1, redirectUri: callbackAddress.redirectUri, metadata, client };
          await secretStore.set(SECRET_NAME, current);
        }
        pending = { pkce, callback, bundle: current };
        return {
          authorizeUrl: buildNotionAuthorizeUrl({
            metadata: current.metadata, client: current.client, redirectUri: current.redirectUri,
            challenge: pkce.challenge, state: pkce.state,
          }),
          notice: 'Notion 계정 연결을 시작했어요.',
        };
      } catch (error) {
        callback?.cancel();
        pending = null;
        throw error;
      }
    },
    async awaitConnection() {
      const current = pending;
      if (!current) throw Object.assign(new Error('Notion 연결을 먼저 시작해 주세요.'), {
        status: 409, reason: 'oauth_not_started',
      });
      try {
        const code = await current.callback.waitForCode;
        const tokens = await exchangeNotionCode({
          metadata: current.bundle.metadata, client: current.bundle.client,
          redirectUri: current.bundle.redirectUri, code, verifier: current.pkce.verifier,
        }, { fetchImpl, now });
        await secretStore.set(SECRET_NAME, { ...current.bundle, tokens });
        const connectedRuntime = await activeRuntime();
        const tools = await connectedRuntime.listTools();
        const fetchTool = tools.find((tool) => ['notion-fetch', 'fetch'].includes(tool.name));
        if (!fetchTool) throw new Error('Notion MCP fetch tool was not available');
        const self = await connectedRuntime.callTool({ name: fetchTool.name, arguments: { id: 'self' } });
        if (self.isError) throw new Error('Notion MCP workspace identity check failed');
        const workspace = workspaceFromSelf(self);
        await secretStore.set(SECRET_NAME, {
          ...current.bundle, tokens, workspace, tools: tools.map((tool) => tool.name), verifiedAt: now(),
        });
        return {
          connected: true, provider: 'notion',
          userSafeSummary: `${workspace.name} Notion 업무공간을 연결했어요.`,
        };
      } catch (error) {
        const saved = await bundle();
        if (saved?.tokens && !saved.workspace) {
          const { tokens: _discarded, ...registration } = saved;
          await secretStore.set(SECRET_NAME, registration).catch(() => {});
        }
        throw error;
      } finally {
        current.callback.cancel();
        if (pending === current) pending = null;
      }
    },
    credential,
    runtime: activeRuntime,
    async makeTool({ authorizeEffect }) {
      if ((await this.inspect()).state !== 'connected') return null;
      return makeNotionTool({ runtime: await activeRuntime(), authorizeEffect });
    },
    async cancelPending() {
      if (!pending) return {
        cancelled: false, provider: 'notion', userSafeSummary: '진행 중인 Notion 연결이 없어요.',
      };
      const current = pending;
      pending = null;
      current.callback?.cancel();
      return { cancelled: true, provider: 'notion', userSafeSummary: 'Notion 계정 연결을 취소했어요.' };
    },
    async disconnect() {
      await this.cancelPending();
      await runtime?.close?.().catch(() => {}); runtime = null;
      await secretStore.clear(SECRET_NAME);
      return { disconnected: true, provider: 'notion', userSafeSummary: 'Notion 연결을 해제했어요.' };
    },
    async close() {
      pending?.callback?.cancel(); pending = null;
      await runtime?.close?.().catch(() => {}); runtime = null;
    },
  };
}
