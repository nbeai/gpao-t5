import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL(
  '../config/s3-windows-deferred-qualification.json', import.meta.url,
), 'utf8'));
const plan = await readFile(new URL(
  '../../docs/03-product-plan/T5-THIRD-COMPLETION-LIFE-CONTINUITY-IMPLEMENTATION-PLAN-2026-08-26-ko.md',
  import.meta.url,
), 'utf8');

test('Windows 일괄 자격은 유예이지 면제나 PASS가 아니다', () => {
  assert.equal(manifest.status, 'DEFERRED_NOT_WAIVED');
  assert.equal(manifest.gateRules.m5ImplementationMayClose, true);
  assert.equal(manifest.gateRules.m5WindowsActualPass, false);
  assert.equal(manifest.gateRules.m6PlatformNeutralDevelopmentMayOpen, true);
  assert.equal(manifest.gateRules.m7PassRequiresAllRequiredItems, true);
  assert.equal(manifest.gateRules.m8aPassRequiresM7Pass, true);
  assert.equal(manifest.gateRules.officialReleaseGateChanged, false);
});

test('deferred manifest는 runner·VM·human·receipt Windows 책임을 빠뜨리지 않는다', () => {
  assert.equal(manifest.requiredItems.length, 25);
  assert.deepEqual([...new Set(manifest.requiredItems.map((item) => item.lane))].sort(),
    ['human', 'receipt', 'runner', 'vm']);
  for (const required of [
    'Windows Search actual add, update, delete, rebuild', 'NTFS ACL', 'signed installer',
    'gpt-5.5', 'gpt-5.6-terra', 'macOS export to Windows resume',
    'foreground background-off/on matched pair', 'WindowsPlatformQualificationReceipt',
  ]) assert.ok(manifest.requiredItems.some((item) => item.requirement.includes(required)), required);
});

test('무료 VM과 emulation은 비용·architecture 사실을 바꾸지 않는다', () => {
  assert.ok(manifest.executionOptions.some((item) => item.kind === 'zero_cost_vm'));
  assert.ok(manifest.forbiddenSubstitutions.includes('x64 emulation labeled x64 native'));
  assert.ok(manifest.forbiddenSubstitutions.includes('GitHub workflow with runner_id 0 labeled executed'));
  assert.match(plan, /Windows 실측 일괄 자격/u);
  assert.match(plan, /s3-windows-deferred-qualification\.json/u);
  assert.match(plan, /M7은 deferred manifest의 모든 required item/u);
});
