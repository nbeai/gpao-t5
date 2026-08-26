import { createHash } from 'node:crypto';

import { makeRecordReference } from './record-reference.js';

const OBSERVED_SOURCE_KINDS = new Set([
  'local_file', 'web_source', 'connection_resource', 'channel_message',
]);
const OBSERVED_FIELDS = new Set([
  'sourceKind', 'sourceStore', 'sourceId', 'sourceRevision', 'sha256', 'occurredAt',
  'observedAt', 'sessionId', 'workId', 'subjectKeys', 'channel', 'trust', 'sensitivity',
  'coverage', 'availability',
]);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}

function sequence(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} sequence is invalid`);
  return value;
}

function eventDigest(event) {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

function common({
  sourceKind, sourceStore, sourceId, sourceRevision, sha256, occurredAt, observedAt,
  sessionId = null, workId = null, subjectKeys = [], channel = null,
  trust, sensitivity = 'personal', coverage = 'full', availability = 'available',
}) {
  if (trust == null) throw new TypeError('projection trust must come from current runtime provenance');
  return makeRecordReference({
    sourceKind, sourceStore, sourceId, sourceRevision, sha256, occurredAt,
    recordedAt: observedAt,
    scope: { sessionId, workId, subjectKeys, channel },
    trust, sensitivity, coverage, availability,
  });
}

export function projectConversationRecordReference({
  event: input, expectedSessionId, workId = null, channel = null, subjectKeys = [],
  trust, sensitivity = 'personal', coverage = 'full', availability = 'available', observedAt,
} = {}) {
  const event = record(input, 'conversation event');
  if (event.schema !== 't5.conversation-event.v1' || event.type !== 'message'
    || !event.messageId || !event.message) throw new TypeError('conversation source must be a message event');
  const sessionId = required(event.sessionId, 'conversation sessionId');
  if (expectedSessionId != null && sessionId !== String(expectedSessionId)) {
    throw new Error('foreign Session conversation source');
  }
  return common({
    sourceKind: 'conversation_message', sourceStore: 'conversation-ledger',
    sourceId: required(event.messageId, 'conversation messageId'),
    sourceRevision: sequence(event.sequence, 'conversation'), sha256: eventDigest(event),
    occurredAt: event.recordedAt, observedAt, sessionId, workId, channel, subjectKeys,
    trust, sensitivity, coverage, availability,
  });
}

export function projectRunRecordReference({
  event: input, runId: expectedRunId, sessionId: ownerSessionId, expectedSessionId = null,
  workId = null, channel = null, subjectKeys = [], trust, sensitivity = 'personal',
  coverage = 'full', availability = 'available', observedAt,
} = {}) {
  const event = record(input, 'run event');
  if (event.schema !== 't5.run-event.v1' || !event.type) throw new TypeError('invalid run event');
  const runId = required(expectedRunId, 'runId');
  if (event.runId !== runId) throw new Error('foreign Run event');
  const sessionId = required(ownerSessionId, 'run sessionId');
  if (expectedSessionId != null && sessionId !== String(expectedSessionId)) {
    throw new Error('foreign Session run source');
  }
  const revision = sequence(event.sequence, 'run');
  return common({
    sourceKind: 'run_event', sourceStore: 'run-ledger',
    sourceId: `${runId}:event:${revision}`, sourceRevision: revision,
    sha256: eventDigest(event), occurredAt: event.recordedAt, observedAt,
    sessionId, workId, channel, subjectKeys, trust, sensitivity, coverage, availability,
  });
}

export function projectWorkRecordReference({
  event: input, sessionId: ownerSessionId, workId: ownerWorkId, expectedWorkId = null,
  channel = null, subjectKeys = [], trust, sensitivity = 'personal', coverage = 'full',
  availability = 'available', observedAt,
} = {}) {
  const event = record(input, 'work event');
  if (event.schema !== 't5.work-event.v1' || !event.type) throw new TypeError('invalid work event');
  const sessionId = required(ownerSessionId, 'work sessionId');
  const workId = required(ownerWorkId, 'workId');
  if ((expectedWorkId != null && workId !== String(expectedWorkId))
    || (event.workId != null && String(event.workId) !== workId)) {
    throw new Error('foreign Work event');
  }
  const revision = sequence(event.sequence, 'work');
  return common({
    sourceKind: 'work_event', sourceStore: 'work-store',
    sourceId: `${workId}:event:${revision}`, sourceRevision: revision,
    sha256: eventDigest(event), occurredAt: event.recordedAt, observedAt,
    sessionId, workId, channel, subjectKeys, trust, sensitivity, coverage, availability,
  });
}

export function projectAttachmentRecordReference({
  record: input, expectedSessionId = null, workId = null, channel = null, subjectKeys = [],
  trust, sensitivity = 'personal', coverage = 'metadata_only', availability = 'available',
  observedAt,
} = {}) {
  const attachment = record(input, 'attachment record');
  const sessionId = required(attachment.sessionId, 'attachment sessionId');
  if (expectedSessionId != null && sessionId !== String(expectedSessionId)) {
    throw new Error('foreign Session attachment source');
  }
  if (!['input', 'output'].includes(attachment.direction)) {
    throw new TypeError('attachment direction is invalid');
  }
  const output = attachment.direction === 'output';
  const revision = output ? Number(attachment.artifactVersion ?? 1) : 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError('attachment source revision is invalid');
  }
  return common({
    sourceKind: output ? 'artifact' : 'attachment', sourceStore: 'attachment-store',
    sourceId: required(attachment.attachmentId, 'attachmentId'), sourceRevision: revision,
    sha256: attachment.sha256, occurredAt: attachment.createdAt, observedAt,
    sessionId, workId, channel, subjectKeys, trust, sensitivity, coverage, availability,
  });
}

export function projectObservedRecordReference(input = {}) {
  record(input, 'observed source metadata');
  for (const field of Object.keys(input)) {
    if (!OBSERVED_FIELDS.has(field)) {
      throw new TypeError(`observed source metadata has unknown field: ${field}`);
    }
  }
  if (!OBSERVED_SOURCE_KINDS.has(input.sourceKind)) {
    throw new TypeError('observed sourceKind is not supported by this adapter');
  }
  return common({
    sourceKind: input.sourceKind,
    sourceStore: required(input.sourceStore, 'observed sourceStore'),
    sourceId: required(input.sourceId, 'observed sourceId'),
    sourceRevision: input.sourceRevision ?? null,
    sha256: input.sha256 ?? null,
    occurredAt: input.occurredAt ?? null,
    observedAt: input.observedAt,
    sessionId: input.sessionId ?? null,
    workId: input.workId ?? null,
    subjectKeys: input.subjectKeys ?? [],
    channel: input.channel ?? null,
    trust: input.trust,
    sensitivity: input.sensitivity ?? 'personal',
    coverage: input.coverage ?? 'unknown',
    availability: input.availability ?? 'available',
  });
}
