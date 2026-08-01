import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeSkillProposal } from '../src/kernel/l5-growth/skill-closure.js';
import { agentRunIdempotencyKey } from '../src/kernel/l5-growth/automation-contracts.js';
import { makeReplayCallReceipt } from '../src/kernel/l5-growth/tcell-replay.js';
import { SkillService, SKILL_SERVICE_CONTROL_NAMES } from '../src/surface/skill-service.js';
import { SkillDefinitionStore, SkillStore } from '../src/surface/skill-store.js';

function replayCases() {
  return [
    { id: 'p1', kind: 'positive', inputFacts: ['one'], expectedFacts: ['done'], forbiddenFacts: ['send'] },
    { id: 'p2', kind: 'positive', inputFacts: ['two'], expectedFacts: ['done'], forbiddenFacts: ['send'] },
    { id: 'n1', kind: 'negative', inputFacts: ['other'], expectedFacts: ['skip'], forbiddenFacts: ['run'] },
    { id: 'b1', kind: 'boundary', inputFacts: ['outside'], expectedFacts: ['stop'], forbiddenFacts: ['cross'] },
    { id: 'b2', kind: 'boundary', inputFacts: ['missing'], expectedFacts: ['report'], forbiddenFacts: ['invent'] },
    { id: 'a1', kind: 'authority', inputFacts: ['send'], expectedFacts: ['dry run'], forbiddenFacts: ['send'] },
  ];
}

function proposal(patch = {}) {
  return {
    name: 'Settlement draft', purpose: 'Prepare a settlement draft',
    steps: ['Prepare the draft'], resultContract: { kind: 'draft' },
    requiredCapabilities: [], authorityHints: ['A3'], replayCases: replayCases(),
    ...patch,
  };
}

function canonicalMemoryStore(initial = []) {
  let state = { schemaVersion: 2, skills: structuredClone(initial) };
  return {
    async load() { return structuredClone(state); },
    async update(mutator) {
      const changed = await mutator(structuredClone(state)) ?? state;
      state = structuredClone(changed);
      return structuredClone(state);
    },
  };
}

function replayRuntime(options = {}) {
  const runs = new Map();
  const receipts = new Map();
  const outputs = new Map();
  let sequence = 0;
  const evidenceStore = {
    get: (id) => receipts.get(id) ?? null,
    output: (id) => outputs.get(id) ?? null,
  };
  const agentRunner = {
    async run(request) {
      await options.beforeRun?.(request, sequence);
      sequence += 1;
      const outputText = JSON.stringify({ verdict: { pass: true, rationale: 'checked' } });
      const receiptId = `receipt-${sequence}`;
      receipts.set(receiptId, makeReplayCallReceipt({
        receiptId,
        caseId: request.replayCase.caseId,
        principleId: request.replayCase.principleId,
        principleVersion: request.replayCase.principleVersion,
        caseInputDigest: request.replayCase.caseInputDigest,
        requestDigest: request.replayCase.caseInputDigest,
        outputText,
        modelCallIdentity: {
          selection: {
            connectionInstanceId: 'conn-1', credentialRef: 'cred-1',
            endpointOrigin: 'https://models.example', requestModelId: 'model-1',
          },
          actualEndpointOrigin: 'https://models.example', actualRequestModelId: 'model-1',
          responseModelId: 'model-1', responseIdentitySource: 'response_field',
        },
        startedAt: 1,
        finishedAt: 2,
        state: 'completed',
      }));
      outputs.set(receiptId, outputText);
      const runId = `run-${sequence}`;
      const jobId = `skill-replay:${request.replayCase.caseId}`;
      const scheduledFor = sequence;
      runs.set(runId, {
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
          schemaVersion: 2,
          id: 'skill-replay-agent',
          name: 'Skill replay',
          purpose: 'Replay one skill case',
          modelRole: 'growth',
          toolAllowlist: request.authorityEnvelope.allowedTools,
          workspaceScope: [],
          defaultBudgets: { maxToolCalls: 0 },
          authorityCeiling: 'A0',
          state: 'active',
          createdAt: 1,
          updatedAt: 1,
        },
        authorityEnvelope: request.authorityEnvelope,
        status: 'succeeded',
        owner: { pid: 1, ownerToken: 'owner-1' },
        heartbeatAt: 2,
        budgets: { maxToolCalls: 0 },
        receipts: [],
        result: {
          externalEffects: 0,
          replayReceiptRef: receiptId,
          caseInputDigest: request.replayCase.caseInputDigest,
        },
        deliveryState: { status: 'not_requested' },
        startedAt: 1,
        finishedAt: 2,
        updatedAt: 2,
      });
      return { runId, verdict: { pass: false }, outputText: 'caller value is not evidence' };
    },
    async get(runId) { return structuredClone(runs.get(runId) ?? null); },
  };
  return {
    agentRunner,
    evidenceStore,
    removeEvidence(id) {
      receipts.delete(id);
      outputs.delete(id);
    },
  };
}

