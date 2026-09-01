import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL(
  '../evidence/nx2-au2b-whisper-host-acquisition-2026-09-01.json', import.meta.url,
), 'utf8'));

test('AU-2는 universal host와 exact model generation을 실제 fixture qualification으로 닫는다', () => {
  assert.equal(evidence.status, 'AU2_COMPLETE_AU3_OPEN');
  assert.deepEqual(evidence.macOSHostActual.architectures, ['arm64', 'x86_64']);
  assert.equal(evidence.macOSHostActual.nonSystemDylibs, 0);
  assert.equal(evidence.actualFixtureQualification.qualified, true);
  assert.equal(evidence.actualFixtureQualification.transcriptAccuracyClaimed, false);
  assert.equal(evidence.defaults.fullModelDefault, true);
  assert.equal(evidence.defaults.q5Default, false);
});

test('AU-2 준비는 polling·redownload·blind transcription retry 없이 같은 generation을 재사용한다', () => {
  assert.equal(evidence.resume.modelPollingCalls, 0);
  assert.equal(evidence.resume.partialDownloadReusable, true);
  assert.equal(evidence.resume.inactiveGenerationReusable, true);
  assert.equal(evidence.resume.concurrentPreparationOneGeneration, true);
  assert.equal(evidence.resume.blindTranscriptionRetry, 0);
  assert.equal(evidence.platform.windowsPhysical, 'NOT_RUN');
});
