import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const closeoutUrl = new URL('../evidence/s6-wp0-windows-prephysical-closeout-2026-08-31.json', import.meta.url);

test('WP0 closeout은 물리 Windows 전 가능한 수리와 실제 OS blocker를 분리한다', async () => {
  const value = JSON.parse(await readFile(closeoutUrl, 'utf8'));
  assert.equal(value.status, 'PREPHYSICAL_COMPLETE_RUNNER_ALLOCATION_BLOCKED_PHYSICAL_PENDING');
  assert.equal(value.sourceBaseline, '7a47f69afb1480c887d7bf641dad062c584e28f9');
  assert.equal(value.productCodeHead, '4d14b7af80e0718fa393a3dab96f737d57c164d0');
  assert.equal(value.possibleBeforePhysicalWindows.status, 'COMPLETE');
  assert.ok(value.possibleBeforePhysicalWindows.implementedRepairs.length >= 8);
  assert.equal(value.possibleBeforePhysicalWindows.boundedOpenFamilies.length, 3);
  assert.ok(value.physicalBlockers.length >= 8);
  assert.equal(value.windowsInstallerDecision, 'OWNER_PENDING');
});

test('WP0 closeout은 CI 성공과 zero-step hosted runner 실패를 서로 바꾸지 않는다', async () => {
  const value = JSON.parse(await readFile(closeoutUrl, 'utf8'));
  assert.equal(value.verification.fullCi.exitCode, 0);
  assert.equal(value.verification.fullCi.integration.failed, 0);
  assert.equal(value.verification.fullCi.mutation.survived, 0);
  assert.equal(value.verification.hostedRunner.windowsStepsStarted, 0);
  assert.equal(value.verification.hostedRunner.productCodeExecuted, false);
  assert.equal(value.claims.currentHeadWindowsRunnerPass, false);
  assert.equal(value.claims.physicalWindowsX64Pass, false);
  assert.equal(value.claims.physicalWindowsArm64Pass, false);
  assert.equal(value.claims.publicWindowsReleaseReady, false);
});

test('WP0 closeout은 새 Router Store Prompt와 Windows installer로 범위를 넓히지 않는다', async () => {
  const value = JSON.parse(await readFile(closeoutUrl, 'utf8'));
  assert.equal(value.possibleBeforePhysicalWindows.newStores, 0);
  assert.equal(value.possibleBeforePhysicalWindows.newRouters, 0);
  assert.equal(value.possibleBeforePhysicalWindows.modelSpecificRuntimeOrPrompt, 0);
  assert.equal(value.possibleBeforePhysicalWindows.windowsInstallerBuilt, false);
  assert.equal(value.claims.windowsInstallerReady, false);
});
