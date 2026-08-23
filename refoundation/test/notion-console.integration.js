import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeNotionTool } from '../src/notion-tool.js';

test('연결된 Notion 손은 도구 발견→검색→페이지 읽기→수정을 자연어 멀티턴 한 Run에 잇는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-notion-console-'));
  const remoteCalls = [];
  const runtime = {
    async listTools() { return [
      {
        name: 'notion-search', description: 'Search workspace',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'notion-fetch', description: 'Fetch page',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'notion-update-page', description: 'Update page',
        inputSchema: { type: 'object', properties: { page_id: { type: 'string' }, command: { type: 'string' } } },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
    ]; },
    async callTool(input) {
      remoteCalls.push(input);
      if (input.name === 'notion-search') return {
        content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'page-1', title: '주간 회의' }] }) }], isError: false,
      };
      if (input.name === 'notion-fetch') return {
        content: [{ type: 'text', text: JSON.stringify({ id: 'page-1', title: '주간 회의', text: '결정사항 없음' }) }], isError: false,
      };
      return { content: [{ type: 'text', text: JSON.stringify({ id: 'page-1', updated: true }) }], isError: false };
    },
  };
  const service = {
    id: 'notion', label: 'Notion', category: 'workspace', toolName: 'notion',
    inspect: async () => ({
      state: 'connected', userSafeSummary: '테스트 업무공간에 연결되어 있어요.',
      capabilities: { search: true, read: true, create: true, update: true, download: false, upload: false },
      routes: [], actions: [],
    }),
    async makeTool({ authorizeEffect }) { return makeNotionTool({ runtime, authorizeEffect }); },
  };
  let turn = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      if (!input.tools.some((tool) => tool.name === 'notion')) return { text: '', toolCalls: [{
        id: 'find-notion', name: 'tool_search', args: { query: 'notion' },
      }] };
      turn += 1;
      const base = { toolName: null, argumentsJson: null, effect: null };
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'list-notion', name: 'notion', args: { ...base, action: 'list_tools' },
      }] };
      if (turn === 2) return { text: '', toolCalls: [{
        id: 'search-notion', name: 'notion', args: {
          ...base, action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '주간 회의' }),
          effect: {
            kind: 'observe', summary: 'Notion에서 주간 회의 검색', targets: ['notion'],
            reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
          },
        },
      }] };
      if (turn === 3) return { text: '', toolCalls: [{
        id: 'fetch-notion', name: 'notion', args: {
          ...base, action: 'call', toolName: 'notion-fetch', argumentsJson: JSON.stringify({ id: 'page-1' }),
          effect: {
            kind: 'observe', summary: 'Notion 주간 회의 읽기', targets: ['notion'],
            reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
          },
        },
      }] };
      if (turn === 4) return { text: '', toolCalls: [{
        id: 'update-notion', name: 'notion', args: {
          ...base, action: 'call', toolName: 'notion-update-page',
          argumentsJson: JSON.stringify({ page_id: 'page-1', command: '결정사항에 다음 주 재검토 추가' }),
          effect: {
            kind: 'external_change', summary: '주간 회의 페이지 수정', targets: ['notion'],
            reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
          },
        },
      }] };
      return { text: '주간 회의 페이지를 읽고 결정사항에 다음 주 재검토를 추가했어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const answer = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '노션에서 주간 회의를 찾아 읽고 결정사항에 다음 주 재검토를 추가해줘' }),
    }).then((response) => response.json());
    assert.match(answer.reply, /추가했어요/u);
    assert.deepEqual(remoteCalls.map((call) => call.name), [
      'notion-search', 'notion-fetch', 'notion-update-page',
    ]);
    const run = await fetch(`${base}/runs/${answer.runId}`).then((response) => response.json());
    assert.equal(run.events.filter((event) => event.type === 'tool_completed').length, 5);
    assert.equal(run.events.some((event) => (
      event.type === 'tool_completed'
      && event.payload.receipt.requestedCall.args.effect?.kind === 'external_change'
      && event.payload.receipt.outcome === 'succeeded'
    )), true);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
