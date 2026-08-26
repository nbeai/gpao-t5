import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);

test('M4-0 actual observations는 다섯 owner-fixed case를 pass하고 retrieval expansion을 닫는다', async () => {
  const { stdout } = await execute(process.execPath, ['refoundation/scripts/run-s3m4-recall-auditor.mjs']);
  const result = JSON.parse(stdout);
  assert.equal(result.pass, true);
  assert.equal(result.audits.length, 5);
  assert.ok(result.audits.every((audit) => audit.status === 'passed'));
  assert.equal(result.decision.fts, 'closed_no_deficit');
  assert.equal(result.decision.embedding, 'closed_prerequisite_not_proven');
  assert.equal(result.decision.graph, 'closed_prerequisite_not_proven');
  assert.equal(result.decision.deepRecallModel, 'closed_prerequisite_not_proven');
  assert.deepEqual(result.retrievalEnginesAdded, []);
  assert.equal(result.sourceReopenRate, 1);
  assert.equal(result.irrelevantInjection, 0);
  assert.equal(result.selectorModelCallsOnNormalTurn, 0);
});
