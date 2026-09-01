import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL(
  '../evidence/nx2-au0-auditory-baseline-2026-09-01.json', import.meta.url,
), 'utf8'));

test('AU-0은 current STT gap과 actual whisper.cpp 후보를 제품 변경 없이 분리한다', () => {
  assert.equal(evidence.status, 'AU0_COMPLETE_AU1_OPEN');
  assert.equal(evidence.productSourceChanges, 0);
  assert.equal(evidence.currentProduct.usableWhisperExecutable, false);
  assert.equal(evidence.currentProduct.usableModelGeneration, false);
  assert.equal(evidence.candidate.engine, 'whisper.cpp');
  assert.equal(evidence.candidate.productIntegrated, false);
  assert.match(evidence.candidate.sourceCommit, /^[0-9a-f]{40}$/u);
  assert.equal(evidence.models.q5_0.state, 'qualification_candidate_not_default');
});

test('Q5 이익은 기록하되 한 합성 fixture로 기본 모델이나 인간 품질을 확정하지 않는다', () => {
  assert.ok(evidence.syntheticKoreanMemo.q5WithoutHint.warmWallMs
    < evidence.syntheticKoreanMemo.fullWithoutHint.wallMs);
  assert.ok(evidence.syntheticKoreanMemo.q5WithoutHint.peakFootprintBytes
    < evidence.syntheticKoreanMemo.fullWithoutHint.peakFootprintBytes);
  assert.equal(evidence.syntheticKoreanMemo.q5WithoutHint.edits,
    evidence.syntheticKoreanMemo.fullWithoutHint.edits);
  assert.equal(evidence.comparisonBoundaries.q5DefaultQualified, false);
  assert.equal(evidence.comparisonBoundaries.humanSpeechQualityQualified, false);
});

test('양 모델의 무음 hallucination은 exit나 transcript를 coverage 성공으로 쓸 수 없게 한다', () => {
  assert.ok(evidence.silenceOpposingTest.q5.falseTranscript.length > 0);
  assert.ok(evidence.silenceOpposingTest.full.falseTranscript.length > 0);
  assert.ok(evidence.silenceOpposingTest.q5.claimedEndMs
    > evidence.silenceOpposingTest.durationMs);
  assert.ok(evidence.silenceOpposingTest.full.claimedEndMs
    > evidence.silenceOpposingTest.durationMs);
  assert.equal(evidence.silenceOpposingTest.quantizationCause, false);
  assert.equal(evidence.decision.firstProductSlice, 'AU-1 Audio Reality & Native Decode');
});
