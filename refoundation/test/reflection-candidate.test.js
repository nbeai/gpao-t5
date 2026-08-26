import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { makeRecordReference } from '../src/record-reference.js';
import {
  calculateReflectionSourceFence,
  makeReflectionCandidateEnvelope,
  transitionReflectionCandidate,
  validateReflectionCandidateEnvelope,
} from '../src/reflection-candidate.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const recordedAt = '2026-08-27T00:00:00.000Z';

function record(name, sourceKind, trust = 'runtime_observed', sensitivity = 'normal') {
  return makeRecordReference({
    sourceKind,
    sourceStore: `${sourceKind}-store`,
    sourceId: name,
    sourceRevision: 1,
    sha256: sha(name),
    occurredAt: recordedAt,
    recordedAt,
    scope: { sessionId: `session-${name}`, workId: `work-${name}`,
      subjectKeys: ['subject-owner'], channel: 'private' },
    trust,
    sensitivity,
    coverage: 'full',
    availability: 'available',
  });
}

function baseParts() {
  const refs = {
    objective1: record('objective-1', 'conversation_message', 'user_asserted'),
    method1: record('method-1', 'run_event'),
    effect1: record('effect-1', 'run_event'),
    completion1: record('completion-1', 'work_event'),
    objective2: record('objective-2', 'conversation_message', 'user_asserted'),
    method2: record('method-2', 'run_event'),
    effect2: record('effect-2', 'run_event'),
    completion2: record('completion-2', 'work_event'),
    counterexample: record('counterexample', 'web_source', 'external_untrusted'),
    correction: record('current-correction', 'conversation_message', 'user_asserted', 'personal'),
  };
  const episodes = [
    { episodeId: 'episode-1', workId: 'work-1', workRevision: 1, runId: 'run-1',
      resultDigest: sha('result-1'), outcome: 'achieved', recordRoles: {
        objectiveRecordIds: [refs.objective1.recordId], methodRecordIds: [refs.method1.recordId],
        effectSettlementRecordIds: [refs.effect1.recordId],
        completionRecordIds: [refs.completion1.recordId],
      } },
    { episodeId: 'episode-2', workId: 'work-2', workRevision: 2, runId: 'run-2',
      resultDigest: sha('result-2'), outcome: 'achieved', recordRoles: {
        objectiveRecordIds: [refs.objective2.recordId], methodRecordIds: [refs.method2.recordId],
        effectSettlementRecordIds: [refs.effect2.recordId],
        completionRecordIds: [refs.completion2.recordId],
      } },
  ];
  const sourceRecordIds = [
    refs.objective1, refs.method1, refs.effect1, refs.completion1,
    refs.objective2, refs.method2, refs.effect2, refs.completion2,
  ].map((item) => item.recordId);
  const correctionHeads = [{ memoryId: 'memory-current', subjectKey: 'subject-owner',
    subjectRevision: 3, sourceOrder: 7, status: 'active',
    sourceRecordIds: [refs.correction.recordId] }];
  const forgetHeads = [{ scopeHandle: 'scope-owner', epoch: 0,
    lastForgetRequestId: null, tombstoneDigest: null }];
  return { refs, episodes, sourceRecordIds, correctionHeads,
    forgetHeads, recordRefs: Object.values(refs), affectedScopes: ['scope-owner'] };
}

function fixture({ counterexample = true, relation = 'preserved', alter = null } = {}) {
  const parts = baseParts();
  alter?.(parts);
  if (!counterexample) {
    parts.recordRefs = parts.recordRefs.filter((item) => item.recordId !== parts.refs.counterexample.recordId);
  }
  const counterexampleRecordIds = counterexample ? [parts.refs.counterexample.recordId] : [];
  const fence = calculateReflectionSourceFence({ affectedScopeHandles: parts.affectedScopes,
    episodes: parts.episodes, recordRefs: parts.recordRefs, correctionHeads: parts.correctionHeads,
    forgetHeads: parts.forgetHeads });
  return {
    reflectionId: 'reflection-1',
    hypothesis: '재시작 전에 현재 결과를 확인하면 불확실한 작업의 중복 실행을 줄일 수 있다.',
    sourceEpisodeIds: parts.episodes.map((item) => item.episodeId),
    sourceRecordIds: parts.sourceRecordIds,
    counterexampleRecordIds,
    affectedScopes: parts.affectedScopes,
    createdBy: 'background_reviewer',
    episodes: parts.episodes,
    recordRefs: parts.recordRefs,
    correctionHeads: parts.correctionHeads,
    correctionRelations: parts.correctionHeads.map((head) => ({ memoryId: head.memoryId, relation })),
    forgetHeads: parts.forgetHeads,
    counterexampleSearch: counterexample
      ? { state: 'found', recordIds: counterexampleRecordIds, sourceWindowDigest: fence.windowDigest }
      : { state: 'not_run', recordIds: [], sourceWindowDigest: null },
    unknowns: ['다른 종류의 작업에서도 같은 이익이 있는지는 아직 모른다.'],
  };
}

