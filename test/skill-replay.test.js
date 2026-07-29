import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  normalizeSkillProposal,
} from '../src/kernel/l5-growth/skill-closure.js';
import {
  contentHash,
  reviseSkillDefinition,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { runSkillReplay } from '../src/runtime/skill-replay-runner.js';
import { SkillClosureService } from '../src/runtime/skill-closure-service.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';

function proposal() {
  return {
    name: '정산 정리',
    purpose: '정산 자료를 읽고 합계를 만든다',
    inputs: [],
    steps: [{ kind: 'calculate', instruction: '합계를 계산한다' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file.read'],
    authorityHints: ['A1'],
    replayCases: [
      {
        id: 'positive',
        kind: 'positive',
        request: { values: [10, 20] },
        expected: { status: 'succeeded', result: { total: 30 } },
      },
      {
        id: 'negative',
        kind: 'negative',
        request: { text: '날씨를 알려줘' },
        expected: { status: 'not_applicable' },
      },
      {
        id: 'boundary',
        kind: 'boundary',
        request: { folder: '/outside' },
        expected: { status: 'blocked' },
      },
    ],
    source: { kind: 'model_proposal' },
  };
}

function skill() {
  const result = normalizeSkillProposal(proposal(), { now: 1 });
  assert.equal(result.ok, true, result.errors?.join('; '));
  return result.skill;
}

function successfulExecutor(calls = []) {
  return async ({ replayCase }) => {
    calls.push(replayCase.id);
    if (replayCase.kind === 'positive') {
      return {
        status: 'succeeded',
        result: { total: 30 },
        usedCapabilities: ['local.file.read'],
        externalEffects: [],
      };
    }
    if (replayCase.kind === 'negative') {
      return { status: 'not_applicable', usedCapabilities: [], externalEffects: [] };
    }
    return { status: 'blocked', usedCapabilities: [], externalEffects: [] };
  };
}

test('AC-2A: replay actually executes positive, negative, and boundary cases', async () => {
  const calls = [];
  const result = await runSkillReplay(skill(), {
    execute: successfulExecutor(calls),
    runAt: 100,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['positive', 'negative', 'boundary']);
  assert.deepEqual(result.cases.map((entry) => entry.kind), ['positive', 'negative', 'boundary']);
  assert.equal(result.skillVersion, 1);
  assert.equal(result.skillHash, skill().contentHash);
});

test('AC-2A: replay cannot pass as structural validation without an executor', async () => {
  const result = await runSkillReplay(skill(), { runAt: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'executor_required');
});

test('AC-2A: negative and boundary replay fail on any external effect', async () => {
  for (const violatingKind of ['negative', 'boundary']) {
    const result = await runSkillReplay(skill(), {
      execute: async ({ replayCase }) => {
        const base = await successfulExecutor()({ replayCase });
        return replayCase.kind === violatingKind
          ? { ...base, externalEffects: [{ kind: 'send', target: 'outside' }] }
          : base;
      },
      runAt: 100,
    });
    assert.equal(result.ok, false, `${violatingKind} must fail`);
    assert.equal(result.cases.find((entry) => entry.kind === violatingKind).ok, false);
  }
});

test('AC-2A: undeclared capabilities fail replay instead of widening the skill', async () => {
  const result = await runSkillReplay(skill(), {
    execute: async ({ replayCase }) => {
      const base = await successfulExecutor()({ replayCase });
      return replayCase.kind === 'positive'
        ? { ...base, usedCapabilities: ['local.file.read', 'slack.post'] }
        : base;
    },
    runAt: 100,
  });

  assert.equal(result.ok, false);
  assert.match(result.cases[0].reason, /undeclared capability/);
});

test('AC-2A: malformed executor evidence cannot collapse into empty safe evidence', async () => {
  for (const patch of [
    { usedCapabilities: { hidden: 'slack.post' } },
    { externalEffects: { hidden: 'send' } },
  ]) {
    const result = await runSkillReplay(skill(), {
      execute: async ({ replayCase }) => ({
        ...await successfulExecutor()({ replayCase }),
        ...patch,
      }),
      runAt: 100,
    });
    assert.equal(result.ok, false);
    assert.match(result.cases[0].reason, /invalid replay evidence/);
  }
});

test('AC-2A: executor failures are evidence, not thrown success or skipped cases', async () => {
  const result = await runSkillReplay(skill(), {
    execute: async ({ replayCase }) => {
      if (replayCase.kind === 'positive') throw new Error('model timeout');
      return successfulExecutor()({ replayCase });
    },
    runAt: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.cases.length, 3, 'remaining counter-cases must still run');
  assert.equal(result.cases[0].actual.status, 'execution_failed');
  assert.equal(result.cases[0].actual.error, 'model timeout');
});

test('AC-2A: a missing expected result is a replay failure, not a runner exception', async () => {
  const result = await runSkillReplay(skill(), {
    execute: async ({ replayCase }) => {
      const base = await successfulExecutor()({ replayCase });
      if (replayCase.kind === 'positive') delete base.result;
      return base;
    },
    runAt: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.cases[0].reason, 'result contract mismatch');
});

test('AC-2A: replay digest is reproducible and excludes wall-clock evidence time', async () => {
  const first = await runSkillReplay(skill(), { execute: successfulExecutor(), runAt: 100 });
  const second = await runSkillReplay(skill(), {
    execute: async ({ replayCase }) => {
      const result = await successfulExecutor()({ replayCase });
      return {
        externalEffects: result.externalEffects,
        usedCapabilities: result.usedCapabilities,
        result: result.result,
        status: result.status,
      };
    },
    runAt: 999,
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.replayDigest, second.replayDigest);
  assert.notEqual(first.runAt, second.runAt);
});

test('AC-2A: malformed replay case internals are rejected without calling the executor', async () => {
  const malformed = skill();
  malformed.replayCases = [null, ...malformed.replayCases.slice(1)];
  malformed.contentHash = contentHash({
    name: malformed.name,
    purpose: malformed.purpose,
    inputs: malformed.inputs,
    steps: malformed.steps,
    resultContract: malformed.resultContract,
    requiredCapabilities: malformed.requiredCapabilities,
    authorityHints: malformed.authorityHints,
    replayCases: malformed.replayCases,
  });
  let calls = 0;
  const result = await runSkillReplay(malformed, {
    execute: async () => { calls += 1; return {}; },
    runAt: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_replay_contract');
  assert.equal(calls, 0);
});

test('AC-2A: runner rejects all-succeeded kind/status semantics before executor calls', async () => {
  const malformed = skill();
  malformed.replayCases = malformed.replayCases.map((replayCase) => ({
    ...replayCase,
    expected: { ...replayCase.expected, status: 'succeeded' },
  }));
  malformed.contentHash = contentHash({
    name: malformed.name,
    purpose: malformed.purpose,
    inputs: malformed.inputs,
    steps: malformed.steps,
    resultContract: malformed.resultContract,
    requiredCapabilities: malformed.requiredCapabilities,
    authorityHints: malformed.authorityHints,
    replayCases: malformed.replayCases,
  });
  let calls = 0;
  const result = await runSkillReplay(malformed, {
    execute: async () => {
      calls += 1;
      return {
        status: 'succeeded',
        usedCapabilities: [],
        externalEffects: [],
      };
    },
    runAt: 100,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_replay_contract');
  assert.equal(calls, 0);
  assert.ok(result.errors.some((error) => error.includes('negative') && error.includes('not_applicable')));
  assert.ok(result.errors.some((error) => error.includes('boundary') && error.includes('blocked')));
});

test('AC-2A: runner independently rejects every kind/status mismatch before execution', async () => {
  const wrongStatus = {
    positive: 'blocked',
    negative: 'succeeded',
    boundary: 'not_applicable',
  };
  for (const [kind, status] of Object.entries(wrongStatus)) {
    const malformed = skill();
    malformed.replayCases = malformed.replayCases.map((replayCase) => replayCase.kind === kind
      ? { ...replayCase, expected: { ...replayCase.expected, status } }
      : replayCase);
    malformed.contentHash = contentHash({
      name: malformed.name,
      purpose: malformed.purpose,
      inputs: malformed.inputs,
      steps: malformed.steps,
      resultContract: malformed.resultContract,
      requiredCapabilities: malformed.requiredCapabilities,
      authorityHints: malformed.authorityHints,
      replayCases: malformed.replayCases,
    });
    let calls = 0;
    const result = await runSkillReplay(malformed, {
      execute: async () => { calls += 1; return {}; },
      runAt: 100,
    });
    assert.equal(result.reason, 'invalid_replay_contract');
    assert.equal(calls, 0, `${kind} mismatch reached executor`);
    assert.ok(result.errors.some((error) => error.includes(kind) && error.includes('requires')));
  }
});

function memoryStore() {
  let state = { schemaVersion: 2, skills: [] };
  return {
    async load() { return structuredClone(state); },
    async save(next) { state = structuredClone(next); return next; },
  };
}

test('AC-2A: proposal and replay evidence persist, but replay never self-approves', async () => {
  const store = memoryStore();
  const service = new SkillClosureService({ store, executeReplayCase: successfulExecutor() });
  const proposed = await service.propose(proposal(), { sessionId: 's1', now: 10 });
  assert.equal(proposed.ok, true);
  assert.equal(proposed.skill.state, 'proposed');

  const replayed = await service.replay(proposed.skill.id, { now: 20 });
  assert.equal(replayed.ok, true);
  const saved = (await store.load()).skills[0];
  assert.equal(saved.state, 'replay_required');
  assert.equal(saved.lastReplay.ok, true);
  assert.equal(saved.lastReplay.skillHash, saved.contentHash);
  assert.equal(saved.userConfirmed, undefined);
});

test('AC-2A: the AC-1 private store restores proposal and replay evidence after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-ac2a-skill-'));
  const store = new SkillDefinitionStore(dir);
  const service = new SkillClosureService({ store, executeReplayCase: successfulExecutor() });
  const proposed = await service.propose(proposal(), { sessionId: 's1', now: 10 });
  await service.replay(proposed.skill.id, { now: 20 });

  const restarted = await new SkillDefinitionStore(dir).load();
  assert.equal(restarted.skills[0].state, 'replay_required');
  assert.equal(restarted.skills[0].lastReplay.ok, true);
  assert.equal((await stat(join(dir, 'skills.json'))).mode & 0o777, 0o600);
});

test('AC-2A: duplicate proposals are idempotent and conflicting ids never overwrite', async () => {
  const store = memoryStore();
  const service = new SkillClosureService({ store, executeReplayCase: successfulExecutor() });
  const first = await service.propose(proposal(), { now: 10 });
  const duplicate = await service.propose(proposal(), { now: 20 });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.created, false);
  assert.equal((await store.load()).skills.length, 1);
});

test('AC-2A: replay evidence is not stored if the skill changes during execution', async () => {
  const store = memoryStore();
  let service;
  const execute = async ({ replayCase }) => {
    if (replayCase.kind === 'positive') {
      const state = await store.load();
      state.skills[0] = reviseSkillDefinition(
        state.skills[0],
        { purpose: '실행 중 수정된 새 목적' },
        15,
      );
      await store.save(state);
    }
    return successfulExecutor()({ replayCase });
  };
  service = new SkillClosureService({ store, executeReplayCase: execute });
  const proposed = await service.propose(proposal(), { now: 10 });
  const replayed = await service.replay(proposed.skill.id, { now: 20 });

  assert.equal(replayed.ok, false);
  assert.equal(replayed.reason, 'skill_changed_during_replay');
  assert.equal((await store.load()).skills[0].lastReplay, undefined);
});
