import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S3-UX 재자격은 full tools·milestone·managed cancel·KHB-H01 네 경계를 모두 닫는다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-ux-requalification-pass-2026-08-27.json', import.meta.url)));
  assert.equal(value.status, 'PASS_WITH_OBSERVATION');
  assert.equal(value.fullToolProviderSmoke.passed, true);
  assert.equal(value.meaningfulMilestone.rawOutputStoredInMilestone, false);
  assert.equal(value.managedChildCancellation.actualProcessTreeTest, 'PASS');
  assert.equal(value.khbH01.passed, true);
  assert.equal(value.khbH01.final.sameWorkRecoveryQualified, true);
  assert.equal(value.khbH01.final.followupReplayedProcess, false);
});

test('재자격 evidence는 실패·비용 unknown·Windows 미자격을 지우지 않는다', async () => {
  const value = JSON.parse(await readFile(new URL('../evidence/s3-ux-requalification-pass-2026-08-27.json', import.meta.url)));
  assert.equal(value.khbH01.failedProductAttemptsPreserved, 6);
  assert.equal(value.qualificationCost.knownTokens, null);
  assert.ok(value.notClaimed.includes('physical Windows UI qualification'));
  assert.equal(value.officialReleaseGateChanged, false);
});
