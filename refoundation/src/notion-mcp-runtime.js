import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { NOTION_MCP_URL } from './notion-mcp-oauth.js';

async function defaultClientFactory({ token, onUnauthorized }) {
  const authProvider = { token, ...(onUnauthorized ? { onUnauthorized } : {}) };
  let client = new Client({ name: 'gpao-t5', version: '0.1.1' }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(NOTION_MCP_URL), { authProvider }));
  } catch (streamableError) {
    await client.close().catch(() => {});
    client = new Client({ name: 'gpao-t5', version: '0.1.1' }, { capabilities: {} });
    try {
      await client.connect(new SSEClientTransport(new URL('https://mcp.notion.com/sse'), { authProvider }));
    } catch (sseError) {
      await client.close().catch(() => {});
      throw Object.assign(new Error('Notion 원격 연결을 열지 못했어요.'), {
        cause: sseError, streamableCause: streamableError,
      });
    }
  }
  return {
    listTools: (...args) => client.listTools(...args),
    callTool: (...args) => client.callTool(...args),
    close: () => client.close(),
  };
}

function safeTool(tool) {
  const name = String(tool?.name ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(name)
    || !tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
    throw new Error('invalid Notion MCP tool definition');
  }
  return {
    name,
    title: tool.title == null ? null : String(tool.title).slice(0, 200),
    description: tool.description == null ? '' : String(tool.description).slice(0, 4_000),
    inputSchema: structuredClone(tool.inputSchema),
    annotations: {
      readOnlyHint: tool.annotations?.readOnlyHint === true,
      destructiveHint: tool.annotations?.destructiveHint === true,
      idempotentHint: tool.annotations?.idempotentHint === true,
      openWorldHint: tool.annotations?.openWorldHint === true,
    },
  };
}

export function makeNotionMcpRuntime({
  credential, onUnauthorized, clientFactory = defaultClientFactory,
} = {}) {
  if (typeof credential !== 'function') throw new TypeError('Notion credential source is required');
  let clientPromise = null;
  let tools = null;

  async function client() {
    if (!clientPromise) clientPromise = clientFactory({
      token: async () => (await credential()).accessToken,
      onUnauthorized,
    }).catch((error) => { clientPromise = null; throw error; });
    return clientPromise;
  }

  async function listTools() {
    const result = await (await client()).listTools();
    if (!Array.isArray(result?.tools)) throw new Error('Notion MCP returned no tool list');
    tools = result.tools.map(safeTool);
    return structuredClone(tools);
  }

  return {
    listTools,
    async callTool({ name, arguments: args = {} } = {}) {
      const available = tools ?? await listTools();
      if (!available.some((tool) => tool.name === name)) throw new Error('Notion MCP tool not found');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Notion MCP arguments must be an object');
      const result = await (await client()).callTool({ name, arguments: structuredClone(args) });
      return {
        content: Array.isArray(result?.content) ? structuredClone(result.content) : [],
        ...(result?.structuredContent && typeof result.structuredContent === 'object'
          ? { structuredContent: structuredClone(result.structuredContent) } : {}),
        isError: result?.isError === true,
      };
    },
    invalidate() { tools = null; },
    async close() {
      const active = await clientPromise?.catch(() => null);
      clientPromise = null; tools = null;
      await active?.close?.();
    },
  };
}
