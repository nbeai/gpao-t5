import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeSettingsMemoryRecordReference, projectMemorySurface, projectReopenedSource,
} from '../src/memory-surface.js';

const reference = makeSettingsMemoryRecordReference({
  action: 'forget', memoryId: 'memory-1', now: '2026-08-27T00:00:00.000Z',
  makeId: () => 'action-1',
});

test('설정 행동 RecordRef는 복제하지 않은 HTTP body를 available source로 꾸미지 않는다', () => {
  assert.equal(reference.availability, 'unknown');
  assert.equal(reference.sha256, null);
  assert.equal(reference.coverage, 'metadata_only');
});

test('기억 표면은 current·history·forgotten을 한 projection으로 내고 raw event를 내지 않는다', () => {
  const claim = {
    memoryId: 'memory-1', kind: 'preference', subjectKey: 'coffee', value: 'light roast',
    status: 'active', validFrom: null, validTo: null, recordedAt: '2026-08-27T00:00:00.000Z',
    sensitivity: 'personal', sources: [reference],
  };
  const surface = projectMemorySurface({
    events: [{ type: 'memory_added', content: 'raw' }], claims: [claim], tombstones: [],
    items: [{ memoryId: 'memory-1', kind: 'user', content: claim.value }],
  });
  assert.deepEqual(surface.counts, { current: 1, history: 0, forgotten: 0 });
  assert.equal(surface.current[0].value, 'light roast');
  assert.equal(surface.current[0].sources[0].recordId, reference.recordId);
  assert.equal('events' in surface, false);
  assert.deepEqual(surface.legacy, []);
  assert.equal(surface.items[0].source, null);
  assert.equal('recordRefs' in surface.items[0], false);
  assert.equal('temporal' in surface.items[0], false);
});

test('사용자 출처 표면은 원본 대화 내용만 bounded projection으로 보여준다', () => {
  const result = projectReopenedSource({ ...reference, sourceKind: 'conversation_message' }, {
    state: 'reopened', source: { recordedAt: '2026-08-27T00:00:00.000Z',
      message: { role: 'user', content: '나는 산미 있는 커피를 좋아해.' } },
    accounting: { availability: 'available', digestMatched: true },
  });
  assert.equal(result.label, '대화');
  assert.equal(result.content, '나는 산미 있는 커피를 좋아해.');
  assert.equal(result.digestMatched, true);
  assert.equal('message' in result, false);
});

test('active forget tombstone은 history 표면에서 값·출처·subject를 다시 노출하지 않는다', () => {
  const surface = projectMemorySurface({ events: [], items: [], claims: [{
    memoryId: 'forgotten-memory', kind: 'preference', subjectKey: 'private.subject',
    value: 'PRIVATE_FORGOTTEN_VALUE', status: 'retracted', validFrom: null, validTo: null,
    recordedAt: '2026-08-27T00:00:00.000Z', sensitivity: 'private', sources: [reference],
  }], tombstones: [{ memoryId: 'forgotten-memory', requestId: 'forget-1',
    subjectKey: 'private.subject', reversibleUntil: null }] });
  assert.equal(surface.history[0].value, '내용을 지운 기억');
  assert.deepEqual(surface.history[0].sources, []);
  assert.equal(surface.history[0].sensitivity, null);
  assert.equal('subject' in surface.history[0], false);
  assert.doesNotMatch(JSON.stringify(surface), /PRIVATE_FORGOTTEN_VALUE|private\.subject/u);
});
