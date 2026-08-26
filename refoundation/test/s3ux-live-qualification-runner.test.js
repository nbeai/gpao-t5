import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixedFailure, safeOutput } from '../scripts/run-s3ux-live-qualification.mjs';

test('S3-UX live runner는 160-cell이 아니라 owner-fixed 네 model lane만 실행한다', async () => {
  const source = await readFile(new URL('../scripts/run-s3ux-live-qualification.mjs', import.meta.url), 'utf8');
  assert.match(source, /UX-C1-terra/u); assert.match(source, /UX-C1-gpt55/u);
  assert.match(source, /UX-A1-terra/u); assert.match(source, /UX-E1-gpt55/u);
  assert.match(source, /results\.length === 4/u);
  assert.doesNotMatch(source, /for \(const model.*for \(const journey/su);
});

test('human review output은 path·ID·hash·secret canary를 stdout 전에 차단한다', () => {
  assert.equal(safeOutput('안전한 사용자 문장', ['PRIVATE-CANARY']), true);
  for (const value of ['/Users/me/private.txt', '123e4567-e89b-12d3-a456-426614174000',
    'a'.repeat(64), 'sk-secret-canary', 'PRIVATE-CANARY']) assert.equal(
    safeOutput(value, ['PRIVATE-CANARY']), false);
});

test('top-level failure는 provider·credential 원문 대신 fixed taxonomy만 남긴다', () => {
  assert.equal(fixedFailure(new Error('credential PRIVATE-CANARY unavailable')), 'credential_boundary');
  assert.equal(fixedFailure(new Error('provider echoed PRIVATE-CANARY')), 'qualification_runtime_boundary');
});

test('runner는 secretRef-only 격리 연결과 외부·제품 write 0을 증거에 분리한다', async () => {
  const source = await readFile(new URL('../scripts/run-s3ux-live-qualification.mjs', import.meta.url), 'utf8');
  assert.match(source, /loadReadOnlyConnectionCredential/u);
  assert.match(source, /makePlatformSecretStore/u);
  assert.match(source, /--human-controlled/u);
  assert.match(source, /maxAttempts: 1/u);
  assert.match(source, /externalWrites: 0/u); assert.match(source, /productWrites: 0/u);
  assert.match(source, /humanLanguageReviewPassed: null/u);
  assert.match(source, /pass: false/u);
  assert.doesNotMatch(source, /makeConsoleServer|exec_command|browser|messenger/u);
});
