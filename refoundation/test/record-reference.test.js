import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDurableMemorySourceSet,
  makeRecordReference,
  validateRecordReference,
} from '../src/record-reference.js';

const base = (overrides = {}) => ({
  sourceKind: 'conversation_message',
  sourceStore: 'conversation-ledger',
  sourceId: 'message-17',
  sourceRevision: 4,
  sha256: 'a'.repeat(64),
  occurredAt: '2026-08-26T02:03:04.000Z',
  recordedAt: '2026-08-26T02:03:05.000Z',
  scope: {
    sessionId: 'session-1',
    workId: 'work-2',
    subjectKeys: ['person:owner'],
    channel: 'console',
  },
  trust: 'user_asserted',
  sensitivity: 'personal',
  coverage: 'full',
  availability: 'available',
  ...overrides,
});

test('RecordRef는 canonical source identity에서 recordId를 만들고 원문을 복제하지 않는다', () => {
  const reference = makeRecordReference(base());
  assert.match(reference.recordId, /^rr_[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(reference).sort(), [
    'availability', 'coverage', 'occurredAt', 'recordId', 'recordedAt', 'scope',
    'sensitivity', 'sha256', 'sourceId', 'sourceKind', 'sourceRevision', 'sourceStore',
    'trust',
  ].sort());
  assert.equal('content' in reference, false);
  assert.equal('text' in reference, false);
  assert.equal('value' in reference, false);
  assert.deepEqual(validateRecordReference(reference), reference);
});

test('stable identity는 source kind·store·id·revision만 사용하고 revision 변화는 새 identity다', () => {
  const first = makeRecordReference(base());
  const observationChanged = makeRecordReference(base({
    sha256: 'b'.repeat(64),
    recordedAt: '2026-08-27T02:03:05.000Z',
    trust: 'runtime_observed',
    availability: 'changed',
  }));
  const revisionChanged = makeRecordReference(base({ sourceRevision: 5 }));
  assert.equal(first.recordId, observationChanged.recordId);
  assert.notEqual(first.recordId, revisionChanged.recordId);
});

test('unknown digest·time·availability는 0이나 available로 꾸미지 않고 그대로 보존한다', () => {
  const reference = makeRecordReference(base({
    sha256: null,
    occurredAt: null,
    coverage: 'unknown',
    availability: 'unknown',
  }));
  assert.equal(reference.sha256, null);
  assert.equal(reference.occurredAt, null);
  assert.equal(reference.coverage, 'unknown');
  assert.equal(reference.availability, 'unknown');
});

test('RecordRef closed contract는 raw content·임의 enum·깨진 digest·scope 확장을 거부한다', () => {
  assert.throws(() => makeRecordReference({ ...base(), content: 'raw secret' }), /unknown field/u);
  assert.throws(() => makeRecordReference(base({ sourceKind: 'model_note' })), /sourceKind/u);
  assert.throws(() => makeRecordReference(base({ sha256: 'ABC' })), /sha256/u);
  assert.throws(() => makeRecordReference(base({ trust: 'probably_owner' })), /trust/u);
  assert.throws(() => makeRecordReference(base({
    scope: { ...base().scope, tenantId: 'tenant-1' },
  })), /scope.*unknown field/u);
  assert.throws(() => makeRecordReference(base({
    scope: { ...base().scope, subjectKeys: ['person:owner', 'person:owner'] },
  })), /subjectKeys.*unique/u);
});

test('RecordRef는 exact ISO time·bounded identity·자기 canonical recordId를 요구한다', () => {
  assert.throws(() => makeRecordReference(base({ recordedAt: 'yesterday' })), /recordedAt/u);
  assert.throws(() => makeRecordReference(base({ sourceId: '' })), /sourceId/u);
  assert.throws(() => makeRecordReference(base({ sourceRevision: 1.2 })), /sourceRevision/u);
  const reference = makeRecordReference(base());
  assert.throws(() => validateRecordReference({ ...reference, recordId: `rr_${'0'.repeat(64)}` }),
    /recordId/u);
});

test('model inference나 external untrusted만으로 durable Memory source를 만들 수 없다', () => {
  const inferred = makeRecordReference(base({ trust: 'model_inferred' }));
  const external = makeRecordReference(base({ trust: 'external_untrusted' }));
  const user = makeRecordReference(base({ trust: 'user_asserted' }));
  assert.throws(() => assertDurableMemorySourceSet([]), /supporting source/u);
  assert.throws(() => assertDurableMemorySourceSet([inferred]), /model_inferred/u);
  assert.throws(() => assertDurableMemorySourceSet([external]), /external_untrusted/u);
  assert.deepEqual(assertDurableMemorySourceSet([inferred, user]), [inferred, user]);
});

test('secret reference는 원문이 아닌 runtime-observed metadata pointer로만 표현한다', () => {
  const secretRef = makeRecordReference(base({
    sourceKind: 'connection_resource',
    sourceStore: 'platform-secret-store',
    sourceId: 'secret-ref-7',
    sha256: null,
    trust: 'runtime_observed',
    sensitivity: 'secret_ref',
    coverage: 'metadata_only',
  }));
  assert.equal(secretRef.sensitivity, 'secret_ref');
  assert.throws(() => makeRecordReference(base({ sensitivity: 'secret_ref' })), /secret_ref/u);
});
