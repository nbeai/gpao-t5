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
