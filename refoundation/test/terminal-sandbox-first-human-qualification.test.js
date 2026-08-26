import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const url = new URL('../evidence/s3-terminal-sandbox-first-human-qualification-2026-08-26.json', import.meta.url);

test('sandbox-first 인간 자격은 두 모델 정답·effect null·변경 0과 성능 비주장을 함께 보존한다', async () => {
  const evidence = JSON.parse(await readFile(url, 'utf8'));
  assert.equal(evidence.verdict, 'PASS_WITH_OBSERVATION');
  for (const result of Object.values(evidence.results)) {
    assert.equal(result.correct, true);
    assert.equal(result.complete, true);
    assert.equal(result.effectNullCalls, result.execCalls);
    assert.equal(result.macosObservationProbeCalls, result.execCalls);
    assert.equal(result.changedEffects, 0);
  }
  assert.equal(evidence.runtimeQualification.fileWriteProbeChangedNothing, true);
  assert.equal(evidence.runtimeQualification.protectedSecretContentObserved, false);
  assert.equal(evidence.runtimeQualification.unqualifiedPlatformNullExecution, 0);
  assert.equal(evidence.performanceObservation.speedImprovementProven, false);
  assert.equal(evidence.performanceObservation.cleanMedianClaimed, false);
});
