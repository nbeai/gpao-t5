import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('S4-D5 증거는 Store·pipe·host·read와 explanation lifetime의 RSS를 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-d5-rss-attribution-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'READ_ONLY_ATTRIBUTION_COMPLETE_REPAIR_CANDIDATE_OPEN');
  assert.equal(evidence.productChanges, 0);
  assert.ok(evidence.median.storeOnlyPeakRssDelta < 32 * 1024 * 1024);
  assert.ok(evidence.median.registryPollPeakRssDelta < 32 * 1024 * 1024);
  assert.ok(evidence.median.releasedExplanationThenRegistryPeakRssDelta < 64 * 1024 * 1024);
  assert.ok(evidence.median.retainedExplanationThenRegistryPeakRssDelta > 512 * 1024 * 1024);
  assert.ok(evidence.median.processStartCurrentPeakRssDelta > 512 * 1024 * 1024);
  assert.equal(evidence.attribution.retainedCommandExplanationNecessaryInReproduction, true);
  assert.equal(evidence.attribution.memoryLeakClaimed, false);
  assert.equal(evidence.repairCandidate.newStore, false);
  assert.ok(evidence.nonClaims.includes('RSS repair is complete'));
});
