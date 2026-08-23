import test from 'node:test';
import assert from 'node:assert/strict';

import { makeNotionTool } from '../src/notion-tool.js';
import { makeRemoteMcpTool } from '../src/remote-mcp-tool.js';

const effect = (kind) => ({
  kind, summary: 'Notion 작업', targets: ['notion'], reversible: true,
  backupAvailable: true, recipientNew: false, approvalToken: null,
});

test('Notion readOnlyHint 조회도 모델의 observe 선언 뒤에만 호출된다', async () => {
  const calls = [];
  const runtime = {
    async listTools() { return [{
      name: 'notion-search', description: 'Search', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }]; },
    async callTool(input) { calls.push(input); return {
      content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'page-1' }] }) }], isError: false,
    }; },
  };
  const tool = makeNotionTool({ runtime, authorizeEffect: async () => { throw new Error('must not authorize'); } });
  const missing = await tool.preflight({
    action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '회의록' }), effect: null,
  });
  assert.equal(missing.allowed, false);
  assert.equal(missing.result.state, 'observe_effect_required');
  assert.equal(calls.length, 0);
  assert.equal((await tool.preflight({
    action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '회의록' }), effect: effect('observe'),
  })).allowed, true);
  const result = await tool.execute({
    action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '회의록' }), effect: effect('observe'),
  });
  assert.equal(result.state, 'called');
  assert.equal(result.trust, 'untrusted_external');
  assert.deepEqual(calls, [{ name: 'notion-search', arguments: { query: '회의록' } }]);
});

test('Notion 쓰기 도구는 effect와 authority가 없으면 remote call 전에 멈춘다', async () => {
  let calls = 0;
  const runtime = {
    async listTools() { return [{
      name: 'notion-update-page', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: false, destructiveHint: false },
    }]; },
    async callTool() { calls += 1; return {}; },
  };
  const tool = makeNotionTool({
    runtime,
    authorizeEffect: async (args) => args.effect?.kind === 'external_change'
      ? { allowed: true }
      : { allowed: false, outcome: 'not_executed', result: { state: 'external_change_required' } },
  });
  const missing = await tool.preflight({
    action: 'call', toolName: 'notion-update-page', argumentsJson: JSON.stringify({ page_id: 'p1' }), effect: null,
  });
  assert.equal(missing.allowed, false);
  assert.equal(calls, 0);
  const allowed = await tool.preflight({
    action: 'call', toolName: 'notion-update-page', argumentsJson: JSON.stringify({ page_id: 'p1' }), effect: effect('external_change'),
  });
  assert.equal(allowed.allowed, true);
  await tool.execute({
    action: 'call', toolName: 'notion-update-page', argumentsJson: JSON.stringify({ page_id: 'p1' }), effect: effect('external_change'),
  });
  assert.equal(calls, 1);
});

test('destructiveHint 도구는 external_change로 낮출 수 없고 원격 오류·큰 출력은 정직하게 경계된다', async () => {
  const runtime = {
    async listTools() { return [{
      name: 'notion-delete-page', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, {
      name: 'notion-search', inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, destructiveHint: false },
    }]; },
    async callTool({ name }) { return name === 'notion-delete-page'
      ? { content: [{ type: 'text', text: 'failed' }], isError: true }
      : { content: [{ type: 'text', text: 'x'.repeat(100_000) }], isError: false }; },
  };
  const tool = makeNotionTool({ runtime, authorizeEffect: async () => ({ allowed: true }) });
  const lowered = await tool.preflight({
    action: 'call', toolName: 'notion-delete-page', argumentsJson: '{}', effect: effect('external_change'),
  });
  assert.equal(lowered.allowed, false);
  assert.equal(lowered.result.state, 'destructive_required');
  const failed = await tool.execute({
    action: 'call', toolName: 'notion-delete-page', argumentsJson: '{}', effect: effect('destructive'),
  });
  assert.equal(failed.exitCode, 1);
  const large = await tool.execute({
    action: 'call', toolName: 'notion-search', argumentsJson: '{}', effect: null,
  });
  assert.equal(large.truncated, true);
  assert.ok(JSON.stringify(large.content).length < 70_000);
});

