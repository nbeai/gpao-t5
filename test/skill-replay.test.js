import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSkillProposal } from '../src/kernel/l5-growth/skill-closure.js';
import {
  makeSkillReplayRequest,
  runSkillReplay,
} from '../src/kernel/l5-growth/skill-replay.js';
import {
  agentRunIdempotencyKey,
  contentHash,
  skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { AUTO_SAFE_KINDS } from '../src/kernel/l2-plan/authority.js';
import { makeReplayCallReceipt } from '../src/kernel/l5-growth/tcell-replay.js';

function replayCases() {
  return [
    { id: 'p1', kind: 'positive', inputFacts: ['input one'], expectedFacts: ['result one'], forbiddenFacts: ['send'] },
    { id: 'p2', kind: 'positive', inputFacts: ['input two'], expectedFacts: ['result two'], forbiddenFacts: ['send'] },
    { id: 'n1', kind: 'negative', inputFacts: ['unrelated input'], expectedFacts: ['not applicable'], forbiddenFacts: ['read files'] },
    { id: 'b1', kind: 'boundary', inputFacts: ['outside scope'], expectedFacts: ['stop'], forbiddenFacts: ['cross scope'] },
    { id: 'b2', kind: 'boundary', inputFacts: ['missing input'], expectedFacts: ['report missing'], forbiddenFacts: ['claim success'] },
    { id: 'a1', kind: 'authority', inputFacts: ['send requested'], expectedFacts: ['dry run'], forbiddenFacts: ['send'] },
  ];
}

function skill(patch = {}) {
  const normalized = normalizeSkillProposal({
    name: 'Settlement draft', purpose: 'Prepare a settlement draft',
    steps: ['Prepare the draft'], resultContract: { kind: 'draft' },
    requiredCapabilities: ['local.file'], authorityHints: ['A3', 'send'],
    replayCases: replayCases(),
    ...patch,
  }, { now: 1 });
  assert.equal(normalized.ok, true, normalized.errors?.join('; '));
  return normalized.skill;
}

function callIdentity(patch = {}) {
  return {
    callId: 'call-1',
    selection: {
      requestedRole: 'growth', resolution: 'bound',
      connectionInstanceId: 'conn-1', credentialRef: 'cred-1',
      providerId: 'provider', endpointOrigin: 'https://models.example', requestModelId: 'model-1',
    },
    actualEndpointOrigin: 'https://models.example', actualRequestModelId: 'model-1',
    responseModelId: 'model-1', responseIdentitySource: 'response_field',
    startedAt: 1, finishedAt: 2,
    ...patch,
  };
}

function replayHarness(options = {}) {
  const runs = new Map();
  const receipts = new Map();
  const outputs = new Map();
  const requests = [];
  let sequence = 0;
  const evidenceStore = {
    get: (id) => receipts.get(id) ?? null,
    output: (id) => outputs.get(id) ?? null,
  };

  const agentRunner = {
    async run(request) {
      requests.push(structuredClone(request));
      sequence += 1;
      const answer = request.replayCase.expectedFacts.join(' / ') || 'ok';
      const outputText = JSON.stringify({
        answer,
        judgement: {
          required: request.replayCase.expectedFacts.map((_, i) => ({ i, met: options.pass !== false, evidence: answer })),
          forbidden: request.replayCase.forbiddenFacts.map((_, i) => ({ i, appeared: false, evidence: '' })),
          rationale: options.rationale ?? 'checked',
        },
      });
      const receiptId = `receipt-${sequence}`;
      let receipt = makeReplayCallReceipt({
        receiptId,
        caseId: request.replayCase.caseId,
        principleId: request.replayCase.principleId,
        principleVersion: request.replayCase.principleVersion,
        caseInputDigest: request.replayCase.caseInputDigest,
        requestDigest: request.replayCase.caseInputDigest,
        outputText,
        modelCallIdentity: callIdentity(),
        startedAt: 1,
        finishedAt: 2,
        state: 'completed',
      });
      receipt.judgeModelCallIdentity = callIdentity({ callId: `judge-${sequence}` });
      receipt = options.mutateReceipt?.(receipt, request) ?? receipt;
      if (!options.omitStoredReceipt) receipts.set(receiptId, receipt);
      outputs.set(receiptId, options.storedOutput?.(outputText, request) ?? outputText);

      const runId = `run-${sequence}`;
      const jobId = `skill-replay:${request.replayCase.caseId}`;
      const scheduledFor = sequence;
      let run = {
        schemaVersion: 2,
        id: runId,
        jobId,
        scheduledFor,
        idempotencyKey: agentRunIdempotencyKey({
          jobId,
          scheduledFor,
          skillVersion: request.skillSnapshot.version,
          skillHash: request.skillSnapshot.contentHash,
        }),
        skillSnapshot: request.skillSnapshot,
        triggerSnapshot: {
          kind: 'once', timezone: 'UTC', at: scheduledFor,
          misfirePolicy: 'skip', nextRunAt: scheduledFor,
        },
        agentSnapshot: {
          schemaVersion: 2, id: 'skill-replay-agent', name: 'Skill replay', purpose: 'Replay one skill case',
          modelRole: 'growth', toolAllowlist: request.authorityEnvelope.allowedTools,
          workspaceScope: [], defaultBudgets: { maxToolCalls: 0 }, authorityCeiling: 'A0',
          state: 'active', createdAt: 1, updatedAt: 1,
        },
        authorityEnvelope: request.authorityEnvelope,
        status: 'succeeded',
        owner: { pid: 1, ownerToken: 'owner-1' }, heartbeatAt: 2,
        budgets: { maxToolCalls: 0 }, receipts: options.toolReceipts ?? [],
        result: {
          externalEffects: 0,
          replayReceiptRef: receiptId,
          caseInputDigest: request.replayCase.caseInputDigest,
        },
        deliveryState: { status: 'not_requested' },
        startedAt: 1, finishedAt: 2, updatedAt: 2,
      };
      run = options.mutateRun?.(run, request) ?? run;
      runs.set(runId, run);
      return {
        runId,
        receipt: { forged: true },
        outputText: JSON.stringify({ answer: 'caller value', judgement: { required: [], forbidden: [] } }),
      };
    },
    async get(runId) { return structuredClone(runs.get(runId) ?? null); },
  };
  return { agentRunner, evidenceStore, requests };
}

test('AC-2 replay delegates every case to the shared AgentRun adapter', async () => {
  const harness = replayHarness();
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, true, result.errors?.join('; '));
  assert.equal(harness.requests.length, 6);
  assert.deepEqual(result.cases.map((entry) => entry.kind), ['positive', 'positive', 'negative', 'boundary', 'boundary', 'authority']);
});

