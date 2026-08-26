import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadReadOnlyConnectionCredential,
  makeAuditedFetch,
  makeInMemoryProviderObserver,
  makeRecordingCoordinator,
  main,
  normalizeProviderUsage,
  PRIVACY_CANARIES,
  reflectionQualificationFixtures,
  runMeaningJourney,
} from '../scripts/run-s3m6-reflection-shadow-qualification.mjs';

function fakeModel(toolCalls, usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }) {
  return { async respond(input) {
    await input.onContextReceipt?.({ requestBytes: 321, tools: { bytes: 123 } });
    const handle = await input.resourceObserver.reserve({ provider: 'fake', model: 'fake-model',
      attempt: 1, contextReceipt: { requestBytes: 321 } });
    await input.resourceObserver.commit(handle, { usage });
    return { text: '', toolCalls: structuredClone(toolCalls), usage, responseModel: 'fake-model' };
  } };
}

const call = (args, name = 'reflection_meaning') => ({ id: 'call-1', name, args });

test('one-shot recording qualification은 positive 의미만 기록하고 insufficient는 write 없이 abstain한다', async () => {
  const [positive, insufficient] = reflectionQualificationFixtures();
  const proposed = await runMeaningJourney({ fixture: positive, expectedModelId: 'fake-model',
    model: fakeModel([call({
    action: 'propose', hypothesis: '현재 결과 확인 뒤 필요한 경우에만 재실행한다.',
    sourceEpisodeHandles: ['episode-alpha', 'episode-beta'],
    counterexampleHandles: ['counterexample-gamma'], affectedScopeHandles: ['scope-current-work'],
    correctionRelations: [{ handle: 'correction-current', relation: 'preserved' }],
    unknowns: ['다른 작업군은 아직 모른다.'],
  })]) });
  assert.equal(proposed.passed, true); assert.equal(proposed.recordingCalls, 1);
  assert.equal(proposed.structuralModelChoicePassed, true);
  assert.equal(proposed.modelQualityPassed, null);
  assert.equal(proposed.hypothesisHumanReviewRequired, true);
  assert.match(proposed.hypothesisForHumanReview, /현재 결과/u);
  assert.equal(proposed.materializationCalls, 0); assert.equal(proposed.ledgerWrites, 0);
  assert.equal(proposed.usage.totalTokens, 15); assert.equal(proposed.providerAttempts[0].state, 'committed');

  const abstained = await runMeaningJourney({ fixture: insufficient, expectedModelId: 'fake-model',
    model: fakeModel([call({
    action: 'abstain', hypothesis: '', sourceEpisodeHandles: [], counterexampleHandles: [],
    affectedScopeHandles: [], correctionRelations: [], unknowns: [],
  })]) });
  assert.equal(abstained.passed, true); assert.equal(abstained.recordingCalls, 0);
  assert.equal(abstained.ledgerWrites, 0); assert.equal(abstained.externalProductWrites, 0);
});

test('multiple·missing·foreign tool call은 어떤 coordinator call도 실행하지 않는다', async () => {
  const [fixture] = reflectionQualificationFixtures();
  for (const calls of [[], [call({}), call({})], [call({}, 'foreign_tool')]]) {
    await assert.rejects(() => runMeaningJourney({ fixture, model: fakeModel(calls) }), (error) => (
      error.code === 'reflection_meaning_tool_call_invalid' && error.executedCalls === 0
    ));
  }
});

test('recording coordinator는 runtime identity를 거부하고 materializer·ledger 상태를 갖지 않는다', async () => {
  const coordinator = makeRecordingCoordinator();
  await assert.rejects(() => coordinator.materializeAndPropose({ meaningProposal: {
    reflectionId: 'forged', hypothesis: 'x',
  } }), /runtime identity/u);
  assert.equal(coordinator.calls.length, 0);
  assert.equal('ledger' in coordinator, false); assert.equal('materializer' in coordinator, false);
});

