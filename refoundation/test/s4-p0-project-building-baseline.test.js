import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S4-P0 actual은 화면 성공과 Runtime 밖 dev server 결함을 합치지 않는다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-p0-project-building-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.productSourceDirty, false);
  for (const name of ['createdWebsite', 'companyContent', 'consultationForm', 'localBrowserNavigation',
    'formFilled', 'formSubmitted', 'successObserved', 'externalPublicationZero', 'sourceUnchanged']) {
    assert.equal(evidence.checks[name], true, name);
  }
  assert.equal(evidence.checks.devServerOwned, false);
  assert.equal(evidence.checks.temporaryResidueZero, false);
  assert.equal(evidence.firstDefectFamily, 'dev_server_ownership_cleanup');
  assert.equal(evidence.delivery.runningManagedProcesses, 0);
  assert.deepEqual(evidence.delivery.temporaryResidue, ['server.log', 'server.pid']);
  assert.equal(evidence.delivery.postRunAudit.ppid, 1);
  assert.equal(evidence.delivery.postRunAudit.terminationVerified, true);
  assert.equal(evidence.purposePassed, false);
  assert.equal(evidence.decision, 'S4_P_FIRST_BINDING_DEFECT_REPRODUCED');
});

test('S4-P0 runner는 실제 모델·외부 계정 대신 격리 fixture와 current product를 사용한다', async () => {
  const source = await readFile(new URL(
    '../scripts/run-s4p0-project-building-baseline.mjs', import.meta.url), 'utf8');
  assert.match(source, /actualUserData: false/u);
  assert.match(source, /actualExternalAccount: false/u);
  assert.match(source, /productChanges: candidate \? 1 : 0/u);
  assert.match(source, /makeConsoleServer/u);
  assert.match(source, /makeAgentBrowserDriver/u);
  assert.match(source, /dev_server_ownership_cleanup/u);
  assert.doesNotMatch(source, /Intent|frameworkRouter|ProjectStore/u);
});
