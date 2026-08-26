import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  projectAttachmentRecordReference,
  projectConversationRecordReference,
  projectObservedRecordReference,
  projectRunRecordReference,
  projectWorkRecordReference,
} from '../src/record-projection.js';

const NOW = '2026-08-26T03:00:00.000Z';
const root = new URL('../../', import.meta.url);

test('Conversation message shadow는 content를 복제하지 않고 exact event digest·scope를 남긴다', () => {
  const event = {
    schema: 't5.conversation-event.v1', sessionId: 'session-1', sequence: 2,
    recordedAt: '2026-08-26T02:00:00.000Z', type: 'message', messageId: 'message-1',
    message: { role: 'user', content: 'fixture private sentence' },
  };
  const reference = projectConversationRecordReference({
    event, expectedSessionId: 'session-1', workId: 'work-1', channel: 'console',
    trust: 'user_asserted', sensitivity: 'private', observedAt: NOW,
  });
  assert.equal(reference.sourceKind, 'conversation_message');
  assert.equal(reference.sourceStore, 'conversation-ledger');
  assert.equal(reference.sourceId, 'message-1');
  assert.equal(reference.sourceRevision, 2);
  assert.match(reference.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(reference.scope, {
    sessionId: 'session-1', workId: 'work-1', subjectKeys: [], channel: 'console',
  });
  assert.doesNotMatch(JSON.stringify(reference), /fixture private sentence/u);

  const changed = projectConversationRecordReference({
    event: { ...event, message: { ...event.message, content: 'changed' } },
    expectedSessionId: 'session-1', workId: 'work-1', channel: 'console',
    trust: 'user_asserted', sensitivity: 'private', observedAt: NOW,
  });
  assert.equal(changed.recordId, reference.recordId);
  assert.notEqual(changed.sha256, reference.sha256);
});

test('Conversation shadow는 foreign Session과 aborted/non-message 사건을 source로 승격하지 않는다', () => {
  const event = {
    schema: 't5.conversation-event.v1', sessionId: 'session-a', sequence: 3,
    recordedAt: NOW, type: 'message', messageId: 'message-a',
    message: { role: 'user', content: 'safe fixture' },
  };
  assert.throws(() => projectConversationRecordReference({
    event, expectedSessionId: 'session-b', trust: 'user_asserted', observedAt: NOW,
  }), /foreign Session/u);
  assert.throws(() => projectConversationRecordReference({
    event: { ...event, type: 'message_aborted' }, expectedSessionId: 'session-a',
    trust: 'user_asserted', observedAt: NOW,
  }), /message event/u);
});

test('Run event shadow는 Run·Session·Work scope와 event digest를 분리한다', () => {
  const event = {
    schema: 't5.run-event.v1', runId: 'run-1', sequence: 4, recordedAt: NOW,
    type: 'tool_completed', payload: { output: 'large untrusted fixture' },
  };
  const reference = projectRunRecordReference({
    event, runId: 'run-1', sessionId: 'session-1', expectedSessionId: 'session-1',
    workId: 'work-1', trust: 'external_untrusted', coverage: 'partial', observedAt: NOW,
  });
  assert.equal(reference.sourceKind, 'run_event');
  assert.equal(reference.sourceId, 'run-1:event:4');
  assert.equal(reference.sourceRevision, 4);
  assert.equal(reference.coverage, 'partial');
  assert.equal(reference.trust, 'external_untrusted');
  assert.doesNotMatch(JSON.stringify(reference), /large untrusted fixture/u);
});

test('Work event shadow는 append sequence를 identity revision으로 쓰고 의미 payload를 복제하지 않는다', () => {
  const event = {
    schema: 't5.work-event.v1', sequence: 9, recordedAt: NOW,
    type: 'work_settled', workId: 'work-1', outcome: 'achieved',
    internalResult: 'do not copy this result',
  };
  const reference = projectWorkRecordReference({
    event, sessionId: 'session-1', workId: 'work-1', expectedWorkId: 'work-1',
    trust: 'runtime_observed', observedAt: NOW,
  });
  assert.equal(reference.sourceKind, 'work_event');
  assert.equal(reference.sourceStore, 'work-store');
  assert.equal(reference.sourceId, 'work-1:event:9');
  assert.deepEqual(reference.scope, {
    sessionId: 'session-1', workId: 'work-1', subjectKeys: [], channel: null,
  });
  assert.doesNotMatch(JSON.stringify(reference), /do not copy this result/u);
  assert.throws(() => projectWorkRecordReference({
    event, sessionId: 'session-1', workId: 'work-1', expectedWorkId: 'work-2',
    trust: 'runtime_observed', observedAt: NOW,
  }), /foreign Work/u);
});

test('Attachment와 output artifact는 기존 content hash·version·ownership을 재사용한다', () => {
  const input = {
    attachmentId: 'attachment-1', sessionId: 'session-1', direction: 'input',
    sha256: 'c'.repeat(64), createdAt: '2026-08-26T01:00:00.000Z', links: [],
  };
  const inputRef = projectAttachmentRecordReference({
    record: input, expectedSessionId: 'session-1', trust: 'user_asserted', observedAt: NOW,
  });
  assert.equal(inputRef.sourceKind, 'attachment');
  assert.equal(inputRef.sourceRevision, 1);
  assert.equal(inputRef.sha256, input.sha256);

  const outputRef = projectAttachmentRecordReference({
    record: { ...input, direction: 'output', artifactVersion: 3 },
    expectedSessionId: 'session-1', workId: 'work-1', trust: 'runtime_observed', observedAt: NOW,
  });
  assert.equal(outputRef.sourceKind, 'artifact');
  assert.equal(outputRef.sourceRevision, 3);
  assert.equal(outputRef.scope.workId, 'work-1');
});

test('projection은 trust를 추측하지 않고 sensitivity 불확실 시 personal로 닫는다', () => {
  const event = {
    schema: 't5.run-event.v1', runId: 'run-1', sequence: 1, recordedAt: NOW,
    type: 'run_started', payload: {},
  };
  assert.throws(() => projectRunRecordReference({
    event, runId: 'run-1', sessionId: 'session-1', observedAt: NOW,
  }), /trust/u);
  const reference = projectRunRecordReference({
    event, runId: 'run-1', sessionId: 'session-1', trust: 'runtime_observed', observedAt: NOW,
  });
  assert.equal(reference.sensitivity, 'personal');
});

test('local file·Web·channel·connection은 원문 없는 observed metadata adapter 하나로 표현한다', () => {
  const web = projectObservedRecordReference({
    sourceKind: 'web_source', sourceStore: 'web-observation', sourceId: 'web-1',
    sourceRevision: null, sha256: null, occurredAt: null, observedAt: NOW,
    sessionId: 'session-1', trust: 'external_untrusted', coverage: 'partial',
  });
  assert.equal(web.sourceKind, 'web_source');
  assert.equal(web.availability, 'available');
  assert.equal(web.sensitivity, 'personal');

  const channel = projectObservedRecordReference({
    sourceKind: 'channel_message', sourceStore: 'telegram-ledger', sourceId: 'message-7',
    sourceRevision: 1, sha256: 'd'.repeat(64), occurredAt: NOW, observedAt: NOW,
    sessionId: 'session-1', channel: 'telegram:private', trust: 'user_asserted',
    sensitivity: 'private', coverage: 'full',
  });
  assert.equal(channel.scope.channel, 'telegram:private');

  const secret = projectObservedRecordReference({
    sourceKind: 'connection_resource', sourceStore: 'platform-secret-store',
    sourceId: 'secret-ref-1', sourceRevision: 1, sha256: null, occurredAt: null,
    observedAt: NOW, sessionId: 'session-1', trust: 'runtime_observed',
    sensitivity: 'secret_ref', coverage: 'metadata_only',
  });
  assert.equal(secret.sensitivity, 'secret_ref');

  assert.throws(() => projectObservedRecordReference({
    sourceKind: 'web_source', sourceStore: 'web-observation', sourceId: 'web-2',
    sourceRevision: null, sha256: null, occurredAt: null, observedAt: NOW,
    sessionId: 'session-1', trust: 'external_untrusted', coverage: 'partial',
    content: 'must not enter metadata adapter',
  }), /unknown field/u);
});

test('RecordRef shadow는 AgentLoop·Memory·Context·사용자 surface hot path에 아직 연결되지 않는다', async () => {
  assert.doesNotMatch(await readFile(new URL('refoundation/src/memory-ledger.js', root), 'utf8'),
    /record-projection/u, 'refoundation/src/memory-ledger.js');
  const hotPaths = [
    'refoundation/src/agent-loop.js',
    'refoundation/src/console-server.js',
    'refoundation/src/console-model-factory.js',
    'refoundation/src/conversation-projection.js',
    'refoundation/src/memory-portfolio.js',
  ];
  for (const path of hotPaths) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.doesNotMatch(source, /record-reference|record-projection/u, path);
  }
});
