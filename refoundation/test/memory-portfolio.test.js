import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryCandidateProjection, selectMemoryPortfolio, workingMemoryProjection,
  episodePointers, temporalMemoryCandidateProjection } from '../src/memory-portfolio.js';

test('자동 투영은 명시적 User Memory와 exact Work revision만 사용하고 의미 후보는 pointer로 남긴다', () => {
  const items = [
    { memoryId: 'coffee', kind: 'user', content: '사용자는 산미 있는 커피를 좋아한다.', subjects: ['커피'], alwaysRelevant: true },
    { memoryId: 'code', kind: 'user', content: '코드 답은 간결하게.', subjects: ['코드'] },
    { memoryId: 'old-work', kind: 'work', content: '예전 일', source: { workId: 'w', revision: 1 } },
    { memoryId: 'current-work', kind: 'work', content: '현재 일', source: { workId: 'w', revision: 2 } },
  ];
  assert.deepEqual(selectMemoryPortfolio({ items, currentWork: { workId: 'w', revision: 2 } })
    .map((item) => item.memoryId), ['coffee', 'current-work']);
  const candidate = memoryCandidateProjection(items);
  assert.match(candidate.content, /"memoryId":"code"/u); assert.doesNotMatch(candidate.content, /코드 답은/u);
});

test('프로젝트 subject는 프로그램 분석 요청에 런타임 의미 선택되지 않는다', () => {
  const items = [{ memoryId: 'project', kind: 'user', content: '프로젝트 기억', subjects: ['프로젝트'],
    subjectRevision: 1, sourceOrder: 1 }];
  assert.deepEqual(selectMemoryPortfolio({ items, request: '프로그램 분석' }), []);
  assert.match(memoryCandidateProjection(items).content, /프로젝트/u);
});

test('같은 subject 최신성은 서로 다른 Work revision이 아니라 subject revision과 source order를 쓴다', () => {
  const candidate = memoryCandidateProjection([
    { memoryId: 'old', kind: 'user', content: '길게', subjects: ['답변'],
      subjectRevision: 1, sourceOrder: 4, source: { workId: 'old-work', revision: 9 } },
    { memoryId: 'new', kind: 'user', content: '짧게', subjects: ['답변'],
      subjectRevision: 2, sourceOrder: 8, source: { workId: 'new-work', revision: 1 } },
  ]);
  assert.match(candidate.content, /"memoryId":"new"/u); assert.doesNotMatch(candidate.content, /"memoryId":"old"/u);
});

test('Working Memory와 Episode는 원문을 복제하지 않고 Work·Run·Message pointer만 남긴다', () => {
  const state = { works: [{ workId: 'w', revision: 2, status: 'active', sourceMessageId: 'm1' }],
    inputs: [{ inputId: 'i1', workId: 'w', state: 'classified' }],
    events: [{ type: 'work_settled', workId: 'w', revision: 1, outcome: 'achieved', runId: 'r1' }] };
  assert.deepEqual(workingMemoryProjection(state, 'w'), { workId: 'w', revision: 2,
    status: 'active', pendingInputIds: ['i1'] });
  assert.deepEqual(episodePointers(state), [{ workId: 'w', revision: 1, outcome: 'achieved',
    runId: 'r1', sessionId: null, sourceMessageId: 'm1', recordedAt: null }]);
  assert.doesNotMatch(JSON.stringify(episodePointers(state)), /content|text|receipt/u);
});

test('temporal Memory는 content 자동 주입 없이 current·historical·unknown pointer만 보인다', () => {
  const base = {
    kind: 'preference', subjectKey: 'subject-coffee', value: 'must not leak old coffee',
    scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
    sources: [{ scope: { channel: 'console' }, sensitivity: 'personal' }],
    recordedAt: '2026-08-20T00:00:00.000Z', validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z', subjectRevision: 1, sourceOrder: 1,
    status: 'active', supersedes: [], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: true,
  };
  const claims = [
    { ...base, memoryId: 'current' },
    { ...base, memoryId: 'historical', subjectKey: 'subject-old',
      validFrom: '2025-01-01T00:00:00.000Z', validTo: '2025-12-31T00:00:00.000Z' },
    { ...base, memoryId: 'unknown', subjectKey: 'subject-unknown', validTo: null },
  ];
  const message = temporalMemoryCandidateProjection(claims, {
    asOf: '2026-08-26T00:00:00.000Z', currentChannel: 'console', currentWork: null,
  });
  assert.match(message.content, /"memoryId":"current".*"temporalState":"current"/u);
  assert.match(message.content, /"memoryId":"historical".*"temporalState":"historical"/u);
  assert.match(message.content, /"memoryId":"unknown".*"temporalState":"temporal_unknown"/u);
  assert.doesNotMatch(message.content, /must not leak old coffee/u);
  assert.deepEqual(selectMemoryPortfolio({
    items: [{ memoryId: 'current', kind: 'user', content: 'must not inject', alwaysRelevant: true,
      temporal: { status: 'active' } }],
  }), []);
});

test('private temporal source는 다른 channel candidate surface에 나타나지 않는다', () => {
  const claims = [{
    memoryId: 'private-memory', kind: 'fact', subjectKey: 'private-subject', value: 'private value',
    scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
    sources: [{ scope: { channel: 'telegram' }, sensitivity: 'private' }],
    recordedAt: '2026-08-20T00:00:00.000Z', validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z', subjectRevision: 1, sourceOrder: 1,
    status: 'active', supersedes: [], conflictsWith: [], sensitivity: 'private', alwaysRelevant: false,
  }];
  assert.equal(temporalMemoryCandidateProjection(claims, {
    asOf: '2026-08-26T00:00:00.000Z', currentChannel: 'console', currentWork: null,
  }), null);
  assert.match(temporalMemoryCandidateProjection(claims, {
    asOf: '2026-08-26T00:00:00.000Z', currentChannel: 'telegram', currentWork: null,
  }).content, /private-memory/u);
});
