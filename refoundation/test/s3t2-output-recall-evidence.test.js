import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S3-T2A 증거는 exact recall만 닫고 retention·secret classification을 미완료로 남긴다', async () => {
  const raw = await readFile(new URL('../evidence/s3-t2a-output-recall-2026-08-26.json', import.meta.url), 'utf8');
  const evidence = JSON.parse(raw);
  assert.equal(evidence.status, 'exact_recall_complete_retention_open');
  assert.equal(evidence.truncated, true); assert.equal(evidence.handlePresent, true);
  assert.equal(evidence.activatedOnDemand, true); assert.equal(evidence.commandExecutions, 1);
  assert.equal(evidence.exactMiddleRecovered, true); assert.equal(evidence.restartRecovered, true);
  assert.equal(evidence.foreignSessionRejected, true); assert.equal(evidence.fileMode, '600');
  assert.equal(evidence.pass, true); assert.ok(evidence.remaining.some((item) => item.includes('retention')));
});