function service(store, runtime = replayRuntime()) {
  return new SkillService({ store, ...runtime });
}

function approvalFor(skill) {
  return {
    id: `approval-${skill.version}`,
    decision: 'approved',
    skillId: skill.id,
    skillVersion: skill.version,
    skillHash: skill.contentHash,
    replayDigest: skill.lastReplay.replayDigest,
  };
}

test('AC-2 service exposes the control consumer name for parent wiring', () => {
  assert.deepEqual(SKILL_SERVICE_CONTROL_NAMES, ['skill.propose']);
});

test('AC-2 service rejects an injectable replay truth', () => {
  assert.throws(
    () => new SkillService({ store: canonicalMemoryStore(), replay: () => ({ ok: true }) }),
    /custom replay adapters are forbidden/,
  );
});

test('AC-2 service rejects the legacy SkillStore API at construction', () => {
  const legacy = new SkillStore('/tmp/unused-ac2-legacy-store');
  assert.throws(() => new SkillService({ store: legacy }), /canonical SkillDefinitionStore/);
});

test('AC-2 service rejects compatibility views and __v2Definition records', async () => {
  const canonical = normalizeSkillProposal(proposal(), { now: 1 }).skill;
  const legacyView = {
    schemaVersion: 2,
    compatibility: 'v1',
    skills: [{ id: canonical.id, state: 'candidate', __v2Definition: canonical }],
  };
  const store = {
    async load() { return structuredClone(legacyView); },
    async update(mutator) { return mutator(structuredClone(legacyView)); },
  };
  await assert.rejects(service(store).list(), /canonical skill state required/);
});

test('AC-2 canonical service keeps replay, approval, and activation as separate operations', async () => {
  const store = canonicalMemoryStore();
  const skills = service(store);
  const proposed = await skills.propose(proposal(), { sessionId: 's1', now: 10 });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.skill.state, 'proposed');

  const replayed = await skills.replay(proposed.skill.id, { now: 20 });
  assert.equal(replayed.ok, true);
  let current = (await skills.get(proposed.skill.id)).skill;
  assert.equal(current.state, 'replay_required');
  assert.match(current.lastReplay.replayDigest, /^[a-f0-9]{64}$/);

  const noReceipt = await skills.approve(current.id, { now: 30, confirmed: true });
  assert.equal(noReceipt.ok, false);
  assert.equal(noReceipt.reason, 'explicit_approval_required');

  const approved = await skills.approve(current.id, { now: 30, approval: approvalFor(current), activate: true });
  assert.equal(approved.ok, true);
  current = (await skills.get(current.id)).skill;
  assert.equal(current.state, 'approved', 'approval must not activate');

  const activated = await skills.activate(current.id, { now: 40, replay: true, approve: true });
  assert.equal(activated.ok, true);
  current = (await skills.get(current.id)).skill;
  assert.equal(current.state, 'active');
});

test('AC-2 approval is bound to the exact skill hash and replay digest', async () => {
  const store = canonicalMemoryStore();
  const skills = service(store);
  const proposed = await skills.propose(proposal(), { now: 1 });
  await skills.replay(proposed.skill.id, { now: 2 });
  const current = (await skills.get(proposed.skill.id)).skill;
  for (const patch of [
    { skillHash: 'f'.repeat(64) },
    { replayDigest: 'other-digest' },
    { skillVersion: 99 },
    { decision: 'rejected' },
  ]) {
    const result = await skills.approve(current.id, {
      now: 3,
      approval: { ...approvalFor(current), ...patch },
    });
    assert.equal(result.ok, false, JSON.stringify(patch));
  }
  assert.equal((await skills.get(current.id)).skill.state, 'replay_required');
});

test('AC-2 approval re-reads stored replay evidence instead of trusting lastReplay', async () => {
  const store = canonicalMemoryStore();
  const runtime = replayRuntime();
  const skills = service(store, runtime);
  const proposed = await skills.propose(proposal(), { now: 1 });
  await skills.replay(proposed.skill.id, { now: 2 });
  const current = (await skills.get(proposed.skill.id)).skill;
  runtime.removeEvidence(current.lastReplay.cases[0].runReceiptRef);

  const approved = await skills.approve(current.id, { now: 3, approval: approvalFor(current) });
  assert.equal(approved.ok, false);
  assert.equal(approved.reason, 'stored_replay_invalid');
  assert.equal((await skills.get(current.id)).skill.state, 'replay_required');
});

