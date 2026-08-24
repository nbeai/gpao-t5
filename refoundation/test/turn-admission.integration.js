import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';

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
      assert.deepEqual(input.tools.map((tool) => tool.name), ['work_transition']);
      assert.equal(input.toolChoice.requiredToolName, 'work_transition');
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      assert.match(admitted.content, /"objective":"첫 작업"/u);
      assert.match(admitted.content, /"resultDeliveryAtAdmission":"not_delivered"/u);
      return { text: '', toolCalls: [{ id: 'classify', name: 'work_transition', args: {
        decisions: [{ meaning: 'revise_current_work', schedule: 'within_current_work',
          cancelCurrent: false }],
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
    const classifiedInput = classified.inputs.find((input) => input.inputId === second.inputId);
    assert.equal(classifiedInput.meaning, 'revise_current_work'); assert.equal(classifiedInput.state, 'executed');
    const canonical = await server.conversationLedger.read(session.id);
    assert.equal(canonical.messages.some((message) => message.role === 'assistant'
      && message.content === '첫 작업 완료'), false);
    const runs = await server.runLedger.list({ sessionId: session.id });
    assert.equal(runs[0].events.some((event) => event.type === 'model_superseded_by_admission'), true);
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

test('현재 결과 선 delivery가 명시된 extension만 exact 새 Run으로 한 번 실행된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-followup-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  let classified; const classifiedPromise = new Promise((resolve) => { classified = resolve; });
  let deliver; const deliveryGate = new Promise((resolve) => { deliver = resolve; });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '첫 작업 결과', toolCalls: [] }; }
    if (turn === 2) {
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      return { text: '', toolCalls: [{ id: 'followup', name: 'work_transition', args: {
        decisions: [{ meaning: 'extend_current_work', schedule: 'after_current_delivery',
          cancelCurrent: false }],
      } }] };
    }
    if (turn === 3) { classified(); await deliveryGate;
      return { text: '첫 작업을 마치고 후속을 이어갈게요.', toolCalls: [] }; }
    assert.equal(input.messages.filter((message) => String(message.content)
      .includes('현재 요약은 먼저 전달하고, 별도 응답에서 비교표를 작성해줘')).length, 1);
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
      body: JSON.stringify({ sessionId: session.id,
        text: '현재 요약은 먼저 전달하고, 별도 응답에서 비교표를 작성해줘', attachmentIds: [] }) }).then((response) => response.json());
    release(); await classifiedPromise;
    let state = await server.workStore.read(); let input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(state.works[0].revision, 1); assert.equal(input.state, 'scheduled'); assert.equal(input.baseRevision, 1);
    deliver(); await stream;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const sessionState = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      if (JSON.stringify(sessionState).includes('후속 표 정리를 완료')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.meaning, 'extend_current_work'); assert.equal(input.schedule, 'after_current_delivery');
    assert.equal(input.state, 'executed');
    assert.equal(state.events.filter((event) => event.type === 'input_execution_claimed'
      && event.inputId === input.inputId).length, 1);
  } finally {
    release?.(); deliver?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('현재 Work 확장은 같은 Work·Run에서 추가 결과까지 만들고 input을 executed로 닫는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-extend-inline-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '검토 초안', toolCalls: [] }; }
    if (turn === 2) {
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      return { text: '', toolCalls: [{ id: 'extend', name: 'work_transition', args: {
        decisions: [{ meaning: 'extend_current_work', schedule: 'within_current_work',
          cancelCurrent: false }],
      } }] };
    }
    assert.equal(input.messages.filter((message) => String(message.content)
      .includes('범위는 유지하고 산출물 맨 뒤에 리스크 목록을 포함해줘')).length, 1);
    return { text: '검토 결과\n\n리스크 목록: R1, R2', toolCalls: [] };
  } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '자료를 검토해줘' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
        text: '범위는 유지하고 산출물 맨 뒤에 리스크 목록을 포함해줘' }) }).then((response) => response.json());
    release(); const wire = await stream; assert.match(wire, /리스크 목록: R1, R2/u);
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.meaning, 'extend_current_work'); assert.equal(input.schedule, 'within_current_work');
    assert.equal(input.state, 'executed'); assert.equal(state.works.length, 1); assert.equal(state.works[0].revision, 2);
    assert.equal((await server.runLedger.list({ sessionId: session.id })).length, 1);
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('independent 전환은 현재 Run을 completion 없이 닫고 새 Work를 별도 Run에서 exact-once 실행한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-independent-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '기존 작업 중간 상태', toolCalls: [] }; }
    if (turn === 2) return { text: '', toolCalls: [{ id: 'independent', name: 'work_transition', args: {
      decisions: [{ meaning: 'start_independent_work', schedule: 'independent_work', cancelCurrent: false }],
    } }] };
    if (turn === 3) {
      assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
      return { text: '기존 작업은 두고 새 요청으로 전환했습니다.', toolCalls: [] };
    }
    return { text: '새 일정 확인 결과: SCHEDULE-731', toolCalls: [] };
  } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '기존 자료를 검토해줘' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '그 검토는 유지하고 별도 일정 확인을 시작해줘' }) })
      .then((response) => response.json());
    release(); await stream;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const view = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      if (JSON.stringify(view).includes('SCHEDULE-731')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'executed'); assert.equal(state.works.length, 2);
    assert.equal(state.works[0].status, 'paused'); assert.notEqual(state.works[0].workId, state.works[1].workId);
    const runs = await server.runLedger.list({ sessionId: session.id }); assert.equal(runs.length, 2);
    const origin = runs.find((run) => run.runId !== input.executionRunId);
    assert.equal(origin.events.some((event) => event.type === 'tool_completed'
      && event.payload?.receipt?.requestedCall?.name === 'work_completion'), false);
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('cancel은 process와 Work를 끝내고 completion proposal 없이 중단 surface 하나만 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-cancel-console-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create(); const processes = new ManagedProcessRegistry({ stopGraceMs: 50, killGraceMs: 100 });
  const child = await processes.start({ program: '/bin/sh', args: ['-lc', 'sleep 30'], cwd: workspace,
    env: process.env, ownerId: session.id, waitMs: 10, metadata: { kind: 'managed', originRunId: null } });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, processRegistry: processes, modelFactory: () => ({ async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '진행 중', toolCalls: [] }; }
    if (turn === 2) return { text: '', toolCalls: [{ id: 'cancel', name: 'work_transition', args: {
      decisions: [{ meaning: 'cancel_current_work', schedule: 'stop', cancelCurrent: false }],
    } }] };
    assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
    return { text: '요청대로 중단했습니다.', toolCalls: [] };
  } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '긴 작업을 진행해줘' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이 작업을 중단해줘' }) }).then((response) => response.json());
    release(); const wire = await stream; assert.match(wire, /요청대로 중단했습니다/u);
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'executed'); assert.equal(state.works[0].status, 'cancelled');
    assert.equal(state.proposals.length, 0); assert.equal(processes.list(session.id)[0].state, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const view = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.equal(view.transcript.filter((entry) => entry.role === 'assistant').length, 1);
    assert.equal(processes.claimTerminalWake(child.processId), null);
  } finally { release?.(); await processes.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});
