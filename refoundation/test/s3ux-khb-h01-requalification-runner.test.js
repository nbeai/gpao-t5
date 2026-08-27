import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('KHB-H01 runner는 실제 console에서 milestone→교정→queued→cancel→후속 무재실행을 잇는다', async () => {
  const source = await readFile(new URL('../scripts/run-s3ux-khb-h01-requalification.mjs', import.meta.url), 'utf8');
  assert.match(source, /KHB-H01/u); assert.match(source, /makeConsoleServer/u);
  assert.match(source, /meaningful\.milestone/u); assert.match(source, /\/turn\/cancel/u);
  assert.match(source, /followupReplayedProcess === false/u); assert.match(source, /unexpectedCreatedFiles === 0/u);
  assert.match(source, /sameWorkNextRevisionClaimable/u); assert.match(source, /followupSameWorkRevision/u);
  assert.match(source, /sameWorkRecoveryRunStarted/u); assert.match(source, /correctionPreserved/u);
  assert.match(source, /sameWorkRecoveryQualified/u); assert.match(source, /followupReplyForHumanReview/u);
  assert.match(source, /findS3HumanBusinessScenario/u);
  assert.doesNotMatch(source, /workspaceConnectionServices: \[[^\]]/u);
});
