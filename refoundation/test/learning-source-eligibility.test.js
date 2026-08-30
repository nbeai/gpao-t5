import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveLearningSourceEligibility } from '../src/learning-source-eligibility.js';

function fixture({ outcome = 'achieved', objectiveOutcome = 'achieved', resultState = 'delivery_terminal',
  deliveryState = 'persisted', runStatus = 'completed', blockers = [], receiptOutcome = 'succeeded' } = {}) {
  const workId = 'work-1'; const runId = 'run-1';
  const workState = {
    works: [{ workId, sessionId: 'session-1', revision: 2, status: outcome === 'achieved' ? 'completed' : 'active',
      sourceMessageId: 'message-1' }],
    proposals: [{ workId, runId, revision: 2, proposedOutcome: outcome,
      verifiedOutcome: outcome, blockerDigest: 'blockers', blockers }],
    results: [{ workId, runId, sessionId: 'session-1', revision: 2, objectiveOutcome,
      resultDigest: 'result-digest', state: resultState,
      delivery: { provider: 'console', state: deliveryState } }],
    events: [{ type: 'work_settled', workId, runId, revision: 2, outcome,
      recordedAt: '2026-08-25T00:00:00.000Z' }],
  };
  const runs = [{ runId, sessionId: 'session-1', status: runStatus,
    events: [{ type: 'tool_completed', payload: { receipt: { outcome: receiptOutcome,
      result: receiptOutcome === 'unknown' ? { effectUnknown: true } : { state: 'observed' } } } }] }];
  return { workState, runs };
}

test('달성·검증·surface·delivery·Run·effect가 모두 terminal인 Episode만 learning source가 된다', () => {
  const report = deriveLearningSourceEligibility(fixture());
  assert.equal(report.sources.length, 1); assert.equal(report.sources[0].eligible, true);
  assert.deepEqual(report.sources[0].reasons, []);
  assert.deepEqual(report.sources[0].learningSignals, ['work_revised']);
  assert.deepEqual(report.sources[0].pointer, { workId: 'work-1', revision: 2, runId: 'run-1',
    sessionId: 'session-1', sourceMessageId: 'message-1', resultDigest: 'result-digest' });
  assert.doesNotMatch(JSON.stringify(report), /surfaceResult|content|prompt|reply/u);
});

test('단순 성공은 reviewer admission 신호가 아니고 실패 뒤 다른 route 성공은 content-free 신호다', () => {
  const simple = fixture(); simple.workState.events[0].revision = 1;
  simple.workState.works[0].revision = 1; simple.workState.proposals[0].revision = 1;
  simple.workState.results[0].revision = 1;
  assert.deepEqual(deriveLearningSourceEligibility(simple).sources[0].learningSignals, []);
  const recovered = fixture(); recovered.workState.events[0].revision = 1;
  recovered.workState.works[0].revision = 1; recovered.workState.proposals[0].revision = 1;
  recovered.workState.results[0].revision = 1;
  recovered.runs[0].events = [
    { type: 'tool_completed', payload: { receipt: { outcome: 'failed',
      requestedCall: { name: 'exec', args: { command: 'first' } }, result: { state: 'failed' } } } },
    { type: 'tool_completed', payload: { receipt: { outcome: 'succeeded',
      requestedCall: { name: 'exec', args: { command: 'second' } }, result: { state: 'observed' } } } },
  ];
  assert.deepEqual(deriveLearningSourceEligibility(recovered).sources[0].learningSignals,
    ['failure_recovered_by_different_route']);
});

test('Run completed만으로 unresolved·delivery 실패·effect unknown을 학습 성공으로 만들지 않는다', () => {
  const unresolved = deriveLearningSourceEligibility(fixture({ outcome: 'unresolved' })).sources[0];
  assert.equal(unresolved.eligible, false); assert.ok(unresolved.reasons.includes('work_not_achieved'));
  const failedDelivery = deriveLearningSourceEligibility(fixture({ deliveryState: 'failed' })).sources[0];
  assert.equal(failedDelivery.eligible, false); assert.ok(failedDelivery.reasons.includes('delivery_not_confirmed'));
  const unknownEffect = deriveLearningSourceEligibility(fixture({ receiptOutcome: 'unknown' })).sources[0];
  assert.equal(unknownEffect.eligible, false); assert.ok(unknownEffect.reasons.includes('effect_unknown'));
});

test('누락된 proposal·result·Run은 0으로 꾸미지 않고 각각 source 미달로 남긴다', () => {
  const missing = fixture(); missing.workState.proposals = []; missing.workState.results = []; missing.runs = [];
  const source = deriveLearningSourceEligibility(missing).sources[0];
  assert.equal(source.eligible, false);
  assert.deepEqual(source.reasons, ['completion_not_verified', 'result_missing', 'run_missing']);
});
