import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = new URL('../evidence/s3-ch1-ch2-product-human-journeys-2026-08-27.json', import.meta.url);

test('CH1·CH2 실제 제품 여정은 pause·private·export·forget과 발견된 종료 결함 수리를 보존한다', async () => {
  const value = JSON.parse(await readFile(evidence, 'utf8'));
  assert.equal(value.ch1.eventCountAfterPausedWrite, value.ch1.eventCountBeforePause);
  assert.equal(value.ch1.remainingEvents, 0);
  assert.equal(value.ch1.contentCanaryStored, false);
  assert.match(value.ch2.discoveredFailure, /SIGTERM/u);
  assert.match(value.ch2.countertest, /86400/u);
  assert.equal(value.ch2.exportForbiddenFields, 0);
  assert.equal(value.ch2.remainingSegments, 0);
  assert.equal(value.environment.realUserFilesRead, 0);
  assert.equal(value.environment.externalWrites, 0);
  assert.equal(value.passed, true);
});