function currentEvidence(envelope) {
  return {
    affectedScopeHandles: envelope.candidate.affectedScopes,
    episodes: envelope.episodes,
    recordRefs: envelope.recordRefs,
    correctionHeads: envelope.correctionHeads,
    forgetHeads: envelope.sourceFence.forgetHeads,
  };
}

test('Reflection은 두 achieved Episode의 exact genealogy를 가진 inactive proposed envelope만 만든다', () => {
  const envelope = makeReflectionCandidateEnvelope(fixture());
  assert.equal(envelope.schema, 't5.reflection-candidate.v1');
  assert.equal(envelope.candidate.state, 'proposed');
  assert.equal(envelope.candidate.userConfirmed, false);
  assert.equal(envelope.projection, 'none');
  assert.deepEqual(envelope.stateHistory, [{ from: null, to: 'proposed',
    sourceWindowDigest: envelope.sourceFence.windowDigest }]);
  assert.equal(envelope.sourceFence.episodeHeads[0].workId, 'work-1');
  assert.equal(envelope.sourceFence.episodeHeads[0].runId, 'run-1');
  assert.match(envelope.candidateDigest, /^[a-f0-9]{64}$/u);
  assert.equal(validateReflectionCandidateEnvelope(envelope).candidateDigest, envelope.candidateDigest);
  assert.deepEqual(envelope.taint, {
    sourceTrusts: ['external_untrusted', 'runtime_observed', 'user_asserted'],
    derivedByModel: true,
    externalUntrustedOrigin: true,
    sensitivityFloor: 'personal',
  });
  assert.equal('persona' in envelope.candidate, false);
  assert.equal('alwaysRelevant' in envelope.candidate, false);
});

test('source fence는 입력 배열 순서가 달라도 exact heads에서 같은 digest를 만든다', () => {
  const parts = baseParts();
  const first = calculateReflectionSourceFence({ affectedScopeHandles: parts.affectedScopes,
    episodes: parts.episodes, recordRefs: parts.recordRefs, correctionHeads: parts.correctionHeads,
    forgetHeads: parts.forgetHeads });
  const second = calculateReflectionSourceFence({ affectedScopeHandles: [...parts.affectedScopes].reverse(),
    episodes: [...parts.episodes].reverse(), recordRefs: [...parts.recordRefs].reverse(),
    correctionHeads: [...parts.correctionHeads].reverse(), forgetHeads: [...parts.forgetHeads].reverse() });
  assert.equal(first.windowDigest, second.windowDigest);
  assert.deepEqual(first, second);
});

test('same_record_identity_changed_scope_must_stale: scope·channel·관측 시간 변화는 fence를 바꾼다', () => {
  const parts = baseParts();
  const first = calculateReflectionSourceFence({ affectedScopeHandles: parts.affectedScopes,
    episodes: parts.episodes, recordRefs: parts.recordRefs, correctionHeads: parts.correctionHeads,
    forgetHeads: parts.forgetHeads });
  const changedRecords = parts.recordRefs.map((item, index) => (index === 0 ? {
    ...item,
    recordedAt: '2026-08-27T00:00:01.000Z',
    scope: { ...item.scope, channel: 'foreign-group', subjectKeys: ['subject-foreign'] },
  } : item));
  const changed = calculateReflectionSourceFence({ affectedScopeHandles: parts.affectedScopes,
    episodes: parts.episodes, recordRefs: changedRecords, correctionHeads: parts.correctionHeads,
    forgetHeads: parts.forgetHeads });
  assert.notEqual(changed.windowDigest, first.windowDigest);
});

