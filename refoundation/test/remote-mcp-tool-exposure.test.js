import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRemoteMcpTool } from '../src/remote-mcp-tool.js';

test('읽기 전용 Connector는 서버가 광고한 쓰기 도구를 모델 목록과 실행에서 모두 닫는다', async () => {
  const runtime = { async listTools() { return [
    { name: 'search_files', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
    { name: 'create_file', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
  ]; }, async callTool() { throw new Error('must not execute'); } };
  const tool = makeRemoteMcpTool({ id: 'google-workspace', label: 'Google Workspace', runtime,
    readOnlyOnly: true, allowedToolNames: ['search_files'] });
  const listed = await tool.execute({ action: 'list_tools' });
  assert.deepEqual(listed.tools.map((item) => item.name), ['search_files']);
  await assert.rejects(() => tool.preflight({ action: 'call', toolName: 'create_file',
    argumentsJson: '{}', effect: { kind: 'external_change' } }), /not found/u);
});

test('공식 exact allowlist는 optional annotation 누락 때문에 검증된 읽기 도구를 지우지 않는다', async () => {
  const runtime = { async listTools() { return [
    { name: 'search_files', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: false, destructiveHint: true } },
    { name: 'create_file', inputSchema: { type: 'object' }, annotations: {} },
  ]; }, async callTool() { return { content: [], isError: false }; } };
  const tool = makeRemoteMcpTool({ id: 'google-workspace', label: 'Google Workspace', runtime,
    readOnlyOnly: true, allowedToolNames: ['search_files'] });
  const listed = await tool.execute({ action: 'list_tools' });
  assert.deepEqual(listed.tools.map((item) => item.name), ['search_files']);
  assert.equal(listed.tools[0].annotations.readOnlyHint, true);
  assert.equal(listed.tools[0].annotations.destructiveHint, false);
  assert.equal((await tool.preflight({ action: 'call', toolName: 'search_files',
    argumentsJson: '{}', effect: { kind: 'observe' } })).allowed, true);
});

test('쓰기 Connector의 exact allowlist는 쓰기 도구를 observe로 낮추지 않는다', async () => {
  const runtime = { async listTools() { return [{ name: 'send_message', inputSchema: { type: 'object' },
    annotations: { readOnlyHint: false, destructiveHint: false } }]; }, async callTool() { return { content: [] }; } };
  const tool = makeRemoteMcpTool({ id: 'future-write', label: 'Future Write', runtime,
    readOnlyOnly: false, allowedToolNames: ['send_message'] });
  const preflight = await tool.preflight({ action: 'call', toolName: 'send_message',
    argumentsJson: '{}', effect: { kind: 'observe' } });
  assert.equal(preflight.allowed, false); assert.equal(preflight.result.state, 'external_change_required');
});
