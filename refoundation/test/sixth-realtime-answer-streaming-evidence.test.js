import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-str-realtime-answer-streaming-2026-08-31.json', import.meta.url);

test('S6-STR은 실제 Console streaming과 canonical final exact-once를 함께 닫는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'COMPLETE_WITH_PROVIDER_FIRST_DELTA_CARRY');
  assert.equal(value.actualConsole.shortDirect.status, 'PASS');
  assert.equal(value.actualConsole.shortDirect.answerDeltaToVisibleMs <= 120, true);
  assert.equal(value.actualConsole.shortDirect.duplicateFinalMessages, 0);
  assert.equal(value.actualConsole.longDirect.visibleGrowthObserved, true);
  assert.equal(value.actualConsole.weatherToolTransition.stalePartialAnswerMixed, false);
  assert.equal(value.implemented.canonicalFinalPersistedOnce, true);
});

test('S6-STR은 provider 첫 delta 2초 미달을 Runtime PASS로 꾸미지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.carry.observedShortProviderFirstDeltaMs > value.carry.productTargetFirstSemanticAnswerMs, true);
  assert.equal(value.carry.observedRuntimeDeltaToVisibleMs <= value.carry.runtimeAbsoluteDeltaToVisibleTargetMs, true);
  assert.match(value.carry.interpretation, /not claimed/u);
});

test('S6-STR은 모델 판단·호출·Store·Router를 늘리지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.nonGoalsPreserved.newStore, 0);
  assert.equal(value.nonGoalsPreserved.newIntentRouter, 0);
  assert.equal(value.nonGoalsPreserved.promptChanges, 0);
  assert.equal(value.nonGoalsPreserved.addedModelCalls, 0);
  assert.equal(value.nonGoalsPreserved.addedToolCalls, 0);
  assert.equal(value.nonGoalsPreserved.persistedPartialAnswers, 0);
  assert.equal(value.nonGoalsPreserved.installerBuilt, false);
});
