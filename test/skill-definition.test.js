import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSkillProposal,
  validateSkillReplayCases,
} from '../src/kernel/l5-growth/skill-closure.js';
import { validateSkillDefinition } from '../src/kernel/l5-growth/automation-contracts.js';

function replayCases() {
  return [
    {
      id: 'positive-known-input', kind: 'positive',
      inputFacts: ['two settlement files are available'],
      expectedFacts: ['a settlement summary is produced'], forbiddenFacts: ['a message is sent'],
    },
    {
      id: 'positive-empty-input', kind: 'positive',
      inputFacts: ['the settlement folder is empty'],
      expectedFacts: ['the empty input is reported'], forbiddenFacts: ['totals are invented'],
    },
    {
      id: 'negative-weather', kind: 'negative',
      inputFacts: ['the user asks about weather'],
      expectedFacts: ['the skill does not apply'], forbiddenFacts: ['settlement files are opened'],
    },
    {
      id: 'boundary-other-project', kind: 'boundary',
      inputFacts: ['the files belong to another project'],
      expectedFacts: ['the skill stops at the project boundary'], forbiddenFacts: ['other project data is read'],
    },
    {
      id: 'boundary-missing-source', kind: 'boundary',
      inputFacts: ['the source folder is unavailable'],
      expectedFacts: ['the missing source is reported'], forbiddenFacts: ['success is claimed'],
    },
    {
      id: 'authority-send', kind: 'authority',
      inputFacts: ['the result would need to be sent externally'],
      expectedFacts: ['replay remains dry-run only'], forbiddenFacts: ['the result is sent'],
    },
  ].map((entry) => ({ sourceRefs: [], ...entry }));
}

function proposal(patch = {}) {
  return {
    name: ' Weekly settlement ',
    purpose: ' Read settlement material and prepare a concise draft. ',
    inputs: [{ name: 'folder', required: true }],
    steps: [
      ' Inspect the available files. ',
      { kind: 'summarize', instruction: ' Prepare the settlement summary. ' },
    ],
    resultContract: { kind: 'draft', delivery: 'none' },
    requiredCapabilities: ['local.file', ' local.file '],
    authorityHints: ['send', ' A3 ', 'send'],
    replayCases: replayCases(),
    ...patch,
  };
}

test('AC-2 proposal normalizes into an influence-free canonical SkillDefinition', () => {
  const result = normalizeSkillProposal(proposal({
    id: 'caller-id', state: 'active', version: 99, contentHash: 'f'.repeat(64),
  }), { sessionId: 'session-1', traceIds: ['trace-2', 'trace-1', 'trace-1'], now: 10 });

  assert.equal(result.ok, true, result.errors?.join('; '));
  assert.equal(result.skill.name, 'Weekly settlement');
  assert.equal(result.skill.state, 'proposed');
  assert.equal(result.skill.version, 1);
  assert.notEqual(result.skill.id, 'caller-id');
  assert.deepEqual(result.skill.requiredCapabilities, ['local.file']);
  assert.deepEqual(result.skill.authorityHints, ['A3', 'send']);
  assert.deepEqual(result.skill.source.traceIds, ['trace-1', 'trace-2']);
  assert.equal(result.skill.userConfirmed, undefined);
  assert.equal(result.skill.executionAuthority, undefined);
  assert.equal(validateSkillDefinition(result.skill).ok, true);
});

test('AC-2 current skill.propose payload can create a proposal before replay cases are authored', () => {
  const result = normalizeSkillProposal({
    name: 'Weekly settlement',
    purpose: 'Prepare the weekly settlement draft',
    steps: ['Read the source', 'Prepare the draft'],
  }, { now: 1 });

  assert.equal(result.ok, true, result.errors?.join('; '));
  assert.deepEqual(result.skill.replayCases, []);
  assert.deepEqual(result.skill.steps.map((step) => step.instruction), ['Read the source', 'Prepare the draft']);
  assert.equal(validateSkillReplayCases(result.skill.replayCases).ok, false, 'empty cases cannot replay');
});

test('AC-2 replay suite uses the sealed 2/1/2/1 minimum', () => {
  assert.equal(validateSkillReplayCases(replayCases()).ok, true);
  for (const [kind, keep] of [['positive', 1], ['negative', 0], ['boundary', 1], ['authority', 0]]) {
    let seen = 0;
    const reduced = replayCases().filter((entry) => entry.kind !== kind || seen++ < keep);
    const checked = validateSkillReplayCases(reduced);
    assert.equal(checked.ok, false, `${kind} shortage passed`);
    assert.ok(checked.errors.some((error) => error.includes(kind)), checked.errors.join('; '));
  }
});

test('AC-2 authorityHints are hash-bound metadata', () => {
  const first = normalizeSkillProposal(proposal({ authorityHints: ['A3'] }), { now: 1 });
  const second = normalizeSkillProposal(proposal({ authorityHints: ['A0'] }), { now: 999 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.skill.contentHash, second.skill.contentHash);
  assert.notEqual(first.skill.id, second.skill.id);
});

test('AC-2 normalization is deterministic outside source and wall-clock metadata', () => {
  const first = normalizeSkillProposal(proposal(), { sessionId: 'a', now: 1 });
  const second = normalizeSkillProposal(proposal({
    requiredCapabilities: ['local.file'],
    authorityHints: ['send', 'A3'],
    resultContract: { delivery: 'none', kind: 'draft' },
  }), { sessionId: 'b', now: 999 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.skill.contentHash, second.skill.contentHash);
  assert.equal(first.skill.id, second.skill.id);
});

test('AC-2 sensitive proposal text and nested structured values never become a definition', () => {
  const sensitive = [
    proposal({ purpose: 'password: hunter2machine' }),
    proposal({ inputs: [{ auth: { password: 'hunter2machine' } }] }),
    proposal({ resultContract: { headers: ['Bearer abcdefghijklmnop'] } }),
    proposal({ resultContract: new Map([['password', 'hunter2machine']]) }),
    proposal({ resultContract: new Set(['sk-abcdef1234567890abcdef']) }),
  ];

  for (const raw of sensitive) {
    const result = normalizeSkillProposal(raw, { now: 1 });
    assert.equal(result.ok, false, 'sensitive proposal was accepted');
    assert.equal(result.reason, 'sensitive_input');
  }
});

test('AC-2 malformed proposal input is rejected without throwing', () => {
  for (const raw of [null, [], {}, proposal({ steps: [null] }), proposal({ replayCases: [null] })]) {
    assert.doesNotThrow(() => normalizeSkillProposal(raw, { now: 1 }));
    assert.equal(normalizeSkillProposal(raw, { now: 1 }).ok, false);
  }
});
