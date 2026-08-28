import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('3차 설치 전 자격은 16개 인간 목적·격리·CA/M6 비활성·비주장을 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/third-completion-preinstall-qualification-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'PASS_WITH_OBSERVATION');
  assert.equal(evidence.productVersion, '0.3.0');
  assert.equal(evidence.humanScenarioQualification.required, 16);
  assert.equal(evidence.humanScenarioQualification.passed, 16);
  assert.equal(evidence.humanScenarioQualification.failed, 0);
  assert.equal(new Set(evidence.humanScenarioQualification.finalSuccessfulRuns.map((item) => item.id)).size, 16);
  assert.equal(evidence.humanScenarioQualification.privacy.realUserRootPathOrExcerptLeaks, 0);
  assert.equal(evidence.scopeDecisions.s3ca, 'deferred_to_fourth_product_entry_and_model_context_zero');
  assert.equal(evidence.scopeDecisions.m6AdaptiveLearning, 'deferred_default_off');
  assert.equal(evidence.scopeDecisions.installerCreated, false);
  assert.equal(evidence.conversationUx.simultaneousEnterAndSendAdmissions, 1);
  assert.equal(evidence.conversationUx.duplicateReplies, 0);
  assert.ok(evidence.notClaimed.includes('signed notarized or stapled package'));
  assert.doesNotMatch(JSON.stringify(evidence), /\/Users\/|C:\\Users\\|sk-[A-Za-z0-9]|-----BEGIN/u);
});

test('3차 정본은 설치 전 역사와 현재 Cleanroom 기준을 함께 가리킨다', async () => {
  const plan = await readFile(new URL('../../T5-THIRD-ACTIVATION-PREPARATION.md', import.meta.url), 'utf8');
  assert.match(plan, /THIRD_COMPLETION_0_3_1_PRODUCT_BASELINE/u);
  assert.match(plan, /PRODUCT_CLEANROOM_ACTIVE/u);
  assert.match(plan, /third-completion-preinstall-qualification-2026-08-28\.json/u);
  assert.match(plan, /전용 설치 세션/u);
  assert.match(plan, /S3CA_DEFERRED_TO_FOURTH/u);
  assert.match(plan, /t5-0\.3\.1-pre-clean-baseline/u);
});
