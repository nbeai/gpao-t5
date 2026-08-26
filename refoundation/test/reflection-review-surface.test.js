import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectReflectionReviewDetail,
  projectReflectionReviewList,
  projectReflectionReviewSource,
  reflectionReviewHandle,
  reflectionReviewRevisionHandle,
  reflectionReviewSourceHandle,
} from '../src/reflection-review-surface.js';

const internal = {
  reflection: 'reflection-internal-17', material: 'f'.repeat(64), candidate: 'e'.repeat(64),
  episode: 'episode-internal-1', work: 'work-internal-1', run: 'run-internal-1',
  objective: 'record-objective-internal', method: 'record-method-internal',
  effect: 'record-effect-internal', completion: 'record-completion-internal',
  counter: 'record-counter-internal', correction: 'record-correction-internal',
  memory: 'memory-internal', subject: 'subject-internal', scope: 'scope-internal',
  store: 'source-store-internal', source: 'source-id-internal', window: 'd'.repeat(64),
  mappedSession: 'mapped-session-internal', mappedWork: 'mapped-work-internal',
  mappedSubject: 'mapped-subject-internal', mappedChannel: 'mapped-channel-internal',
  mappedHead: '9'.repeat(64), mappedDigest: '8'.repeat(64),
};

function reference(recordId, sourceKind, order) {
  return { recordId, sourceKind, sourceStore: `${internal.store}-${order}`,
    sourceId: `${internal.source}-${order}`, sourceRevision: 1, sha256: String(order).repeat(64),
    occurredAt: '2026-08-27T00:00:00.000Z', recordedAt: '2026-08-27T00:00:00.000Z',
    scope: { sessionId: 'session-internal', workId: internal.work,
      subjectKeys: [internal.subject], channel: 'private-internal' },
    trust: sourceKind === 'conversation_message' ? 'user_asserted' : 'runtime_observed',
    sensitivity: 'personal', coverage: 'full', availability: 'available' };
}

function fixture(state = 'proposed') {
  const refs = [reference(internal.objective, 'conversation_message', 1),
    reference(internal.method, 'run_event', 2), reference(internal.effect, 'run_event', 3),
    reference(internal.completion, 'work_event', 4),
    reference(internal.counter, 'web_source', 5),
    reference(internal.correction, 'conversation_message', 6)];
  const accounting = refs.map((item) => ({ recordId: item.recordId,
    availability: 'available', digestMatched: true }));
  return { materializationDigest: internal.material,
    candidate: { candidateDigest: internal.candidate,
      candidate: { reflectionId: internal.reflection,
        hypothesis: `현재 결과를 확인한다. ${internal.work}은 표시하지 않는다. <script>alert(1)</script>`,
        sourceEpisodeIds: [internal.episode],
        sourceRecordIds: [internal.objective, internal.method, internal.effect, internal.completion],
        counterexampleRecordIds: [internal.counter], affectedScopes: [internal.scope],
        state, createdBy: 'background_reviewer', userConfirmed: false },
      episodes: [{ episodeId: internal.episode, workId: internal.work, workRevision: 1,
        runId: internal.run, resultDigest: 'c'.repeat(64), outcome: 'achieved', recordRoles: {
          objectiveRecordIds: [internal.objective], methodRecordIds: [internal.method],
          effectSettlementRecordIds: [internal.effect], completionRecordIds: [internal.completion],
        } }], recordRefs: refs,
      correctionHeads: [{ memoryId: internal.memory, subjectKey: internal.subject,
        subjectRevision: 2, sourceOrder: 8, status: 'active', sourceRecordIds: [internal.correction] }],
      correctionRelations: [{ memoryId: internal.memory, relation: 'preserved' }],
      counterexampleSearch: { state: 'found', recordIds: [internal.counter],
        sourceWindowDigest: internal.window },
      unknowns: [`다른 범위는 아직 모른다. ${internal.run}`],
      taint: { sourceTrusts: ['external_untrusted'], derivedByModel: true,
        externalUntrustedOrigin: true, sensitivityFloor: 'personal' },
      sourceFence: { windowDigest: internal.window,
        forgetHeads: [{ scopeHandle: internal.scope, epoch: 0,
          lastForgetRequestId: null, tombstoneDigest: null }] },
      projection: 'none', stateHistory: [{ from: null, to: 'proposed',
        sourceWindowDigest: internal.window }] },
    receipt: { schema: 't5.reflection-materialization-receipt.v2',
      affectedScopeHeads: [{ handle: internal.scope, sessionId: internal.mappedSession,
        workId: internal.mappedWork, subjectKeys: [internal.mappedSubject],
        channel: internal.mappedChannel, headDigest: internal.mappedHead }],
      affectedScopeDigest: internal.mappedDigest,
      reopenAccountingRecords: accounting, counterexampleSearch: { heads: [{
      handle: 'counter-head-internal', episodeId: 'counter-episode-internal',
      workId: 'counter-work-internal', runId: 'counter-run-internal',
      recordId: internal.counter, sourceRevision: 1, sha256: '5'.repeat(64),
    }] } }, materialization: { receipt: { reopenAccountingRecords: accounting } } };
}