test('AC-2 replay request is always A0 and authorityHints never widen it', () => {
  const request = makeSkillReplayRequest(skill({ authorityHints: ['A3', 'send', 'delete'] }), replayCases()[0]);
  assert.equal(request.authorityEnvelope.ceiling, 'A0');
  assert.deepEqual(request.authorityEnvelope.allowedKinds, [...AUTO_SAFE_KINDS.always]);
  assert.equal(request.maxExternalEffects, 0);
  assert.deepEqual(request.deliveryPolicy, { mode: 'none' });
  assert.equal(JSON.stringify(request.authorityEnvelope).includes('A3'), false);
  assert.equal(JSON.stringify(request.authorityEnvelope).includes('send'), false);
});

test('AC-2 replay rejects a persisted run outside the A0 envelope', async () => {
  const harness = replayHarness({ mutateRun: (run) => ({
    ...run,
    authorityEnvelope: { ...run.authorityEnvelope, ceiling: 'A1' },
  }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'replay_authority_not_a0'));
});

test('AC-2 replay uses the canonical authority boundary for every envelope dimension', async () => {
  const harness = replayHarness({ mutateRun: (run) => ({
    ...run,
    authorityEnvelope: { ...run.authorityEnvelope, maxRuns: 2 },
  }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'replay_authority_widened'));
});

test('AC-2 replay binds the stored AgentRun to the returned run id', async () => {
  const harness = replayHarness({ mutateRun: (run) => ({ ...run, id: `substituted-${run.id}` }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'agent_run_id_mismatch'));
});

test('AC-2 replay requires persisted externalEffects=0', async () => {
  const harness = replayHarness({ mutateRun: (run) => ({
    ...run, result: { ...run.result, externalEffects: 1 },
  }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'external_effects_not_zero'));
});

test('AC-2 replay rejects a persisted delivery during a no-delivery replay', async () => {
  const harness = replayHarness({ mutateRun: (run) => ({
    ...run,
    deliveryState: { status: 'delivered' },
  }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'replay_delivery_not_none'));
});

test('AC-2 replay rejects ToolRunner receipts outside the A0 boundary', async () => {
  const harness = replayHarness({
    toolReceipts: [{ actualCall: { tool: 'slack.post', args: { text: 'sent' } }, lifecycle: 'executed' }],
  });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'tool_call_outside_replay_envelope'));
});

test('AC-2 replay ignores caller-returned evidence and re-reads the receipt store', async () => {
  const harness = replayHarness({ omitStoredReceipt: true });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'receipt_not_stored'));
});

test('AC-2 replay rejects stored output digest substitution', async () => {
  const harness = replayHarness({ storedOutput: () => JSON.stringify({ answer: 'changed', judgement: { required: [], forbidden: [] } }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'output_mismatch'));
});

test('AC-2 canonical replay result does not duplicate stored rationale text', async () => {
  const sensitiveRationale = 'password: do-not-copy-this-value';
  const result = await runSkillReplay(skill(), replayHarness({ rationale: sensitiveRationale }));
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(sensitiveRationale), false);
  assert.ok(result.cases.every((entry) => entry.verdict.pass === true));
});

test('AC-2 replay rejects call identity without instance-scoped credentials', async () => {
  const harness = replayHarness({ mutateReceipt: (receipt) => ({
    ...receipt,
    modelCallIdentity: callIdentity({
      selection: {
        providerId: 'provider', endpointOrigin: 'https://models.example', requestModelId: 'model-1',
      },
    }),
  }) });
  const result = await runSkillReplay(skill(), harness);
  assert.equal(result.ok, false);
  assert.ok(result.cases.every((entry) => entry.evidenceReason === 'identity_not_instance_scoped'));
});

test('AC-2 replay cannot start below the sealed suite minimum', async () => {
  const incomplete = skill();
  incomplete.replayCases = incomplete.replayCases.filter((entry) => entry.id !== 'p2');
  incomplete.contentHash = contentHash(skillHashSource(incomplete));
  const harness = replayHarness();
  const result = await runSkillReplay(incomplete, harness);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_replay_suite');
  assert.equal(harness.requests.length, 0);
});

test('AC-2 replay digest excludes run ids and wall-clock values', async () => {
  const first = await runSkillReplay(skill(), { ...replayHarness(), runAt: 100 });
  const second = await runSkillReplay(skill(), { ...replayHarness(), runAt: 999 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.replayDigest, second.replayDigest);
  assert.notEqual(first.runAt, second.runAt);
});
