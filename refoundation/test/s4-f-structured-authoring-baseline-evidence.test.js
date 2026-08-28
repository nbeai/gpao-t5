import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-F baseline 증거는 세 gap·일곱 phase·미구현 경계를 분리한다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../evidence/s4-f-structured-authoring-baseline-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(value.productChanges, 0);
  assert.equal(value.reproduced.multiFilePartialCommit, true);
  assert.equal(value.reproduced.stalePreimageOverwrite, true);
  assert.equal(value.reproduced.shellLiteralExpansion, true);
  assert.equal(value.contract.phases.length, 7);
  assert.equal(value.contract.filesystemWideAtomicRenameClaimed, false);
  assert.ok(value.nonClaims.includes('workspace_patch product tool exists'));
});