test('audited fetch는 exact store-false single-tool request만 전달하고 privacy canary는 저장 전 차단한다', async () => {
  const observations = []; let fetches = 0;
  const toolDefinition = { name: 'reflection_meaning', strict: true,
    parameters: { type: 'object', additionalProperties: false } };
  const expectedToolSchemaDigest = createHash('sha256')
    .update(JSON.stringify(toolDefinition)).digest('hex');
  const fetch = makeAuditedFetch({ endpoint: 'https://api.openai.com/v1/responses',
    expectedModel: 'gpt-5.6-terra', expectedToolSchemaDigest, observations,
    fetchImpl: async () => { fetches += 1; return { ok: true }; } });
  const body = JSON.stringify({ store: false, model: 'gpt-5.6-terra',
    tool_choice: 'required', tools: [toolDefinition], input: 'synthetic' });
  await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: {
    authorization: 'Bearer secret-canary' }, body });
  assert.equal(fetches, 1); assert.equal(observations[0].requestBytes,
    Buffer.byteLength(body, 'utf8'));
  assert.equal(observations[0].expectedModel, 'gpt-5.6-terra');
  assert.equal(observations[0].modelMatched, true); assert.equal(observations[0].strictTool, true);
  assert.match(observations[0].requestDigest, /^[a-f0-9]{64}$/u);
  assert.match(observations[0].toolSchemaDigest, /^[a-f0-9]{64}$/u);
  assert.equal(observations[0].toolSchemaMatched, true);
  assert.deepEqual(observations[0].forbiddenHits, []);
  assert.equal(observations[0].rawHeadersPersisted, false);
  assert.equal(observations[0].rawBodyPersisted, false);
  await assert.rejects(() => fetch('https://api.openai.com/v1/responses', { method: 'POST',
    headers: {}, body: JSON.stringify({ store: false, model: 'gpt-5.6-terra', tool_choice: 'required',
      tools: [{ name: 'reflection_meaning' }], input: PRIVACY_CANARIES[0] }) }), /private runtime canary/u);
  await assert.rejects(() => fetch('https://api.openai.com/v1/responses', { method: 'POST',
    headers: { authorization: 'Bearer x' }, body: JSON.stringify({ store: false,
      model: 'gpt-5.6-terra', tool_choice: 'required', tools: [{ ...toolDefinition,
        parameters: { ...toolDefinition.parameters, required: ['forged'] } }], input: 'synthetic' }) }),
  /one-shot store-false/u);
  await assert.rejects(() => fetch('https://api.openai.com/v1/responses', { method: 'POST',
    headers: {}, body }), /one-shot store-false/u);
  assert.equal(fetches, 1);
});

test('positive fixture의 derived RecordRef·Session·store identity도 exact provider body에서 0이다', async () => {
  const [fixture] = reflectionQualificationFixtures(); let fetches = 0;
  const fetch = makeAuditedFetch({ endpoint: 'https://api.openai.com/v1/responses',
    expectedModel: 'gpt-5.6-terra', observations: [],
    forbiddenCanaries: fixture.forbiddenRequestCanaries,
    fetchImpl: async () => { fetches += 1; return { ok: true }; } });
  for (const canary of fixture.forbiddenRequestCanaries) {
    await assert.rejects(() => fetch('https://api.openai.com/v1/responses', { method: 'POST',
      headers: {}, body: JSON.stringify({ store: false, model: 'gpt-5.6-terra', tool_choice: 'required',
        tools: [{ name: 'reflection_meaning' }], input: canary }) }), /private runtime canary/u);
  }
  assert.equal(fetches, 0);
});

test('credential loader는 secretRef read-only이고 inline secret·짧은 OAuth expiry를 거부한다', async () => {
  let gets = 0; let sets = 0; let clears = 0;
  const secretStore = { async get() { gets += 1; return { credential: {
    access: 'oauth-access-canary', expiresAt: Date.now() + 60 * 60 * 1_000,
  } }; }, async set() { sets += 1; }, async clear() { clears += 1; } };
  const oauth = await loadReadOnlyConnectionCredential({ connection: { id: 'chatgpt_oauth:gpt-5.5',
    kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId: 'gpt-5.5', secretRef: 'model-secret' },
  secretStore });
  assert.equal(oauth.modelId, 'gpt-5.5'); assert.equal(gets, 1); assert.equal(sets, 0); assert.equal(clears, 0);
  await assert.rejects(() => loadReadOnlyConnectionCredential({ connection: { id: 'inline',
    kind: 'api_key', provider: 'openai', modelId: 'gpt-5.6-terra', secretRef: 'model-secret',
    key: 'inline-secret' }, secretStore }), /secret-reference-only/u);
  for (const [field, value] of [['access', 'x'], ['refresh', 'x'], ['token', 'x'], ['secret', 'x']]) {
    const before = gets;
    await assert.rejects(() => loadReadOnlyConnectionCredential({ connection: {
      id: 'inline', kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId: 'gpt-5.5',
      secretRef: 'model-secret', [field]: value,
    }, secretStore }), /secret-reference-only/u);
    assert.equal(gets, before);
  }
  await assert.rejects(() => loadReadOnlyConnectionCredential({ connection: { id: 'expired',
    kind: 'chatgpt_oauth', provider: 'chatgpt_oauth', modelId: 'gpt-5.5', secretRef: 'model-secret' },
  secretStore: { async get() { return { credential: { access: 'x', expiresAt: Date.now() + 1_000 } }; } } }),
  /no-refresh qualification margin/u);
  assert.equal(sets, 0); assert.equal(clears, 0);
});

