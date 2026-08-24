import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('실행 중 같은 대화의 새 발화는 의미 판단 전 Conversation·Work에 durable admission된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-turn-admission-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let modelTurn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => ({ async respond(input) {
    modelTurn += 1;
    if (modelTurn === 1) {
      assert.equal(input.tools.some((tool) => tool.name === 'work_transition'), false);
      entered(); await gate; return { text: '첫 작업 완료', toolCalls: [] };
    }
    if (modelTurn === 2) {
      assert.equal(input.tools.some((tool) => tool.name === 'work_transition'), true);
      assert.equal(input.toolChoice.requiredToolName, 'work_transition');
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      const inputId = /inputId=([^\n]+)/u.exec(admitted.content)[1];
      return { text: '', toolCalls: [{ id: 'classify', name: 'work_transition', args: {
        decisions: [{ inputId, relation: 'steer', cancelCurrent: false }],
      } }] };
    }
    return { text: '교정을 반영해 완료했습니다.', toolCalls: [] };
  } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '첫 작업', attachmentIds: [] }),
    }).then((response) => response.json());
    const streamResponse = await fetch(`${base}/turn/stream?sessionId=${session.id}&streamId=${first.streamId}`);
    await started;
    const secondResponse = await fetch(`${base}/turn/stream-start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '왜 못하고 있지?', attachmentIds: [] }),
    });
    const second = await secondResponse.json();
    assert.equal(secondResponse.status, 202);
    assert.equal(second.admitted, true);
    assert.equal(second.state, 'pending_model_judgment');
    const during = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.equal(JSON.stringify(during).includes('왜 못하고 있지?'), true);
    const conversation = await server.conversationLedger.read(session.id);
    assert.equal(conversation.messages.some((message) => message.role === 'user'
      && message.content === '왜 못하고 있지?'), true);
    const work = await server.workStore.read();
    assert.equal(work.inputs.some((input) => input.inputId === second.inputId
      && input.state === 'admitted'), true);
    release(); await streamResponse.text();
    const classified = await server.workStore.read();
    assert.equal(classified.inputs.find((input) => input.inputId === second.inputId).relation, 'steer');
    const completed = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(completed.transcript.filter((entry) => entry.role === 'user').map((entry) => entry.text),
      ['첫 작업', '왜 못하고 있지?']);
  } finally {
    release?.(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔은 서버 접수 성공 뒤에만 사용자 말풍선을 만들고 busy 입력을 보존한다', async () => {
  const html = await readFile(new URL('../../src/surface/web/index.html', import.meta.url), 'utf8');
  const submit = html.slice(html.indexOf('async function submit()'), html.indexOf('function renderRecovery'));
  assert.ok(submit.indexOf('await startTurn(') < submit.indexOf("const box = turnBox()"));
  assert.match(submit, /turnStart\.admitted[\s\S]*반영하도록 받았어요/u);
  assert.ok(submit.lastIndexOf("text.value = ''") > submit.indexOf("const box = turnBox()"));
});

test('followup으로 분류된 admitted input은 현재 Run 정산 후 exact 새 Run으로 한 번 실행된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-followup-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '첫 작업 결과', toolCalls: [] }; }
    if (turn === 2) {
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      const inputId = /inputId=([^\n]+)/u.exec(admitted.content)[1];
      return { text: '', toolCalls: [{ id: 'followup', name: 'work_transition', args: {
        decisions: [{ inputId, relation: 'followup', cancelCurrent: false }],
      } }] };
    }
    if (turn === 3) return { text: '첫 작업을 마치고 후속을 이어갈게요.', toolCalls: [] };
    assert.equal(input.messages.filter((message) => String(message.content).includes('끝나면 표로도 정리해줘')).length, 1);
    return { text: '후속 표 정리를 완료했습니다.', toolCalls: [] };
  } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '첫 작업을 해', attachmentIds: [] }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?sessionId=${session.id}&streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '끝나면 표로도 정리해줘', attachmentIds: [] }) }).then((response) => response.json());
    release(); await stream;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const sessionState = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      if (JSON.stringify(sessionState).includes('후속 표 정리를 완료')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.relation, 'followup'); assert.equal(input.state, 'executed');
    assert.equal(state.events.filter((event) => event.type === 'input_execution_claimed'
      && event.inputId === input.inputId).length, 1);
  } finally {
    release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
