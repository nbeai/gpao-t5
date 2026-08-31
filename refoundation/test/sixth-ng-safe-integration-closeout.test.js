import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-ng-safe-integration-closeout-2026-08-31.json', import.meta.url);

test('S6-NG closeout은 전체 연구를 읽고 완료된 NG0·1·2·7을 중복 개발하지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.researchRead.complete, true);
  assert.equal(value.researchRead.markdownFiles, 10);
  assert.equal(value.researchRead.lines, 5377);
  assert.match(value.absorbed.NG0, /complete/u);
  assert.match(value.absorbed.NG1, /complete/u);
  assert.match(value.absorbed.NG2, /closed/u);
});

test('S6-NG closeout은 실패한 Lens와 미자격 Method·Auditory·Document 구현을 제품에 남기지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.executed.NG3A.practicalLens, 'REJECTED');
  assert.equal(value.executed.NG3A.productChanges, 0);
  assert.equal(value.executed.NG5_DR0.productChanges, 0);
  for (const name of ['Method Runtime', 'Auditory implementation',
    'Computer Use', 'global Practical Judgment Prompt']) assert.ok(value.notOpened.includes(name), name);
  assert.equal(value.productSourceChanges, 0);
  assert.equal(value.newStores, 0);
  assert.equal(value.newRouters, 0);
});

test('S6-NG closeout은 전체 CI와 Windows 물리 비주장을 유지한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.verification.fullCiBeforeEvidenceOnlyNgAdditions.exitCode, 0);
  assert.equal(value.verification.fullCiBeforeEvidenceOnlyNgAdditions.integration.failed, 0);
  assert.equal(value.verification.fullCiBeforeEvidenceOnlyNgAdditions.integration.skippedPhysicalWindows, 2);
  assert.equal(value.verification.fullCiBeforeEvidenceOnlyNgAdditions.mutation.survived, 0);
});
