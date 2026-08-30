import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { WorkStore } from '../src/work-store.js';

function settlementAware(respond) {
  let pendingFinal = null; let call = 0;
  return { async respond(input) {
    if (pendingFinal) { const response = pendingFinal; pendingFinal = null; return response; }
    const response = await respond(input);
    const handles = [...new Set(input.messages.flatMap((message) => (
      [...String(message.content ?? '').matchAll(/inputHandle=(busy_[A-Za-z0-9_-]{8,80})/gu)]
        .map((match) => match[1])
    )))];
    const completionAvailable = input.tools.some((tool) => tool.name === 'work_completion');
    if (handles.length && completionAvailable && response.toolCalls.length === 0
      && String(response.text ?? '').trim()) {
      pendingFinal = response; call += 1;
      return { text: '', toolCalls: [{ id: `fixture-settlement-${call}`, name: 'work_completion',
        args: { outcome: 'unresolved', inputSettlements: handles.map((handle) => (
          { handle, disposition: 'answered' }
        )) } }] };
    }
    return response;
  } };
}

function fixtureFactory(respond, decision = 'steer_current') {
  return (context) => context.purpose === 'transition_decision' ? { async respond(input) {
    const payload = JSON.parse(input.messages[0].content);
    const selected = typeof decision === 'function' ? decision(payload) : { choice: decision };
    return { text: '', toolCalls: [{ id: 'fixture-transition', name: 'transition_decision', args: {
      choice: selected.choice, targetHandle: selected.targetHandle ?? null,
      currentWorkDisposition: selected.currentWorkDisposition ?? null,
    } }] };
  } } : settlementAware(respond);
}

