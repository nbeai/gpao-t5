import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-P closeout은 여섯 stage와 네 인간 목적을 실제 evidence로 닫는다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../evidence/s4-p-durable-project-building-complete-2026-08-30.json', import.meta.url), 'utf8'));
  assert.equal(value.status, 'S4_P_DURABLE_PROJECT_BUILDING_COMPLETE_MACOS_PRODUCT_SCOPE');
  assert.deepEqual(value.stages, { P0: 'COMPLETE', P1: 'COMPLETE', P2: 'COMPLETE', P3: 'COMPLETE',
    P4: 'COMPLETE_CONDITIONAL_EXISTING_OFFICIAL_CLI', P5: 'COMPLETE_WITH_EXISTING_CAPABILITY' });
  for (const item of Object.values(value.humanQualification)) {
    assert.equal(item.passed, true); await readFile(new URL(`../../${item.evidence}`, import.meta.url));
  }
  assert.equal(value.performance.newProject.paretoImproved, true);
  for (const metric of ['wallMs', 'modelCalls', 'toolCalls', 'providerTokens', 'requestBytes']) {
    assert.ok(value.performance.newProject.final[metric] < value.performance.newProject.red[metric], metric);
  }
  assert.equal(value.performance.existingProjectRestartJourney.purposePassed, true);
});

test('S4-P는 새 platform·Router·Store·자동 설치나 과장된 외부 완료를 만들지 않는다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../evidence/s4-p-durable-project-building-complete-2026-08-30.json', import.meta.url), 'utf8'));
  for (const enabled of Object.values(value.architecture)) assert.equal(enabled, false);
  for (const unsafe of Object.values(value.safety)) assert.equal(unsafe, false);
  assert.equal(value.windows, 'DEFERRED_NOT_WAIVED_S4_L');
  assert.ok(value.nonClaims.includes('production deployment'));
  assert.ok(value.nonClaims.includes('actual external account write qualification'));
});