test('usage 누락과 provider unknown은 0 token으로 꾸미지 않는다', async () => {
  assert.deepEqual(normalizeProviderUsage(null), {
    inputTokens: null, outputTokens: null, totalTokens: null, known: false, complete: false,
  });
  const observer = makeInMemoryProviderObserver();
  const handle = await observer.reserve({ provider: 'openai', model: 'terra', attempt: 1,
    contextReceipt: { requestBytes: 10 } });
  await observer.unknown(handle, { reason: 'transport_unknown' });
  assert.equal(observer.attempts[0].state, 'unknown');
  assert.equal(observer.attempts[0].usage.totalTokens, null);
  assert.equal(normalizeProviderUsage({ total_tokens: -1 }).totalTokens, null);
  assert.equal(normalizeProviderUsage({ total_tokens: 1.5 }).totalTokens, null);
  assert.equal(normalizeProviderUsage({ total_tokens: 3 }).complete, false);
});

test('invalid model choice는 runtime이 막아도 quality failure와 safety pass를 합치지 않는다', async () => {
  const [fixture] = reflectionQualificationFixtures();
  const result = await runMeaningJourney({ fixture, expectedModelId: 'fake-model', model: fakeModel([call({
    action: 'propose', hypothesis: '근거를 생략한다.', sourceEpisodeHandles: ['episode-alpha'],
    counterexampleHandles: [], affectedScopeHandles: ['scope-current-work'],
    correctionRelations: [], unknowns: [],
  })]) });
  assert.equal(result.structuralModelChoicePassed, false);
  assert.equal(result.modelQualityPassed, null);
  assert.equal(result.runtimeSafetyPassed, true);
  assert.equal(result.runtimeRejectedModelChoice, true);
  assert.equal(result.recordingCalls, 0); assert.equal(result.passed, false);
});

test('정확한 slot과 함께 prose를 반환하면 one-shot model quality는 실패한다', async () => {
  const [fixture] = reflectionQualificationFixtures();
  const model = fakeModel([call({ action: 'propose', hypothesis: '현재 결과를 먼저 확인한다.',
    sourceEpisodeHandles: ['episode-alpha', 'episode-beta'],
    counterexampleHandles: ['counterexample-gamma'], affectedScopeHandles: ['scope-current-work'],
    correctionRelations: [{ handle: 'correction-current', relation: 'preserved' }], unknowns: [],
  })]);
  const original = model.respond; model.respond = async (input) => ({ ...(await original(input)), text: 'extra' });
  const result = await runMeaningJourney({ fixture, expectedModelId: 'fake-model', model });
  assert.equal(result.responseProsePresent, true);
  assert.equal(result.structuralModelChoicePassed, false);
  assert.equal(result.modelQualityPassed, null);
  assert.equal(result.runtimeSafetyPassed, true); assert.equal(result.passed, false);
});

test('model output privacy canary는 human review 원문으로 재노출하지 않는다', async () => {
  const [fixture] = reflectionQualificationFixtures();
  const result = await runMeaningJourney({ fixture, expectedModelId: 'fake-model', model: fakeModel([call({
    action: 'propose', hypothesis: PRIVACY_CANARIES[0],
    sourceEpisodeHandles: ['episode-alpha', 'episode-beta'],
    counterexampleHandles: ['counterexample-gamma'], affectedScopeHandles: ['scope-current-work'],
    correctionRelations: [{ handle: 'correction-current', relation: 'preserved' }], unknowns: [],
  })]) });
  assert.equal(result.modelOutputPrivacyPassed, false);
  assert.equal(result.hypothesisForHumanReview, null);
  assert.equal(result.structuralModelChoicePassed, false); assert.equal(result.passed, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(PRIVACY_CANARIES[0], 'u'));
});

test('provider가 credential을 tool output에 echo해도 human review와 evidence에 재노출하지 않는다', async () => {
  const [fixture] = reflectionQualificationFixtures(); const credential = 'EPHEMERAL_ACCESS_CANARY';
  const result = await runMeaningJourney({ fixture, expectedModelId: 'fake-model',
    outputForbiddenCanaries: [credential], model: fakeModel([call({
      action: 'propose', hypothesis: credential,
      sourceEpisodeHandles: ['episode-alpha', 'episode-beta'],
      counterexampleHandles: ['counterexample-gamma'], affectedScopeHandles: ['scope-current-work'],
      correctionRelations: [{ handle: 'correction-current', relation: 'preserved' }], unknowns: [],
    })]) });
  assert.equal(result.modelOutputPrivacyPassed, false);
  assert.equal(result.hypothesisForHumanReview, null);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(credential, 'u'));
});

