import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s3-terminal-core-human-qualification-2026-08-26.json', import.meta.url);

test('Terminal Core 인간 자격은 최초 실패와 수리 후 8/8을 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(evidence.verdict, 'PASS_WITH_OBSERVATION');
  assert.equal(evidence.coreJourneys.pairedUserGoalPassesAfterRepair, '8/8');
  assert.equal(evidence.firstPass['gpt-5.6-terra'][3].passed, false);
  assert.equal(evidence.firstPass['gpt-5.6-terra'][3].providerTokens, 475142);
  assert.equal(evidence.repairQualification['gpt-5.6-terra'].passed, true);
  assert.equal(evidence.repairQualification['gpt-5.6-terra'].programExecutions, 1);
  assert.equal(evidence.repairQualification['gpt-5.5'].programExecutions, 1);
  assert.equal(evidence.repairQualification['gpt-5.6-terra'].learningReview, 0);
  assert.ok(evidence.notClaimed.includes('clean full-model performance median'));
  assert.ok(evidence.notClaimed.includes('GitHub account live qualification'));
});
