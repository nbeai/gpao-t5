import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server, room) {
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true, maxRetries: 20, retryDelay: 10 });
}

test('QH-3 projection red: independent busy input과 control output은 old Work surface에서 철회된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh3-projection-independent-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const mainProviderSawBusy = [];
  const busyText = '앞 작업과 섞지 말고 다른 일로 새로 시작해. NEW_PURPOSE_731을 결과에 넣어.';
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: (context) => (
    context.purpose === 'transition_decision' ? { async respond(input) {
      assert.deepEqual(input.tools.map((tool) => tool.name), ['transition_decision']);
      return { text: 'not published', toolCalls: [{ id: 'decision', name: 'transition_decision', args: {
        choice: 'new_work', targetHandle: null, currentWorkDisposition: 'pause',
      } }] };
    } } : { async respond(input) {
    turn += 1;
    mainProviderSawBusy.push(input.messages.some((message) => String(message.content ?? '').includes(busyText)));
    if (turn === 1) { entered(); await gate; return { text: 'BASE_RESULT_731', toolCalls: [] }; }
    return { text: 'NEW_WORK_RESULT NEW_PURPOSE_731', toolCalls: [] };
  } }) });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '현재 안내문에 BASE_RESULT_731을 넣어 작성해' })
    }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const admitted = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: busyText }) }).then((response) => response.json());
    release(); await stream;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await server.workStore.read();
      if (state.inputs.find((input) => input.inputId === admitted.inputId)?.state === 'executed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const view = await server.sessionStore.load(session.id);
    const surfaces = view.transcript.filter((entry) => entry.role === 'assistant')
      .map((entry) => entry.result?.reply ?? '');
    assert.equal(surfaces.length, 2);
    assert.match(surfaces[0], /BASE_RESULT_731/u);
    assert.doesNotMatch(surfaces[0], /NEW_PURPOSE_731/u);
    assert.match(surfaces[1], /NEW_PURPOSE_731/u);
    assert.deepEqual(mainProviderSawBusy, [false, true]);
    const canonical = await server.conversationLedger.read(session.id);
    assert.equal(canonical.entries.some((entry) => entry.message?.content === busyText), true);
    assert.equal(canonical.entries.some((entry) => entry.message?.toolCalls
      ?.some((call) => call.name === 'transition_decision')), false);
    const runs = await server.runLedger.list({ sessionId: session.id });
    assert.equal(runs.some((candidate) => candidate.events.some((event) => (
      event.type === 'transition_decision_completed' && event.payload.choice === 'new_work'
    ))), true);
  } finally { release?.(); await close(server, room); }
});

test('QH-3 projection red: visible paused Work는 raw ID 없는 bounded opaque candidate로 투영된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh3-paused-candidate-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  let projected = false;
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: (context) => (
    context.purpose === 'transition_decision' ? { async respond(input) {
      const payload = JSON.parse(input.messages[0].content);
      const candidate = payload.pausedCandidates.find((item) => item.title.includes('PAUSED_VISIBLE_OBJECTIVE'));
      projected = Boolean(candidate) && !/workId|revision/u.test(input.messages[0].content);
      return { text: 'not published', toolCalls: [{ id: 'resume-decision', name: 'transition_decision', args: {
        choice: candidate ? 'resume_paused' : 'ambiguous', targetHandle: candidate?.handle ?? null,
        currentWorkDisposition: 'pause',
      } }] };
    } } : { async respond(input) {
    turn += 1;
    if (turn === 1) { entered(); await gate; return { text: 'CURRENT_BASE', toolCalls: [] }; }
    return { text: 'resume candidate checked', toolCalls: [] };
  } }) });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    await server.conversationLedger.ensure({ sessionId: session.id, legacyMessages: [] });
    await server.conversationLedger.appendMessage({ sessionId: session.id, messageId: 'paused-visible-source',
      runId: 'visible-prior-run', message: { role: 'user', content: 'PAUSED_VISIBLE_OBJECTIVE 보고서를 이어서 완성해' } });
    await server.sessionStore.append(session.id, { role: 'user', text: 'PAUSED_VISIBLE_OBJECTIVE 보고서를 이어서 완성해' });
    const paused = await server.workStore.create({ sessionId: session.id, sourceMessageId: 'paused-visible-source' });
    await server.workStore.setStatus({ workId: paused.workId, expectedRevision: paused.revision, status: 'paused' });
    await server.workStore.create({ sessionId: session.id, sourceMessageId: 'current-visible-source' });
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '현재 임시 메모를 작성해' })
    }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id,
        text: '현재 것은 두고 PAUSED_VISIBLE_OBJECTIVE 보고서를 다시 이어가' }) });
    release(); await stream;
    assert.equal(projected, true);
  } finally { release?.(); await close(server, room); }
});
