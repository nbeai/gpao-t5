import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CapabilityLifecycleLedger, makeCapabilityLifecycleTool } from '../src/capability-lifecycle.js';
import { LearningCandidateStore, makeLearningCandidateTool } from '../src/learning-candidate.js';
import { qualifyLearningComparison } from '../src/learning-qualification.js';
import { ManagedSkillStore } from '../src/managed-skill-store.js';

const skill = `---
name: recover-report-work
description: Recover and verify interrupted report work.
---

# Recover report work

Observe the last durable result, continue only unfinished steps, and verify the reopened artifact.
`;
function source(index, eligible = true) { return { eligible,
  pointer: { workId: `work-${index}`, revision: 1, runId: `run-${index}`,
    sessionId: `session-${index}`, sourceMessageId: `message-${index}`, resultDigest: `result-${index}` } }; }

test('reviewer는 서로 다른 eligible Episode에서 pending proposal만 만들고 active Skill은 쓰지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-candidate-'));
  try {
    const ledger = new CapabilityLifecycleLedger(room);
    const store = new LearningCandidateStore({ ledger, makeId: () => 'proposal-1' });
    const tool = makeLearningCandidateTool({ store, eligibleSources: [source(1), source(2)], currentRunId: 'review-run' });
    assert.deepEqual(tool.parameters.properties.action.enum, ['propose']);
    const proposal = await tool.execute({ action: 'propose', name: 'recover-report-work',
      description: 'Recover and verify interrupted report work.', content: skill,
      sourceRunIds: ['run-1', 'run-2'] });
    assert.equal(proposal.state, 'candidate'); assert.equal(proposal.sourcePointers.length, 2);
    assert.equal(proposal.revisionDigest.length, 64);
    assert.equal((await ledger.current('proposal-1')).events.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('ineligible·중복 Work·credential content는 proposal 사건을 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-candidate-reject-'));
  try {
    const ledger = new CapabilityLifecycleLedger(room); const store = new LearningCandidateStore({ ledger });
    const badSourceTool = makeLearningCandidateTool({ store,
      eligibleSources: [source(1), source(2, false)], currentRunId: 'review' });
    await assert.rejects(() => badSourceTool.execute({ action: 'propose', name: 'recover-report-work',
      description: 'Recover and verify interrupted report work.', content: skill,
      sourceRunIds: ['run-1', 'run-2'] }), /not eligible/u);
    const secret = skill.replace('Observe the last durable result', 'Use Authorization: Bearer secret-token-value-1234567890');
    const tool = makeLearningCandidateTool({ store, eligibleSources: [source(1), source(2)], currentRunId: 'review' });
    await assert.rejects(() => tool.execute({ action: 'propose', name: 'recover-report-work',
      description: 'Recover and verify interrupted report work.', content: secret,
      sourceRunIds: ['run-1', 'run-2'] }), /credential/u);
    assert.deepEqual(await ledger.events(), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('candidate digest와 exact qualification receipt가 일치할 때만 tested가 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-candidate-qualified-'));
  try {
    const ledger = new CapabilityLifecycleLedger(room);
    const store = new LearningCandidateStore({ ledger, makeId: () => 'proposal-2' });
    await store.stage({ name: 'recover-report-work', description: 'Recover and verify interrupted report work.',
      content: skill, sourcePointers: [source(1), source(2)], createdRunId: 'review' });
    const revisionDigest = (await store.inspect('proposal-2')).revisionDigest;
    const comparison = { capability: { kind: 'skill', id: 'recover-report-work' },
      baseline: { runs: [{ runId: 'b1' }, { runId: 'b2' }], revisions: [],
        durationMs: { median: 200 }, modelTurns: { median: 4 }, toolCalls: 6,
        failedToolCalls: 0, notExecutedToolCalls: 0 },
      candidate: { runs: [{ runId: 'c1' }, { runId: 'c2' }], revisions: [{ digest: revisionDigest }],
        durationMs: { median: 150 }, modelTurns: { median: 3 }, toolCalls: 4,
        failedToolCalls: 0, notExecutedToolCalls: 0 } };
    const eligible = (prefix) => ({ sources: [1, 2].map((index) => ({ eligible: true,
      pointer: { workId: `${prefix}-work-${index}`, runId: `${prefix}${index}` } })) });
    const qualified = qualifyLearningComparison({ comparison,
      baselineEligibility: eligible('b'), candidateEligibility: eligible('c'),
      pairEvaluations: [1, 2].map((index) => ({ baselineRunId: `b${index}`, candidateRunId: `c${index}`,
        evaluatorRunId: `e${index}`, evaluationDigest: `d${index}`, samePurpose: true,
        baselineCorrect: true, candidateCorrect: true, baselineComplete: true,
        candidateComplete: true, userCorrectionPreserved: true })),
      triggerEvaluation: { evaluatorRunId: 'te', evaluationDigest: 'td',
        sourceExpressionsReused: false, falsePositiveCount: 0, falseNegativeCount: 0 },
      fieldObservation: { workId: 'field', runId: 'field-run', resultDigest: 'field-result',
        candidateRevisionUsed: true, achieved: true, userCorrectionPreserved: true,
        regressionObserved: false } });
    assert.equal((await store.qualify('proposal-2', qualified, 'qualification-run')).state, 'tested');
    await assert.rejects(() => store.qualify('proposal-2', {
      ...qualified, candidate: { revisions: [{ digest: 'wrong' }] },
    }, 'other'), /only a candidate|does not match/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('qualified proposal은 recommendation 뒤 새 Run부터 exact learned revision으로 활성화된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-activation-'));
  try {
    const ledger = new CapabilityLifecycleLedger(join(room, 'lifecycle'));
    const candidates = new LearningCandidateStore({ ledger, makeId: () => 'proposal-3' });
    await candidates.stage({ name: 'recover-report-work', description: 'Recover and verify interrupted report work.',
      content: skill, sourcePointers: [source(1), source(2)], createdRunId: 'review' });
    const candidate = await candidates.inspect('proposal-3');
    await ledger.append('tested', { proposalId: 'proposal-3', kind: 'skill', id: candidate.name,
      lifecycleAction: 'activate', state: 'tested', sourceRunId: 'qualification',
      candidateRevision: { version: null, digest: candidate.revisionDigest },
      comparison: { qualificationReceipt: { state: 'qualified', digest: 'qualified' } } });
    const managed = new ManagedSkillStore({ root: join(room, 'managed'),
      catalogSnapshot: { skills: [], contentByName: new Map() }, policyCatalog: { byName: new Map() } });
    const runs = { read: async () => ({}) };
    const recommend = makeCapabilityLifecycleTool({ ledger, runLedger: runs, stores: { skill: managed },
      learningCandidates: candidates, currentRunId: 'recommend', currentRunOrigin: 'learning_review' });
    await recommend.execute({ action: 'recommend', proposalId: 'proposal-3', kind: null, id: null,
      lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect: null });
    const apply = makeCapabilityLifecycleTool({ ledger, runLedger: runs, stores: { skill: managed },
      learningCandidates: candidates, currentRunId: 'apply', currentRunOrigin: 'learning_promotion' });
    const activated = await apply.execute({ action: 'apply', proposalId: 'proposal-3', kind: null, id: null,
      lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [],
      effect: { kind: 'local_change', reversible: true } });
    assert.equal(activated.state, 'active');
    assert.deepEqual(await managed.activeRevision('recover-report-work'), {
      active: true, version: null, digest: candidate.revisionDigest });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('activation 뒤 lifecycle commit이 실패하면 learned Skill은 active로 남지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-activation-fault-'));
  try {
    const baseLedger = new CapabilityLifecycleLedger(join(room, 'lifecycle'));
    const candidates = new LearningCandidateStore({ ledger: baseLedger, makeId: () => 'proposal-4' });
    await candidates.stage({ name: 'recover-report-work', description: 'Recover and verify interrupted report work.',
      content: skill, sourcePointers: [source(1), source(2)], createdRunId: 'review' });
    const candidate = await candidates.inspect('proposal-4');
    await baseLedger.append('tested', { proposalId: 'proposal-4', kind: 'skill', id: candidate.name,
      lifecycleAction: 'activate', state: 'tested', sourceRunId: 'qualification',
      candidateRevision: { version: null, digest: candidate.revisionDigest },
      comparison: { qualificationReceipt: { state: 'qualified', digest: 'qualified' } } });
    await baseLedger.append('recommended', { proposalId: 'proposal-4', kind: 'skill', id: candidate.name,
      lifecycleAction: 'activate', state: 'recommended', sourceRunId: 'recommend' });
    const faultyLedger = { directory: baseLedger.directory,
      current: (id) => baseLedger.current(id), list: () => baseLedger.list(),
      async append(type, payload) { if (type === 'applied') throw new Error('injected lifecycle failure');
        return baseLedger.append(type, payload); } };
    const managed = new ManagedSkillStore({ root: join(room, 'managed'),
      catalogSnapshot: { skills: [], contentByName: new Map() }, policyCatalog: { byName: new Map() } });
    const apply = makeCapabilityLifecycleTool({ ledger: faultyLedger, runLedger: { read: async () => ({}) },
      stores: { skill: managed }, learningCandidates: candidates,
      currentRunId: 'apply', currentRunOrigin: 'learning_promotion' });
    await assert.rejects(() => apply.execute({ action: 'apply', proposalId: 'proposal-4', kind: null,
      id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null,
      unknowns: [], effect: { kind: 'local_change', reversible: true } }), /injected/u);
    assert.equal((await managed.activeRevision('recover-report-work')).active, false);
    assert.equal((await baseLedger.current('proposal-4')).state, 'recommended');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('active publish 뒤 managed lifecycle append가 실패해도 learned Skill을 inactive로 되돌린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-managed-fault-'));
  try {
    const managed = new ManagedSkillStore({ root: join(room, 'managed'),
      catalogSnapshot: { skills: [], contentByName: new Map() }, policyCatalog: { byName: new Map() } });
    const revisionDigest = createHash('sha256').update(skill).digest('hex');
    managed.append = async () => { throw new Error('injected managed ledger failure'); };
    await assert.rejects(() => managed.activateLearned({ name: 'recover-report-work', content: skill,
      proposalId: 'proposal', revisionDigest }), /injected/u);
    assert.equal((await managed.activeRevision('recover-report-work')).active, false);
  } finally { await rm(room, { recursive: true, force: true }); }
});
