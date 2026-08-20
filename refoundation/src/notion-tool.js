import { makeRemoteMcpTool } from './remote-mcp-tool.js';

/** Notion-specific user language and file boundary over the generic dynamic MCP tool. */
export function makeNotionTool({ runtime, authorizeEffect } = {}) {
  return makeRemoteMcpTool({
    id: 'notion', label: 'Notion', runtime, authorizeEffect,
    limitations: 'Notion MCP does not currently upload files; do not claim file upload support.',
  });
}
