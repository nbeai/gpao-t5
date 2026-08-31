import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-hq-macos-source-closeout-2026-08-30.json', import.meta.url,
), 'utf8'));
const twoWave = JSON.parse(await readFile(new URL(
  '../evidence/s6-total-human-hq-two-wave-closeout-2026-08-31.json', import.meta.url,
), 'utf8'));

test('S6-HQ macOS source closeout은 실제 UX 성공과 속도·desktop·Windows 비주장을 함께 보존한다', () => {
  assert.equal(evidence.actualConsoleMissions.length, 10);
  assert.equal(evidence.liveSpeed.weather.passedTruth, true);
  assert.equal(evidence.liveSpeed.weather.targetMet, false);
  assert.equal(evidence.liveSpeed.singleAttachment.passedTruth, true);
  assert.equal(evidence.safetyTruth.falseCompletion, 0);
  assert.equal(evidence.claims.macosSourceCandidateComplete, true);
  assert.equal(evidence.claims.fullCrossPlatformSixthComplete, false);
  assert.equal(evidence.claims.windowsDeferredNotWaived, true);
  assert.equal(evidence.claims.installerOrReleasePackageBuilt, false);
  assert.equal(evidence.verification.fullCI.check, 'PASS');
  assert.equal(evidence.verification.fullCI.mutation, 'PASS_2_OF_2');
});

test('두 회차 총괄 HQ는 실제 Console·Telegram·복구·결과 위생과 package·Windows 비주장을 함께 닫는다', () => {
  assert.equal(twoWave.humanExecution.actualConsole, true);
  assert.equal(twoWave.humanExecution.actualTelegramApp, true);
  assert.equal(twoWave.secondWave.length, 5);
  assert.ok(twoWave.secondWave.every((mission) => mission.status.startsWith('PASS')));
  const integrated = twoWave.secondWave.find((mission) => mission.id === 'W2-3');
  assert.equal(integrated.internalFilesInZip, 0);
  assert.equal(integrated.privateBackupFolders, 0);
  assert.equal(integrated.projectUndoExact, true);
  assert.equal(twoWave.uxRepair.inputToVisiblePreparationMs < 500, true);
  assert.deepEqual(twoWave.verification.unit, { passed: 1969, failed: 0, skippedWindows: 1 });
  assert.deepEqual(twoWave.verification.productIntegration, { passed: 207, failed: 0, skippedWindows: 2 });
  assert.equal(twoWave.scope.packageBuilt, false);
  assert.equal(twoWave.scope.windowsQualified, false);
});
