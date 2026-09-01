import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL(
  '../evidence/nx2-au3-managed-transcription-2026-09-01.json', import.meta.url,
), 'utf8'));

test('AU-3는 actual managed start·poll·terminal을 닫되 transcript를 publish하지 않는다', () => {
  assert.equal(evidence.status, 'AU3_COMPLETE_AU4_OPEN');
  assert.equal(evidence.actualShort.state, 'transcribed_unverified');
  assert.equal(evidence.actualShort.publishable, false);
  assert.equal(evidence.actualShort.sourceDurationMs, evidence.actualShort.decodedDurationMs);
  assert.equal(evidence.contracts.existingManagedProcessRegistry, true);
  assert.equal(evidence.contracts.newProcessStore, 0);
});

test('AU-3 Stop은 process tree·late output·scratch를 terminal로 닫는다', () => {
  assert.equal(evidence.actualStop.terminal, 'stopped');
  assert.equal(evidence.actualStop.lateTranscript, 0);
  assert.equal(evidence.actualStop.remainingScratchEntries, 0);
  assert.equal(evidence.contracts.automaticCrashRetry, 0);
});
