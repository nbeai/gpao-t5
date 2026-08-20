import { NOTION_MCP_URL } from './notion-mcp-oauth.js';
import { makeRemoteMcpRuntime } from './remote-mcp-runtime.js';

/** Notion keeps its product identity flow; standard Streamable HTTP tools use the shared runtime. */
export function makeNotionMcpRuntime(options = {}) {
  return makeRemoteMcpRuntime({ serverUrl: NOTION_MCP_URL, ...options });
}
