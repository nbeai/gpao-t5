import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const evidence = JSON.parse(readFileSync(new URL(
  '../evidence/nx2-au1a-audio-reality-2026-09-01.json', import.meta.url,
), 'utf8'));

test('AU-1A는 macOS native reality·decode를 닫되 transcript를 열지 않는다', () => {
  assert.equal(evidence.status, 'AU1A_COMPLETE_AU1_WINDOWS_DECODE_CURRENT');
  assert.equal(evidence.productBehavior.audioAttachmentNativeReality, true);
  assert.equal(evidence.productBehavior.transcriptionActivated, false);
  assert.equal(evidence.productBehavior.newTool, 0);
  assert.equal(evidence.macOS.observations.wavSilence.durationMs, 5000);
  assert.equal(evidence.macOS.observations.mp4NoAudio.audioTracks, 0);
  assert.equal(evidence.macOS.decode.m4aToPcm.sampleRate, 16000);
  assert.equal(evidence.macOS.decode.m4aToPcm.channels, 1);
  assert.equal(evidence.macOS.decode.sourceDigestReopenedAfterDecode, true);
  assert.equal(evidence.macOS.decode.scratchCleaned, true);
});

test('Windows와 다중 track·stale 경계는 미실행을 PASS로 꾸미지 않는다', () => {
  assert.equal(evidence.windows.state, 'DEFERRED_NOT_WAIVED');
  assert.equal(evidence.windows.physicalCompile, 'NOT_RUN');
  assert.equal(evidence.windows.pcmDecode, 'NOT_YET_IMPLEMENTED');
  assert.equal(evidence.truthBoundaries.audioTrackZeroStopsBeforeDecode, true);
  assert.equal(evidence.truthBoundaries.multipleAudioTracksRequireSelection, true);
  assert.equal(evidence.truthBoundaries.staleSourceRejected, true);
  assert.equal(evidence.next.au1Complete, false);
});
