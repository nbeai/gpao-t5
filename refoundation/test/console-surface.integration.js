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
