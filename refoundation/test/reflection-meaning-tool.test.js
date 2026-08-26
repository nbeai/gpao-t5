import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  makeReflectionMeaningTool,
  projectReflectionMeaningSnapshot,
} from '../src/reflection-meaning-tool.js';
import { makeRecordReference } from '../src/record-reference.js';

function authoritativeCorrection(handle, appliesToScopeHandles) {
  const reference = makeRecordReference({ sourceKind: 'conversation_message',
    sourceStore: 'conversation-ledger', sourceId: 'PRIVATE_SOURCE_ID_CANARY', sourceRevision: 1,
    sha256: 'a'.repeat(64), occurredAt: '2026-08-27T00:00:00.000Z',
    recordedAt: '2026-08-27T00:00:00.000Z',
    scope: { sessionId: 'private-session', workId: null,
      subjectKeys: ['PRIVATE_SUBJECT_CANARY'], channel: 'private' },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available' });
  return { handle, appliesToScopeHandles,
    head: { memoryId: 'PRIVATE_MEMORY_ID_CANARY', subjectKey: 'PRIVATE_SUBJECT_CANARY',
      subjectRevision: 2, sourceOrder: 3, status: 'active', sourceRecordIds: [reference.recordId] },
    recordRefs: [reference] };
}

function setup(snapshotOverrides = {}) {
  const calls = [];
  const coordinator = { async materializeAndPropose(input) {
    calls.push(structuredClone(input)); return { candidateState: 'proposed', publicationQualified: false };
  } };
  const runtimeSnapshot = {
    episodeAllowlist: [{ handle: 'episode-safe-a' }, { handle: 'episode-safe-b' }],
    counterexampleSearch: { results: [{ handle: 'counter-safe-a' }] },
    affectedScopes: [{ handle: 'scope-safe-a' }],
    currentCorrections: [authoritativeCorrection('correction-safe-a', ['scope-safe-a'])],
    ...snapshotOverrides,
  };
  return { calls, tool: makeReflectionMeaningTool({ coordinator, runtimeSnapshot }) };
}

function proposal(overrides = {}) {
  return { action: 'propose', hypothesis: '검증할 절차 가설',
    sourceEpisodeHandles: ['episode-safe-a', 'episode-safe-b'],
    counterexampleHandles: ['counter-safe-a'], affectedScopeHandles: ['scope-safe-a'],
    correctionRelations: [{ handle: 'correction-safe-a', relation: 'preserved' }],
    unknowns: ['다른 작업군은 아직 모름'], ...overrides };
}

test('provider schema는 일곱 의미 필드만 required인 closed strict schema다', () => {
  const { tool } = setup();
  assert.equal(tool.name, 'reflection_meaning'); assert.equal(tool.strict, true);
  assert.equal(tool.informationAlwaysVisible, false);
  assert.equal(tool.parameters.additionalProperties, false);
  const expected = ['action', 'hypothesis', 'sourceEpisodeHandles', 'counterexampleHandles',
    'affectedScopeHandles', 'correctionRelations', 'unknowns'];
  assert.deepEqual([...tool.parameters.required].sort(), [...expected].sort());
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), [...expected].sort());
  assert.deepEqual(tool.parameters.properties.action.enum, ['propose', 'abstain']);
  assert.equal(tool.parameters.properties.sourceEpisodeHandles.maxItems, 64);
  assert.equal(tool.parameters.properties.counterexampleHandles.maxItems, 64);
  assert.equal(tool.parameters.properties.affectedScopeHandles.maxItems, 32);
  assert.equal(tool.parameters.properties.correctionRelations.maxItems, 64);
  const relation = tool.parameters.properties.correctionRelations.items;
  assert.equal(relation.additionalProperties, false);
  assert.deepEqual(relation.required, ['handle', 'relation']);
  assert.deepEqual(relation.properties.relation.enum, ['preserved', 'conflicts']);
  const forbidden = ['reflectionId', 'createdBy', 'recordRefs', 'roles', 'forgetHeads',
    'sourceFence', 'taint', 'stateHistory', 'materializationReceipt', 'candidateDigest'];
  const serialized = JSON.stringify(tool.parameters);
  assert.doesNotMatch(serialized, /uniqueItems/u);
  for (const field of forbidden) assert.doesNotMatch(serialized, new RegExp(field, 'u'));
});