const forbiddenKeys = /"(?:reflectionId|candidateDigest|materializationDigest|recordId|sourceId|sourceStore|workId|runId|episodeId|memoryId|subjectKey|sourceFence|taint|stateHistory|receipt)"|RecordRef/iu;
const forbiddenValues = () => Object.values(internal).filter((value) => typeof value === 'string');

test('list·detail은 opaque handles와 사람 문장만 내고 raw ID·digest·원장 계약을 노출하지 않는다', () => {
  const entry = fixture(); const list = projectReflectionReviewList([entry]);
  const detail = projectReflectionReviewDetail(entry); const serialized = JSON.stringify({ list, detail });
  assert.equal(list.items.length, 1); assert.equal(list.appliedCount, 0);
  assert.match(list.items[0].reviewHandle, /^review_[A-Za-z0-9_-]{22}$/u);
  assert.match(list.items[0].revisionHandle, /^revision_[A-Za-z0-9_-]{22}$/u);
  assert.doesNotMatch(serialized, forbiddenKeys);
  for (const value of forbiddenValues()) assert.equal(serialized.includes(value), false);
  assert.equal(detail.applied, false); assert.equal(detail.statusLabel, '검토 필요');
  assert.deepEqual(detail.actions, { retain: true, reject: true });
});

test('hypothesis·unknown 안의 known handle과 SHA는 숨기고 bounded data만 반환한다', () => {
  const entry = fixture(); entry.candidate.candidate.hypothesis = [internal.work,
    internal.mappedSession, internal.mappedWork, internal.mappedSubject, internal.mappedChannel,
    internal.mappedHead, internal.mappedDigest, 'x'.repeat(5_000)].join(' ');
  const detail = projectReflectionReviewDetail(entry);
  assert.match(detail.hypothesis, /\[식별 정보 숨김\]/u);
  assert.equal(detail.hypothesis.length <= 4_000, true);
  assert.doesNotMatch(JSON.stringify(detail), new RegExp(internal.work, 'u'));
  assert.equal(Object.hasOwn(detail, 'html'), false);
});

test('v2 scope receipt가 없으면 projection하지 않고 mapping 내부값을 전부 숨긴다', () => {
  const entry = fixture(); const detail = projectReflectionReviewDetail(entry);
  const serialized = JSON.stringify(detail);
  for (const value of [internal.mappedSession, internal.mappedWork, internal.mappedSubject,
    internal.mappedChannel, internal.mappedHead, internal.mappedDigest]) {
    assert.equal(serialized.includes(value), false);
  }
  const missing = fixture(); delete missing.receipt.affectedScopeHeads;
  assert.throws(() => projectReflectionReviewList([missing]), /v2 scope receipt/u);
});

