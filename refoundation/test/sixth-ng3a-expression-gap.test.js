import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-ng3a-expression-gap-2026-08-31.json', import.meta.url);

test('NG3A는 ordinary와 expert의 실제 목적·비용 격차를 세 분야에서 분리한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.baseline.sales.ordinary.purposePass, false);
  assert.equal(value.baseline.sales.expert.purposePass, true);
  assert.equal(value.baseline.receivables.ordinary.purposePass, false);
  assert.equal(value.baseline.receivables.expert.purposePass, true);
  assert.equal(value.baseline.inventory.ordinary.purposePass, true);
  assert.equal(value.baseline.inventory.ordinary.modelCalls > value.baseline.inventory.expert.modelCalls, true);
});

test('NG3A qualification Lens는 Direct를 보존했지만 두 목적 실패로 폐기된다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.qualificationOnlyPracticalLens.directHoldout.toolCalls, 0);
  assert.equal(value.qualificationOnlyPracticalLens.sales.purposePass, false);
  assert.equal(value.qualificationOnlyPracticalLens.receivables.purposePass, false);
  assert.equal(value.qualificationOnlyPracticalLens.decision, 'REJECTED');
  assert.equal(value.productChanges, 0);
});

test('NG3A는 모델 판단 관측을 Runtime Router·Prompt patch 근거로 승격하지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'CLOSED_WITH_MODEL_JUDGMENT_OBSERVATION_CANDIDATE_REJECTED');
  assert.equal(value.failureFamily.runtimeInformationMissingProven, false);
  assert.equal(value.failureFamily.modelJudgmentQualityObservation, true);
  assert.equal(value.failureFamily.newRuntimeOrPromptAuthorized, false);
  assert.match(value.stopRule, /Do not attach a second/u);
});
