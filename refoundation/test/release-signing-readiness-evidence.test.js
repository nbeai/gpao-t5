import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/release-signing-readiness-2026-08-27.json', import.meta.url,
), 'utf8'));

test('Release readiness는 두 Developer ID·공증 profile·양쪽 runtime을 실제 준비 상태로 분리한다', () => {
  assert.equal(evidence.status, 'READY');
  assert.equal(evidence.passed, true);
  assert.equal(evidence.developerId.application.keychainIdentityValid, true);
  assert.equal(evidence.developerId.installer.keychainIdentityValid, true);
  assert.equal(evidence.notary.credentialsValidated, true);
  assert.equal(evidence.notary.acceptedSubmissionHistoryObserved, true);
  assert.equal(evidence.runtime.arm64ArchiveOfficialChecksumMatched, true);
  assert.equal(evidence.runtime.x64ArchiveOfficialChecksumMatched, true);
});

test('자격 준비는 현재 source package의 서명·공증·설치 완료로 승격되지 않는다', () => {
  assert.equal(evidence.sourceBoundary.privateKeysCopiedIntoRepository, false);
  assert.equal(evidence.sourceBoundary.releaseConfigurationCopiedIntoRepository, false);
  assert.ok(evidence.notClaimed.some((claim) => claim.includes('current-source signed package')));
  assert.ok(evidence.notClaimed.some((claim) => claim.includes('notarized or stapled')));
});