test('서로 충돌하는 readOnly·destructive annotation은 파괴 경계를 우선한다', async () => {
  let calls = 0;
  const tool = makeNotionTool({
    runtime: {
      async listTools() { return [{
        name: 'notion-conflicting-tool', inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, destructiveHint: true },
      }]; },
      async callTool() { calls += 1; return { content: [], isError: false }; },
    },
    authorizeEffect: async () => ({ allowed: true }),
  });
  const lowered = await tool.preflight({
    action: 'call', toolName: 'notion-conflicting-tool', argumentsJson: '{}', effect: effect('observe'),
  });
  assert.equal(lowered.allowed, false);
  assert.equal(lowered.result.state, 'destructive_required');
  assert.equal(calls, 0);
});

test('Notion 동적 인자는 OpenAI strict schema에서 허용되는 JSON 문자열로만 전달된다', async () => {
  const tool = makeNotionTool({
    runtime: {
      async listTools() { return [{
        name: 'notion-search', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true },
      }]; },
      async callTool() { return { content: [], isError: false }; },
    },
  });
  assert.equal(tool.parameters.properties.arguments, undefined);
  assert.deepEqual(tool.parameters.properties.argumentsJson.type, ['string', 'null']);
  assert.equal(JSON.stringify(tool.parameters).includes('"additionalProperties":true'), false);
  await assert.rejects(() => tool.preflight({
    action: 'call', toolName: 'notion-search', argumentsJson: '{broken', effect: null,
  }), /invalid JSON/u);
});

test('Remote MCP read timeout은 Run을 무한 대기시키지 않고 정직한 실패로 끝난다', async () => {
  const tool = makeRemoteMcpTool({
    id: 'fixture', label: 'Fixture', timeoutMs: 20,
    runtime: {
      async listTools() { return [{
        name: 'read_slow', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true },
      }]; },
      async callTool() { return new Promise(() => {}); },
    },
  });
  const args = { action: 'call', toolName: 'read_slow', argumentsJson: '{}', effect: effect('observe') };
  assert.equal((await tool.preflight(args)).allowed, true);
  const result = await Promise.race([
    tool.execute(args),
    new Promise((resolve) => setTimeout(() => resolve({ state: 'hung' }), 100)),
  ]);
  assert.equal(result.state, 'remote_timeout');
  assert.equal(result.exitCode, 1);
  assert.equal(result.effectUnknown, false);
});

test('Remote MCP write timeout은 불명확 효과를 남기고 같은 exact call 재실행을 막는다', async () => {
  let calls = 0;
  const tool = makeRemoteMcpTool({
    id: 'fixture', label: 'Fixture', timeoutMs: 20,
    runtime: {
      async listTools() { return [{
        name: 'update_slow', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false },
      }]; },
      async callTool() { calls += 1; return new Promise(() => {}); },
    },
    authorizeEffect: async () => ({ allowed: true }),
  });
  const args = { action: 'call', toolName: 'update_slow', argumentsJson: '{"id":"p1","title":"next"}', effect: effect('external_change') };
  assert.equal((await tool.preflight(args)).allowed, true);
  const result = await Promise.race([
    tool.execute(args),
    new Promise((resolve) => setTimeout(() => resolve({ state: 'hung' }), 100)),
  ]);
  assert.equal(result.state, 'remote_effect_unknown');
  assert.equal(result.effectUnknown, true);
  assert.equal(result.retrySafe, false);
  const replay = await tool.preflight({
    ...args, argumentsJson: '{"title":"next","id":"p1"}',
  });
  assert.equal(replay.allowed, false);
  assert.equal(replay.result.state, 'ambiguous_remote_effect_not_replayable');
  assert.equal(calls, 1);
});
