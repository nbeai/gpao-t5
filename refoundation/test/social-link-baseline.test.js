import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessSocialLinkObservations, loadSocialLinkBaseline, socialBaselineReadiness,
  summarizeSocialWebRead,
} from '../src/social-link-baseline.js';

const baselineFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'social-link-baseline.json');

test('SNS 기준선은 사용자 관심을 대표하지 않으면서 6개 플랫폼 live identity와 boundary를 갖춘다', async () => {
  const baseline = await loadSocialLinkBaseline(baselineFile); const readiness = socialBaselineReadiness(baseline);
  assert.equal(baseline.cases.length, 21); assert.deepEqual(baseline.platforms, ['x', 'threads', 'facebook', 'instagram', 'youtube', 'tiktok']);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.gaps, []);
  assert.equal(baseline.scope.representativeOfUsers, false);
  assert.equal(baseline.scope.analysisTargetsComeFrom, 'current_user_business_taste_goal_and_request');
  assert.deepEqual(readiness.sampledContextTags, ['beauty', 'creator', 'education', 'food', 'local-service', 'retail']);
  assert.equal(readiness.userRepresentativenessClaimed, false);
});

test('format fixture와 live reference의 출처·stable identity 경계를 검증한다', async () => {
  const baseline = await loadSocialLinkBaseline(baselineFile);
  const x = baseline.cases.find((item) => item.caseId === 'x-twitter-alias-fixture');
  assert.equal(x.expected.canonicalUrl, 'https://x.com/XDevelopers/status/1228393702244134912');
  const unsafe = structuredClone({ schema: baseline.schema, platforms: baseline.platforms, scope: baseline.scope, cases: baseline.cases });
  unsafe.cases[0].inputUrl = 'https://user:secret@x.com/XDevelopers/status/1';
  await assert.rejects(() => loadSocialLinkBaseline(unsafe), /credentials/u);
  const falseLive = structuredClone({ schema: baseline.schema, platforms: baseline.platforms, scope: baseline.scope, cases: baseline.cases });
  falseLive.cases[1].referenceType = 'live_reference';
  await assert.rejects(() => loadSocialLinkBaseline(falseLive), /live reference/u);
  const falseRepresentative = structuredClone({ schema: baseline.schema, platforms: baseline.platforms, scope: baseline.scope, cases: baseline.cases });
  falseRepresentative.scope.representativeOfUsers = true;
  await assert.rejects(() => loadSocialLinkBaseline(falseRepresentative), /must not claim/u);
});

test('후보 관측은 identity와 coverage를 모두 맞혀야 통과하고 보지 않은 항목을 중복 주장하면 실패한다', async () => {
  const baseline = await loadSocialLinkBaseline(baselineFile);
  const observations = baseline.cases.map((item) => ({
    caseId: item.caseId, state: item.expected.state, platform: item.platform,
    contentType: item.expected.contentType, contentId: item.expected.contentId,
    canonicalUrl: item.expected.canonicalUrl, observed: ['identity'], missing: ['text', 'metrics'],
  }));
  assert.equal(assessSocialLinkObservations(baseline, observations).passed, true);
  const wrongIdentity = structuredClone(observations); wrongIdentity[0].contentId = 'wrong';
  assert.equal(assessSocialLinkObservations(baseline, wrongIdentity).passed, false);
  const falseCoverage = structuredClone(observations); falseCoverage[0].observed.push('metrics');
  assert.equal(assessSocialLinkObservations(baseline, falseCoverage).passed, false);
});

test('현재 web_read 기준선은 요청 주소 반사와 실제 응답 identity·본문 관측을 구분한다', async () => {
  const baseline = await loadSocialLinkBaseline(baselineFile);
  const sample = baseline.cases.find((item) => item.caseId === 'youtube-official-video-live');
  const reached = summarizeSocialWebRead(sample, {
    state: 'partial_dynamic',
    source: {
      status: 200,
      requestedUrl: sample.inputUrl,
      finalUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
      canonicalUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
      title: 'YouTube Data API Overview',
      coverage: { kind: 'partial_dynamic' },
    },
    content: { text: 'Observed public page text', totalChars: 25, truncated: false, omittedChars: 0 },
  });
  assert.equal(reached.identityObserved, true);
  assert.deepEqual(reached.observed, ['identity', 'text']);
  assert.deepEqual(reached.missing, ['caption', 'metrics', 'comments', 'subtitle', 'audio', 'frames', 'ocr']);

  const echoedOnly = summarizeSocialWebRead(sample, {
    state: 'failed', reason: 'network_error',
    source: { requestedUrl: sample.inputUrl, finalUrl: sample.inputUrl, redirects: [] },
    content: null,
  });
  assert.equal(echoedOnly.identityObserved, false);
  assert.deepEqual(echoedOnly.observed, []);
  assert.ok(echoedOnly.missing.includes('identity'));
});