test('실행 중 같은 대화의 새 발화는 의미 판단 전 Conversation·Work에 durable admission된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-turn-admission-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let modelTurn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    modelTurn += 1;
    if (modelTurn === 1) {
      assert.equal(input.tools.some((tool) => tool.name === 'work_control'), false);
      entered(); await gate; return { text: '첫 작업 완료', toolCalls: [] };
    }
    if (modelTurn === 2) {
      assert.equal(input.tools.some((tool) => tool.name === 'work_control'), false);
      assert.equal(input.toolChoice?.requiredToolName, undefined);
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      assert.match(admitted.content, /"objective":"첫 작업"/u);
      assert.match(admitted.content, /"resultDeliveryAtAdmission":"not_delivered"/u);
      return { text: '교정을 반영해 완료했습니다.', toolCalls: [] };
    }
    throw new Error('unexpected extra model turn');
  }) });
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
    assert.equal(classifiedInput.disposition, 'current_work'); assert.equal(classifiedInput.state, 'executed');
    const canonical = await server.conversationLedger.read(session.id);
    assert.equal(canonical.messages.some((message) => message.role === 'assistant'
      && message.content === '첫 작업 완료'), false);
    const runs = await server.runLedger.list({ sessionId: session.id });
    assert.equal(runs[0].events.some((event) => event.type === 'model_superseded_by_admission'), true);
    const publication = classified.results.find((item) => item.runId === runs[0].runId);
    assert.equal(publication.state, 'delivery_terminal');
    const publicationEvents = classified.events.filter((event) => event.runId === runs[0].runId
      && ['result_ready_pending_surface', 'result_surface_persisted', 'result_delivery_terminal'].includes(event.type));
    assert.deepEqual(publicationEvents.map((event) => event.type), [
      'result_ready_pending_surface', 'result_surface_persisted', 'result_delivery_terminal',
    ]);
    const completed = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    assert.deepEqual(completed.transcript.filter((entry) => entry.role === 'user').map((entry) => entry.text),
      ['첫 작업', '왜 못하고 있지?']);
  } finally {
    release?.(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('콘솔은 서버 접수 성공 뒤에만 사용자 말풍선을 만들고 busy 입력을 보존한다', async () => {
  const html = await readFile(new URL('../../refoundation/ui/index.html', import.meta.url), 'utf8');
  const submit = html.slice(html.indexOf('async function submit()'), html.indexOf('function renderRecovery'));
  assert.ok(submit.indexOf('await startTurn(') < submit.indexOf("const box = turnBox()"));
  assert.match(submit, /turnStart\.admitted[\s\S]*반영하도록 받았어요/u);
  assert.ok(submit.lastIndexOf("text.value = ''") > submit.indexOf("const box = turnBox()"));
});

test('최초 stream-start 성공 전에 Conversation·input admission이 durable하게 결속된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-initial-stream-admission-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const server = makeConsoleServer({ stateDir, workspace, workAdmissionMode: 'action-v1',
    modelFactory: fixtureFactory(async () => ({ text: '재개된 최초 요청 완료', toolCalls: [] })) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const response = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
      'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
      text: 'S6-WA 최초 요청', attachmentIds: [] }) });
    assert.equal(response.status, 200); const started = await response.json(); assert.ok(started.streamId);
    const conversation = await server.conversationLedger.read(session.id);
    assert.equal(conversation.messages.some((message) => message.role === 'user'
      && message.content === 'S6-WA 최초 요청'), true);
    const state = await server.workStore.read();
    assert.equal(state.works.length, 0, 'direct input does not create Work before a Hand is needed');
    assert.equal(state.inputs.length, 1); assert.equal(state.inputs[0].state, 'admitted');
    assert.equal((await server.sessionStore.load(session.id)).transcript[0].text, 'S6-WA 최초 요청');
    const stream = await fetch(`${base}/turn/stream?streamId=${started.streamId}`);
    await stream.text();
    const settled = await server.workStore.read();
    assert.equal(settled.inputs[0].state, 'executed'); assert.equal(settled.works.length, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('stream-start ACK 뒤 SSE 전 Runtime 재시작은 같은 최초 input을 한 번만 재개한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-initial-stream-restart-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const first = makeConsoleServer({ stateDir, workspace, workAdmissionMode: 'action-v1',
    modelFactory: fixtureFactory(async () => { throw new Error('pre-restart runtime must not execute'); }) });
  await new Promise((resolve, reject) => { first.once('error', reject); first.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${first.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  const started = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
    'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
    text: 'ACK 뒤 재시작 요청', attachmentIds: [] }) });
  assert.equal(started.status, 200); await new Promise((resolve) => first.close(resolve));
  let calls = 0; const successor = makeConsoleServer({ stateDir, workspace, workAdmissionMode: 'action-v1',
    modelFactory: fixtureFactory(async () => { calls += 1; return { text: '재개 완료', toolCalls: [] }; }) });
  try {
    await successor.recoverPreparedAdmissions(); await successor.resumeQueuedWork();
    await successor.closeWorkspaceConnections();
    const state = await successor.workStore.read();
    assert.equal(calls, 1); assert.equal(state.inputs.length, 1);
    assert.equal(state.inputs[0].state, 'executed'); assert.equal(state.works.length, 0);
    const conversation = await successor.conversationLedger.read(session.id);
    assert.deepEqual(conversation.messages.map((message) => message.content), ['ACK 뒤 재시작 요청', '재개 완료']);
  } finally {
    await successor.closeMessengers();
    await new Promise((resolve) => successor.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('현재 Work에 제시된 교정 중 provider 실패도 한 failure surface로 닫고 자동 반복하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-presented-provider-failure-terminal-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let mainCalls = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelStatus: () => ({
    connected: true, provider: 'fixture', modelId: 'fixture-model',
  }), modelFactory: fixtureFactory(async () => {
    mainCalls += 1;
    if (mainCalls === 1) { entered(); await gate; return { text: '폐기될 첫 답', toolCalls: [] }; }
    if (mainCalls === 2) throw Object.assign(new Error('provider private detail'), {
      status: 400, code: 'http_400',
    });
    throw new Error('presented failure input must not retry automatically');
  }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
      'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
      text: '초안을 만들어줘', attachmentIds: [] }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
      'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
      text: '형식만 간결하게 고쳐줘', attachmentIds: [] }) }).then((response) => response.json());
    release(); await stream;
    let state; let input;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
      if (input?.state === 'executed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'executed'); assert.equal(input.settlementDisposition, 'answered');
    assert.equal(mainCalls, 2); assert.equal((await server.workStore.queuedInputs(session.id)).length, 0);
    const failures = state.results.filter((item) => item.surfaceResult?.failure?.failure?.stage === 'model_response');
    assert.equal(failures.length, 1);
    assert.equal(state.events.filter((event) => event.type === 'input_failure_surface_claimed'
      && event.inputId === admitted.inputId).length, 1);
  } finally {
    release?.(); await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('현재 결과 선 delivery가 명시된 extension만 exact 새 Run으로 한 번 실행된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-followup-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '첫 작업 결과', toolCalls: [] }; }
    assert.equal(input.messages.filter((message) => String(message.content)
      .includes('현재 요약은 먼저 전달하고, 별도 응답에서 비교표를 작성해줘')).length, 1);
    return { text: '후속 표 정리를 완료했습니다.', toolCalls: [] };
  }, 'followup_after_delivery') });
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
    release(); await stream;
    let state; let input;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const sessionState = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      const workState = await server.workStore.read();
      const workInput = workState.inputs.find((item) => item.inputId === admitted.inputId);
      if (JSON.stringify(sessionState).includes('후속 표 정리를 완료') && workInput?.state === 'executed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.disposition, 'deferred_after_delivery'); assert.equal(input.schedule, 'after_current_delivery');
    assert.equal(input.state, 'executed');
    assert.equal(state.events.filter((event) => event.type === 'input_execution_claimed'
      && event.inputId === input.inputId).length, 1);
  } finally {
    release?.(); await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('after-delivery 입력의 provider 실패도 exact surface 뒤 executed로 닫고 자동 재실행하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-followup-provider-failure-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let mainCalls = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelStatus: () => ({
    connected: true, provider: 'fixture', modelId: 'fixture-model',
  }), modelFactory: fixtureFactory(async () => {
    mainCalls += 1;
    if (mainCalls === 1) { entered(); await gate; return { text: '먼저 전달할 결과', toolCalls: [] }; }
    if (mainCalls === 2) throw Object.assign(new Error('provider raw SECRET'), {
      status: 400, code: 'http_400',
    });
    throw new Error('failed admitted input must not run again automatically');
  }, 'followup_after_delivery') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sessionId: session.id, text: '먼저 이 결과를 만들어줘', attachmentIds: [],
      }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sessionId: session.id, text: '이 답 뒤에 별도 확인도 해줘', attachmentIds: [],
      }) }).then((response) => response.json());
    release(); await stream;
    let state; let input;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
      if (input?.state === 'executed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'executed'); assert.equal(input.settlementDisposition, 'answered');
    assert.equal(state.events.filter((event) => event.type === 'input_execution_claimed'
      && event.inputId === admitted.inputId).length, 1);
    assert.equal(mainCalls, 2);
    const failure = state.results.find((item) => item.runId === input.executionRunId);
    assert.equal(failure.state, 'delivery_terminal');
    assert.equal(failure.surfaceResult.failure.failure.stage, 'model_response');
    assert.equal(failure.surfaceResult.failure.recovery.automaticRetryAllowed, false);
    const canonical = await server.conversationLedger.read(session.id);
    const failureMessages = canonical.messages.filter((message) => message.role === 'assistant'
      && /응답을 만드는 단계에서 중단/u.test(message.content));
    assert.equal(failureMessages.length, 1);
    assert.doesNotMatch(JSON.stringify(failure.surfaceResult), /SECRET|provider raw/u);
  } finally {
    release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('after-delivery와 independent 입력이 함께 들어와도 각 exact Work를 한 번씩 순서대로 실행한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-mixed-exact-scheduling-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let mainCalls = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    mainCalls += 1;
    if (mainCalls === 1) { entered(); await gate; return { text: '첫 결과', toolCalls: [] }; }
    const userText = input.messages.filter((message) => message.role === 'user')
      .map((message) => message.content).join('\n');
    if (mainCalls === 2) {
      assert.match(userText, /결과 뒤 후속 확인/u); assert.doesNotMatch(userText, /별도 새 작업/u);
      return { text: '후속 확인 결과', toolCalls: [] };
    }
    if (mainCalls === 3) {
      assert.match(userText, /별도 새 작업/u);
      return { text: '독립 작업 결과', toolCalls: [] };
    }
    throw new Error('mixed inputs must execute exactly once each');
  }, (payload) => String(payload.admittedInput?.text).includes('결과 뒤 후속 확인')
    ? { choice: 'followup_after_delivery' }
    : { choice: 'new_work', currentWorkDisposition: 'pause' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
      'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
      text: '긴 첫 작업', attachmentIds: [] }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const follow = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
      'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
      text: '결과 뒤 후속 확인을 해줘', attachmentIds: [] }) }).then((response) => response.json());
    const independent = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: {
      'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
      text: '별도 새 작업도 시작해줘', attachmentIds: [] }) }).then((response) => response.json());
    release(); await stream;
    let state; let followInput; let independentInput;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      state = await server.workStore.read();
      followInput = state.inputs.find((item) => item.inputId === follow.inputId);
      independentInput = state.inputs.find((item) => item.inputId === independent.inputId);
      if (followInput?.state === 'executed' && independentInput?.state === 'executed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(followInput.state, 'executed'); assert.equal(independentInput.state, 'executed');
    assert.notEqual(followInput.workId, independentInput.workId); assert.equal(mainCalls, 3);
    for (const input of [followInput, independentInput]) {
      const claim = state.claims.find((item) => item.runId === input.executionRunId);
      assert.equal(claim.workId, input.workId); assert.equal(claim.revision, input.revision);
      assert.equal(state.events.filter((event) => event.type === 'input_execution_claimed'
        && event.inputId === input.inputId).length, 1);
    }
    const replies = state.results.map((result) => result.surfaceResult?.reply ?? '');
    assert.ok(replies.some((text) => text.includes('후속 확인 결과')), JSON.stringify(replies));
    assert.ok(replies.some((text) => text.includes('독립 작업 결과')), JSON.stringify(replies));
  } finally {
    release?.(); await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('현재 Work 확장은 같은 Work·Run에서 추가 결과까지 만들고 input을 executed로 닫는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-extend-inline-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '검토 초안', toolCalls: [] }; }
    if (turn === 2) {
      const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
      assert.ok(admitted); return { text: '검토 결과\n\n리스크 목록: R1, R2', toolCalls: [] };
    }
    throw new Error('unexpected extra model turn');
  }) });
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
    assert.equal(input.disposition, 'current_work');
    assert.equal(input.state, 'executed'); assert.equal(state.works.length, 1); assert.equal(state.works[0].revision, 2);
    assert.equal((await server.runLedger.list({ sessionId: session.id })).length, 1);
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('independent 전환은 현재 Run을 completion 없이 닫고 새 Work를 별도 Run에서 exact-once 실행한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-independent-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '기존 작업 중간 상태', toolCalls: [] }; }
    return { text: '새 일정 확인 결과: SCHEDULE-731', toolCalls: [] };
  }, 'new_work') });
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
      const work = await server.workStore.read();
      const current = work.inputs.find((item) => item.inputId === admitted.inputId);
      if (JSON.stringify(view).includes('SCHEDULE-731') && current?.state === 'executed') break;
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

