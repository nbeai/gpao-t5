import test from 'node:test';
import assert from 'node:assert/strict';

import { compareCapabilityRuns, makeCapabilityComparisonTool } from '../src/capability-comparison.js';

function run(id, { status = 'completed', durationMs = 1000, used = false, modelTurns = 2, calls = 1 } = {}) {
  const start = '2026-08-21T00:00:00.000Z'; const end = durationMs == null ? null : new Date(Date.parse(start) + durationMs).toISOString();
  const events = Array.from({ length: calls }, (_, index) => ({ type: 'tool_completed', payload: { receipt: {
    requestedCall: { name: 'exec', args: { command: used ? 'jq .' : 'python3 work.py' } }, actualCall: { name: 'exec', args: {} }, outcome: index ? 'failed' : 'succeeded',
    result: used && index === 0 ? { capabilitiesUsed: [{ kind: 'cli', id: 'jq', version: '1.8.2', digest: 'a'.repeat(64) }] } : {},
  } } }));
  if (status !== 'interrupted') events.push({ type: `run_${status}`, payload: { modelTurns, receiptCount: calls } });
  return { runId: id, status, startedAt: start, endedAt: end, events };
}

test('baseline과 candidate의 상태·시간·왕복·실패를 개별값과 median으로 보존한다', () => {
  const result = compareCapabilityRuns({
    kind: 'cli', id: 'jq',
    baselineRuns: [run('b1', { durationMs: 3000 }), run('b2', { durationMs: 1000, status: 'failed', calls: 2 })],
    candidateRuns: [run('c1', { durationMs: 2000, used: true }), run('c2', { durationMs: null, used: true, status: 'interrupted' })],
  });
  assert.deepEqual(result.baseline.durationMs, { observed: 2, unknown: 0, min: 1000, median: 2000, max: 3000 });
  assert.deepEqual(result.candidate.durationMs, { observed: 1, unknown: 1, min: 2000, median: 2000, max: 2000 });
  assert.equal(result.baseline.status.failed, 1); assert.equal(result.candidate.status.interrupted, 1);
  assert.equal(result.baseline.failedToolCalls, 1); assert.equal(result.candidate.failedToolCalls, 0);
  assert.equal(result.winner, undefined); assert.equal(result.comparisonBoundary.samePurposeVerified, false);
});

test('candidate 미사용과 baseline의 같은 capability 사용은 비교 전에 거부한다', () => {
  assert.throws(() => compareCapabilityRuns({ kind: 'cli', id: 'jq', baselineRuns: [run('b')], candidateRuns: [run('c')] }), /candidate.*use/iu);
  assert.throws(() => compareCapabilityRuns({ kind: 'cli', id: 'jq', baselineRuns: [run('b', { used: true })], candidateRuns: [run('c', { used: true })] }), /baseline.*must not use/iu);
});

test('read-only comparison tool은 exact Run만 읽고 recommendation·변경 action이 없다', async () => {
  const runs = new Map([['b', run('b')], ['c', run('c', { used: true })]]);
  const tool = makeCapabilityComparisonTool({ runLedger: { read: async (id) => runs.get(id) } });
  assert.deepEqual(tool.parameters.properties.action.enum, ['compare']);
  const result = await tool.execute({ action: 'compare', kind: 'cli', id: 'jq', baselineRunIds: ['b'], candidateRunIds: ['c'] });
  assert.equal(result.baseline.sampleSize, 1); assert.equal(result.candidate.sampleSize, 1);
  assert.equal(result.recommendation, undefined); assert.equal(result.comparisonBoundary.lifecycleChanges, 0);
});
