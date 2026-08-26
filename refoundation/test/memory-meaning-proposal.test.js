import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeRecordReference } from '../src/record-reference.js';
import {
  deriveMemoryMeaningCandidate,
  validateMemoryMeaningProposal,
} from '../src/memory-meaning-proposal.js';

const root = new URL('../../', import.meta.url);
const source = ({ id = 'source-1', trust = 'user_asserted', sensitivity = 'personal' } = {}) => (
  makeRecordReference({
    sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: id,
    sourceRevision: 1, sha256: createHash('sha256').update(id).digest('hex'),
    occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
    scope: { sessionId: 'session-1', workId: 'work-1', subjectKeys: [], channel: 'console' },
    trust, sensitivity, coverage: 'full', availability: 'available',
  })
);
const proposal = (overrides = {}) => ({
  action: 'remember', kind: 'preference', value: 'prefers filter coffee',
  subjectHandle: 'subject-owner',
  validTimeMeaning: {
    from: '2026-08-26T00:00:00.000Z', to: '2027-08-26T00:00:00.000Z', certainty: 'explicit',
  },
  scopeMeaning: 'global',
  ...overrides,
});
const reality = (overrides = {}) => ({
  memoryId: 'memory-1', sources: [source()], recordedAt: '2026-08-26T00:01:00.000Z',
  currentSessionId: 'session-1', currentWorkId: 'work-1', currentChannel: 'console',
  verifiedSubjects: {
    'subject-owner': { subjectKey: 'person:owner:coffee', personId: 'person:owner' },
    'subject-project': { subjectKey: 'project:alpha', projectId: 'project:alpha' },
  },
  subjectRevision: 2, sourceOrder: 7, targetMemoryId: null, conflictingMemoryIds: [],
  normalPolicyQualified: false, channelSensitivity: 'personal', alwaysRelevantQualified: false,
  ...overrides,
});

test('model proposal은 의미 여섯 필드만 받고 runtime identity·source·scope·sensitivity를 거부한다', () => {
  assert.deepEqual(validateMemoryMeaningProposal(proposal()), proposal());
  for (const forbidden of [
    ['memoryId', 'model-memory'], ['sources', []], ['recordedAt', '2026-08-26T00:00:00.000Z'],
    ['personId', 'person:guess'], ['sensitivity', 'normal'], ['alwaysRelevant', true],
    ['subjectRevision', 99],
  ]) assert.throws(() => validateMemoryMeaningProposal({ ...proposal(), [forbidden[0]]: forbidden[1] }),
    /unknown field/u);
});

test('runtime은 source·clock·scope·subject identity·revision을 파생하고 model 문자열을 key로 쓰지 않는다', () => {
  const result = deriveMemoryMeaningCandidate({ proposal: proposal(), reality: reality() });
  assert.equal(result.state, 'claim_candidate');
  assert.equal(result.claim.memoryId, 'memory-1');
  assert.equal(result.claim.subjectKey, 'person:owner:coffee');
  assert.equal(result.claim.scope.personId, 'person:owner');
  assert.equal(result.claim.recordedAt, '2026-08-26T00:01:00.000Z');
  assert.equal(result.claim.subjectRevision, 2);
  assert.equal(result.claim.sourceOrder, 7);
  assert.deepEqual(result.claim.sources, reality().sources);
  assert.equal(result.claim.alwaysRelevant, false);
});

test('필요한 verified handle이 없으면 identity를 발명하지 않고 추가 관측을 요구한다', () => {
  const result = deriveMemoryMeaningCandidate({
    proposal: proposal({ scopeMeaning: 'person', subjectHandle: 'unknown-person' }), reality: reality(),
  });
  assert.equal(result.state, 'needs_verified_subject');
  assert.equal(result.claim, null);
});

