import test from 'node:test';
import assert from 'node:assert/strict';

import { assessBusinessArtifactContinuity } from '../src/business-artifact-continuity.js';

function run(model) {
  return {
    model, passed: true, actualBusinessAccount: false, actualUserData: false,
    checks: { noRawExecBypass: true, restartContinuity: true, finalSeparatesDoneAndNotDone: true },
    fileRoundTrip: {
      attachmentId: `${model}-artifact`, uploadArtifactMatched: true,
      uploadShaMatched: true, artifactPersistedAfterRestart: true,
    },
    finalState: {
      reservationMutations: 0, replyCount: 1, downloadCount: 1,
      uploads: [{ filename: 'settlement-2026-08.pdf', bytes: 34 }],
    },
  };
}

test('W7 suite는 두 모델의 stable artifact·원래 이름·hash·재시작·무우회를 모두 요구한다', () => {
  const result = assessBusinessArtifactContinuity([run('terra'), run('gpt-5.5')]);
  assert.equal(result.passed, true); assert.ok(Object.values(result.checks).every(Boolean));
});

test('wrong artifact·hash·filename·restart·raw exec 중 하나라도 어긋나면 W7은 실패다', () => {
  for (const mutate of [
    (runs) => { runs[0].fileRoundTrip.uploadArtifactMatched = false; },
    (runs) => { runs[0].fileRoundTrip.uploadShaMatched = false; },
    (runs) => { runs[0].fileRoundTrip.artifactPersistedAfterRestart = false; },
    (runs) => { runs[0].finalState.uploads[0].filename = 'content.pdf'; },
    (runs) => { runs[0].checks.noRawExecBypass = false; },
    (runs) => { runs[0].finalState.reservationMutations = 1; },
  ]) {
    const runs = [run('terra'), run('gpt-5.5')]; mutate(runs);
    assert.equal(assessBusinessArtifactContinuity(runs).passed, false);
  }
});
