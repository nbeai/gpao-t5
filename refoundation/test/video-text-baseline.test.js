import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assessVideoTextObservations, loadVideoTextBaseline, videoTextBaselineReadiness,
} from '../src/video-text-baseline.js';

const baselineFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'video-text-baseline.json');

test('영상 텍스트 기준선은 사용자 관심사를 대표하지 않고 manual·automatic·absent·URL 경계를 가진다', async () => {
  const baseline = await loadVideoTextBaseline(baselineFile);
  const readiness = videoTextBaselineReadiness(baseline);
  assert.equal(baseline.cases.length, 6);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.gaps, []);
  assert.equal(readiness.userRepresentativenessClaimed, false);
  assert.equal(readiness.liveAvailable, 2);
  assert.equal(readiness.liveAbsent, 1);
  assert.equal(readiness.manualAvailable, true);
  assert.equal(readiness.automaticAvailable, true);
});

test('실제 자막 관측은 identity·track·text와 source·language를 함께 맞혀야 통과한다', async () => {
  const baseline = await loadVideoTextBaseline(baselineFile);
  const observations = baseline.cases.map((item) => ({
    caseId: item.caseId,
    state: item.expected.state,
    contentType: item.expected.contentType,
    videoId: item.expected.videoId,
    canonicalUrl: item.expected.canonicalUrl,
    captionState: item.expected.caption.state,
    selectedSource: item.expected.caption.preferredSource,
    language: item.expected.caption.language,
    observed: item.expected.caption.state === 'available'
      ? ['identity', 'captionTrack', 'captionText']
      : item.expected.state === 'identified' ? ['identity'] : [],
    missing: item.expected.caption.state === 'available'
      ? ['audio', 'frames', 'ocr']
      : ['captionTrack', 'captionText', 'audio', 'frames', 'ocr'],
  }));
  const result = assessVideoTextObservations(baseline, observations);
  assert.equal(result.passed, true);

  const falseCaption = structuredClone(observations);
  const absent = falseCaption.find((item) => item.caseId === 'youtube-caption-absent-live');
  absent.observed.push('captionText');
  absent.missing = absent.missing.filter((field) => field !== 'captionText');
  assert.equal(assessVideoTextObservations(baseline, falseCaption).passed, false);
});

test('요청 주소 반사만으로 영상 identity나 자막 관측을 주장하면 실패한다', async () => {
  const baseline = await loadVideoTextBaseline(baselineFile);
  const expected = baseline.cases.find((item) => item.caseId === 'youtube-manual-caption-live');
  const result = assessVideoTextObservations(baseline, [{
    caseId: expected.caseId,
    state: 'identified', contentType: 'video', videoId: expected.expected.videoId,
    canonicalUrl: expected.expected.canonicalUrl,
    captionState: 'available', selectedSource: 'manual', language: 'en',
    observed: ['identity'], missing: ['captionTrack', 'captionText', 'audio', 'frames', 'ocr'],
  }]);
  assert.equal(result.passed, false);
  assert.ok(result.missingCaseIds.length > 0);
});