test('지원 역할·반례·불확실성·현재 교정 관계를 합치거나 생략하지 않는다', () => {
  const detail = projectReflectionReviewDetail(fixture());
  assert.deepEqual(detail.support[0].sourceGroups.map((item) => item.label),
    ['사용자가 원한 것', '실제로 사용한 방법', '실행 결과', '완료 확인']);
  assert.ok(detail.support[0].sourceGroups.every((item) => item.sources.length === 1));
  assert.equal(detail.counterexamples.length, 1);
  assert.equal(detail.counterexamples[0].sources.length, 1);
  assert.equal(detail.uncertainties.length, 1);
  assert.match(detail.uncertainties[0], /식별 정보 숨김/u);
  assert.equal(detail.currentCorrections.length, 1);
  assert.equal(detail.currentCorrections[0].relation, 'marked_aligned');
  assert.match(detail.currentCorrections[0].relationLabel, /후보가/u);
  assert.deepEqual(detail.counts, { supportingExperiences: 1, supportingSources: 4,
    counterexamples: 1, uncertainties: 1, currentCorrections: 1 });
});

test('review는 revision에 따라 바뀌고 source handle은 role별 exact reference에 안정적으로 결속된다', () => {
  const proposed = fixture(); const reviewed = fixture('reviewed');
  reviewed.candidate.candidateDigest = 'b'.repeat(64);
  assert.equal(reflectionReviewHandle(proposed), reflectionReviewHandle(reviewed));
  assert.notEqual(reflectionReviewRevisionHandle(proposed), reflectionReviewRevisionHandle(reviewed));
  const sources = proposed.candidate.recordRefs.map((item) => reflectionReviewSourceHandle(proposed, item));
  assert.equal(new Set(sources).size, sources.length);
  assert.ok(sources.every((handle) => /^source_[A-Za-z0-9_-]{22}$/u.test(handle)));
});

test('duplicate entry handle과 duplicate source handle은 합치지 않고 fail closed한다', () => {
  const entry = fixture();
  assert.throws(() => projectReflectionReviewList([entry, structuredClone(entry)]),
    /list handles must be unique/u);
  const duplicateSource = fixture();
  duplicateSource.candidate.recordRefs.push(structuredClone(duplicateSource.candidate.recordRefs[0]));
  assert.throws(() => projectReflectionReviewDetail(duplicateSource), /source handles must be unique/u);
});

test('source projection은 sanitized reopen만 받고 changed·missing이면 content를 항상 null로 둔다', () => {
  const entry = fixture(); const sourceHandle = reflectionReviewSourceHandle(entry,
    entry.candidate.recordRefs[0]);
  const available = projectReflectionReviewSource(entry, { sourceHandle,
    reopened: { state: 'reopened', content: `사용자 원문 ${internal.recordId ?? internal.work}`,
      recordedAt: '2026-08-27T00:00:00.000Z' } });
  assert.equal(available.state, 'available'); assert.match(available.content, /식별 정보 숨김/u);
  for (const state of ['changed', 'missing', 'permission_denied', 'unknown']) {
    const projected = projectReflectionReviewSource(entry, { sourceHandle,
      reopened: { state, content: '절대 보여주지 않음' } });
    assert.equal(projected.content, null); assert.notEqual(projected.state, 'available');
  }
  assert.throws(() => projectReflectionReviewSource(entry, { sourceHandle: 'source_foreign',
    reopened: { state: 'reopened', content: 'x' } }), /not available/u);
  assert.throws(() => projectReflectionReviewSource(entry, { sourceHandle,
    reopened: { state: 'reopened', content: 'x', accounting: { recordId: internal.objective } } }),
  /unknown field/u);
});

test('검토용으로 남김·사용하지 않음도 적용 상태로 표현하지 않는다', () => {
  const kept = projectReflectionReviewDetail(fixture('reviewed'));
  const rejected = projectReflectionReviewDetail(fixture('rejected'));
  assert.equal(kept.statusLabel, '검토용으로 남김'); assert.equal(kept.applied, false);
  assert.deepEqual(kept.actions, { retain: false, reject: true });
  assert.equal(rejected.statusLabel, '사용하지 않음'); assert.equal(rejected.applied, false);
  assert.deepEqual(rejected.actions, { retain: false, reject: false });
});
