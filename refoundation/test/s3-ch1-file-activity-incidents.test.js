import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CH1은 collector 구현 전에 12개 metadata/privacy/platform 사고 가족을 고정한다', async () => {
  const value = JSON.parse(await readFile(new URL('../config/s3-ch1-file-activity-incidents.json', import.meta.url)));
  assert.equal(value.status, 'CH1_INCIDENTS_FROZEN_PRODUCT_UNTOUCHED');
  assert.equal(value.failureFamilies.length, 12);
  assert.equal(value.invariants.defaultEnabled, false);
  assert.equal(value.invariants.contentCapture, false);
  assert.equal(value.invariants.modelContextDefaultBytes, 0);
  assert.equal(value.platforms.wsl, 'negative-control evidence only');
});

test('CH1 사고 fixture는 actor·journal gap·scope escape·비용·삭제와 Windows 미자격을 빠뜨리지 않는다', async () => {
  const value = JSON.parse(await readFile(new URL('../config/s3-ch1-file-activity-incidents.json', import.meta.url)));
  const families = value.failureFamilies.map((item) => item.family).join('\n');
  for (const required of ['actor_and_cause_invention', 'journal_gap_wrap_drop_or_volume_change',
    'symlink_hardlink_reparse_scope_escape', 'collector_failure_blocks_foreground',
    'unbounded_event_storm_and_cost', 'delete_export_retention_falsehood',
    'windows_structural_claimed_as_native_pass']) assert.match(families, new RegExp(required, 'u'));
  assert.ok(value.nonGoals.includes('app activity CH2'));
  assert.ok(value.nonGoals.includes('purpose relevance CH3'));
});