test('같은 Work·Run을 반복 Episode처럼 넣거나 genealogy 한 축을 비우면 거부한다', () => {
  assert.throws(() => makeReflectionCandidateEnvelope(fixture({ alter(parts) {
    parts.episodes[1].workId = parts.episodes[0].workId;
  } })), /unique and distinct|distinct achieved Episode/u);
  assert.throws(() => makeReflectionCandidateEnvelope(fixture({ alter(parts) {
    parts.episodes[1].recordRoles.effectSettlementRecordIds = [];
  } })), /bounded array/u);
});

test('model inference·untrusted content만으로 Reflection을 접지하지 않는다', () => {
  assert.throws(() => makeReflectionCandidateEnvelope(fixture({ alter(parts) {
    parts.recordRefs = parts.recordRefs.map((item) => (
      parts.sourceRecordIds.includes(item.recordId) ? { ...item, trust: 'model_inferred' } : item
    ));
  } })), /source genealogy|cannot rely only/u);
});

test('external origin은 taint로 남고 입력이 taint·state·projection을 저작할 수 없다', () => {
  const input = fixture();
  assert.throws(() => makeReflectionCandidateEnvelope({ ...input,
    taint: { externalUntrustedOrigin: false } }), /unknown field: taint/u);
  assert.throws(() => makeReflectionCandidateEnvelope({ ...input, state: 'tested' }), /unknown field: state/u);
  assert.throws(() => makeReflectionCandidateEnvelope({ ...input, projection: 'default' }), /unknown field: projection/u);
});

test('support/counterexample 중복과 현재 교정 relation 누락을 거부한다', () => {
  const overlap = fixture(); overlap.counterexampleRecordIds = [overlap.sourceRecordIds[0]];
  overlap.counterexampleSearch.recordIds = [overlap.sourceRecordIds[0]];
  assert.throws(() => makeReflectionCandidateEnvelope(overlap), /must be disjoint/u);
  const missing = fixture(); missing.correctionRelations = [];
  assert.throws(() => makeReflectionCandidateEnvelope(missing), /every current correction/u);
});

test('missing·changed source와 secret-bearing source는 persistent Reflection 근거가 아니다', () => {
  assert.throws(() => makeReflectionCandidateEnvelope(fixture({ alter(parts) {
    parts.recordRefs[0] = { ...parts.recordRefs[0], availability: 'changed' };
  } })), /exactly available/u);
  assert.throws(() => makeReflectionCandidateEnvelope(fixture({ alter(parts) {
    parts.recordRefs[0] = { ...parts.recordRefs[0], sensitivity: 'never_store' };
  } })), /not open/u);
});

test('closed transition은 source fence가 같은 reviewed 뒤 counterexample이 있는 tested만 허용한다', () => {
  const proposed = makeReflectionCandidateEnvelope(fixture());
  assert.throws(() => transitionReflectionCandidate(proposed, { to: 'tested',
    currentEvidence: currentEvidence(proposed) }), /not allowed/u);
  const reviewed = transitionReflectionCandidate(proposed, { to: 'reviewed',
    currentEvidence: currentEvidence(proposed) });
  assert.equal(reviewed.candidate.state, 'reviewed');
  assert.notEqual(reviewed.candidateDigest, proposed.candidateDigest);
  const tested = transitionReflectionCandidate(reviewed, { to: 'tested',
    currentEvidence: currentEvidence(reviewed) });
  assert.equal(tested.candidate.state, 'tested');
  assert.throws(() => transitionReflectionCandidate(tested, { to: 'reviewed',
    currentEvidence: currentEvidence(tested) }), /not allowed/u);
});

test('foreground 교정 뒤 stale background publication은 exact code로 실패하고 원본을 바꾸지 않는다', () => {
  const proposed = makeReflectionCandidateEnvelope(fixture());
  const before = structuredClone(proposed);
  const current = currentEvidence(proposed);
  current.correctionHeads = [{ ...current.correctionHeads[0], subjectRevision: 4 }];
  assert.throws(() => transitionReflectionCandidate(proposed, { to: 'reviewed',
    currentEvidence: current }), (error) => (
    error.code === 'reflection_stale_source_window'
  ));
  assert.deepEqual(proposed, before);
});

