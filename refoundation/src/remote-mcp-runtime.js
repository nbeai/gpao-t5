import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { classifyAuthChallenge } from './connection-auth-recovery.js';

function safeTool(tool) {
  const name = String(tool?.name ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(name)
    || !tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
    throw new Error('invalid Remote MCP tool definition');
  }
  return {
    name, title: tool.title == null ? null : String(tool.title).slice(0, 200),
    description: tool.description == null ? '' : String(tool.description).slice(0, 4_000),
    inputSchema: structuredClone(tool.inputSchema), annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint === true,
      destructiveHint: tool.annotations?.destructiveHint === true,
      idempotentHint: tool.annotations?.idempotentHint === true,
      openWorldHint: tool.annotations?.openWorldHint === true,
    },
  };
}

async function defaultClientFactory({ serverUrl, credential, onUnauthorized, onAuthRejected,
  onAdditionalPermissionRequired,
  fetchImpl = globalThis.fetch }) {
  const client = new Client({ name: 'gpao-t5', version: '0.1.1' }, { capabilities: {} });
  const authenticatedFetch = async (url, init = {}) => {
    const first = await credential(); const headers = new Headers(init.headers ?? {});
    headers.set('authorization', `Bearer ${first.accessToken}`);
    let response = await fetchImpl(url, { ...init, headers });
    let challenge = classifyAuthChallenge({ status: response.status,
      wwwAuthenticate: response.headers.get('www-authenticate') });
    if (challenge.kind === 'step_up') {
      await response.body?.cancel().catch(() => {});
      await onAdditionalPermissionRequired?.({ failedGeneration: first.generation,
        requiredScopes: challenge.requiredScopes });
      throw Object.assign(new Error('Remote MCP needs additional permission'), {
        reason: 'needs_additional_permission', requiredScopes: challenge.requiredScopes,
      });
    }
    if (response.status !== 401 || typeof onUnauthorized !== 'function') return response;
    await response.body?.cancel().catch(() => {});
    const refreshed = await onUnauthorized({ failedGeneration: first.generation, response });
    const latest = refreshed?.accessToken ? refreshed : await credential();
    const retryHeaders = new Headers(init.headers ?? {});
    retryHeaders.set('authorization', `Bearer ${latest.accessToken}`);
    response = await fetchImpl(url, { ...init, headers: retryHeaders });
    challenge = classifyAuthChallenge({ status: response.status,
      wwwAuthenticate: response.headers.get('www-authenticate') });
    if (challenge.kind === 'step_up') {
      await response.body?.cancel().catch(() => {});
      await onAdditionalPermissionRequired?.({ failedGeneration: latest.generation,
        requiredScopes: challenge.requiredScopes });
      throw Object.assign(new Error('Remote MCP needs additional permission'), {
        reason: 'needs_additional_permission', requiredScopes: challenge.requiredScopes,
      });
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      await onAuthRejected?.({ failedGeneration: latest.generation });
      throw Object.assign(new Error('Remote MCP credential was rejected after refresh'), { reason: 'reauth_required' });
    }
    return response;
  };
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), {
      fetch: authenticatedFetch, onInsufficientScope: 'throw', maxStepUpRetries: 0,
    }));
  } catch (error) { await client.close().catch(() => {}); throw error; }
  return { listTools: (...args) => client.listTools(...args), callTool: (...args) => client.callTool(...args), close: () => client.close() };
}

export function makeRemoteMcpRuntime({ serverUrl, credential, onUnauthorized,
  onAuthRejected, onAdditionalPermissionRequired,
  fetchImpl = globalThis.fetch, clientFactory = defaultClientFactory } = {}) {
  if (!/^https:\/\//u.test(String(serverUrl ?? ''))) throw new TypeError('Remote MCP HTTPS URL is required');
  if (typeof credential !== 'function') throw new TypeError('Remote MCP credential source is required');
  let clientPromise = null; let tools = null;
  async function client() {
    if (!clientPromise) clientPromise = clientFactory({
      serverUrl, credential, token: async () => (await credential()).accessToken,
      onUnauthorized, onAuthRejected, onAdditionalPermissionRequired, fetchImpl,
    }).catch((error) => { clientPromise = null; throw error; });
    return clientPromise;
  }
  async function resetClient() {
    const active = await clientPromise?.catch(() => null);
    clientPromise = null; tools = null;
    await active?.close?.().catch(() => {});
  }
  async function listTools() {
    let result;
    try { result = await (await client()).listTools(); }
    catch (error) { await resetClient(); throw error; }
    if (!Array.isArray(result?.tools)) throw new Error('Remote MCP returned no tool list');
    tools = result.tools.map(safeTool); return structuredClone(tools);
  }
  return {
    listTools,
    async callTool({ name, arguments: args = {} } = {}) {
      const available = tools ?? await listTools();
      if (!available.some((tool) => tool.name === name)) throw new Error('Remote MCP tool not found');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Remote MCP arguments must be an object');
      let result;
      try { result = await (await client()).callTool({ name, arguments: structuredClone(args) }); }
      catch (error) { await resetClient(); throw error; }
      return { content: Array.isArray(result?.content) ? structuredClone(result.content) : [],
        ...(result?.structuredContent && typeof result.structuredContent === 'object'
          ? { structuredContent: structuredClone(result.structuredContent) } : {}), isError: result?.isError === true };
    },
    invalidate() { tools = null; },
    async close() { await resetClient(); },
  };
}
