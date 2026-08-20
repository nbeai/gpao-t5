import test from 'node:test';
import assert from 'node:assert/strict';

import { makeNotionTool } from '../src/notion-tool.js';

const effect = (kind) => ({
  kind, summary: 'Notion 작업', targets: ['notion'], reversible: true,
  backupAvailable: true, recipientNew: false, approvalToken: null,
});

test('Notion 도구 목록의 readOnlyHint가 true인 조회는 추가 효과 선언 없이 호출된다', async () => {
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
  assert.equal((await tool.preflight({
    action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '회의록' }), effect: null,
  })).allowed, true);
  const result = await tool.execute({
    action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '회의록' }), effect: null,
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
