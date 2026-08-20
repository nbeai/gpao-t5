import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeGoogleDriveTool } from '../src/google-drive-tool.js';

test('연결된 Google Drive 손은 자연어 검색→파일 선택→다운로드 결과물을 같은 Run에 잇는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-console-'));
  const api = {
    async search() {
      return {
        files: [{
          id: 'drive-file-1', name: '8월 정산.pdf', mimeType: 'application/pdf',
          modifiedTime: '2026-08-20T00:00:00Z', capabilities: { canDownload: true, canEdit: false },
        }],
        nextPageToken: null, incompleteSearch: false,
      };
    },
    async download({ fileId }) {
      return {
        file: { id: fileId, name: '8월 정산.pdf', mimeType: 'application/pdf' },
        originalName: '8월 정산.pdf', mimeType: 'application/pdf', bytes: Buffer.from('%PDF-GOOGLE-T5'),
      };
    },
  };
  const service = {
    id: 'google-workspace', label: 'Google Workspace', category: 'workspace', toolName: 'google_drive',
    inspect: async () => ({
      state: 'connected', userSafeSummary: 'Google Drive 전용 연결을 사용할 수 있어요.',
      capabilities: { search: true, read: true, download: true }, routes: [], actions: [],
    }),
    async makeTool(context) { return makeGoogleDriveTool({ api, ...context }); },
  };
  let turn = 0;
  const nulls = {
    query: null, fileId: null, pageSize: null, pageToken: null, exportMime: null,
    name: null, parentId: null, filePath: null, mimeType: null, effect: null,
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      const drive = input.tools.find((tool) => tool.name === 'google_drive'); assert.ok(drive);
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'search-drive', name: 'google_drive', args: {
          ...nulls, action: 'search', query: '8월 정산', pageSize: 20,
        },
      }] };
      if (turn === 2) {
        const found = JSON.parse(input.messages.at(-1).content);
        assert.equal(found.result.files[0].id, 'drive-file-1');
        return { text: '', toolCalls: [{
          id: 'download-drive', name: 'google_drive', args: {
            ...nulls, action: 'download', fileId: 'drive-file-1',
            effect: {
              kind: 'local_change', summary: '8월 정산 파일 받기', targets: ['google-drive'],
              reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
            },
          },
        }] };
      }
      const downloaded = JSON.parse(input.messages.at(-1).content);
      assert.equal(downloaded.result.state, 'downloaded');
      return { text: 'Google Drive에서 8월 정산 파일을 찾아 다운로드했어요.', toolCalls: [] };
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
      body: JSON.stringify({ sessionId: session.id, text: '내 구글 드라이브에서 8월 정산 파일을 찾아서 내려받아줘' }),
    }).then((response) => response.json());
    assert.equal(answer.artifacts.length, 1);
    assert.equal(answer.artifacts[0].originalName, '8월 정산.pdf');
    const bytes = await fetch(`${base}${answer.artifacts[0].downloadUrl}`).then((response) => response.text());
    assert.equal(bytes, '%PDF-GOOGLE-T5');
    const run = await fetch(`${base}/runs/${answer.runId}`).then((response) => response.json());
    assert.deepEqual(run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt.actualCall.name), ['google_drive', 'google_drive']);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('Google Drive가 연결되지 않았으면 데이터 손을 모델에게 제공하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-google-console-unconnected-'));
  const service = {
    id: 'google-workspace', label: 'Google Workspace', category: 'workspace',
    inspect: async () => ({ state: 'needs_connection', userSafeSummary: '연결 필요', capabilities: {}, routes: [] }),
    makeTool: async () => null,
  };
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, workspaceConnectionServices: [service],
    modelFactory: () => ({ async respond(input) {
      assert.equal(input.tools.some((tool) => tool.name === 'google_drive'), false);
      assert.equal(input.tools.some((tool) => tool.name === 'connection'), true);
      return { text: 'Google Drive 연결이 필요해요.', toolCalls: [] };
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
      body: JSON.stringify({ sessionId: session.id, text: '드라이브 자료 찾아줘' }),
    }).then((response) => response.json());
    assert.match(answer.reply, /연결이 필요/u);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