test('cancel은 process와 Work를 끝내고 proposal 없는 busy input을 executed로 승격하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-cancel-console-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create(); const processes = new ManagedProcessRegistry({ stopGraceMs: 50, killGraceMs: 100 });
  const child = await processes.start({ program: '/bin/sh', args: ['-lc', 'sleep 30'], cwd: workspace,
    env: process.env, ownerId: session.id, waitMs: 10, metadata: { kind: 'managed', originRunId: null } });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const errors = [];
  const server = makeConsoleServer({ stateDir, workspace, processRegistry: processes,
    modelFactory: fixtureFactory(async () => {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: '진행 중', toolCalls: [] }; }
    throw new Error('cancelled run must not call the main model again');
  }, 'cancel'), onError: (error) => errors.push(error) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '긴 작업을 진행해줘' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '이 작업을 중단해줘' }) }).then((response) => response.json());
    release(); const wire = await stream; assert.match(wire, /"kind":"cancelled"/u,
      errors.map((error) => error?.stack ?? error?.message).join('\n'));
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'cancelled'); assert.equal(input.schedule, null);
    assert.equal(input.resultDigest, undefined); assert.equal(state.works[0].status, 'cancelled');
    assert.equal(state.proposals.length, 0); assert.equal(processes.list(session.id)[0].state, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const view = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    const cancelledSurface = view.transcript.filter((entry) => entry.role === 'assistant');
    assert.equal(cancelledSurface.length, 1);
    assert.equal(cancelledSurface[0].result.kind, 'cancelled');
    assert.match(cancelledSurface[0].result.reply, /취소했어요/u);
    assert.equal('runId' in cancelledSurface[0].result, false);
    const cancelledRunId = state.cancellations[0].runId;
    assert.equal(state.claims.find((claim) => claim.runId === cancelledRunId)?.state, 'released');
    const releaseEvent = state.events.find((event) => event.type === 'execution_released'
      && event.runId === cancelledRunId);
    const terminalEvent = state.events.find((event) => event.type === 'work_cancellation_settled'
      && event.runId === cancelledRunId);
    assert.ok(releaseEvent.sequence < terminalEvent.sequence);
    assert.equal(processes.claimTerminalWake(child.processId), null);
  } finally { release?.(); await processes.stopAll('test_cleanup');
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('result ready 뒤 surface crash는 모델·도구 재실행 없이 exact 결과를 재시작 복구한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-result-ready-recovery-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); let modelCalls = 0;
  const modelFactory = () => ({ async respond() {
    modelCalls += 1; return { text: 'RECOVERED-SURFACE-731', toolCalls: [] };
  } });
  const firstServer = makeConsoleServer({ stateDir, workspace, modelFactory });
  await new Promise((resolve, reject) => { firstServer.once('error', reject); firstServer.listen(0, '127.0.0.1', resolve); });
  const firstBase = `http://127.0.0.1:${firstServer.address().port}`;
  const session = await fetch(`${firstBase}/sessions`, { method: 'POST' }).then((response) => response.json());
  const originalAppend = firstServer.sessionStore.append.bind(firstServer.sessionStore); let injected = false;
  firstServer.sessionStore.append = async (sessionId, entry) => {
    if (!injected && entry?.role === 'assistant') { injected = true; throw new Error('injected surface failure'); }
    return originalAppend(sessionId, entry);
  };
  const failed = await fetch(`${firstBase}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '복구할 결과를 만들어줘' }) });
  assert.equal(failed.status, 500);
  let state = await firstServer.workStore.read(); const ready = state.results.at(-1);
  assert.equal(ready.state, 'pending_surface'); assert.equal(ready.surfaceResult.reply, 'RECOVERED-SURFACE-731');
  assert.equal((await firstServer.sessionStore.load(session.id)).transcript.filter(
    (entry) => entry.role === 'assistant').length, 0);
  await new Promise((resolve) => firstServer.close(resolve));

  const secondServer = makeConsoleServer({ stateDir, workspace, modelFactory });
  try {
    await secondServer.recoverResultPublications();
    const recovered = await secondServer.sessionStore.load(session.id);
    assert.equal(recovered.transcript.filter((entry) => entry.role === 'assistant').length, 1);
    assert.equal(recovered.transcript.find((entry) => entry.role === 'assistant').result.reply,
      'RECOVERED-SURFACE-731');
    state = await secondServer.workStore.read(); assert.equal(state.results.at(-1).state, 'delivery_terminal');
    assert.equal(modelCalls, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('achieved 제안은 result ready와 surface delivery 뒤에만 Work terminal이 되고 crash 뒤 exact 정산된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-result-ready-settlement-recovery-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let modelCalls = 0;
  const modelFactory = fixtureFactory(async () => {
    modelCalls += 1;
    if (modelCalls === 1) return { text: '', toolCalls: [{
      id: 'completion-before-crash', name: 'work_completion',
      args: { outcome: 'achieved', inputSettlements: [] },
    }] };
    if (modelCalls === 2) return { text: '정확한 완료 결과 842', toolCalls: [] };
    throw new Error('recovery must not rerun the model');
  });
  const firstServer = makeConsoleServer({ stateDir, workspace, modelFactory });
  await new Promise((resolve, reject) => {
    firstServer.once('error', reject); firstServer.listen(0, '127.0.0.1', resolve);
  });
  const firstBase = `http://127.0.0.1:${firstServer.address().port}`;
  const session = await fetch(`${firstBase}/sessions`, { method: 'POST' }).then((response) => response.json());
  const originalAppend = firstServer.sessionStore.append.bind(firstServer.sessionStore); let injected = false;
  firstServer.sessionStore.append = async (sessionId, entry) => {
    if (!injected && entry?.role === 'assistant') {
      injected = true; throw new Error('injected surface persistence crash');
    }
    return originalAppend(sessionId, entry);
  };
  const failed = await fetch(`${firstBase}/turn`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '정확한 완료 결과를 만들어줘' }) });
  assert.equal(failed.status, 500);
  let state = await firstServer.workStore.read();
  assert.equal(state.results.at(-1).state, 'pending_surface');
  assert.equal(state.results.at(-1).objectiveOutcome, 'achieved');
  assert.equal(state.works[0].status, 'active');
  assert.equal(state.events.some((event) => event.type === 'work_settled'), false);
  assert.equal(state.claims.at(-1).state, 'active');
  await new Promise((resolve) => firstServer.close(resolve));

  const secondServer = makeConsoleServer({ stateDir, workspace, modelFactory });
  try {
    await secondServer.recoverResultPublications();
    const recovered = await secondServer.sessionStore.load(session.id);
    assert.equal(recovered.transcript.filter((entry) => entry.role === 'assistant').length, 1);
    assert.equal(recovered.transcript.find((entry) => entry.role === 'assistant').result.reply,
      '정확한 완료 결과 842');
    state = await secondServer.workStore.read();
    assert.equal(state.results.at(-1).state, 'delivery_terminal');
    assert.equal(state.works[0].status, 'completed');
    assert.equal(state.events.filter((event) => event.type === 'work_settled').length, 1);
    assert.equal(modelCalls, 2);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('외부 delivery dispatch 뒤 crash는 재시작에서 blind resend 없이 unknown terminal로 닫힌다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-delivery-unknown-recovery-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create({ origin: { channel: 'telegram', chatId: 'fixture-chat' } });
  const works = new WorkStore(join(stateDir, 'work')); const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const surfaceResult = { kind: 'reply', reply: 'DELIVERY-UNKNOWN-731', runId };
  await works.recordResultReady({ runId, sessionId: session.id, objectiveOutcome: 'achieved',
    resultDigest: 'digest-731', surfaceResult });
  await sessions.append(session.id, { role: 'assistant', result: surfaceResult });
  await works.markResultSurfacePersisted(runId);
  await works.markResultDeliveryStarted(runId, { provider: 'telegram', state: 'started' });
  let sends = 0;
  const server = makeConsoleServer({ stateDir, workspace,
    messengerProviderFactory: () => ({ id: 'telegram', async sendReply() { sends += 1; return { sent: true }; } }),
    modelFactory: () => ({ async respond() { throw new Error('model must not run'); } }) });
  try {
    await server.recoverResultPublications(); const state = await server.workStore.read();
    assert.equal(state.results[0].state, 'delivery_terminal');
    assert.equal(state.results[0].delivery.state, 'unknown'); assert.equal(sends, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('tool 실행 중 admission은 시작한 Hand만 정산하고 아직 시작하지 않은 tail을 실행하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-tool-boundary-admission-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); let turn = 0;
  const effect = { kind: 'local_change', summary: '격리 fixture 변경', targets: [workspace],
    reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null };
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [
      { id: 'first-tool', name: 'exec', args: { command: "touch tool-started; sleep 0.2; printf FIRST", cwd: null, effect } },
      { id: 'stale-tail', name: 'exec', args: { command: 'touch stale-tail', cwd: null, effect } },
    ] };
    const admitted = input.messages.find((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
    assert.ok(admitted); return { text: '새 입력을 반영해 마쳤습니다.', toolCalls: [] };
  }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '두 단계를 실행해줘' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { await readFile(join(workspace, 'tool-started')); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
    }
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        sessionId: session.id, text: '두 번째 단계는 하지 말고 여기서 정리해줘',
      }) }).then((response) => response.json());
    await stream;
    await assert.rejects(() => readFile(join(workspace, 'stale-tail')), /ENOENT/u);
    const runs = await server.runLedger.list({ sessionId: session.id }); const run = runs[0];
    const receipts = run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt);
    assert.equal(receipts.find((item) => item.toolCallId === 'first-tool').outcome, 'succeeded');
    const skipped = receipts.find((item) => item.toolCallId === 'stale-tail');
    assert.equal(skipped.outcome, 'not_executed'); assert.equal(skipped.result.executionStarted, false);
    const state = await server.workStore.read();
    assert.equal(state.inputs.find((item) => item.inputId === admitted.inputId).state, 'executed');
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('같은 boundary 전에 admission된 A·B·C는 순서 보존 한 model call·동일 R+1로 적용된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-mailbox-batch-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); let turn = 0;
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: 'STALE-BATCH', toolCalls: [] }; }
    const presented = input.messages.filter((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
    assert.deepEqual(presented.map((message) => message.content.split('\n').at(-1)), [
      '계약서 범위로 확인해', '견적서도 함께 포함해', '금액은 세금 포함으로 계산해',
    ]);
    return { text: '계약서·견적서·세금 포함 금액을 함께 반영했습니다.', toolCalls: [] };
  }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '자료를 검토해' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const admitted = [];
    for (const text of ['계약서 범위로 확인해', '견적서도 함께 포함해', '금액은 세금 포함으로 계산해']) {
      admitted.push(await fetch(`${base}/turn/stream-start`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text }) })
        .then((response) => response.json()));
    }
    await release(); const wire = await stream; assert.match(wire, /세금 포함/u);
    const state = await server.workStore.read(); assert.equal(state.works[0].revision, 2);
    assert.deepEqual(admitted.map((item) => state.inputs.find((input) => input.inputId === item.inputId).state),
      ['executed', 'executed', 'executed']);
    assert.equal(state.events.filter((event) => event.type === 'execution_claimed' && event.revision === 2).length, 1);
    const view = await server.sessionStore.load(session.id);
    assert.equal(view.transcript.filter((entry) => entry.role === 'assistant').length, 1);
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('A·B model call 중 C admission은 미적용 A·B·C 전체를 재제시하고 stale tool 효과를 막는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-mailbox-rebatch-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); let turn = 0;
  let firstEntered; const firstStarted = new Promise((resolve) => { firstEntered = resolve; });
  let firstRelease; const firstGate = new Promise((resolve) => { firstRelease = resolve; });
  let batchEntered; const batchStarted = new Promise((resolve) => { batchEntered = resolve; });
  let batchRelease; const batchGate = new Promise((resolve) => { batchRelease = resolve; });
  const effect = { kind: 'local_change', summary: 'stale fixture', targets: [workspace],
    reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null };
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async (input) => {
    turn += 1;
    if (turn === 1) { firstEntered(); await firstGate; return { text: 'STALE-INITIAL', toolCalls: [] }; }
    if (turn === 2) { batchEntered(); await batchGate; return { text: '', toolCalls: [{
      id: 'stale-after-ab', name: 'exec', args: { command: 'touch stale-after-ab', cwd: null, effect },
    }] }; }
    const presented = input.messages.filter((message) => /T5 NEWLY ADMITTED USER MESSAGE/u.test(message.content));
    assert.deepEqual(presented.map((message) => message.content.split('\n').at(-1)), ['A 조건', 'B 조건', 'C 최종 조건']);
    return { text: 'A·B·C 최종 조건을 반영했습니다.', toolCalls: [] };
  }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '초기 작업' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await firstStarted;
    const ids = [];
    for (const text of ['A 조건', 'B 조건']) ids.push((await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text }) }).then((r) => r.json())).inputId);
    firstRelease(); await batchStarted;
    ids.push((await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: 'C 최종 조건' }) }).then((r) => r.json())).inputId);
    batchRelease(); await stream;
    await assert.rejects(() => readFile(join(workspace, 'stale-after-ab')), /ENOENT/u);
    const state = await server.workStore.read(); assert.equal(state.works[0].revision, 2);
    assert.deepEqual(ids.map((id) => state.inputs.find((input) => input.inputId === id).state),
      ['executed', 'executed', 'executed']);
    const runs = await server.runLedger.list({ sessionId: session.id });
    assert.equal(runs[0].events.filter((event) => event.type === 'model_superseded_by_admission').length, 2);
    assert.equal(runs[0].events.some((event) => event.type === 'tool_started'
      && event.payload?.toolCallId === 'stale-after-ab'), false);
  } finally { firstRelease?.(); batchRelease?.();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('resume_paused_work는 exact Work를 R+1로 재개하고 별도 Run exact-once로 실행한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-resume-paused-console-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create(); const works = new WorkStore(join(stateDir, 'work'));
  const paused = await works.create({ sessionId: session.id, sourceMessageId: 'paused-source' });
  await works.setStatus({ workId: paused.workId, expectedRevision: 1, status: 'paused' });
  const current = await works.create({ sessionId: session.id, sourceMessageId: 'current-source' });
  let turn = 0; let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async () => {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: 'CURRENT-STALE', toolCalls: [] }; }
    return { text: '재개 작업 결과 RESUMED-884', toolCalls: [] };
  }, (payload) => ({ choice: 'resume_paused',
    targetHandle: payload.pausedCandidates.find((item) => item.title.includes('이전 보고서'))?.handle,
    currentWorkDisposition: 'pause' })) });
  await server.conversationLedger.ensure({ sessionId: session.id, legacyMessages: [] });
  await server.conversationLedger.appendMessage({ sessionId: session.id, messageId: 'paused-source',
    runId: 'paused-visible-run', message: { role: 'user', content: '이전 보고서를 이어서 완성해' } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '현재 새 작업을 진행해' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '현재 일은 두고 이전 작업을 다시 이어가줘' }) })
      .then((response) => response.json());
    release(); await stream;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const view = await server.sessionStore.load(session.id);
      const state = await server.workStore.read();
      const input = state.inputs.find((item) => item.inputId === admitted.inputId);
      if (JSON.stringify(view).includes('RESUMED-884') && input?.state === 'executed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(state.works.length, 2); assert.equal(state.works.find((item) => item.workId === current.workId).status, 'paused');
    const resumed = state.works.find((item) => item.workId === paused.workId);
    assert.equal(resumed.status, 'active'); assert.equal(resumed.revision, 2);
    assert.equal(input.workId, paused.workId); assert.equal(input.state, 'executed');
    assert.equal((await server.runLedger.list({ sessionId: session.id })).length, 2);
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('followup input은 surface 전 pending이고 exact surface receipt 뒤에만 executed가 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-input-pending-surface-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace); let turn = 0;
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const modelGate = new Promise((resolve) => { release = resolve; });
  let publishing; const publishStarted = new Promise((resolve) => { publishing = resolve; });
  let allowSurface; const surfaceGate = new Promise((resolve) => { allowSurface = resolve; });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: fixtureFactory(async () => {
    turn += 1; if (turn === 1) { entered(); await modelGate; return { text: 'STALE', toolCalls: [] }; }
    return { text: 'PENDING-SURFACE-RESULT-731', toolCalls: [] };
  }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const originalAppend = server.sessionStore.append.bind(server.sessionStore);
    server.sessionStore.append = async (sessionId, entry) => {
      if (entry?.role === 'assistant') { publishing(); await surfaceGate; }
      return originalAppend(sessionId, entry);
    };
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '초기 작업' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '현재 작업에 이 요구를 반영해' }) }).then((response) => response.json());
    release(); await publishStarted;
    let state = await server.workStore.read(); let input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'completed_pending_surface');
    assert.equal(state.results.at(-1).state, 'pending_surface');
    assert.equal(state.events.some((event) => event.type === 'input_executed' && event.inputId === input.inputId), false);
    allowSurface(); await stream;
    state = await server.workStore.read(); input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'executed'); assert.equal(input.surfaceReceipt.runId, input.completionRunId);
    assert.equal(input.surfaceReceipt.resultDigest, input.resultDigest);
    const types = state.events.filter((event) => event.inputId === input.inputId
      || (event.runId === input.completionRunId && event.type === 'result_surface_persisted'))
      .map((event) => event.type);
    assert.ok(types.indexOf('input_completed_pending_surface') < types.indexOf('result_surface_persisted'));
    assert.ok(types.indexOf('result_surface_persisted') < types.indexOf('input_executed'));
  } finally { release?.(); allowSurface?.();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('현재 Telegram delivery ACK가 unknown이면 after-delivery input을 다음 Run으로 조기 활성화하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-deferred-after-failed-delivery-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const sessions = new ConsoleSessionStore(stateDir);
  const session = await sessions.create({ origin: { channel: 'telegram', chatId: 'owner-chat' } });
  let turn = 0; let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let followupRuns = 0;
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: '77', username: 'fixture_bot' }; },
    async sendReply() { const error = new Error('ack unavailable'); error.code = 'telegram_delivery_unknown';
      error.effectUnknown = true; error.retrySafe = false; throw error; },
  };
  const server = makeConsoleServer({ stateDir, workspace, messengerProviderFactory: () => provider,
    modelFactory: fixtureFactory(async () => {
      turn += 1;
      if (turn === 1) { entered(); await gate; return { text: 'STALE', toolCalls: [] }; }
      followupRuns += 1; return { text: '후속 작업이 조기 실행됐습니다.', toolCalls: [] };
    }, 'followup_after_delivery'),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await server.messengerGateway.connect({ provider: 'telegram', token: 'fixture-token' });
    await server.messengerStateStore.bind('telegram', 'owner-chat', session.id);
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '먼저 결과를 만들어줘' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '첫 답을 전달한 뒤 다음 답에서 표를 만들어줘' }) })
      .then((response) => response.json());
    release(); await stream; await new Promise((resolve) => setTimeout(resolve, 100));
    const state = await server.workStore.read();
    const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(state.results[0].delivery.state, 'unknown');
    assert.equal(input.state, 'scheduled');
    assert.equal(input.baseRevision, 1);
    assert.equal(input.deferredByRunId, state.results[0].runId);
    assert.equal(followupRuns, 0);
    assert.equal((await server.runLedger.list({ sessionId: session.id })).length, 1);
  } finally {
    release?.(); await server.closeMessengers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
