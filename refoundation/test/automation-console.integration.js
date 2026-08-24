import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

const effect = {
  kind: 'local_change', summary: '반복 업무 예약', targets: ['T5 자동화 원장'],
  reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
};

test('자연어 반복 요청은 실제 Job이 되고 수동 실행·Run 기록·멈춤·재개가 같은 콘솔에서 이어진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({
    stateDir, workspace,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'automation-model' }),
    modelFactory: () => ({ async respond({ messages, tools }) {
      const last = messages.at(-1);
      if (last.role === 'tool') {
        const receipt = JSON.parse(last.content);
        if (receipt.requestedCall.name === 'tool_search') {
          assert.ok(tools.some((tool) => tool.name === 'automation'));
          return { text: '', toolCalls: [{
            id: 'automation-create', name: 'automation', args: {
              action: 'create', jobId: null, name: '아침 파일 확인',
              prompt: '작업공간의 audit-result.md를 읽고 한 줄로 요약해줘.',
              scheduleKind: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Seoul',
              requiredTools: [], requiredEffect: null, requireResultUrl: false,
              delivery: 'origin_session', preparationToolCallIds: [],
              delegatedTool: null, delegatedEffect: null, effect,
            },
          }] };
        }
        if (receipt.requestedCall.name === 'automation_outcome') {
          return { text: '자동 실행 결과를 만들었어요.', toolCalls: [] };
        }
        return { text: '매일 확인하도록 예약했어요.', toolCalls: [] };
      }
      if (String(last.content).includes('매일 오전 9시')) {
        assert.ok(tools.some((tool) => tool.name === 'automation'));
        return { text: '', toolCalls: [{
          id: 'automation-create', name: 'automation', args: {
            action: 'create', jobId: null, name: '아침 파일 확인',
            prompt: '작업공간의 audit-result.md를 읽고 한 줄로 요약해줘.',
            scheduleKind: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Seoul',
            requiredTools: [], requiredEffect: null, requireResultUrl: false,
            delivery: 'origin_session', preparationToolCallIds: [],
            delegatedTool: null, delegatedEffect: null, effect,
          },
        }] };
      }
      if (tools.some((tool) => tool.name === 'automation_outcome')) return { text: '', toolCalls: [{
        id: 'automation-finish', name: 'automation_outcome', args: {
          status: 'achieved', summary: '요약 결과를 만들었습니다.', remaining: null,
          evidenceToolCallIds: [], resultUrls: [],
        },
      }] };
      return { text: '자동 실행 결과를 만들었어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await server.startAutomations(); const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '매일 오전 9시에 audit-result를 확인해줘.' }) }).then((response) => response.json());
    assert.equal(reply.reply, '매일 확인하도록 예약했어요.');
    let state = await fetch(`${base}/automation`).then((response) => response.json());
    assert.equal(state.jobs.length, 1); assert.equal(state.jobs[0].state, 'scheduled');
    const jobId = state.jobs[0].id;
    const queued = await fetch(`${base}/automation/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) }).then((response) => response.json());
    assert.equal(queued.enqueued, true);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      state = await fetch(`${base}/automation`).then((response) => response.json());
      if (state.runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.runs[0].status, 'succeeded');
    assert.ok(state.runs[0].sourceRunId);
    const origin = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.ok(origin.transcript.some((entry) => entry.result?.trigger === 'automation'
      && entry.result?.reply === '자동 실행 결과를 만들었어요.'));
    const archived = await fetch(`${base}/sessions?archived=1`).then((response) => response.json());
    assert.ok(archived.sessions.some((item) => item.continuationOf === session.id));
    await fetch(`${base}/automation/pause`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
    assert.equal((await fetch(`${base}/automation`).then((response) => response.json())).jobs[0].state, 'paused');
    await fetch(`${base}/automation/resume`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }) });
    assert.equal((await fetch(`${base}/automation`).then((response) => response.json())).jobs[0].state, 'scheduled');
  } finally {
    await server.closeAutomations(); server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
