import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessSocialLinkObservations, loadSocialLinkBaseline, socialBaselineReadiness } from '../src/social-link-baseline.js';

const baselineFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'social-link-baseline.json');

test('SNS 기준선은 6개 플랫폼·18개 identity 사례와 업종 분포를 가지되 live content 공백을 숨기지 않는다', async () => {
  const baseline = await loadSocialLinkBaseline(baselineFile); const readiness = socialBaselineReadiness(baseline);
  assert.equal(baseline.cases.length, 18); assert.deepEqual(baseline.platforms, ['x', 'threads', 'facebook', 'instagram', 'youtube', 'tiktok']);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.gaps.filter((gap) => /no live identified/u.test(gap)), [
    'threads: no live identified content reference', 'instagram: no live identified content reference',
  ]);
  assert.deepEqual(readiness.businessDomains, ['beauty', 'creator', 'education', 'food', 'local-service', 'retail']);
});

test('format fixture와 live reference의 출처·stable identity 경계를 검증한다', async () => {
  const baseline = await loadSocialLinkBaseline(baselineFile);
  const x = baseline.cases.find((item) => item.caseId === 'x-twitter-alias-fixture');
  assert.equal(x.expected.canonicalUrl, 'https://x.com/XDevelopers/status/1228393702244134912');
  const unsafe = structuredClone({ schema: baseline.schema, platforms: baseline.platforms, requiredBusinessDomains: baseline.requiredBusinessDomains, cases: baseline.cases });
  unsafe.cases[0].inputUrl = 'https://user:secret@x.com/XDevelopers/status/1';
  await assert.rejects(() => loadSocialLinkBaseline(unsafe), /credentials/u);
  const falseLive = structuredClone({ schema: baseline.schema, platforms: baseline.platforms, requiredBusinessDomains: baseline.requiredBusinessDomains, cases: baseline.cases });
  falseLive.cases[1].referenceType = 'live_reference';
  await assert.rejects(() => loadSocialLinkBaseline(falseLive), /live reference/u);
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
