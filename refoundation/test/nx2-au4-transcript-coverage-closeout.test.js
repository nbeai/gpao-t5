import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-au4-transcript-coverage-2026-09-01.json', import.meta.url), 'utf8'));

test('AU-4는 실제 음성을 승격하고 무음 hallucination을 같은 coverage 계약에서 차단한다', () => {
  assert.equal(evidence.status, 'AU4_COMPLETE_AU5_OPEN');
  assert.equal(evidence.actualSpeech.state, 'verified_transcript');
  assert.equal(evidence.actualSpeech.publishable, true);
  assert.equal(evidence.actualSilence.state, 'coverage_rejected');
  assert.equal(evidence.actualSilence.publishable, false);
  assert.equal(evidence.actualSilence.silenceHallucination, true);
  assert.equal(evidence.runtime.textPostprocessing, 0);
  assert.equal(evidence.runtime.exitZeroIsSuccess, false);
});
