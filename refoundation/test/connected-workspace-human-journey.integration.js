import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeNotionTool } from '../src/notion-tool.js';

const effect = (kind, summary, targets) => ({
  kind, summary, targets, reversible: true, backupAvailable: true,
  recipientNew: false, approvalToken: null,
});
const notionNulls = {
  toolName: null, argumentsJson: null, effect: null,
  verificationToolName: null, targetResourceId: null, expectedText: null,
};
const attachmentNulls = {
  attachmentId: null, filePath: null, maxChars: null, maxCells: null, maxPages: null,
};

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('일반 사용자의 Notion 자료 찾기부터 파일 왕복까지 한 대화 흐름으로 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-connected-workspace-human-'));
  const stateDir = join(room, 'state');
  const incoming = join(room, '거래처 안내.txt');
  const downloaded = join(room, '받은 회의자료.txt');
  const remoteBytes = Buffer.from('Notion 회의자료 원본\n', 'utf8');
  await writeFile(incoming, '거래처 안내 최종본\n', 'utf8');
  const cli = join(room, 'ntn-fixture');
  await writeFile(cli, [
    '#!/bin/sh',
    'case "$1 $2" in',
    '  "files create") cat >/dev/null; printf \'{"id":"upload-1","status":"uploaded"}\\n\' ;;',
    '  "files get") printf \'{"id":"upload-1","status":"uploaded"}\\n\' ;;',
    '  *) exit 2 ;;',
    'esac',
  ].join('\n'), 'utf8');
  await chmod(cli, 0o755);

  const fileServer = (await import('node:http')).createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain', 'content-length': remoteBytes.length });
    response.end(remoteBytes);
  });
  await new Promise((resolve, reject) => {
    fileServer.once('error', reject); fileServer.listen(0, '127.0.0.1', resolve);
  });
  const remoteUrl = `http://127.0.0.1:${fileServer.address().port}/meeting.txt`;

  const notionCalls = [];
  let meetingUpdated = false;
  const notionRuntime = {
    async listTools() { return [
      { name: 'notion-search', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'notion-fetch', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
      { name: 'notion-create-pages', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
      { name: 'notion-update-page', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
    ]; },
    async callTool(call) {
      notionCalls.push(call);
      if (call.name === 'notion-search') return {
        isError: false, content: [{ type: 'text', text: JSON.stringify({ results: [{ id: 'meeting-1', title: '주간 회의' }] }) }],
      };
      if (call.name === 'notion-fetch') return call.arguments.id === 'created-1' ? {
        isError: false, content: [{ type: 'text', text: JSON.stringify({ id: 'created-1', title: '후속 할 일' }) }],
      } : {
        isError: false, content: [{ type: 'text', text: JSON.stringify({
          id: 'meeting-1', title: '주간 회의', text: meetingUpdated ? '다음 주 재검토' : '검토 전',
          files: [{ name: '회의자료.txt', url: remoteUrl }],
        }) }],
      };
      if (call.name === 'notion-create-pages') return {
        isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, id: 'created-1' }) }],
      };
      meetingUpdated = true;
      return { isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, id: 'meeting-1' }) }] };
    },
  };
  const notionService = {
    id: 'notion', label: 'Notion', category: 'workspace', toolName: 'notion',
    inspect: async () => ({
      state: 'connected', reason: 'verified_notion_mcp',
      userSafeSummary: '테스트 업무공간에 연결되어 있어요.',
      capabilities: { search: true, read: true, create: true, update: true, download: true, upload: true },
      routes: [
        { kind: 'remote_mcp', label: 'Notion 원격 연결', state: 'connected', canStart: false },
        { kind: 'authenticated_cli', label: '컴퓨터의 Notion 연결', state: 'ready', canStart: false },
      ], actions: [],
    }),
    async makeTool({ authorizeEffect }) { return makeNotionTool({ runtime: notionRuntime, authorizeEffect }); },
  };

  const queue = [
    () => ({ text: '', toolCalls: [{ id: 'n-list', name: 'notion', args: { ...notionNulls, action: 'list_tools' } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-search', name: 'notion', args: { ...notionNulls, action: 'call', toolName: 'notion-search', argumentsJson: JSON.stringify({ query: '주간 회의' }), effect: effect('observe', 'Notion 주간 회의 검색', ['notion']) } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-fetch', name: 'notion', args: { ...notionNulls, action: 'call', toolName: 'notion-fetch', argumentsJson: JSON.stringify({ id: 'meeting-1' }), effect: effect('observe', 'Notion 회의 읽기', ['notion']) } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-create', name: 'notion', args: {
      ...notionNulls, action: 'verified_write', toolName: 'notion-create-pages', argumentsJson: JSON.stringify({ title: '후속 할 일' }),
      verificationToolName: 'notion-fetch', targetResourceId: null, expectedText: '후속 할 일',
      effect: effect('external_change', 'Notion 후속 페이지 만들기', ['notion']),
    } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-update', name: 'notion', args: {
      ...notionNulls, action: 'verified_write', toolName: 'notion-update-page', argumentsJson: JSON.stringify({ page_id: 'meeting-1', text: '다음 주 재검토' }),
      verificationToolName: 'notion-fetch', targetResourceId: 'meeting-1', expectedText: '다음 주 재검토',
      effect: effect('external_change', 'Notion 회의 페이지 수정', ['notion']),
    } }] }),
    () => ({ text: '주간 회의를 찾아 읽고, 후속 할 일 페이지를 만든 뒤 회의 페이지도 수정했어요.', toolCalls: [] }),

    () => ({ text: '', toolCalls: [{ id: 'n-fetch-file', name: 'notion', args: { ...notionNulls, action: 'call', toolName: 'notion-fetch', argumentsJson: JSON.stringify({ id: 'meeting-1' }), effect: effect('observe', 'Notion 회의 파일 확인', ['notion']) } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-download', name: 'exec', args: {
      command: `curl -fsS ${JSON.stringify(remoteUrl)} -o ${JSON.stringify(downloaded)}`, cwd: room,
      effect: effect('local_change', 'Notion 회의자료 받기', [downloaded]),
    } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-register', name: 'attachment', args: {
      ...attachmentNulls, action: 'register_output', filePath: downloaded,
    } }] }),
    () => ({ text: 'Notion 회의자료를 내려받아 이 대화에 파일로 준비했어요.', toolCalls: [] }),

    () => ({ text: '', toolCalls: [{ id: 'n-upload', name: 'exec', args: {
      command: `${JSON.stringify(cli)} files create --filename 안내.txt < ${JSON.stringify(incoming)}`, cwd: room,
      effect: effect('external_send', 'Notion에 거래처 안내 올리기', ['notion']),
    } }] }),
    () => ({ text: '', toolCalls: [{ id: 'n-upload-check', name: 'exec', args: {
      command: `${JSON.stringify(cli)} files get upload-1`, cwd: room, effect: null,
    } }] }),
    () => ({ text: '거래처 안내 파일을 Notion에 올리고 업로드 완료 상태를 다시 확인했어요.', toolCalls: [] }),

  ];

  let discoveryId = 0;
  const server = makeConsoleServer({
    stateDir, workspace: room, workspaceConnectionServices: [notionService],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      const userText = input.messages.findLast((message) => message.role === 'user')?.content ?? '';
      const desired = 'notion';
      if (!input.tools.some((tool) => tool.name === desired)) return {
        text: '', toolCalls: [{
          id: `find-workspace-tool-${discoveryId += 1}`, name: 'tool_search',
          args: { query: desired },
        }],
      };
      const next = queue.shift();
      assert.ok(next, 'unexpected extra model turn');
      assert.ok(input.tools.some((tool) => tool.name === 'connection'));
      return next(input);
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    const session = (await post(base, '/sessions', {})).body;
    for (const text of [
      '노션에서 주간 회의를 찾아 읽고 후속 할 일 페이지를 만든 다음, 회의 페이지에 다음 주 재검토라고 반영해줘.',
      '그 회의 페이지에 붙은 회의자료도 내려받아줘.',
      `내 컴퓨터의 ${incoming} 파일을 같은 Notion 업무공간에 올리고 실제로 올라갔는지 확인해줘.`,
    ]) {
      const result = await post(base, '/turn', { sessionId: session.id, text });
      assert.equal(result.status, 200);
      assert.equal(result.body.kind, 'reply');
      results.push(result.body);
    }
    assert.equal(queue.length, 0);
    assert.deepEqual(notionCalls.map((call) => call.name), [
      'notion-search', 'notion-fetch', 'notion-create-pages', 'notion-fetch',
      'notion-update-page', 'notion-fetch', 'notion-fetch',
    ]);
    assert.deepEqual(await readFile(downloaded), remoteBytes);
    assert.equal(results[1].artifacts[0].originalName, '받은 회의자료.txt');
    const runs = await fetch(`${base}/runs?sessionId=${session.id}`).then((response) => response.json());
    assert.equal(runs.runs.length, 3);
    assert.equal(runs.runs.every((run) => run.status === 'completed'), true);
    for (const run of runs.runs) {
      const detail = await fetch(`${base}/runs/${run.runId}`).then((response) => response.json());
      assert.equal(detail.events.some((event) => event.type === 'surface_persisted'), true);
    }
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fileServer.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
