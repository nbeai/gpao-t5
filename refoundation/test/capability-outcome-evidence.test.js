import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCapabilityOutcomeEvidence, makeCapabilityEvidenceTool } from '../src/capability-outcome-evidence.js';

function run({ id, status = 'completed', startedAt = '2026-08-21T00:00:00.000Z', receipts = [], modelTurns = 2 } = {}) {
  const terminalType = status === 'interrupted' ? null : `run_${status}`;
  return {
    runId: id, sessionId: `session-${id}`, status, startedAt,
    endedAt: terminalType ? '2026-08-21T00:00:02.000Z' : null,
    events: [
      { type: 'run_started', payload: {} },
      ...receipts.map((receipt, index) => ({ type: 'tool_completed', sequence: index + 2, payload: { receipt } })),
      ...(terminalType ? [{ type: terminalType, payload: { modelTurns, receiptCount: receipts.length } }] : []),
    ],
  };
}

const receipt = (name, args, result = {}, outcome = 'succeeded') => ({
  requestedCall: { name, args }, actualCall: outcome === 'not_executed' ? null : { name, args }, outcome, result,
});

test('준비만 한 CLI와 실제 사용한 CLI를 구분하고 Run 완료를 목적 달성으로 만들지 않는다', () => {
  const report = deriveCapabilityOutcomeEvidence([
    run({ id: 'prepare', receipts: [receipt('cli_prepare', { action: 'install', id: 'jq' }, { state: 'installed', id: 'jq', version: '1.8.2', sha256: 'a'.repeat(64) })] }),
    run({ id: 'use', status: 'failed', receipts: [receipt('exec', { command: 'jq .' }, { capabilitiesUsed: [{ kind: 'cli', id: 'jq', version: '1.8.2', digest: 'a'.repeat(64) }] })] }),
  ]);
  const jq = report.capabilities.find((item) => item.kind === 'cli' && item.id === 'jq');
  assert.equal(jq.preparationRuns, 1); assert.equal(jq.usageRuns, 1);
  assert.equal(jq.completedUsageRuns, 0); assert.equal(jq.failedUsageRuns, 1);
  assert.equal(jq.runs.find((item) => item.runId === 'prepare').used, false);
  assert.equal(jq.purposeAchieved, undefined);
  assert.equal(report.interpretationBoundary.runCompletionIsNotPurposeAchievement, true);
  assert.equal(report.interpretationBoundary.retirementNotAuthorized, true);
});

test('skill search는 사용으로 세지 않고 본문 view만 digest와 결속한다', () => {
  const report = deriveCapabilityOutcomeEvidence([run({ id: 'skill', receipts: [
    receipt('skill', { action: 'search', name: 'triage' }, { state: 'searched', skills: [{ name: 'triage' }] }),
    receipt('skill', { action: 'view', name: 'triage' }, { state: 'viewed', name: 'triage', contentDigest: 'b'.repeat(64) }),
  ] })]);
  const skill = report.capabilities.find((item) => item.kind === 'skill' && item.id === 'triage');
  assert.equal(skill.usageRuns, 1); assert.equal(skill.runs[0].uses, 1); assert.deepEqual(skill.versions, ['b'.repeat(64)]);
});

test('도구 실패·미실행·취소·시간과 호출 수는 해석 없이 capability Run 사실로 남는다', () => {
  const report = deriveCapabilityOutcomeEvidence([run({ id: 'cancel', status: 'cancelled', receipts: [
    receipt('exec', { command: 'jq .' }, { capabilitiesUsed: [{ kind: 'cli', id: 'jq', version: '1.8.2', digest: 'c'.repeat(64) }] }),
    receipt('exec', { command: 'bad' }, { stderr: 'failed' }, 'failed'),
    receipt('exec', { command: 'blocked' }, { state: 'approval_required' }, 'not_executed'),
  ], modelTurns: 3 })]);
  const facts = report.capabilities[0].runs[0];
  assert.equal(facts.status, 'cancelled'); assert.equal(facts.durationMs, 2000); assert.equal(facts.modelTurns, 3);
  assert.equal(facts.toolCalls, 2); assert.equal(facts.failedToolCalls, 1); assert.equal(facts.notExecutedToolCalls, 1);
});

test('read-only evidence 도구는 list와 exact inspect만 제공하고 lifecycle 결정을 하지 않는다', async () => {
  const runs = [run({ id: 'one', receipts: [receipt('skill', { action: 'view', name: 'triage' }, { state: 'viewed', name: 'triage', contentDigest: 'd'.repeat(64) })] })];
  const tool = makeCapabilityEvidenceTool({ runLedger: { list: async () => runs } });
  assert.deepEqual(tool.parameters.properties.action.enum, ['list', 'inspect']);
  const listed = await tool.execute({ action: 'list', kind: null, id: null });
  assert.equal(listed.capabilities[0].id, 'triage');
  assert.deepEqual((await tool.execute({ action: 'list', kind: 'cli', id: null })).capabilities, []);
  const inspected = await tool.execute({ action: 'inspect', kind: 'skill', id: 'triage' });
  assert.equal(inspected.capability.usageRuns, 1); assert.equal(inspected.capability.recommendation, undefined);
});
