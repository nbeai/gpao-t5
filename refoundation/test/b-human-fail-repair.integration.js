import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';
import { WorkStore } from '../src/work-store.js';

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('busy PNG와 source envelope은 prepare→commit 뒤 모델 한 message에 정확히 한 번 공급된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-b-r1-live-')); const workspace = join(room, 'workspace');
  await mkdir(workspace); let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let turn = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, modelFactory: () => ({
    async respond(input) {
      turn += 1;
      if (turn === 1) { entered(); await gate; return { text: '원래 결과', toolCalls: [] }; }
      if (turn === 2) {
        const projected = input.messages.filter((message) => String(message.content).includes('PNG만 함께 봐줘'));
        assert.equal(projected.length, 1); assert.equal(projected[0].modelAttachments.length, 1);
        assert.match(projected[0].content, /sender-42/u); assert.match(projected[0].content, /reply-7/u);
        return { text: '', toolCalls: [{ id: 'transition', name: 'work_transition', args: {
          decisions: [{ meaning: 'revise_current_work', schedule: 'within_current_work',
            cancelCurrent: false }],
        } }] };
      }
      return { text: 'PNG 범위를 반영했습니다.', toolCalls: [] };
    },
  }) });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const attachment = await server.attachmentStore.receive({ sessionId: session.id, originalName: 'fixture.png',
      declaredMime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') });
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '원래 작업' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
    await started;
    const response = await fetch(`${base}/turn/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
        text: 'PNG만 함께 봐줘', attachmentIds: [attachment.attachmentId], source: {
          channel: 'telegram', senderId: 'sender-42', sourceMessageId: 'message-9',
          replyIdentity: { messageId: 'reply-7' },
        } }) });
    const admitted = await response.json(); assert.equal(response.status, 202);
    const state = await server.workStore.read(); const input = state.inputs.find((item) => item.inputId === admitted.inputId);
    assert.equal(input.state, 'admitted'); assert.deepEqual(input.attachmentIds, [attachment.attachmentId]);
    assert.equal(input.source.senderId, 'sender-42'); assert.deepEqual(input.source.replyIdentity, { messageId: 'reply-7' });
    const linked = await server.attachmentStore.get({ sessionId: session.id, attachmentId: attachment.attachmentId });
    assert.equal(linked.links[0].inputId, admitted.inputId); assert.equal(linked.links[0].runId, null);
    release(); await stream;
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('attachment link 실패는 prepared input·Conversation message·live link를 남기지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-b-r1-abort-')); const workspace = join(room, 'workspace');
  await mkdir(workspace); const store = new AttachmentStore(join(room, 'attachments'));
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace, attachmentStore: store,
    modelFactory: () => ({ async respond() { entered(); await gate; return { text: 'done', toolCalls: [] }; } }) });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const attachment = await store.receive({ sessionId: session.id, originalName: 'fixture.png',
      declaredMime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') });
    const originalLink = store.link.bind(store); store.link = async () => { throw new Error('injected link failure'); };
    const first = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '원래 작업' }) }).then((response) => response.json());
    const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text()); await started;
    const failed = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '첨부 교정', attachmentIds: [attachment.attachmentId] }) });
    assert.equal(failed.status, 500); store.link = originalLink;
    const work = await server.workStore.read(); assert.equal(work.inputs.at(-1).state, 'aborted');
    assert.equal((await server.workStore.pendingInputs(session.id)).length, 0);
    assert.equal((await server.conversationLedger.read(session.id)).messages.some((message) => message.content === '첨부 교정'), false);
    assert.equal((await store.get({ sessionId: session.id, attachmentId: attachment.attachmentId })).links.length, 0);
    release(); await stream;
  } finally { release?.(); await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('Hand focus 뒤에도 work_completion이 남고 proposal·settlement가 같은 blocker digest를 쓴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-b-r4-live-')); const workspace = join(room, 'workspace'); await mkdir(workspace);
  let turn = 0; const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    modelFactory: () => ({ async respond(input) { turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'exec', name: 'exec', args: { command: 'pwd' } }] };
      if (turn === 2) { assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), true);
        return { text: '', toolCalls: [{ id: 'complete', name: 'work_completion', args: { outcome: 'achieved' } }] }; }
      return { text: '완료했습니다.', toolCalls: [] };
    } }) });
  const base = await listen(server);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '현재 폴더를 확인해줘' }) }).then((response) => response.json());
    const state = await server.workStore.read(); const proposal = state.proposals.find((item) => item.runId === result.runId);
    const settlement = state.events.find((event) => event.type === 'work_settled' && event.runId === result.runId);
    assert.equal(proposal.verifiedOutcome, 'achieved'); assert.equal(settlement.outcome, 'achieved');
    const run = await server.runLedger.read(result.runId); const settled = run.events.find((event) => event.type === 'work_settled');
    assert.equal(proposal.blockerDigest, settled.payload.blockerDigest);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('재시작은 완성된 prepared envelope만 exact inputId로 commit하고 부분 admission은 abort한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-b-r1-restart-')); const stateDir = join(room, 'state');
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const session = await new ConsoleSessionStore(stateDir).create();
  const conversations = new ConversationLedger(join(stateDir, 'conversations'));
  await conversations.ensure({ sessionId: session.id });
  const attachments = new AttachmentStore(join(stateDir, 'attachments'));
  const attachment = await attachments.receive({ sessionId: session.id, originalName: 'fixture.png',
    declaredMime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') });
  const works = new WorkStore(join(stateDir, 'work'));
  const complete = await works.prepareInputAdmission({ sessionId: session.id, messageId: 'message-complete',
    attachmentIds: [attachment.attachmentId] });
  await attachments.link({ sessionId: session.id, attachmentIds: [attachment.attachmentId],
    messageId: 'message-complete', inputId: complete.inputId });
  await conversations.appendMessage({ sessionId: session.id, messageId: 'message-complete',
    message: { role: 'user', content: '완성된 준비 입력' } });
  const partial = await works.prepareInputAdmission({ sessionId: session.id, messageId: 'message-partial' });
  const server = makeConsoleServer({ stateDir, workspace,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }) });
  try {
    const recovered = await server.recoverPreparedAdmissions();
    assert.deepEqual(recovered.map((item) => item.state).toSorted(), ['aborted', 'admitted']);
    const state = await server.workStore.read();
    assert.equal(state.inputs.find((item) => item.inputId === complete.inputId).state, 'admitted');
    assert.equal(state.inputs.find((item) => item.inputId === partial.inputId).state, 'aborted');
    assert.equal((await server.conversationLedger.read(session.id)).messages.some(
      (message) => message.content === '완성된 준비 입력'), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});