test('sensitivity는 source·channel floor에서 fail-closed되고 qualified policy만 normal로 내린다', () => {
  const uncertain = deriveMemoryMeaningCandidate({ proposal: proposal(), reality: reality({
    sources: [source({ sensitivity: 'normal' })], channelSensitivity: null,
  }) });
  assert.equal(uncertain.claim.sensitivity, 'personal');
  const qualifiedNormal = deriveMemoryMeaningCandidate({ proposal: proposal(), reality: reality({
    sources: [source({ sensitivity: 'normal' })], channelSensitivity: 'normal', normalPolicyQualified: true,
  }) });
  assert.equal(qualifiedNormal.claim.sensitivity, 'normal');
  const privateChannel = deriveMemoryMeaningCandidate({ proposal: proposal(), reality: reality({
    channelSensitivity: 'private',
  }) });
  assert.equal(privateChannel.claim.sensitivity, 'private');
  const secret = deriveMemoryMeaningCandidate({ proposal: proposal(), reality: reality({
    sources: [source({ sensitivity: 'never_store' })],
  }) });
  assert.equal(secret.state, 'never_store');
  assert.equal(secret.claim, null);
});

test('inferred·unknown valid time은 model 추측을 durable exact time으로 승격하지 않는다', () => {
  const inferred = deriveMemoryMeaningCandidate({
    proposal: proposal({ validTimeMeaning: {
      from: '2026-08-26T00:00:00.000Z', to: null, certainty: 'inferred',
    } }), reality: reality(),
  });
  assert.equal(inferred.state, 'temporal_unknown_candidate');
  assert.equal(inferred.claim.validFrom, null);
  assert.equal(inferred.claim.validTo, null);
});

test('correct와 retract의 exact target은 model이 아니라 current runtime projection에서 온다', () => {
  const missing = deriveMemoryMeaningCandidate({
    proposal: proposal({ action: 'correct' }), reality: reality(),
  });
  assert.equal(missing.state, 'needs_exact_target');
  const correction = deriveMemoryMeaningCandidate({
    proposal: proposal({ action: 'correct' }), reality: reality({ targetMemoryId: 'memory-old' }),
  });
  assert.deepEqual(correction.claim.supersedes, ['memory-old']);
  const retract = deriveMemoryMeaningCandidate({
    proposal: proposal({ action: 'retract' }), reality: reality({ targetMemoryId: 'memory-old' }),
  });
  assert.equal(retract.state, 'retract_candidate');
  assert.equal(retract.targetMemoryId, 'memory-old');
  assert.equal(retract.claim, null);
});

test('untrusted 또는 model-inferred source만 있으면 durable claim 후보를 만들지 않는다', () => {
  for (const trust of ['external_untrusted', 'model_inferred']) {
    const result = deriveMemoryMeaningCandidate({
      proposal: proposal(), reality: reality({ sources: [source({ trust })] }),
    });
    assert.equal(result.state, 'needs_trusted_source');
    assert.equal(result.claim, null);
  }
});

test('model adapter가 바뀌어도 같은 meaning payload와 runtime reality는 같은 candidate다', () => {
  const first = deriveMemoryMeaningCandidate({ proposal: JSON.parse(JSON.stringify(proposal())), reality: reality() });
  const second = deriveMemoryMeaningCandidate({ proposal: JSON.parse(JSON.stringify(proposal())), reality: reality() });
  assert.deepEqual(second, first);
});

test('M2-1 shadow는 Memory writer·AgentLoop·Context·사용자 surface에 연결되지 않는다', async () => {
  for (const path of [
    'refoundation/src/memory-ledger.js', 'refoundation/src/memory-tool.js',
    'refoundation/src/agent-loop.js', 'refoundation/src/console-server.js',
    'refoundation/src/conversation-projection.js', 'refoundation/src/memory-portfolio.js',
  ]) assert.doesNotMatch(await readFile(new URL(path, root), 'utf8'),
    /memory-meaning-proposal|temporal-memory/u, path);
});
