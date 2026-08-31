import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-perf2a-parallel-selection-2026-08-31.json', import.meta.url);

test('PERF-2A는 baseline의 기존 batch 능력을 확인하고 flag·전역 지침을 채택하지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'COMPLETE_NO_PRODUCT_ADOPTION');
  assert.equal(value.syntheticIndependentReadOnly.currentDefault.firstToolBatchSize, 3);
  assert.equal(value.syntheticIndependentReadOnly.providerFlag.firstToolBatchSize, 3);
  assert.equal(value.syntheticIndependentReadOnly.flagPlusGuidance.firstToolBatchSize, 3);
  assert.equal(value.decision.explicitParallelToolCalls, 'NOT_ADOPTED');
  assert.equal(value.decision.globalCrossToolGuidance, 'NOT_ADOPTED');
  assert.equal(value.productDefaultChanged, false);
});

test('실제 제품 파일 목적은 기존 compound Terminal 한 번으로 끝나 segmented 실행 근거가 아니다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.actualProductFilePurpose.passed, true);
  assert.equal(value.actualProductFilePurpose.modelCalls, 3);
  assert.equal(value.actualProductFilePurpose.toolCalls, 2);
  assert.equal(value.actualProductFilePurpose.segmentedParallelOpportunity, false);
  assert.equal(value.decision.segmentedExecution, 'NOT_OPENED');
  assert.equal(value.invalidRunsExcluded.productPatchFromInvalidRuns, 0);
});

test('qualification-only parallel flag는 제품 factory 기본 배선에 들어가지 않는다', async () => {
  const [factory, evidence] = await Promise.all([
    readFile(new URL('../src/console-model-factory.js', import.meta.url), 'utf8'),
    readFile(evidenceUrl, 'utf8').then(JSON.parse),
  ]);
  assert.doesNotMatch(factory, /parallelToolCalls/u);
  assert.equal(evidence.carry.family, 'completion_proposal_to_final_answer_round_trip');
});
