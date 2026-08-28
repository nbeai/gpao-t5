import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('C0 reachability는 platform·qualification·4차·historical·unknown을 죽은 코드와 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-reachability-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'C0_READ_ONLY_AUDIT_COMPLETE');
  assert.equal(evidence.staticModuleGraph.sourceModules, 254);
  assert.equal(evidence.staticModuleGraph.reachableFromPackagedRuntimeEntries, 198);
  assert.equal(evidence.staticModuleGraph.unreachableFromPackagedRuntimeEntries, 56);
  assert.ok(evidence.classification.PLATFORM_REQUIRED.some((item) => /Windows launcher/u.test(item)));
  assert.ok(evidence.classification.FOURTH_CYCLE_DORMANT.some((item) => /Reflection and Principle/u.test(item)));
  assert.ok(evidence.classification.HISTORICAL_READ_ONLY.some((item) => /canonical transcript/u.test(item)));
  assert.ok(evidence.classification.UNKNOWN.some((item) => /conversation-search UI/u.test(item)));
  assert.equal(evidence.packageObservation.bulkRemovalAuthorized, false);
  assert.equal(evidence.productChanges, 0);
  assert.ok(evidence.notClaimed.includes('Prompt changes are authorized'));
});

test('C1 후보 field는 현재 product source에서 생성되지 않는다', async () => {
  const source = await readFile(new URL('../src/console-server.js', import.meta.url), 'utf8');
  for (const field of [
    'memorySuggestion', 'patternCandidate', 'capabilityResolution', 'automationSuggestion',
    'automationProposal', 'surfaceRequest', 'deliveryFailed',
  ]) assert.doesNotMatch(source, new RegExp(`\\b${field}\\b`, 'u'));
});

test('C1은 현재 producer가 없는 supplemental action renderer와 죽은 endpoint를 UI에서 제거한다', async () => {
  const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  for (const token of [
    'renderPatternCandidate', 'renderCapabilityResolution', 'renderAutomationSuggestion',
    'renderSuggestion', 'renderSecretInput', 'renderDeliveryFailed',
    '/patterns/confirm', '/patterns/rollback', '/automation/setup',
    '/automation/approve', '/connectors/secret', '/deliveries/${df.deliveryId}/retry',
  ]) assert.doesNotMatch(ui, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(ui, /r\.reply/u);
  assert.match(ui, /\/memory\/rollback/u);
  assert.match(ui, /\/automation\/pause/u);
});

test('C1 evidence는 과거 reply와 현재 Memory·Automation 표면 보존을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-ui-dead-surface-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'C1_COMPLETE');
  assert.equal(evidence.countertest.redBeforeRemoval, true);
  assert.equal(evidence.countertest.greenAfterRemoval, true);
  assert.equal(evidence.removed.uiLines, 371);
  assert.ok(evidence.preserved.includes('historical assistant reply and canonical transcript'));
  assert.ok(evidence.preserved.includes('current Automation settings actions'));
  assert.ok(evidence.notChanged.includes('Prompt'));
});

test('C2는 절대 활성화되지 않는 toolbox 조건부 action을 제거하고 compatibility alias를 보존한다', async () => {
  const [ui, server] = await Promise.all([
    readFile(new URL('../ui/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
  ]);
  for (const token of ['renderInvalidDeclared', '/connectors/truth', '/connectors/declared/remove', '/personal-tools/']) {
    assert.doesNotMatch(ui, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
  assert.match(server, /url\.pathname === '\/connectors\/truth'/u);
  assert.match(ui, /fetch\('\/toolbox'/u);
  assert.match(ui, /fetch\('\/connections\/doctor'/u);
  assert.match(server, /url\.pathname === '\/toolbox'/u);
  assert.match(server, /url\.pathname === '\/connections\/doctor'/u);
});

test('C2 첫 가족은 canonical connection과 현재 toolbox를 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-toolbox-alias-close-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'C2_FIRST_FAMILY_REQUALIFIED');
  assert.equal(evidence.countertest.redBeforeRemoval, true);
  assert.equal(evidence.countertest.greenAfterRemoval, true);
  assert.ok(evidence.preserved.includes('GET /connections/doctor canonical connection truth'));
  assert.ok(evidence.preserved.includes('GET /connectors/truth compatibility projection'));
  assert.ok(evidence.preserved.includes('current Skill, CLI and Capability lifecycle'));
  assert.deepEqual(evidence.lineDelta, { uiRemoved: 43, serverRemoved: 0 });
});

test('C3 첫 가족은 4차 CA production import만 끊고 현재 Capability lifecycle을 보존한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/product-cleanroom-ca-production-isolation-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'C3_FIRST_FAMILY_COMPLETE');
  assert.deepEqual(evidence.staticGraph, {
    sourceModules: 254, reachableBefore: 198, reachableAfter: 196, unreachableAfter: 58,
  });
  assert.ok(evidence.preservedCurrentProduct.includes('managed Skill and CLI preparation'));
  assert.ok(evidence.preservedCurrentProduct.includes('Capability lifecycle, outcome evidence and comparison'));
  assert.ok(evidence.preservedResearch.includes('CA2 local package store and coordinator qualification'));
});