test('runtime snapshot allowlist hard bounds와 correction scope를 materialization 전에 검증한다', () => {
  for (const [field, snapshotOverrides] of [
    ['episodes', { episodeAllowlist: Array.from({ length: 65 }, (_, index) => ({ handle: `episode-${index}` })) }],
    ['counterexamples', { counterexampleSearch: { results: Array.from({ length: 65 }, (_, index) => ({ handle: `counter-${index}` })) } }],
    ['scopes', { affectedScopes: Array.from({ length: 33 }, (_, index) => ({ handle: `scope-${index}` })) }],
    ['corrections', { currentCorrections: Array.from({ length: 65 }, (_, index) => (
      authoritativeCorrection(`correction-${index}`, ['scope-safe-a'])
    )) }],
  ]) assert.throws(() => setup(snapshotOverrides), new RegExp(`${field.slice(0, -1)}.*bound|allowlist exceeds`, 'iu'));

  assert.throws(() => setup({ currentCorrections: [authoritativeCorrection('correction-safe-a', [])] }),
    /bounded non-empty/u);
  assert.throws(() => setup({ currentCorrections: [authoritativeCorrection('correction-safe-a',
    ['scope-safe-a', 'scope-safe-a'])] }), /duplicates/u);
});

test('meaning_tool_accepts_authoritative_multi_scope_correction_shape', async () => {
  const calls = [];
  const runtimeSnapshot = {
    episodeAllowlist: [{ handle: 'episode-safe-a' }, { handle: 'episode-safe-b' }],
    counterexampleSearch: { results: [{ handle: 'counter-safe-a' }] },
    affectedScopes: [{ handle: 'scope-safe-a' }, { handle: 'scope-safe-b' }],
    currentCorrections: [authoritativeCorrection('correction-multi',
      ['scope-safe-a', 'scope-safe-b'])],
  };
  const tool = makeReflectionMeaningTool({ runtimeSnapshot,
    coordinator: { async materializeAndPropose(input) { calls.push(input); return { inactive: true }; } } });
  const result = await tool.execute(proposal({ affectedScopeHandles: ['scope-safe-a', 'scope-safe-b'],
    correctionRelations: [{ handle: 'correction-multi', relation: 'preserved' }] }));
  assert.equal(result.state, 'proposed_inactive'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].meaningProposal.correctionRelations,
    [{ correctionHandle: 'correction-multi', relation: 'preserved' }]);
  assert.doesNotMatch(`${JSON.stringify(tool.parameters)}${JSON.stringify(calls[0])}`,
    /PRIVATE_MEMORY_ID_CANARY|PRIVATE_SUBJECT_CANARY|PRIVATE_SOURCE_ID_CANARY|recordRefs|recordId|subjectKey/u);
});

test('privacy-safe projector는 authoritative head·RecordRef를 제거하고 deep clone·freeze한다', async () => {
  const correction = authoritativeCorrection('correction-private', ['scope-safe-a', 'scope-safe-b']);
  const runtimeSnapshot = {
    episodeAllowlist: [{ handle: 'episode-safe-a', workId: 'work-private' }],
    counterexampleSearch: { results: [{ handle: 'counter-safe-a', recordRef: correction.recordRefs[0] }] },
    affectedScopes: [{ handle: 'scope-safe-a', subjectKeys: ['PRIVATE_SUBJECT_CANARY'] },
      { handle: 'scope-safe-b', subjectKeys: ['PRIVATE_SUBJECT_CANARY'] }],
    currentCorrections: [correction],
  };
  const projected = projectReflectionMeaningSnapshot(runtimeSnapshot);
  assert.deepEqual(projected.corrections, [{ handle: 'correction-private',
    appliesToScopeHandles: ['scope-safe-a', 'scope-safe-b'] }]);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.corrections), true);
  assert.equal(Object.isFrozen(projected.corrections[0].appliesToScopeHandles), true);
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized,
    /PRIVATE_MEMORY_ID_CANARY|PRIVATE_SUBJECT_CANARY|PRIVATE_SOURCE_ID_CANARY|recordRefs|recordId|subjectKey|head/u);
  correction.appliesToScopeHandles[0] = 'mutated-after-projection';
  assert.equal(projected.corrections[0].appliesToScopeHandles[0], 'scope-safe-a');
  assert.throws(() => { projected.corrections[0].handle = 'mutated'; }, TypeError);

  const withUnknown = authoritativeCorrection('correction-extra', ['scope-safe-a']);
  withUnknown.extraRuntimeField = 'must-fail';
  assert.throws(() => projectReflectionMeaningSnapshot({ ...runtimeSnapshot,
    currentCorrections: [withUnknown] }), /missing or unknown fields/u);
});

test('unrelated correction은 광고하지 않고 related+foreign mixed scope는 누출로 거부한다', async () => {
  const unrelated = setup({ currentCorrections: [authoritativeCorrection('correction-unrelated',
    ['scope-unrelated'])] });
  assert.equal(unrelated.tool.parameters.properties.correctionRelations.maxItems, 0);
  await assert.rejects(unrelated.tool.execute(proposal({ correctionRelations: [{
    handle: 'correction-unrelated', relation: 'preserved',
  }] })), /foreign handle/u);
  assert.equal(unrelated.calls.length, 0);

  assert.throws(() => setup({ currentCorrections: [authoritativeCorrection('correction-mixed',
    ['scope-safe-a', 'scope-foreign'])] }),
  /mixes an advertised scope with a foreign scope/u);
});