test('fake provider 종단 runner는 두 모델×두 fixture 네 요청만 쓰고 qualification state만 반환한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3m6-runner-test-'));
  try {
    const connectionFile = join(room, 'connections.json');
    await writeFile(connectionFile, JSON.stringify({ version: 2, connections: [{
      id: 'api_key:openai:gpt-5.6-terra', kind: 'api_key', provider: 'openai',
      modelId: 'gpt-5.6-terra', secretRef: 'api-secret',
    }, { id: 'chatgpt_oauth:gpt-5.5', kind: 'chatgpt_oauth', provider: 'chatgpt_oauth',
      modelId: 'gpt-5.5', secretRef: 'oauth-secret',
    }] }), { mode: 0o600 });
    let fetches = 0;
    const fetchImpl = async (url, options) => {
      fetches += 1; const body = JSON.parse(options.body);
      const serialized = JSON.stringify(body.input); const abstain = serialized.includes('episode-one');
      const args = abstain ? { action: 'abstain', hypothesis: '', sourceEpisodeHandles: [],
        counterexampleHandles: [], affectedScopeHandles: [], correctionRelations: [], unknowns: [] }
        : { action: 'propose', hypothesis: '현재 결과 확인 뒤 필요한 경우에만 재실행한다.',
          sourceEpisodeHandles: ['episode-alpha', 'episode-beta'],
          counterexampleHandles: ['counterexample-gamma'],
          affectedScopeHandles: ['scope-current-work'],
          correctionRelations: [{ handle: 'correction-current', relation: 'preserved' }],
          unknowns: ['다른 작업군은 아직 모른다.'] };
      const output = [{ type: 'function_call', call_id: `call-${fetches}`,
        name: 'reflection_meaning', arguments: JSON.stringify(args) }];
      const response = { id: `response-${fetches}`, model: body.model, output,
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 } };
      if (String(url).includes('chatgpt.com')) {
        return { ok: true, status: 200, text: async () => (
          `data: ${JSON.stringify({ type: 'response.completed', response })}\n\ndata: [DONE]\n`
        ) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(response) };
    };
    const secretStore = { async get(ref) {
      return ref === 'api-secret' ? { key: 'api-key-canary' } : { credential: {
        access: 'oauth-access-canary', expiresAt: 10_000_000,
      } };
    } };
    const result = await main(['--human-controlled'], { connectionFile, fetchImpl, secretStore,
      now: () => 1_000_000, sourceCommit: 'a'.repeat(40) });
    assert.equal(result.pass, false); assert.equal(result.fullModelPair, true);
    assert.equal(result.machineQualificationPassed, true);
    assert.equal(result.status, 'MACHINE_PASS_HUMAN_MEANING_REVIEW_REQUIRED');
    assert.equal(result.humanMeaningReviewRequired, true);
    assert.equal(result.expectedProviderCalls, 4); assert.equal(result.totals.providerRequests, 4);
    assert.equal(result.totals.totalTokens, 120); assert.equal(fetches, 4);
    assert.ok(result.results.every((item) => item.ledgerWrites === 0
      && item.materializationCalls === 0 && item.requestObservations[0].storeFalse === true));
    const negativeOnly = await main(['--human-controlled', '--fixture', 'insufficient_shared_method'], {
      connectionFile, fetchImpl, secretStore, now: () => 1_000_000, sourceCommit: 'a'.repeat(40),
    });
    assert.deepEqual(negativeOnly.selectedFixtures, ['insufficient_shared_method']);
    assert.equal(negativeOnly.expectedProviderCalls, 2);
    assert.equal(negativeOnly.machineQualificationPassed, true);
    assert.equal(negativeOnly.humanMeaningReviewRequired, false);
    assert.equal(negativeOnly.pass, true); assert.equal(fetches, 6);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('runner source는 product/materializer/ledger를 import하지 않고 stdout-only evidence 경계를 고정한다', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../scripts/run-s3m6-reflection-shadow-qualification.mjs', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /from ['"]\.\.\/src\/(?:reflection-evidence-materializer|reflection-ledger|reflection-source-window-coordinator|console-server|managed-skill-store|capability-lifecycle)/u);
  assert.match(source, /--human-controlled/u); assert.match(source, /maxAttempts:\s*1/u);
  assert.match(source, /providerRetentionNotClaimed:\s*true/u);
  assert.match(source, /evidenceOutput:\s*'stdout_only'/u);
  assert.match(source, /let credentialStoreWrites = 0/u);
});
