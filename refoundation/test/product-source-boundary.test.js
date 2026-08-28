import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('macOS·Windows package builder는 같은 4차 휴면 source 제외 경계를 사용한다', async () => {
  const [mac, windows, verifier] = await Promise.all([
    readFile(new URL('../scripts/build-macos-installer.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-windows-package.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/verify-macos-installer.mjs', import.meta.url), 'utf8'),
  ]);
  for (const source of [mac, windows]) {
    assert.match(source, /removeFourthCycleDormantSource/u);
    assert.match(source, /assertFourthCycleDormantSourceExcluded/u);
    assert.match(source, /removeQualificationOnlySource/u);
    assert.match(source, /assertQualificationOnlySourceExcluded/u);
  }
  assert.match(verifier, /assertFourthCycleDormantSourceExcluded\(refoundation\)/u);
  assert.match(verifier, /assertQualificationOnlySourceExcluded\(refoundation\)/u);
});

test('qualification-only 목록은 동적 worker와 platform source를 제거하지 않는다', async () => {
  const boundary = await readFile(new URL('../scripts/product-source-boundary.mjs', import.meta.url), 'utf8');
  for (const required of [
    'kordoc-read-worker.mjs', 'macos-memory-platform-adapter.js',
    'windows-memory-platform-adapter.js', 'windows-search-projection-driver.js',
  ]) assert.doesNotMatch(boundary, new RegExp(`'src/${required.replaceAll('.', '\\.')}'`, 'u'));
  for (const qualification of [
    'document-data-qualification.js', 'terminal-performance.js',
    's3-human-business-scenarios.js', 'web-variance-analysis.js',
  ]) assert.match(boundary, new RegExp(qualification.replaceAll('.', '\\.'), 'u'));
});

test('4차 휴면 목록은 현재 capability와 platform source를 제거하지 않는다', async () => {
  const boundary = await readFile(new URL('../scripts/product-source-boundary.mjs', import.meta.url), 'utf8');
  for (const required of [
    'managed-cli-store.js', 'managed-skill-store.js', 'capability-lifecycle.js',
    'github-cli-broker.js', 'windows-product-environment.js', 'windows-process-boundary.js',
  ]) assert.doesNotMatch(boundary, new RegExp(required.replaceAll('.', '\\.'), 'u'));
  for (const dormant of [
    'capability-acquisition-coordinator.js', 'capability-reality.js',
    'reflection-candidate.js', 'principle-qualification.js',
  ]) assert.match(boundary, new RegExp(dormant.replaceAll('.', '\\.'), 'u'));
});

test('C4 evidence는 실제 payload 감소와 현재 기능 보존을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-package-boundary-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'C4_COMPLETE');
  assert.equal(evidence.boundary.fourthCycleExcludedFiles, 18);
  assert.equal(evidence.boundary.qualificationOnlyExcludedFiles, 29);
  assert.equal(evidence.boundary.totalExcludedFiles, 47);
  assert.equal(evidence.boundary.sourceDeletedFromGit, false);
  assert.equal(evidence.actualMacOSDevelopmentPayload.payloadGatePassed, true);
  assert.equal(evidence.actualMacOSDevelopmentPayload.explicitPackageVerificationPassed, true);
  assert.deepEqual(evidence.delta, { files: -47, installedBytes: -1704125 });
  assert.ok(evidence.preserved.includes('managed Skill and CLI runtime'));
  assert.ok(evidence.preserved.includes('macOS and Windows platform source'));
  assert.ok(evidence.notChanged.includes('Prompt'));
});
