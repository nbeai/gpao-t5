import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-perf-safe-slice-closeout-2026-08-31.json', import.meta.url);

test('S6-PERF safe slice는 projection만 채택하고 이익 없는 세 후보를 폐기한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'PERF0_2A_4A_5_COMPLETE_SAFE_BOUNDARY');
  assert.deepEqual(value.adopted,
    ['content-free performance timeline projection over existing Run facts']);
  assert.equal(value.rejected.length, 3);
  assert.equal(value.productBehaviorChange, 'NONE');
});

test('S6-PERF safe slice는 위험한 후순위 기능과 무효 환경 patch를 열지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  for (const name of ['segmented execution', 'OCR observation cache',
    'completion co-settlement', 'provider wire epoch', 'programmatic Tool graph']) {
    assert.ok(value.notOpened.includes(name), name);
  }
  assert.equal(value.invalidEnvironmentRuns.productPatch, 0);
  assert.equal(value.newStore, 0);
  assert.equal(value.newPromptOrRouter, 0);
});

test('S6-PERF safe slice는 전체 CI와 Windows 물리 비주장을 유지한다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.verification.fullCi.exitCode, 0);
  assert.equal(value.verification.fullCi.integration.failed, 0);
  assert.equal(value.verification.fullCi.integration.skippedPhysicalWindows, 2);
  assert.equal(value.verification.fullCi.mutation.survived, 0);
});
