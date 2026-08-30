import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s6-wa-whole-android-seam-audit-2026-08-30.json', import.meta.url,
), 'utf8'));

test('S6-WA는 16 seam과 네 P1 수리·Windows 물리 blocker를 함께 보존한다', () => {
  assert.equal(evidence.status,
    'COMPLETE_MACOS_P0_P1_REPAIRED_WINDOWS_EXPLICIT_UX_DELTA_REAUDITED');
  assert.equal(evidence.seams.length, 16); assert.equal(evidence.repairs.length, 4);
  assert.equal(evidence.verification.totalFocused.failed, 0);
  assert.equal(evidence.completion.p0UnresolvedMacos, 0);
  assert.equal(evidence.completion.p1UnresolvedMacos, 0);
  assert.equal(evidence.completion.orphanEffectOrArtifact, 0);
  assert.equal(evidence.completion.blindRetryCycle, 0);
  assert.equal(evidence.completion.windowsUnqualified, 'EXPLICIT_PHYSICAL_BLOCKER');
});
