import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

const effect = { kind: 'external_send', targets: ['https://trycloudflare.com'],
  confirmation: 'known_recipient', rollbackOfToolCallId: null };

test('자연어 외부 Preview는 설치된 공식 CLI 하나를 on-demand 열고 observed URL만 전달한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-quick-preview-console-'));
  const workspace = join(root, 'workspace'); const stateDir = join(root, 'state'); const program = join(root, 'cloudflared');
  await mkdir(workspace); await writeFile(join(workspace, 'index.html'), '<h1>preview-ready</h1>');
  await writeFile(program, '#!/bin/sh\nprintf "https://fixture-public.trycloudflare.com\\n" >&2\nsleep 30\n');
  await chmod(program, 0o700); let turn = 0; let observedProcessId = null;
  const server = makeConsoleServer({ stateDir, workspace, quickPreviewProgram: program,
    quickPreviewFetchImpl: async () => new Response('<h1>preview-ready</h1>', { status: 200 }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond({ tools, messages }) {
      turn += 1;
      if (turn === 1) {
        assert.equal(tools.some((tool) => tool.name === 'preview_publication'), false);
        return { text: '', toolCalls: [{ id: 'find-preview', name: 'tool_search', args: {
          query: '로컬 홈페이지 외부 미리보기 주소 임시 터널 공유',
        } }] };
      }
      if (turn === 2) {
        assert.equal(tools.some((tool) => tool.name === 'preview_publication'), true);
        return { text: '', toolCalls: [{ id: 'publish-preview', name: 'preview_publication', args: {
          action: 'start', localUrl: 'http://127.0.0.1:4183/', processId: null, effect,
        } }] };
      }
      const receipt = JSON.parse(messages.at(-1).content); observedProcessId = receipt.result.processId;
      assert.equal(receipt.result.state, 'preview_ready'); assert.equal(receipt.result.providerAccepted, true);
      assert.equal(receipt.result.urlReachable, true); assert.equal(receipt.result.production, false);
      return { text: `외부 시험 주소: ${receipt.result.previewUrl}`, toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '지금 만든 로컬 홈페이지를 다른 사람이 시험할 주소로 보여줘' }) });
    const result = await response.json(); assert.equal(response.status, 200);
    assert.match(result.reply, /https:\/\/fixture-public\.trycloudflare\.com/u);
    assert.equal(server.managedProcesses.list(session.id).some((item) => (
      item.processId === observedProcessId && item.state === 'running')), true);
  } finally {
    server.closeWakeStreams(); await server.closeCommandExplainer(); await server.closeMessengers();
    await server.managedProcesses.stopAll('quick_preview_test'); await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
});

test('공식 Preview CLI가 없으면 제품은 숨은 대체 설치나 거짓 주소를 만들지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-no-preview-console-')); const workspace = join(root, 'workspace');
  await mkdir(workspace); let turn = 0;
  const server = makeConsoleServer({ stateDir: join(root, 'state'), workspace,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond({ tools, messages }) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'find-preview', name: 'tool_search', args: {
        query: '로컬 홈페이지 외부 미리보기 주소 임시 터널 공유',
      } }] };
      if (turn === 2) {
        assert.equal(tools.some((tool) => tool.name === 'preview_publication'), true);
        return { text: '', toolCalls: [{ id: 'preview-absence', name: 'preview_publication', args: {
          action: 'start', localUrl: 'http://127.0.0.1:4183/', processId: null, effect,
        } }] };
      }
      const receipt = JSON.parse(messages.at(-1).content);
      assert.equal(receipt.result.state, 'unavailable');
      assert.equal(receipt.result.externallyReachable, false);
      assert.equal(receipt.result.automaticInstallPerformed, false);
      assert.equal(receipt.result.internalAttachmentPreviewIsExternal, false);
      return { text: '현재 외부 Preview 수단은 준비되어 있지 않아 로컬 결과만 제공할 수 있어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try { const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '외부 Preview 주소를 만들어줘' }) }).then((response) => response.json());
    assert.match(String(result.reply ?? ''), /준비되어 있지 않아/u, JSON.stringify(result));
  } finally { server.closeWakeStreams(); await server.closeCommandExplainer(); await server.closeMessengers();
    await new Promise((done) => server.close(done)); await rm(root, { recursive: true, force: true }); }
});
