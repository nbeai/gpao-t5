import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assessIncidentReplay, assertIncidentFixture, summarizeIncidentResource,
} from '../src/incident-reference-fixture.js';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 's2-incident-reference-fixtures.json');
const load = async () => JSON.parse(await readFile(file, 'utf8'));

test('A0 fixture는 19개 Run·107 model calls·10,146,162 tokens의 content-free 곡선을 재현한다', async () => {
  const fixture = await load();
  const result = assertIncidentFixture(fixture);
  assert.deepEqual(result.summary, {
    runs: 19, originRuns: 17, automationRuns: 2, modelCalls: 107,
    providerTokens: 10_146_162, requestBytes: 43_239_237, toolCalls: 93,
    browserCalls: 38, browserCallingRunTokens: 5_853_678, failedRuns: 1,
  });
  assert.equal(fixture.source.scopeResolution.historyNarrativeRuns, 20);
  assert.equal(fixture.source.scopeResolution.narrativeCountIsMeasurementAuthority, false);
});

test('직접 Browser 비용과 Browser 동반 scope 비용은 같은 값으로 승격되지 않는다', async () => {
  const fixture = await load();
  const summary = summarizeIncidentResource(fixture);
  const measured = fixture.resourceRunaway.browserAttribution;
  assert.equal(measured.directInputTokensApprox, 2_140_275);
  assert.equal(measured.repeatedReinjectionTokensApprox, 1_844_162);
  assert.equal(summary.browserCallingRunTokens, 5_853_678);
  assert.notEqual(measured.directInputTokensApprox, summary.browserCallingRunTokens);
  assert.equal(measured.causalIncrement, null);
});

test('A0 replay는 자원·거짓 자동화 성공·입력 유실·process 잔류 중 하나를 지우면 실패한다', async () => {
  const fixture = await load();
  const mutations = [
    (value) => { value.resourceRunaway.runs[0].calls[0][0] -= 1; },
    (value) => { value.incidentFamilies.automationFalseSuccess.objectiveReceiptPresent = true; },
    (value) => { value.incidentFamilies.messageAdmissionLoss.durableFollowupCreated = true; },
    (value) => { value.incidentFamilies.processResidual.residualObserved = false; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(fixture); mutate(changed);
    assert.equal(assessIncidentReplay(changed).passed, false);
  }
});

test('A0 fixture는 사용자 원문·경로·URL·메일·원본 UUID를 보존하지 않는다', async () => {
  const fixture = await load();
  const serialized = JSON.stringify(fixture);
  assert.equal(assessIncidentReplay(fixture).privacy.length, 0);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu);
  assert.doesNotMatch(serialized, /https?:\/\/|\/Users\/|@/u);
});
