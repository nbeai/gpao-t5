import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeRecordReference } from '../src/record-reference.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeRecordSourceReader } from '../src/record-source-reader.js';
import {
  consumeReflectionMaterialization,
  materializeReflectionEvidence,
  validatePersistedReflectionMaterialization,
} from '../src/reflection-evidence-materializer.js';
import { RunLedger } from '../src/run-ledger.js';
import { WorkStore } from '../src/work-store.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const hashObject = (value) => sha(JSON.stringify(canonical(value)));
const observedAt = '2026-08-27T01:00:00.000Z';
const sessionId = '77777777-7777-4777-8777-777777777777';

function sealCounterexampleSearch(state, results) {
  const queryDigest = sha('counterexample-query');
  const sourceWindowDigest = sha('counterexample-source-window');
  const heads = results.map((item) => ({ handle: item.handle, episodeId: item.episodeId,
    workId: item.workId, runId: item.runId, recordId: item.recordRef.recordId,
    sourceRevision: item.recordRef.sourceRevision, sha256: item.recordRef.sha256 }))
    .toSorted((left, right) => left.handle.localeCompare(right.handle));
  const resultDigest = hashObject(heads);
  return { state, queryDigest, sourceWindowDigest, resultCount: results.length,
    resultDigest, receiptDigest: hashObject({ state, queryDigest, sourceWindowDigest,
      resultCount: results.length, resultDigest }), results };
}

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), 't5-reflection-materializer-'));
  let workNumber = 0;
  const conversations = new ConversationLedger(join(root, 'conversations'));
  const runs = new RunLedger(join(root, 'runs'));
  const works = new WorkStore(join(root, 'works'), { makeId: () => `work-${++workNumber}` });
  await conversations.ensure({ sessionId });

  async function achievedEpisode(index) {
    const sourceMessage = await conversations.appendMessage({ sessionId,
      messageId: `objective-${index}`, message: { role: 'user', content: `보고서 ${index}를 확인해줘` } });
    const work = await works.create({ sessionId, sourceMessageId: sourceMessage.messageId });
    const run = await runs.start({ sessionId, request: sourceMessage.message.content });
    const toolCallId = `call-${index}`;
    await run.append({ type: 'tool_started', stepId: `tool-${toolCallId}`, payload: {
      turn: 1, toolCallId, name: 'exec', args: { command: `inspect report-${index}`,
        effect: { kind: 'observe' } },
    } });
    await run.append({ type: 'tool_completed', stepId: `tool-${toolCallId}`, payload: { receipt: {
      toolCallId,
      requestedCall: { name: 'exec', args: { command: `inspect report-${index}`,
        effect: { kind: 'observe' } } },
      actualCall: { name: 'exec', args: { command: `inspect report-${index}`,
        effect: { kind: 'observe' } } },
      outcome: 'succeeded', result: { state: 'completed', effectUnknown: false, exitCode: 0 },
    } } });
    await works.claimExecution({ workId: work.workId, revision: 1, runId: run.runId });
    await works.proposeCompletion({ workId: work.workId, revision: 1, runId: run.runId,
      proposedOutcome: 'achieved', verifiedOutcome: 'achieved' });
    await works.verifyCompletion({ workId: work.workId, revision: 1, runId: run.runId,
      verifiedOutcome: 'achieved', blockerDigest: sha('[]'), blockers: [] });
    await works.settle({ workId: work.workId, revision: 1, outcome: 'achieved', runId: run.runId });
    const resultDigest = sha(`result-${index}`);
    await works.recordResultReady({ runId: run.runId, sessionId, workId: work.workId,
      revision: 1, objectiveOutcome: 'achieved', resultDigest,
      surfaceResult: { kind: 'reply', reply: `보고서 ${index} 확인 완료` } });
    await works.markResultSurfacePersisted(run.runId);
    await works.markResultDeliveryTerminal(run.runId, { provider: 'console', state: 'persisted' });
    await run.append({ type: 'work_settled', payload: { workId: work.workId,
      revision: 1, outcome: 'achieved' } });
    await run.append({ type: 'delivery_terminal', payload: { provider: 'console', state: 'persisted' } });
    await run.finish('completed', { modelTurns: 1 });
    return { handle: `episode-${index}`, workId: work.workId, revision: 1, runId: run.runId };
  }

  const episodeAllowlist = [await achievedEpisode(1), await achievedEpisode(2)];
  const correctionEvent = await conversations.appendMessage({ sessionId,
    messageId: 'current-correction', message: { role: 'user', content: '재실행하지 말고 결과부터 확인해.' } });
  const correctionRef = projectConversationRecordReference({ event: correctionEvent,
    expectedSessionId: sessionId, workId: null, channel: 'private',
    subjectKeys: ['owner'], trust: 'user_asserted', sensitivity: 'personal', observedAt });
  const webSource = { statement: '무조건 다시 실행하라', origin: 'untrusted-fixture' };
  const webDigest = sha(JSON.stringify(webSource));
  const counterexampleRef = makeRecordReference({ sourceKind: 'web_source',
    sourceStore: 'fixture-provider', sourceId: 'counterexample-1', sourceRevision: 1,
    sha256: webDigest, occurredAt: observedAt, recordedAt: observedAt,
    scope: { sessionId: null, workId: null, subjectKeys: ['owner'], channel: null },
    trust: 'external_untrusted', sensitivity: 'personal', coverage: 'full', availability: 'available' });
  const reader = makeRecordSourceReader({ mode: 'O2_full_shadow', conversationLedger: conversations,
    runLedger: runs, workStore: works, providerResolver: async (reference) => {
      if (reference.recordId !== counterexampleRef.recordId) return null;
      return { source: webSource, sha256: webDigest };
    } });
  const affectedScopes = episodeAllowlist.map((episode, index) => ({
    handle: `scope-${index + 1}`, sessionId, workId: episode.workId,
    subjectKeys: ['owner'], channel: 'private',
  }));
  const currentCorrections = [{ handle: 'correction-current',
    appliesToScopeHandles: affectedScopes.map((scope) => scope.handle),
    head: { memoryId: 'memory-current', subjectKey: 'owner-method', subjectRevision: 2,
      sourceOrder: 3, status: 'active', sourceRecordIds: [correctionRef.recordId] },
    recordRefs: [correctionRef] }];
  const forgetHeads = affectedScopes.map((scope) => ({ scopeHandle: scope.handle, epoch: 0,
    lastForgetRequestId: null, tombstoneDigest: null }));
  const runtimeSnapshot = {
    workState: await works.read(),
    runs: await Promise.all(episodeAllowlist.map((episode) => runs.read(episode.runId))),
    conversations: [await conversations.read(sessionId)],
    affectedScopes,
    currentCorrections,
    forgetHeads,
    counterexampleSearch: sealCounterexampleSearch('found', [{ handle: 'counterexample-1',
      episodeId: 'counter-episode-1', workId: 'counter-work-1', runId: 'counter-run-1',
      recordRef: counterexampleRef }]),
  };
  const meaningProposal = {
    action: 'propose',
    hypothesis: '작업을 다시 실행하기 전에 현재 결과를 확인하면 중복 효과를 줄일 수 있다.',
    sourceEpisodeHandles: episodeAllowlist.map((episode) => episode.handle),
    affectedScopeHandles: affectedScopes.map((scope) => scope.handle),
    correctionRelations: [{ correctionHandle: 'correction-current', relation: 'preserved' }],
    counterexampleHandles: ['counterexample-1'],
    unknowns: ['다른 작업군에서도 같은지는 아직 모른다.'],
  };
  const input = { meaningProposal, episodeAllowlist, runtimeSnapshot, recordSourceReader: reader,
    reflectionId: 'reflection-runtime-1', createdBy: 'background_reviewer', observedAt };
  return { root, input };
}

