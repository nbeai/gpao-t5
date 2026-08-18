import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('기존 콘솔 UI가 새 session → agent loop → terminal → persisted reply를 왕복한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-surface-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => {
    let turn = 0;
    return {
      async respond(input) {
        turn += 1;
        if (turn === 1) return {
          text: '', toolCalls: [{ id: 'console-call', name: 'exec', args: { command: "printf 'console-ok'", cwd: null } }],
          responseId: 'r1', responseModel: 'console-model',
        };
        const receipt = JSON.parse(input.messages.at(-1).content);
        assert.equal(receipt.result.stdout, 'console-ok');
        assert.equal(receipt.result.commandExplanation.steps[0].executable, 'printf');
        return { text: '콘솔 터미널 연결 완료', toolCalls: [], responseId: 'r2', responseModel: 'console-model' };
      },
    };
  };
  const errors = [];
  const revealed = [];
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'console-model' }),
    onError: (error) => errors.push(error),
    revealPath: async (path) => {
      revealed.push(path);
      return { openedPath: path, targetType: 'file' };
    },
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const html = await fetch(`${base}/`).then((response) => response.text());
    assert.match(html, /GPAO-T5/);
    assert.match(html, /path-links\.js/);
    const reveal = await fetch(`${base}/computer/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-t5-console-action': 'reveal' },
      body: JSON.stringify({ path: '/private/tmp/example.txt' }),
    }).then((response) => response.json());
    assert.equal(reveal.ok, true);
    assert.deepEqual(revealed, ['/private/tmp/example.txt']);
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const start = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '터미널 연결을 확인해줘' }),
    }).then((response) => response.json());
    assert.ok(start.streamId);
    const stream = await fetch(`${base}/turn/stream?sessionId=${created.id}&streamId=${start.streamId}`)
      .then((response) => response.text());
    assert.equal(errors.length, 0, errors[0]?.stack ?? errors[0]?.message);
    assert.match(stream, /event: trace_status/);
    assert.match(stream, /event: tool_progress/);
    assert.match(stream, /event: answer_delta/);
    assert.match(stream, /콘솔 터미널 연결 완료/);
    assert.match(stream, /event: complete/);

    const session = await fetch(`${base}/sessions/${created.id}`).then((response) => response.json());
    assert.equal(session.transcript.length, 2);
    assert.equal(session.transcript[0].role, 'user');
    assert.equal(session.transcript[1].result.reply, '콘솔 터미널 연결 완료');
    const listed = await fetch(`${base}/sessions`).then((response) => response.json());
    assert.equal(listed.sessions[0].turns, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔 모델이 장기 exec handle을 poll해 새 출력과 실제 완료를 관측한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-process-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => {
    let observed = '';
    return { async respond(input) {
      const last = input.messages.at(-1);
      if (last.role !== 'tool') return {
        text: '', responseId: 'start', responseModel: 'process-model',
        toolCalls: [{
          id: 'long-exec', name: 'exec',
          args: { command: "printf 'phase-1'; sleep 0.08; printf 'phase-2'", cwd: null },
        }],
      };
      const receipt = JSON.parse(last.content);
      if (receipt.requestedCall.name === 'exec') {
        assert.equal(receipt.result.state, 'running');
        observed += receipt.result.stdout;
        return {
          text: '', responseId: 'poll', responseModel: 'process-model',
          toolCalls: [{
            id: 'long-poll', name: 'process_control', args: {
              action: 'poll', processId: receipt.result.processId,
              cursor: receipt.result.cursor, input: null, end: null, waitMs: 200,
            },
          }],
        };
      }
      assert.equal(receipt.requestedCall.name, 'process_control');
      observed += receipt.result.stdout;
      if (receipt.result.state === 'running') return {
        text: '', responseId: 'poll-again', responseModel: 'process-model',
        toolCalls: [{
          id: `long-poll-${Date.now()}`, name: 'process_control', args: {
            action: 'poll', processId: receipt.result.processId,
            cursor: receipt.result.cursor, input: null, end: null, waitMs: 200,
          },
        }],
      };
      assert.equal(receipt.result.state, 'completed');
      assert.equal(observed, 'phase-1phase-2');
      assert.equal(receipt.result.processExitCode, 0);
      return {
        text: '장기 작업의 새 출력과 완료를 확인했습니다.', toolCalls: [],
        responseId: 'done', responseModel: 'process-model',
      };
    } };
  };
  const errors = [];
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory, processYieldMs: 20,
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'process-model' }),
    onError: (error) => errors.push(error),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '시간이 걸리는 작업을 끝까지 확인해줘' }),
    }).then((response) => response.json());
    assert.equal(errors.length, 0, errors[0]?.stack ?? errors[0]?.message);
    assert.equal(reply.reply, '장기 작업의 새 출력과 완료를 확인했습니다.');
    assert.equal(server.managedProcesses.list(created.id)[0].state, 'completed');
  } finally {
    await server.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔 취소는 실행 중인 자식 프로세스 트리를 실제로 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-console-cancel-process-'));
  const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace');
  const marker = join(workspace, 'should-not-exist.txt');
  await mkdir(workspace, { recursive: true });
  const modelFactory = () => ({
    async respond(input) {
      const last = input.messages.at(-1);
      if (last.role !== 'tool') return {
        text: '', toolCalls: [{
          id: 'cancel-exec', name: 'exec',
          args: { command: `(sleep 0.5; printf late > '${marker}') & wait`, cwd: null },
        }],
      };
      const receipt = JSON.parse(last.content);
      return {
        text: '', toolCalls: [{
          id: `cancel-poll-${Date.now()}`, name: 'process_control', args: {
            action: 'poll', processId: receipt.result.processId,
            cursor: receipt.result.cursor, input: null, end: null, waitMs: 30000,
          },
        }],
      };
    },
  });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory, processYieldMs: 20 });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const start = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id, text: '오래 걸리는 작업을 시작해줘' }),
    }).then((response) => response.json());
    const streamPromise = fetch(`${base}/turn/stream?sessionId=${created.id}&streamId=${start.streamId}`)
      .then((response) => response.text());
    for (let attempt = 0; attempt < 50 && !server.managedProcesses.list(created.id).length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(server.managedProcesses.list(created.id)[0]?.state, 'running');
    await fetch(`${base}/turn/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: created.id }),
    });
    const stream = await streamPromise;
    assert.match(stream, /멈췄어요/);
    assert.equal(server.managedProcesses.list(created.id)[0].state, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 550));
    const { access } = await import('node:fs/promises');
    await assert.rejects(() => access(marker));
  } finally {
    await server.managedProcesses.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
