import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CapabilityLifecycleLedger, makeCapabilityLifecycleTool } from '../src/capability-lifecycle.js';

function run(id, used = false) { return { runId: id, status: 'completed', startedAt: '2026-08-21T00:00:00Z', endedAt: '2026-08-21T00:00:01Z', events: [
  ...(used ? [{ type: 'tool_completed', payload: { receipt: { requestedCall: { name: 'exec', args: {} }, actualCall: { name: 'exec', args: {} }, outcome: 'succeeded', result: { capabilitiesUsed: [{ kind: 'cli', id: 'jq', version: '1.8.2' }] } } } }] : []),
  { type: 'run_completed', payload: { modelTurns: 2, receiptCount: used ? 1 : 0 } },
] }; }
function qualifiedComparison({ kind, id, baselineRuns, candidateRuns }) {
  const baselineUsed = baselineRuns.flatMap((run) => run.events).some((event) => event.payload?.receipt?.result?.capabilitiesUsed);
  const candidateRevision = candidateRuns.flatMap((run) => run.events)
    .flatMap((event) => event.payload?.receipt?.result?.capabilitiesUsed ?? [])[0] ?? {};
  return {
    capability: { kind, id },
    baseline: { revisions: baselineUsed ? [{ version: '1.8.2', digest: null }] : [] },
    candidate: { revisions: [{ version: candidateRevision.version ?? null,
      digest: candidateRevision.digest ?? null }] },
    comparisonBoundary: { samePurposeVerified: true, answerCorrectnessMeasured: true,
      qualityMeasured: true, sourceEligibilityVerified: true,
      triggerHoldoutVerified: true, fieldObservationVerified: true },
    qualificationReceipt: { state: 'qualified', digest: 'qualification-digest' },
  };
}
const effect = { kind: 'local_change', targets: ['managed capability'],
  confirmation: 'not_applicable', rollbackOfToolCallId: null };

test('제안→tested→recommended와 적용은 다른 Run으로 분리되고 archive·restore가 복구된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-lifecycle-')); const runs = new Map([['b', run('b')], ['c', run('c', true)]]); const calls = [];
  try {
    const ledger = new CapabilityLifecycleLedger(join(room, 'lifecycle')); let active = true; const revision = { active: true, version: '1.8.2', digest: null };
    const stores = { cli: { activeRevision: async () => active ? revision : { active: false, version: null, digest: null }, remove: async (id) => (calls.push(['remove', id]), active = false, { state: 'removed', recoverable: true }), restoreExact: async (id) => (calls.push(['restore', id]), active = true, { state: 'restored' }), rollbackTo: async () => ({}) } };
    const tool1 = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) }, stores,
      currentRunId: 'proposal-run', currentRunOrigin: 'user', compareRuns: qualifiedComparison });
    const proposed = await tool1.execute({ action: 'propose', proposalId: null, kind: 'cli', id: 'jq', lifecycleAction: 'archive', baselineRunIds: ['b'], candidateRunIds: ['c'], rationale: '후보가 맞지 않음', unknowns: ['표본 1개'], effect: null });
    assert.equal(proposed.state, 'tested');
    const recommended = await tool1.execute({ action: 'recommend', proposalId: proposed.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect: null });
    assert.equal(recommended.state, 'recommended');
    await assert.rejects(() => tool1.execute({ action: 'apply', proposalId: proposed.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect }), /later Run/u);
    const wake = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) }, stores, currentRunId: 'wake-run', currentRunOrigin: 'managed_process_terminal' });
    await assert.rejects(() => wake.execute({ action: 'apply', proposalId: proposed.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect }), /user or qualified learning Run/u);
    const tool2 = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) }, stores, currentRunId: 'apply-run', currentRunOrigin: 'user' });
    assert.equal((await tool2.execute({ action: 'apply', proposalId: proposed.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect })).state, 'archived');
    const tool3 = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) }, stores, currentRunId: 'restore-run', currentRunOrigin: 'user' });
    assert.equal((await tool3.execute({ action: 'restore', proposalId: proposed.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect })).state, 'active');
    assert.deepEqual(calls, [['remove', 'jq'], ['restore', 'jq']]);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('store method 부재·사후 상태 불일치는 lifecycle 성공 사건을 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-lifecycle-truth-')); const runs = new Map([['b', run('b')], ['c', run('c', true)]]);
  try {
    const ledger = new CapabilityLifecycleLedger(room); const stores = { cli: { activeRevision: async () => ({ active: true, version: '1.8.2', digest: null }) } };
    const proposalTool = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) }, stores,
      currentRunId: 'p', currentRunOrigin: 'user', compareRuns: qualifiedComparison });
    const p = await proposalTool.execute({ action: 'propose', proposalId: null, kind: 'cli', id: 'jq', lifecycleAction: 'archive', baselineRunIds: ['b'], candidateRunIds: ['c'], rationale: 'test', unknowns: [], effect: null });
    await proposalTool.execute({ action: 'recommend', proposalId: p.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect: null });
    const applyTool = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) }, stores, currentRunId: 'a', currentRunOrigin: 'user' });
    await assert.rejects(() => applyTool.execute({ action: 'apply', proposalId: p.proposalId, kind: null, id: null, lifecycleAction: null, baselineRunIds: [], candidateRunIds: [], rationale: null, unknowns: [], effect }), /does not support remove/u);
    assert.equal((await ledger.current(p.proposalId)).state, 'recommended');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('apply·restore만 reversible local effect를 요구하고 hard delete action은 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-lifecycle-preflight-'));
  try {
    const tool = makeCapabilityLifecycleTool({ ledger: new CapabilityLifecycleLedger(room), runLedger: { read: async () => run('x') }, stores: {}, currentRunId: 'r', currentRunOrigin: 'user', authorizeEffect: async () => ({ allowed: true }) });
    assert.equal(tool.parameters.properties.action.enum.includes('delete'), false);
    assert.equal((await tool.preflight({ action: 'list', effect: null })).allowed, true);
    assert.equal((await tool.preflight({ action: 'apply', effect: { kind: 'observe' } })).allowed, false);
    assert.equal((await tool.preflight({ action: 'restore', effect })).allowed, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('same-purpose·correctness·quality 미검증 comparison은 tested 사건을 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-lifecycle-unqualified-'));
  try {
    const runs = new Map([['b', run('b')], ['c', run('c', true)]]);
    const ledger = new CapabilityLifecycleLedger(room);
    const tool = makeCapabilityLifecycleTool({ ledger, runLedger: { read: async (id) => runs.get(id) },
      stores: {}, currentRunId: 'p', currentRunOrigin: 'user' });
    await assert.rejects(() => tool.execute({ action: 'propose', proposalId: null, kind: 'cli', id: 'jq',
      lifecycleAction: 'keep', baselineRunIds: ['b'], candidateRunIds: ['c'], rationale: '한 번 빨랐음',
      unknowns: ['correctness not measured'], effect: null }), /observation-only/u);
    assert.deepEqual(await ledger.events(), []);
  } finally { await rm(room, { recursive: true, force: true }); }
});