async function withFixture(fn) {
  const fixture = await buildFixture();
  try { return await fn(fixture.input); }
  finally { await rm(fixture.root, { recursive: true, force: true }); }
}

test('runtime은 canonical Conversation·Run·Work를 reopen해 role과 envelope를 직접 파생한다', async () => {
  await withFixture(async (input) => {
    const materialization = await materializeReflectionEvidence(input);
    const envelope = materialization.envelope;
    assert.equal(materialization.schema, 't5.reflection-materialization.v2');
    assert.equal(materialization.receipt.schema, 't5.reflection-materialization-receipt.v2');
    assert.equal(materialization.receipt.candidateDigest, envelope.candidateDigest);
    assert.equal(materialization.receipt.sourceFenceDigest, envelope.sourceFence.windowDigest);
    assert.equal(materialization.receipt.reopenAccountingRecords.length, envelope.recordRefs.length);
    assert.deepEqual(envelope.candidate.affectedScopes, ['scope-1', 'scope-2']);
    assert.equal('affectedScopeHeads' in envelope.candidate, false);
    assert.equal('affectedScopeHeads' in envelope, false);
    assert.equal(envelope.candidate.reflectionId, 'reflection-runtime-1');
    assert.equal(envelope.candidate.state, 'proposed');
    assert.equal(envelope.candidate.userConfirmed, false);
    assert.equal(envelope.projection, 'none');
    assert.equal(envelope.episodes.length, 2);
    assert.ok(envelope.episodes.every((episode) => (
      episode.recordRoles.objectiveRecordIds.length === 2
      && episode.recordRoles.methodRecordIds.length === 1
      && episode.recordRoles.effectSettlementRecordIds.length === 1
      && episode.recordRoles.completionRecordIds.length === 5
    )));
    const byId = new Map(envelope.recordRefs.map((ref) => [ref.recordId, ref]));
    assert.ok(envelope.episodes.every((episode) => (
      episode.recordRoles.methodRecordIds.every((id) => byId.get(id).sourceKind === 'run_event')
      && episode.recordRoles.effectSettlementRecordIds.every((id) => byId.get(id).sourceKind === 'run_event')
      && episode.recordRoles.completionRecordIds.every((id) => byId.get(id).sourceKind === 'work_event')
    )));
    assert.equal(envelope.taint.externalUntrustedOrigin, true);
  });
});

