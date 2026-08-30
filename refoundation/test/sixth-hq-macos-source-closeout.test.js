import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-hq-macos-source-closeout-2026-08-30.json', import.meta.url,
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