test('counterexample 미탐색 또는 current correction conflict는 tested 승격을 막는다', () => {
  const withoutCounter = makeReflectionCandidateEnvelope(fixture({ counterexample: false }));
  const reviewedWithoutCounter = transitionReflectionCandidate(withoutCounter, { to: 'reviewed',
    currentEvidence: currentEvidence(withoutCounter) });
  assert.throws(() => transitionReflectionCandidate(reviewedWithoutCounter, { to: 'tested',
    currentEvidence: currentEvidence(reviewedWithoutCounter) }), /requires a counterexample/u);

  const conflict = makeReflectionCandidateEnvelope(fixture({ relation: 'conflicts' }));
  const reviewedConflict = transitionReflectionCandidate(conflict, { to: 'reviewed',
    currentEvidence: currentEvidence(conflict) });
  assert.throws(() => transitionReflectionCandidate(reviewedConflict, { to: 'tested',
    currentEvidence: currentEvidence(reviewedConflict) }), /preserved current corrections/u);
});

test('forget epoch가 바뀌면 source가 남아 있어도 stale publication으로 거부한다', () => {
  const proposed = makeReflectionCandidateEnvelope(fixture());
  const current = currentEvidence(proposed);
  current.forgetHeads = [{ scopeHandle: 'scope-owner', epoch: 1,
    lastForgetRequestId: 'forget-1', tombstoneDigest: sha('tombstone-1') }];
  assert.throws(() => transitionReflectionCandidate(proposed, { to: 'reviewed', currentEvidence: current }),
    (error) => error.code === 'reflection_stale_source_window');
});

test('한 record를 Episode의 여러 genealogy 역할에 재사용하지 않는다', () => {
  assert.throws(() => makeReflectionCandidateEnvelope(fixture({ alter(parts) {
    parts.episodes[0].recordRoles.effectSettlementRecordIds =
      [...parts.episodes[0].recordRoles.methodRecordIds];
  } })), /roles require distinct/u);
});

test('candidate 또는 evidence를 digest 뒤 고치면 transition 전에 탐지한다', () => {
  const envelope = makeReflectionCandidateEnvelope(fixture());
  envelope.candidate.hypothesis = '사용자는 원래 이런 사람이다.';
  assert.throws(() => validateReflectionCandidateEnvelope(envelope), /digest does not match/u);
});

test('공격자가 digest를 다시 계산해도 derived taint와 proposed confirmation을 위조할 수 없다', () => {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  };
  const redigest = (value) => {
    const copy = structuredClone(value); delete copy.candidateDigest;
    return sha(JSON.stringify(canonical(copy)));
  };
  const taint = makeReflectionCandidateEnvelope(fixture());
  taint.taint.externalUntrustedOrigin = false;
  taint.candidateDigest = redigest(taint);
  assert.throws(() => validateReflectionCandidateEnvelope(taint), /closed derived fields/u);

  const confirmed = makeReflectionCandidateEnvelope(fixture());
  confirmed.candidate.userConfirmed = true;
  confirmed.candidateDigest = redigest(confirmed);
  assert.throws(() => validateReflectionCandidateEnvelope(confirmed), /envelope is invalid/u);

  const skipped = makeReflectionCandidateEnvelope(fixture());
  skipped.candidate.state = 'tested';
  skipped.candidateDigest = redigest(skipped);
  assert.throws(() => validateReflectionCandidateEnvelope(skipped), /does not match its transition history/u);
});

test('Turn 1 contract는 제품 writer·scheduler·Memory·Managed Skill에 연결되지 않는다', async () => {
  const [contract, consoleServer, learningReview, memoryTool] = await Promise.all([
    readFile(new URL('../src/reflection-candidate.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/learning-review.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/memory-tool.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(contract, /node:fs|MemoryLedger|ManagedSkill|LearningCandidate|CapabilityLifecycle/u);
  for (const productSource of [consoleServer, learningReview, memoryTool]) {
    assert.doesNotMatch(productSource, /reflection-candidate/u);
  }
});
