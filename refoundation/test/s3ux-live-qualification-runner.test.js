import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S3-UX live runner는 160-cell이 아니라 owner-fixed 네 model lane만 실행한다', async () => {
  const source = await readFile(new URL('../scripts/run-s3ux-live-qualification.mjs', import.meta.url), 'utf8');
  assert.match(source, /UX-C1-terra/u); assert.match(source, /UX-C1-gpt55/u);
  assert.match(source, /UX-A1-terra/u); assert.match(source, /UX-E1-gpt55/u);
  assert.match(source, /results\.length === 4/u);
  assert.doesNotMatch(source, /for \(const model.*for \(const journey/su);
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
