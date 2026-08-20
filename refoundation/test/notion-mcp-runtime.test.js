import test from 'node:test';
import assert from 'node:assert/strict';

import { makeNotionMcpRuntime } from '../src/notion-mcp-runtime.js';

test('Notion MCP runtime은 공식 도구 목록·annotations·호출 결과를 원문 구조로 보존한다', async () => {
  const calls = [];
  let closed = 0;
  const runtime = makeNotionMcpRuntime({
    credential: async () => ({ accessToken: 'ACCESS-SECRET' }),
    clientFactory: async ({ token }) => {
      assert.equal(await token(), 'ACCESS-SECRET');
      return {
        async listTools() { return { tools: [
          {
            name: 'notion-search', title: 'Search', description: 'Search workspace',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            annotations: { readOnlyHint: true },
          },
          {
            name: 'notion-update-page', title: 'Update page', description: 'Update page',
            inputSchema: { type: 'object', properties: { page_id: { type: 'string' } } },
            annotations: { readOnlyHint: false },
          },
        ] }; },
        async callTool(input) { calls.push(input); return {
          content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'page-1', title: '회의록' }] }) }],
          structuredContent: { count: 1 }, isError: false,
        }; },
        async close() { closed += 1; },
      };
    },
  });
  const tools = await runtime.listTools();
  assert.equal(tools[0].name, 'notion-search');
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[1].annotations.readOnlyHint, false);
  const result = await runtime.callTool({ name: 'notion-search', arguments: { query: '회의록' } });
  assert.deepEqual(calls, [{ name: 'notion-search', arguments: { query: '회의록' } }]);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(result.structuredContent, { count: 1 });
  assert.equal(result.isError, false);
  await runtime.close();
  assert.equal(closed, 1);
});

test('목록에 없는 Notion 도구와 비정상 schema는 remote call 전에 멈춘다', async () => {
  const invalid = makeNotionMcpRuntime({
    credential: async () => ({ accessToken: 'ACCESS' }),
    clientFactory: async () => ({
      async listTools() { return { tools: [{ name: '../escape', inputSchema: null }] }; },
      async callTool() { throw new Error('must not call'); }, async close() {},
    }),
  });
  await assert.rejects(() => invalid.listTools(), /invalid Remote MCP tool/u);
  let calls = 0;
  const unknown = makeNotionMcpRuntime({
    credential: async () => ({ accessToken: 'ACCESS' }),
    clientFactory: async () => ({
      async listTools() { return { tools: [{ name: 'notion-search', inputSchema: { type: 'object' } }] }; },
      async callTool() { calls += 1; return {}; }, async close() {},
    }),
  });
  await assert.rejects(() => unknown.callTool({ name: 'notion-missing', arguments: {} }), /tool not found/u);
  assert.equal(calls, 0);
});
