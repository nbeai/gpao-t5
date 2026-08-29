import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

const source = (path) => import('node:fs/promises').then(({ readFile }) => (
  readFile(new URL(path, import.meta.url), 'utf8')
));

async function run({ mode, request = '간단히 답해줘', respond }) {
  const room = await mkdtemp(join(tmpdir(), 't5-cj4-surface-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
  const calls = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    capabilitySurfaceMode: mode,
    modelFactory: () => ({ async respond(input) {
      calls.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
      return respond(input, calls.length);
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: request }),
    }).then((response) => response.json());
    return { result, calls };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
}

const toolBytes = (call) => Buffer.byteLength(JSON.stringify(call.tools));

test('directory-first 후보는 Direct의 schema를 최소 손과 capability directory로 제한한다', async () => {
  const respond = () => ({ text: '직접 답변', toolCalls: [] });
  const baseline = await run({ mode: 'current-core-v1', respond });
  const candidate = await run({ mode: 'directory-first-v1', respond });
  assert.equal(baseline.result.reply, '직접 답변'); assert.equal(candidate.result.reply, '직접 답변');
  assert.deepEqual(candidate.calls[0].tools.map((tool) => tool.name).toSorted(), [
    'attachment', 'exec', 'tool_search', 'web_read',
  ]);
  assert.ok(candidate.calls[0].tools.length < baseline.calls[0].tools.length);
  assert.ok(toolBytes(candidate.calls[0]) < toolBytes(baseline.calls[0]));
});

test('설치 제품 entry는 자격된 directory-first surface를 사용한다', async () => {
  assert.match(await source('../scripts/start-console.mjs'),
    /makeConsoleServer\(\{[\s\S]*capabilitySurfaceMode: 'directory-first-v1'/u);
});

test('directory-first 후보는 실제 Tool 요청 뒤 completion을 열고 숨은 capability를 한 번 발견한다', async () => {
  const observed = await run({ mode: 'directory-first-v1', request: '현재 연결 상태를 확인해줘',
    respond(input, modelTurn) {
      if (modelTurn === 1) return { text: '', toolCalls: [{
        id: 'find-connection', name: 'tool_search', args: { query: 'current service connection status' },
      }] };
      if (modelTurn === 2) {
        assert.ok(input.tools.some((tool) => tool.name === 'connection'));
        assert.ok(input.tools.some((tool) => tool.name === 'work_completion'));
        return { text: '', toolCalls: [{ id: 'list', name: 'connection',
          args: { action: 'list', id: null, actionId: null } }] };
      }
      if (modelTurn === 3) return { text: '', toolCalls: [{ id: 'done', name: 'work_completion',
        args: { outcome: 'achieved', inputSettlements: [] } }] };
      return { text: '연결 상태를 확인했습니다.', toolCalls: [] };
    } });
  assert.equal(observed.result.reply, '연결 상태를 확인했습니다.');
  assert.equal(observed.calls.length, 4);
  assert.equal(observed.calls[0].tools.some((tool) => tool.name === 'connection'), false);
});
