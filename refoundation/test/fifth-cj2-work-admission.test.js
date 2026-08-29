import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

async function fixture(respond) {
  const room = await mkdtemp(join(tmpdir(), 't5-cj2-work-admission-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const calls = []; const errors = [];
  const server = makeConsoleServer({ stateDir, workspace,
    workAdmissionMode: 'action-v1',
    modelFactory: () => ({ async respond(input) {
      calls.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
      return respond(input, calls.length);
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    onError: (error) => errors.push(error),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  return { room, server, base, session, calls, errors, async close() {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  } };
}

async function turn(target, text) {
  return fetch(`${target.base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: target.session.id, text }),
  }).then((response) => response.json());
}

test('직접 답변은 모델 전에 Work를 만들거나 Working Memory를 투영하지 않는다', async () => {
  const target = await fixture(() => ({ text: '바로 답했습니다.', toolCalls: [] }));
  try {
    const result = await turn(target, '안녕');
    assert.equal(result.reply, '바로 답했습니다.', `${JSON.stringify(result)} ${target.errors.map((error) => error?.stack).join('\n')}`);
    assert.equal(target.calls.length, 1);
    assert.equal(target.calls[0].messages.some((message) => (
      String(message.content ?? '').includes('T5 CURRENT WORKING MEMORY')
    )), false);
    const state = await target.server.workStore.read();
    assert.equal(state.works.length, 0); assert.equal(state.claims.length, 0);
    const [run] = await target.server.runLedger.list({ sessionId: target.session.id });
    assert.equal(run.events.some((event) => event.type === 'work_bound'), false);
    assert.equal(run.events.some((event) => event.type === 'tool_started'), false);
  } finally { await target.close(); }
});

test('첫 Tool 요청은 같은 Run에 Work를 exact once 결속한 뒤 실행한다', async () => {
  const target = await fixture((_input, modelTurn) => {
    if (modelTurn === 1) return { text: '', toolCalls: [{
      id: 'observe-connections', name: 'connection', args: { action: 'list', id: null, actionId: null },
    }] };
    if (modelTurn === 2) return { text: '', toolCalls: [{
      id: 'complete-work', name: 'work_completion',
      args: { outcome: 'achieved', inputSettlements: [] },
    }] };
    return { text: '현재 연결 상태를 확인했습니다.', toolCalls: [] };
  });
  try {
    const result = await turn(target, '현재 연결 상태를 확인해줘');
    assert.equal(result.reply, '현재 연결 상태를 확인했습니다.', `${JSON.stringify(result)} ${target.errors.map((error) => error?.stack).join('\n')}`);
    const state = await target.server.workStore.read();
    assert.equal(state.works.length, 1);
    assert.equal(state.claims.filter((claim) => claim.state === 'active').length, 1);
    const [run] = await target.server.runLedger.list({ sessionId: target.session.id });
    const types = run.events.map((event) => event.type);
    assert.equal(types.filter((type) => type === 'work_bound').length, 1);
    assert.ok(types.indexOf('work_bound') < types.indexOf('tool_started'));
    assert.equal(target.calls[0].messages.some((message) => (
      String(message.content ?? '').includes('T5 CURRENT WORKING MEMORY')
    )), false);
  } finally { await target.close(); }
});
