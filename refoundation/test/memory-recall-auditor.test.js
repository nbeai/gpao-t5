import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { auditRecallCase, decideRecallTechnologyGates } from '../src/memory-recall-auditor.js';

const root = new URL('../../', import.meta.url);
const observation = (overrides = {}) => ({ passed: true, sourcePresent: true, oracleValid: true,
  sourceReopened: true, model: null, wallMs: 1, requestBytes: 100, tokens: 10, ...overrides });

test('M4 corpus는 오너 승인 자연어 목적·source·oracle 다섯 개를 기술 선택 전에 고정한다', async () => {
  const corpus = JSON.parse(await readFile(new URL(
    'refoundation/config/s3-memory-recall-auditor.json', root,
  ), 'utf8'));
  assert.equal(corpus.status, 'owner_plan_questions_frozen_before_retrieval_expansion');
  assert.equal(corpus.cases.length, 5);
  assert.ok(corpus.cases.every((item) => item.purpose && item.sourceId && item.oracle));
  assert.equal(corpus.thresholds.modelFailuresToFail, 2);
});

test('deterministic incident는 같은 source·oracle의 한 번 miss로 failed다', () => {
  const audit = auditRecallCase({ definition: { id: 'd', lane: 'exact_identifier', kind: 'deterministic',
    sourceId: 's', oracle: {} }, observations: [observation({ passed: false })] });
  assert.equal(audit.status, 'failed');
});

test('model 한 번 miss는 insufficient이고 2/3 또는 두 모델 공통 실패만 failed다', () => {
  const definition = { id: 'm', lane: 'historical_date', kind: 'model', sourceId: 's', oracle: {} };
  assert.equal(auditRecallCase({ definition, observations: [
    observation({ passed: false, model: 'gpt-5.5' }),
  ] }).status, 'insufficient_sample');
  assert.equal(auditRecallCase({ definition, observations: [
    observation({ passed: false, model: 'gpt-5.5' }),
    observation({ passed: true, model: 'gpt-5.5' }),
    observation({ passed: false, model: 'gpt-5.6-terra' }),
  ] }).status, 'failed');
});

test('source 부재·oracle 모호·resource 형식 오류는 retrieval failed가 아니라 invalid다', () => {
  const definition = { id: 'm', lane: 'historical_date', kind: 'model', sourceId: 's', oracle: {} };
  assert.equal(auditRecallCase({ definition, observations: [
    observation({ sourcePresent: false }),
  ] }).status, 'invalid');
  assert.equal(auditRecallCase({ definition, observations: [
    observation({ wallMs: null }),
  ] }).status, 'invalid');
});

test('insufficient sample은 FTS·embedding·graph를 열지 않는다', () => {
  const decision = decideRecallTechnologyGates([
    { caseId: 'a', lane: 'historical_date', status: 'insufficient_sample' },
  ]);
  assert.equal(decision.fts, 'insufficient_sample');
  assert.equal(decision.embedding, 'closed_prerequisite_not_proven');
  assert.equal(decision.graph, 'closed_prerequisite_not_proven');
});

test('exact structured failure만 FTS 후보를 열고 다른 기술은 prerequisite 없이 열리지 않는다', () => {
  const decision = decideRecallTechnologyGates([
    { caseId: 'a', lane: 'exact_identifier', status: 'failed' },
    { caseId: 'b', lane: 'current_correction', status: 'passed' },
  ]);
  assert.equal(decision.fts, 'open_candidate');
  assert.equal(decision.embedding, 'closed_prerequisite_not_proven');
  assert.equal(decision.deepRecallModel, 'closed_prerequisite_not_proven');
});