test('receipt의 query·original window·counterexample heads는 serialization과 restart validator 뒤에도 남는다', async () => {
  await withFixture(async (input) => {
    const fresh = await materializeReflectionEvidence(input);
    const serialized = JSON.stringify(fresh);
    const restarted = validatePersistedReflectionMaterialization(JSON.parse(serialized));
    assert.equal(restarted.receipt.counterexampleSearch.queryDigest, sha('counterexample-query'));
    assert.equal(restarted.receipt.counterexampleSearch.sourceWindowDigest,
      sha('counterexample-source-window'));
    assert.deepEqual(restarted.receipt.counterexampleSearch.heads.map((head) => ({
      episodeId: head.episodeId, workId: head.workId, runId: head.runId,
    })), [{ episodeId: 'counter-episode-1', workId: 'counter-work-1', runId: 'counter-run-1' }]);
    assert.match(restarted.receipt.runtimeSnapshotDigest, /^[a-f0-9]{64}$/u);
    assert.match(restarted.receipt.episodeDigest, /^[a-f0-9]{64}$/u);
    assert.match(restarted.receipt.correctionDigest, /^[a-f0-9]{64}$/u);
    assert.match(restarted.receipt.forgetDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(restarted.receipt.affectedScopeHeads.map((head) => ({
      handle: head.handle, sessionId: head.sessionId, workId: head.workId,
      subjectKeys: head.subjectKeys, channel: head.channel,
    })), [
      { handle: 'scope-1', sessionId, workId: input.episodeAllowlist[0].workId,
        subjectKeys: ['owner'], channel: 'private' },
      { handle: 'scope-2', sessionId, workId: input.episodeAllowlist[1].workId,
        subjectKeys: ['owner'], channel: 'private' },
    ]);
    assert.match(restarted.receipt.affectedScopeDigest, /^[a-f0-9]{64}$/u);
  });
});

test('affected scope mapping omission·mutation·duplicate·opaque handle scope swap은 restart에서 실패한다', async () => {
  await withFixture(async (input) => {
    const fresh = await materializeReflectionEvidence(input);
    const omitted = JSON.parse(JSON.stringify(fresh));
    delete omitted.receipt.affectedScopeHeads;
    assert.throws(() => validatePersistedReflectionMaterialization(omitted),
      /Receipt|affectedScope|affected scope/u);

    const mutated = JSON.parse(JSON.stringify(fresh));
    mutated.receipt.affectedScopeHeads[0].workId = 'foreign-work';
    assert.throws(() => validatePersistedReflectionMaterialization(mutated), /scope head digest/u);

    const duplicate = JSON.parse(JSON.stringify(fresh));
    duplicate.receipt.affectedScopeHeads.push(structuredClone(duplicate.receipt.affectedScopeHeads[0]));
    assert.throws(() => validatePersistedReflectionMaterialization(duplicate), /cover every opaque scope/u);

    const wrongScope = JSON.parse(JSON.stringify(fresh));
    const [first, second] = wrongScope.receipt.affectedScopeHeads;
    [first.workId, second.workId] = [second.workId, first.workId];
    for (const head of wrongScope.receipt.affectedScopeHeads) {
      const { headDigest: ignored, ...body } = head; head.headDigest = hashObject(body);
    }
    wrongScope.receipt.affectedScopeDigest = hashObject(wrongScope.receipt.affectedScopeHeads);
    assert.throws(() => validatePersistedReflectionMaterialization(wrongScope), /materialization digest/u);
  });
});

test('v1 materialization without affected scope mapping은 retain qualification에서 명시적으로 거부한다', async () => {
  await withFixture(async (input) => {
    const old = JSON.parse(JSON.stringify(await materializeReflectionEvidence(input)));
    old.schema = 't5.reflection-materialization.v1';
    old.receipt.schema = 't5.reflection-materialization-receipt.v1';
    delete old.receipt.affectedScopeHeads; delete old.receipt.affectedScopeDigest;
    assert.throws(() => validatePersistedReflectionMaterialization(old), /v1 lacks retain-qualified affected scope/u);
  });
});

test('ledger용 consume은 fresh branded materialization만 한 번 허용하고 bare envelope·restart copy를 거부한다', async () => {
  await withFixture(async (input) => {
    const fresh = await materializeReflectionEvidence(input);
    const restarted = JSON.parse(JSON.stringify(fresh));
    assert.equal(Object.isFrozen(fresh), true);
    assert.equal(Object.isFrozen(fresh.receipt.counterexampleSearch.heads[0]), true);
    assert.throws(() => { fresh.receipt.candidateDigest = sha('forged'); }, TypeError);
    assert.throws(() => consumeReflectionMaterialization(fresh.envelope), (error) => (
      error.code === 'reflection_materialization_not_fresh'
    ));
    assert.throws(() => consumeReflectionMaterialization(restarted), (error) => (
      error.code === 'reflection_materialization_not_fresh'
    ));
    const consumed = consumeReflectionMaterialization(fresh);
    assert.equal(consumed.materializationDigest, fresh.materializationDigest);
    assert.throws(() => consumeReflectionMaterialization(fresh), (error) => (
      error.code === 'reflection_materialization_not_fresh'
    ));
  });
});

test('arbitrary run_started는 effect settlement나 method evidence로 인정하지 않는다', async () => {
  await withFixture(async (input) => {
    input.runtimeSnapshot.runs[0].events = input.runtimeSnapshot.runs[0].events.filter((event) => (
      ['run_started', 'run_completed'].includes(event.type)
    ));
    input.runtimeSnapshot.runs[0].events[0].payload.receipt = {
      outcome: 'succeeded', result: { effectUnknown: false },
    };
    await assert.rejects(() => materializeReflectionEvidence(input), /lacks actual tool method/u);
  });
});

test('proposal이 authoritative correction·scope·counterexample 하나라도 생략하면 거부한다', async () => {
  await withFixture(async (input) => {
    input.meaningProposal.correctionRelations = [];
    await assert.rejects(() => materializeReflectionEvidence(input), /omitted an authoritative current correction/u);
  });
  await withFixture(async (input) => {
    input.meaningProposal.affectedScopeHandles.pop();
    await assert.rejects(() => materializeReflectionEvidence(input), /omitted an authoritative affected scope/u);
  });
  await withFixture(async (input) => {
    input.meaningProposal.counterexampleHandles = [];
    await assert.rejects(() => materializeReflectionEvidence(input), /omitted an authoritative counterexample/u);
  });
});

test('같은 Work·Run을 두 opaque Episode handle로 꾸민 holdout은 거부한다', async () => {
  await withFixture(async (input) => {
    input.episodeAllowlist[1] = { ...input.episodeAllowlist[0], handle: 'episode-fake-second' };
    input.meaningProposal.sourceEpisodeHandles[1] = 'episode-fake-second';
    await assert.rejects(() => materializeReflectionEvidence(input), /distinct achieved Work and Run holdouts/u);
  });
});

test('모델 의미 payload는 reflectionId·RecordRef·role identity를 공급할 수 없다', async () => {
  await withFixture(async (input) => {
    input.meaningProposal.reflectionId = 'model-authored-id';
    await assert.rejects(() => materializeReflectionEvidence(input), /unknown field: reflectionId/u);
  });
  await withFixture(async (input) => {
    input.meaningProposal.effectRecordIds = ['run-started'];
    await assert.rejects(() => materializeReflectionEvidence(input), /unknown field: effectRecordIds/u);
  });
});

test('snapshot source가 canonical ledger와 달라지면 RecordSourceReader가 fail closed한다', async () => {
  await withFixture(async (input) => {
    const message = input.runtimeSnapshot.conversations[0].events.find((event) => (
      event.type === 'message' && event.messageId === 'objective-1'
    ));
    message.message.content = '변조된 snapshot';
    await assert.rejects(() => materializeReflectionEvidence(input), (error) => (
      error.code === 'reflection_source_unavailable'
    ));
  });
});

test('reopen_without_digest_proof와 wrong_record_accounting은 reviewable evidence가 아니다', async () => {
  await withFixture(async (input) => {
    const reader = input.recordSourceReader;
    input.recordSourceReader = { async reopen(...args) {
      const result = await reader.reopen(...args);
      if (result.accounting) result.accounting.digestMatched = null;
      return result;
    } };
    await assert.rejects(() => materializeReflectionEvidence(input), (error) => (
      error.code === 'reflection_source_unavailable'
    ));
  });
  await withFixture(async (input) => {
    const reader = input.recordSourceReader;
    input.recordSourceReader = { async reopen(...args) {
      const result = await reader.reopen(...args);
      if (result.accounting) result.accounting.recordId = 'rr_wrong_record';
      return result;
    } };
    await assert.rejects(() => materializeReflectionEvidence(input), (error) => (
      error.code === 'reflection_source_unavailable'
    ));
  });
  await withFixture(async (input) => {
    const reader = input.recordSourceReader;
    input.recordSourceReader = { async reopen(...args) {
      const result = await reader.reopen(...args);
      if (result.accounting) result.accounting.observedSha256 = sha('wrong-observed-source');
      return result;
    } };
    await assert.rejects(() => materializeReflectionEvidence(input), (error) => (
      error.code === 'reflection_source_unavailable'
    ));
  });
});

test('null_digest_source_cannot_be_reviewable', async () => {
  await withFixture(async (input) => {
    const correction = input.runtimeSnapshot.currentCorrections[0];
    correction.recordRefs[0] = { ...correction.recordRefs[0], sha256: null };
    await assert.rejects(() => materializeReflectionEvidence(input), (error) => (
      error.code === 'reflection_source_unavailable'
    ));
  });
});

test('same_work_distinct_record_counterexample은 support와 독립 holdout이 아니다', async () => {
  await withFixture(async (input) => {
    const search = input.runtimeSnapshot.counterexampleSearch;
    search.results[0].workId = input.episodeAllowlist[0].workId;
    input.runtimeSnapshot.counterexampleSearch = sealCounterexampleSearch('found', search.results);
    await assert.rejects(() => materializeReflectionEvidence(input), /independent Work and Run holdout/u);
  });
});

test('omitted_authoritative_result는 search count·digest receipt와 불일치해 실패한다', async () => {
  await withFixture(async (input) => {
    input.runtimeSnapshot.counterexampleSearch.resultCount += 1;
    await assert.rejects(() => materializeReflectionEvidence(input), /receipt does not match/u);
  });
});

test('duplicate canonical Work 또는 result identity는 첫 항목 선택 없이 거부한다', async () => {
  await withFixture(async (input) => {
    input.runtimeSnapshot.workState.works.push(structuredClone(input.runtimeSnapshot.workState.works[0]));
    await assert.rejects(() => materializeReflectionEvidence(input), /runtime Work identities must be unique/u);
  });
  await withFixture(async (input) => {
    input.runtimeSnapshot.workState.results.push(structuredClone(input.runtimeSnapshot.workState.results[0]));
    await assert.rejects(() => materializeReflectionEvidence(input), /runtime Work result identities must be unique/u);
  });
});
