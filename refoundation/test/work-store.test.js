import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WorkStore } from '../src/work-store.js';

test('WorkStore는 input admission·revision·proposal·settlement를 append-only identity로 보존한다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-store-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message-1' });
  const admitted = await store.admitInput({ sessionId: 'session', messageId: 'message-2', origin: 'console' });
  assert.equal(admitted.state, 'admitted');
  const revision = await store.classifyInput({ inputId: admitted.inputId, relation: 'steer',
    workId: work.workId, expectedRevision: 1 });
  assert.equal(revision.revision, 2);
  await store.claimExecution({ workId: work.workId, revision: 2, runId: 'run-1' });
  await store.proposeCompletion({ workId: work.workId, revision: 2, runId: 'run-1' });
  await store.settle({ workId: work.workId, revision: 2, outcome: 'achieved', runId: 'run-1' });
  const state = await store.read();
  assert.equal(state.works[0].status, 'completed');
  assert.equal(state.inputs[0].relation, 'steer');
  assert.deepEqual(state.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6]);
});

test('stale revision classification과 settlement는 최신 Work를 바꾸지 못한다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-stale-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message-1' });
  const first = await store.admitInput({ sessionId: 'session', messageId: 'message-2' });
  await store.classifyInput({ inputId: first.inputId, relation: 'steer', workId: work.workId, expectedRevision: 1 });
  const second = await store.admitInput({ sessionId: 'session', messageId: 'message-3' });
  await assert.rejects(() => store.classifyInput({ inputId: second.inputId, relation: 'followup',
    workId: work.workId, expectedRevision: 1 }), /stale work revision/u);
  await assert.rejects(() => store.settle({ workId: work.workId, revision: 1,
    outcome: 'achieved', runId: 'old-run' }), /stale work revision/u);
  await store.claimExecution({ workId: work.workId, revision: 2, runId: 'current-run' });
  await assert.rejects(() => store.proposeCompletion({ workId: work.workId,
    revision: 2, runId: 'old-run' }), /execution claim mismatch/u);
});

test('durable input envelope은 Conversation pointer와 attachment·channel·sender·reply identity를 보존한다', async () => {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-envelope-')));
  const admitted = await store.admitInput({ sessionId: 'session', messageId: 'message',
    origin: 'telegram', attachmentIds: ['attachment-a', 'attachment-b'],
    source: { channel: 'telegram', senderId: 'owner', replyTo: 'message-previous' } });
  const input = (await store.read()).inputs.find((item) => item.inputId === admitted.inputId);
  assert.deepEqual(input.attachmentIds, ['attachment-a', 'attachment-b']);
  assert.deepEqual(input.source, { channel: 'telegram', senderId: 'owner', replyTo: 'message-previous' });
});
