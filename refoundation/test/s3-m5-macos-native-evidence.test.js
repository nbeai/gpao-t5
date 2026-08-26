import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const evidence = JSON.parse(await readFile(new URL(
  '../evidence/s3-m5-macos-native-surface-2026-08-27.json', import.meta.url,
), 'utf8'));

test('M5-3 evidence는 Spotlight actual과 EventKit 미실행을 분리한다', () => {
  assert.equal(evidence.status, 'PASS_WITH_OBSERVATION');
  assert.equal(evidence.officialReleaseGateChanged, false);
  assert.equal(evidence.coreSpotlightActual.add.state, 'verified');
  assert.equal(evidence.coreSpotlightActual.update.state, 'verified');
  assert.equal(evidence.coreSpotlightActual.delete.state, 'verified');
  assert.equal(evidence.coreSpotlightActual.cleanupExactIdentifierAbsent, true);
  assert.equal(evidence.coreSpotlightActual.sensitiveValuesEmittedToDriver, 0);
  assert.equal(evidence.eventKit.actualCalendarWrites, 0);
  assert.equal(evidence.eventKit.actualReminderWrites, 0);
  assert.ok(evidence.notClaimed.includes('EventKit actual Calendar or Reminders PASS'));
});

test('M5-3 evidence는 제품 비개입과 qualification 비용을 섞지 않는다', () => {
  assert.equal(evidence.productNonInterference.wiredIntoNormalTurn, false);
  assert.equal(evidence.productNonInterference.normalTurnAdditionalModelCalls, 0);
  assert.equal(evidence.productNonInterference.normalTurnAdditionalNativeSearchCalls, 0);
  assert.equal(evidence.qualificationCost.modelCalls, 0);
  assert.equal(evidence.qualificationCost.coreSpotlightWrites, 3);
});

test('M5-3 evidence source digest는 exact source commit과 일치한다', async () => {
  assert.equal(evidence.sourceCommit, 'fdd406e716a266cbcaf14d69a2526f6d09379cc6');
  for (const [path, expected] of Object.entries(evidence.sourceDigests)) {
    const bytes = await readFile(new URL(`../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
  }
});
