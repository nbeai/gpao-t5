import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL('../evidence/nx2-au5a-transcript-artifact-2026-09-01.json', import.meta.url), 'utf8'));

test('AU-5A는 actual verified transcript를 exact Artifact로 열고 교정 version을 분리한다', () => {
  assert.equal(evidence.status, 'AU5A_COMPLETE_AU5_DERIVED_RESULT_CURRENT');
  assert.equal(evidence.actual.artifactState, 'published');
  assert.equal(evidence.actual.bytes, evidence.actual.reopenedBytes);
  assert.equal(evidence.contracts.unverifiedArtifactCount, 0);
  assert.equal(evidence.contracts.correctionPreservesRawV1, true);
  assert.equal(evidence.contracts.runtimeTimestampRewrite, 0);
});
