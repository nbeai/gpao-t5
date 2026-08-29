import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = (name) => readFile(new URL(`../evidence/${name}`, import.meta.url), 'utf8').then(JSON.parse);

test('P0B RED는 정확한 수동 복원과 durable Undo 부재를 분리한다', async () => {
  const value = await evidence('s4-p0b-existing-project-baseline-2026-08-30.json');
  assert.equal(value.checks.sourceFixed, true); assert.equal(value.checks.testsPassedAfterFix, true);
  assert.equal(value.checks.userDirtyPreservedAfterFix, true); assert.equal(value.checks.browserObservedStep2, true);
  assert.equal(value.checks.durableRollbackUsed, false);
  assert.equal(value.firstDefectFamily, 'durable_project_undo_activation');
  assert.equal(value.purposePassed, false);
});

test('P2는 dirty project의 수정·test·Browser·durable Undo를 한 여정으로 닫는다', async () => {
  const value = await evidence('s4-p2b-durable-project-undo-complete-2026-08-30.json');
  for (const name of ['sourceFixed', 'testsPassedAfterFix', 'userDirtyPreservedAfterFix',
    'browserNavigated', 'browserClickedNext', 'browserObservedStep2', 'undoHandleCreated',
    'durableRollbackUsed', 'sourceExactRestored', 'userDirtyPreservedAfterUndo', 'managedProcessStopped']) {
    assert.equal(value.checks[name], true, name);
  }
  assert.equal(value.secondTurn.route.some((item) => item.name === 'workspace_patch'
    && item.action === 'rollback' && item.state === 'rolled_back_verified'), true);
  assert.equal(value.purposePassed, true);
});

test('P1은 Runtime 재시작 뒤 같은 project와 exact Undo를 복원한다', async () => {
  const value = await evidence('s4-p1-runtime-project-continuity-final-2026-08-30.json');
  assert.equal(value.runtimeRestartedBeforeUndo, true); assert.equal(value.checks.runtimeRestartedBeforeUndo, true);
  assert.equal(value.checks.durableRollbackUsed, true); assert.equal(value.checks.sourceExactRestored, true);
  assert.equal(value.checks.userDirtyPreservedAfterUndo, true); assert.equal(value.purposePassed, true);
});

test('P4는 설치된 공식 Quick Tunnel 하나만 자격하고 현재 부재를 거짓 성공으로 만들지 않는다', async () => {
  const value = await evidence('s4-p4-quick-preview-qualification-2026-08-30.json');
  assert.equal(value.productContract.automaticInstall, false);
  assert.equal(value.productContract.urlReopenRequired, true);
  assert.equal(value.qualification.startUrlReopenStopPassed, true);
  assert.equal(value.qualification.actualExternalAccount, false);
  assert.equal(value.ownerHost.cloudflaredInstalled, false);
  assert.equal(value.ownerHost.actualPublicUrlRun, false);
});

test('P5는 새 운영 플랫폼 없이 기존 project continuity 증거를 모두 재사용한다', async () => {
  const value = await evidence('s4-p5-continuity-handoff-closeout-2026-08-30.json');
  for (const path of Object.values(value.projectContinuity)) await readFile(new URL(`../../${path}`, import.meta.url));
  for (const [name, passed] of Object.entries(value.checks)) {
    assert.equal(passed, ['programBlindRetry', 'filePublicationBlindRetry'].includes(name) ? false : true, name);
  }
  assert.equal(value.handoff.newDocumentationSystem, false); assert.equal(value.handoff.newProjectStore, false);
});
