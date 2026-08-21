import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';

const MCP_ENTRY = resolve(
  import.meta.dirname, '..', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin',
  'chrome-devtools-mcp.js',
);

async function defaultClientFactory() {
  const client = new Client({ name: 'gpao-t5-user-browser', version: '0.1.2' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      MCP_ENTRY, '--auto-connect', '--no-category-performance', '--no-category-emulation',
      '--no-category-network', '--no-usage-statistics',
    ],
    env: { HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '/usr/bin:/bin' },
    stderr: 'pipe',
  });
  try { await client.connect(transport); }
  catch (error) { await client.close().catch(() => {}); throw error; }
  return {
    listTools: (...args) => client.listTools(...args),
    callTool: (...args) => client.callTool(...args),
    close: () => client.close(),
  };
}

export function makeUserChromeMcpRuntime({ clientFactory = defaultClientFactory } = {}) {
  let clientPromise = null;
  let connected = false;
  let lastError = null;

  async function client() {
    if (!clientPromise) {
      clientPromise = clientFactory().catch((error) => {
        clientPromise = null; connected = false; lastError = 'user_browser_connection_failed'; throw error;
      });
    }
    return clientPromise;
  }

  async function call(name, args = {}) {
    const active = await client();
    const result = await active.callTool({ name, arguments: structuredClone(args) });
    if (result?.isError) {
      const error = new Error('user_browser_tool_failed');
      error.code = 'user_browser_tool_failed';
      throw error;
    }
    return {
      content: Array.isArray(result?.content) ? structuredClone(result.content) : [],
      structuredContent: result?.structuredContent && typeof result.structuredContent === 'object'
        ? structuredClone(result.structuredContent) : null,
    };
  }

  return {
    async connect() {
      const active = await client();
      const listed = await active.listTools();
      const names = new Set((listed?.tools ?? []).map((tool) => tool.name));
      for (const required of ['list_pages', 'select_page', 'new_page', 'navigate_page', 'take_snapshot']) {
        if (!names.has(required)) throw new Error('user_browser_tools_missing');
      }
      const pages = await call('list_pages');
      connected = true; lastError = null;
      return pages;
    },
    call,
    status() { return { connected, lastError }; },
    async close() {
      const active = await clientPromise?.catch(() => null);
      clientPromise = null; connected = false;
      await active?.close?.();
    },
  };
}