test('empty allowlist는 unrestricted string이 아니라 maxItems 0인 abstain-safe schema다', () => {
  const { tool } = setup({ counterexampleSearch: { results: [] }, currentCorrections: [] });
  for (const field of ['counterexampleHandles', 'correctionRelations']) {
    assert.equal(tool.parameters.properties[field].maxItems, 0);
  }
  assert.deepEqual(tool.parameters.properties.counterexampleHandles.items.enum,
    ['__t5_no_available_runtime_handle__']);
  assert.deepEqual(tool.parameters.properties.correctionRelations.items.properties.handle.enum,
    ['__t5_no_available_runtime_handle__']);
});

test('propose는 의미 선택만 coordinator에 전달하고 runtime-derived identity를 모델에서 받지 않는다', async () => {
  const { tool, calls } = setup();
  const result = await tool.execute(proposal());
  assert.equal(result.state, 'proposed_inactive'); assert.equal(result.publicationQualified, false);
  assert.equal(result.productProjection, 'none'); assert.equal(result.managedCapabilityChanges, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { meaningProposal: {
    hypothesis: '검증할 절차 가설',
    sourceEpisodeHandles: ['episode-safe-a', 'episode-safe-b'],
    counterexampleHandles: ['counter-safe-a'], affectedScopeHandles: ['scope-safe-a'],
    correctionRelations: [{ correctionHandle: 'correction-safe-a', relation: 'preserved' }],
    unknowns: ['다른 작업군은 아직 모름'],
  } });
  const serialized = JSON.stringify(calls[0]);
  assert.doesNotMatch(serialized, /reflectionId|createdBy|recordRefs|forgetHeads|sourceFence|taint|stateHistory/u);
  assert.doesNotMatch(`${JSON.stringify(tool.parameters)}${serialized}`,
    /PRIVATE_MEMORY_ID_CANARY|PRIVATE_SUBJECT_CANARY|PRIVATE_SOURCE_ID_CANARY/u);
});

test('abstain은 materialization·ledger·외부 write를 전혀 호출하지 않는다', async () => {
  const { tool, calls } = setup();
  const result = await tool.execute({ action: 'abstain', hypothesis: '', sourceEpisodeHandles: [],
    counterexampleHandles: [], affectedScopeHandles: [], correctionRelations: [], unknowns: [] });
  assert.deepEqual(result, { state: 'abstained', writes: 0, publicationQualified: false,
    productProjection: 'none', managedCapabilityChanges: 0 });
  assert.equal(calls.length, 0);
});

test('unknown·foreign·duplicate handle은 materialization 전에 fail closed한다', async () => {
  for (const mutation of [
    { sourceEpisodeHandles: ['episode-safe-a', 'foreign-episode'] },
    { sourceEpisodeHandles: ['episode-safe-a', 'episode-safe-a'] },
    { counterexampleHandles: ['foreign-counterexample'] },
    { affectedScopeHandles: ['foreign-scope'] },
    { correctionRelations: [{ handle: 'foreign-correction', relation: 'preserved' }] },
    { correctionRelations: [{ handle: 'correction-safe-a', relation: 'preserved' },
      { handle: 'correction-safe-a', relation: 'conflicts' }] },
  ]) {
    const { tool, calls } = setup();
    await assert.rejects(tool.execute(proposal(mutation)), /foreign handle|duplicates/u);
    assert.equal(calls.length, 0);
  }
});

test('model-supplied runtime identity·state·receipt 필드는 closed schema 실행에서도 거부된다', async () => {
  for (const field of ['reflectionId', 'createdBy', 'recordRefs', 'roles', 'corrections',
    'forgetHeads', 'sourceFence', 'taint', 'state', 'stateHistory', 'materializationReceipt']) {
    const { tool, calls } = setup();
    await assert.rejects(tool.execute({ ...proposal(), [field]: 'forged' }), /unknown fields/u);
    assert.equal(calls.length, 0);
  }
});

test('Turn 3B tool은 제품 registry나 managed capability 설치 경로에 연결되지 않는다', async () => {
  const [consoleServer, capabilityLifecycle, managedSkillStore, coordinator] = await Promise.all([
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/capability-lifecycle.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/managed-skill-store.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reflection-source-window-coordinator.js', import.meta.url), 'utf8'),
  ]);
  for (const source of [consoleServer, capabilityLifecycle, managedSkillStore]) {
    assert.doesNotMatch(source, /reflection-meaning-tool/u);
  }
  assert.doesNotMatch(coordinator,
    /from\s+['"][^'"]*(?:managed|capability|skill|plugin|install)[^'"]*['"]/iu);
});
