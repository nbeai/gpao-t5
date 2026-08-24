import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('주 모델은 subject pointer를 보고 exact memoryId를 선택한 뒤에만 원문을 받는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-c-memory-product-')); const workspace = join(room, 'workspace');
  await mkdir(workspace); let turn = 0; let codeId;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, modelFactory: () => ({
    async respond(input) {
      turn += 1;
      assert.equal(input.messages.some((message) => /프로젝트는 길게 설명/u.test(message.content)), false);
      if (turn === 1) {
        assert.match(input.messages.find((message) => /USER MEMORY CANDIDATES/u.test(message.content)).content,
          /프로젝트/u);
        return { text: '프로그램 분석에는 저장된 프로젝트 기억을 자동 적용하지 않았습니다.', toolCalls: [] };
      }
      if (turn === 2) {
        const candidates = input.messages.find((message) => /USER MEMORY CANDIDATES/u.test(message.content));
        assert.match(candidates.content, new RegExp(codeId, 'u'));
        return { text: '', toolCalls: [{ id: 'read-memory', name: 'memory', args: {
          action: 'read', memoryIds: [codeId], memoryId: null, kind: null, content: null,
          subjects: null, alwaysRelevant: null,
        } }] };
      }
      const receipt = input.messages.find((message) => message.role === 'tool' && message.name === 'memory');
      assert.match(receipt.content, /코드 답변은 짧게/u); assert.doesNotMatch(receipt.content, /프로젝트는 길게/u);
      return { text: '코드 답변은 짧게 하겠습니다.', toolCalls: [] };
    },
  }) });
  await server.memoryLedger.ensure();
  await server.memoryLedger.add({ kind: 'user', content: '프로젝트는 길게 설명한다.', subjects: ['프로젝트'] });
  codeId = (await server.memoryLedger.add({ kind: 'user', content: '코드 답변은 짧게 한다.', subjects: ['코드 답변'] })).memoryId;
  const base = await listen(server);
  try {
    const first = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const unrelated = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: first.id, text: '프로그램 분석을 시작해' }) }).then((response) => response.json());
    assert.match(unrelated.reply, /자동 적용하지 않았/u);
    const second = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const recalled = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: second.id, text: '내 코드 답변 선호를 반영해줘' }) }).then((response) => response.json());
    assert.equal(recalled.reply, '코드 답변은 짧게 하겠습니다.');
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('새 Session의 주 모델은 Episode pointer를 고른 뒤 bounded Conversation·Run 사실을 회수한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-c-episode-product-')); const workspace = join(room, 'workspace');
  await mkdir(workspace); const phase = new Map();
  const errors = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, onError: (error) => errors.push(error),
    modelFactory: ({ sessionId }) => ({ async respond(input) {
      const current = phase.get(sessionId) ?? 0; phase.set(sessionId, current + 1);
      if (current === 0 && !/지난 작업/u.test(input.messages.at(-1)?.content ?? '')) {
        return { text: '과거 고객 보고서 작업을 기록했습니다.', toolCalls: [] };
      }
      if (current === 0) return { text: '', toolCalls: [{ id: 'episodes', name: 'session_search', args: {
        action: 'episodes', query: null, sessionId: null, messageId: null, limit: 5, window: null,
        includeTools: false, workId: null, runId: null,
      } }] };
      if (current === 1) {
        const receipt = input.messages.find((message) => message.role === 'tool' && message.name === 'session_search');
        const parsed = JSON.parse(receipt.content); const episode = parsed.result.episodes[0];
        return { text: '', toolCalls: [{ id: 'episode-read', name: 'session_search', args: {
          action: 'episode_read', query: null, sessionId: null, messageId: null, limit: null, window: 2,
          includeTools: false, workId: episode.workId, runId: episode.runId,
        } }] };
      }
      const receipt = input.messages.filter((message) => message.role === 'tool'
        && message.name === 'session_search').at(-1);
      assert.match(receipt.content, /고객 보고서 초안을 만들어줘/u); assert.match(receipt.content, /"status":"completed"/u);
      return { text: '지난 고객 보고서 Episode를 확인했습니다.', toolCalls: [] };
    } }) });
  const base = await listen(server);
  try {
    const source = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: source.id, text: '고객 보고서 초안을 만들어줘' }) });
    const recall = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: recall.id, text: '지난 작업의 Episode를 확인해줘' }) }).then((response) => response.json());
    assert.equal(result.reply, '지난 고객 보고서 Episode를 확인했습니다.',
      `console errors: ${errors.map((error) => error.message).join(' | ')}; surface=${JSON.stringify(result)}`);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});
