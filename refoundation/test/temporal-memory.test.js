import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { makeRecordReference } from '../src/record-reference.js';
import {
  makeMemoryClaim,
  selectMemoryClaimsAt,
} from '../src/temporal-memory.js';

const source = (id, trust = 'user_asserted') => makeRecordReference({
  sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: id,
  sourceRevision: 1, sha256: createHash('sha256').update(id).digest('hex'),
  occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
  scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
  trust, sensitivity: 'personal', coverage: 'full', availability: 'available',
});

const claim = (overrides = {}) => makeMemoryClaim({
  memoryId: 'memory-1', kind: 'preference', subjectKey: 'person:owner:coffee',
  value: 'prefers filter coffee',
  scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
  sources: [source('source-1')], recordedAt: '2026-08-26T00:01:00.000Z',
  validFrom: '2026-08-01T00:00:00.000Z', validTo: '2026-09-01T00:00:00.000Z',
  subjectRevision: 1, sourceOrder: 1, status: 'active', supersedes: [], conflictsWith: [],
  sensitivity: 'personal', alwaysRelevant: false,
  ...overrides,
});

const select = (claims, options = {}) => selectMemoryClaimsAt({
  claims, asOf: '2026-08-26T12:00:00.000Z',
  scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
  ...options,
});

test('recordedAt이 최신이어도 valid time이 과거면 current가 아니라 historical이다', () => {
  const current = claim({ memoryId: 'current', subjectRevision: 1, sourceOrder: 1 });
  const lateRecordedPast = claim({
    memoryId: 'past', value: 'preferred instant coffee',
    recordedAt: '2026-08-26T11:00:00.000Z', validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2025-12-31T23:59:59.000Z', subjectRevision: 2, sourceOrder: 2,
  });
  const result = select([current, lateRecordedPast]);
  assert.deepEqual(result.current.map((item) => item.memoryId), ['current']);
  assert.deepEqual(result.historical.map((item) => item.memoryId), ['past']);
});

test('retroactive correction은 valid-time 질문과 당시 knowledge-time 질문에서 다르게 보인다', () => {
  const correction = claim({
    memoryId: 'retroactive', recordedAt: '2026-08-20T00:00:00.000Z',
    validFrom: '2026-07-01T00:00:00.000Z', validTo: '2026-08-01T00:00:00.000Z',
  });
  const validTime = select([correction], { asOf: '2026-07-15T00:00:00.000Z' });
  assert.deepEqual(validTime.current.map((item) => item.memoryId), ['retroactive']);
  const knowledgeTime = select([correction], {
    asOf: '2026-07-15T00:00:00.000Z', knowledgeAsOf: '2026-07-15T00:00:00.000Z',
  });
  assert.deepEqual(knowledgeTime.current, []);
  assert.deepEqual(knowledgeTime.notYetRecorded.map((item) => item.memoryId), ['retroactive']);
});

test('validFrom·validTo null은 영구 current가 아니라 temporal unknown이다', () => {
  const unknownStart = claim({ memoryId: 'unknown-start', validFrom: null });
  const unknownEnd = claim({ memoryId: 'unknown-end', validTo: null, subjectKey: 'person:owner:tea' });
  const result = select([unknownStart, unknownEnd]);
  assert.deepEqual(result.current, []);
  assert.deepEqual(result.temporalUnknown.map((item) => item.memoryId), ['unknown-start', 'unknown-end']);
});

test('현재 Turn의 user correction은 stale stored active claim보다 우선한다', () => {
  const stale = claim({ memoryId: 'stale', value: 'prefers dark roast' });
  const correction = claim({
    memoryId: 'current-turn', value: 'prefers light roast', validFrom: null, validTo: null,
    subjectRevision: 2, sourceOrder: 2,
  });
  const result = select([stale], { currentCorrections: [correction] });
  assert.deepEqual(result.current.map((item) => item.memoryId), ['current-turn']);
  assert.deepEqual(result.overridden.map((item) => item.memoryId), ['stale']);
});

test('동명이인과 같은 값은 verified subjectKey가 다르면 합쳐지지 않는다', () => {
  const personA = claim({
    memoryId: 'alex-a', subjectKey: 'person:verified:a', value: 'Alex prefers tea',
    scope: { global: false, workId: null, projectId: null, personId: 'person:a', organizationId: null },
  });
  const personB = claim({
    memoryId: 'alex-b', subjectKey: 'person:verified:b', value: 'Alex prefers tea',
    scope: { global: false, workId: null, projectId: null, personId: 'person:b', organizationId: null },
  });
  const resultA = select([personA, personB], {
    scope: { global: false, workId: null, projectId: null, personId: 'person:a', organizationId: null },
  });
  assert.deepEqual(resultA.current.map((item) => item.memoryId), ['alex-a']);
});

test('같은 Work revision 숫자가 아니라 subjectRevision·sourceOrder가 latest를 정한다', () => {
  const old = claim({ memoryId: 'old', subjectRevision: 4, sourceOrder: 9 });
  const latest = claim({ memoryId: 'latest', subjectRevision: 5, sourceOrder: 2 });
  const result = select([latest, old]);
  assert.deepEqual(result.current.map((item) => item.memoryId), ['latest']);
  assert.deepEqual(result.overridden.map((item) => item.memoryId), ['old']);
});

test('disputed 또는 conflict claim은 current truth로 자동 주입하지 않는다', () => {
  const disputed = claim({ memoryId: 'disputed', status: 'disputed' });
  const conflict = claim({
    memoryId: 'conflict', subjectKey: 'person:owner:location', conflictsWith: ['other-memory'],
  });
  const result = select([disputed, conflict]);
  assert.deepEqual(result.current, []);
  assert.deepEqual(result.contested.map((item) => item.memoryId), ['disputed', 'conflict']);
});

test('timestamp는 timezone·DST 추측 없이 canonical UTC로 저장하고 restart에도 같은 projection이다', () => {
  assert.throws(() => claim({ recordedAt: '2026-11-01T01:30:00-04:00' }), /recordedAt/u);
  const claims = [claim()];
  const before = select(claims);
  const after = select(JSON.parse(JSON.stringify(claims)));
  assert.deepEqual(after, before);
});