test('AC-2 activation re-reads the evidence bound to the stored approval', async () => {
  const store = canonicalMemoryStore();
  const runtime = replayRuntime();
  const skills = service(store, runtime);
  const proposed = await skills.propose(proposal(), { now: 1 });
  await skills.replay(proposed.skill.id, { now: 2 });
  let current = (await skills.get(proposed.skill.id)).skill;
  await skills.approve(current.id, { now: 3, approval: approvalFor(current) });
  current = (await skills.get(current.id)).skill;
  runtime.removeEvidence(current.lastReplay.cases[0].runReceiptRef);

  const activated = await skills.activate(current.id, { now: 4 });
  assert.equal(activated.ok, false);
  assert.equal(activated.reason, 'stored_replay_invalid');
  assert.equal((await skills.get(current.id)).skill.state, 'approved');
});

test('AC-2 active revision can replay, approve, activate, and rollback to the prior active version', async () => {
  const store = canonicalMemoryStore();
  const skills = service(store);
  const proposed = await skills.propose(proposal(), { now: 1 });
  await skills.replay(proposed.skill.id, { now: 2 });
  let current = (await skills.get(proposed.skill.id)).skill;
  await skills.approve(current.id, { now: 3, approval: approvalFor(current) });
  await skills.activate(current.id, { now: 4 });

  const revised = await skills.revise(current.id, { purpose: 'Prepare a reviewed settlement draft' }, { now: 5 });
  assert.equal(revised.ok, true);
  assert.equal(revised.skill.version, 2);
  assert.equal(revised.skill.state, 'proposed');
  await skills.replay(current.id, { now: 6 });
  current = (await skills.get(current.id)).skill;
  await skills.approve(current.id, { now: 7, approval: approvalFor(current) });
  await skills.activate(current.id, { now: 8 });

  const rolledBack = await skills.rollback(current.id, { now: 9 });
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.skill.version, 1);
  assert.equal(rolledBack.skill.state, 'active');
  assert.equal(rolledBack.skill.rolledBackFrom.version, 2);
});

test('AC-2 sensitive proposals and revisions are rejected before canonical storage', async () => {
  const store = canonicalMemoryStore();
  const skills = service(store);
  const rejected = await skills.propose(proposal({ inputs: [{ password: 'hunter2machine' }] }), { now: 1 });
  assert.equal(rejected.ok, false);
  assert.deepEqual((await skills.list()).skills, []);

  const proposed = await skills.propose(proposal(), { now: 2 });
  const revision = await skills.revise(proposed.skill.id, {
    resultContract: { headers: ['Bearer abcdefghijklmnop'] },
  }, { now: 3 });
  assert.equal(revision.ok, false);
  assert.equal((await skills.get(proposed.skill.id)).skill.version, 1);

  const rawReason = 'password: do-not-store-this-rejection-input';
  const rejectedSkill = await skills.reject(proposed.skill.id, { now: 4, reason: rawReason });
  assert.equal(rejectedSkill.ok, true);
  assert.equal(JSON.stringify(await skills.list()).includes(rawReason), false);
});

test('AC-2 replay evidence is discarded if the canonical definition changes during replay', async () => {
  const store = canonicalMemoryStore();
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  let firstRun = true;
  const runtime = replayRuntime({
    beforeRun: async () => {
      if (!firstRun) return;
      firstRun = false;
      started();
      await wait;
    },
  });
  const skills = service(store, runtime);
  const proposed = await skills.propose(proposal(), { now: 1 });
  const replaying = skills.replay(proposed.skill.id, { now: 2 });
  await began;
  const revised = await skills.revise(proposed.skill.id, { purpose: 'Changed while replay ran' }, { now: 3 });
  assert.equal(revised.ok, true);
  release();
  const result = await replaying;
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'skill_changed_during_replay');
  assert.equal((await skills.get(proposed.skill.id)).skill.lastReplay, undefined);
});

test('AC-2 canonical SkillDefinitionStore persists service state without a legacy view', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac2-canonical-'));
  const store = new SkillDefinitionStore(dir);
  const skills = service(store);
  const proposed = await skills.propose(proposal(), { now: 1 });
  await skills.replay(proposed.skill.id, { now: 2 });
  let current = (await skills.get(proposed.skill.id)).skill;
  await skills.approve(current.id, { now: 3, approval: approvalFor(current) });
  await skills.activate(current.id, { now: 4 });

  const restarted = new SkillService({ store: new SkillDefinitionStore(dir) });
  const state = await restarted.list();
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.compatibility, undefined);
  assert.equal(state.skills[0].state, 'active');
  assert.equal(state.skills[0].__v2Definition, undefined);
  const active = await restarted.active();
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].authorityHints, ['A3']);
  assert.equal(active[0].executionAuthority, null, 'authority hints must not become execution authority');
});
