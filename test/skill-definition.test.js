import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_PROPOSE_CONTROL_SCHEMA,
  normalizeSkillProposal,
} from '../src/kernel/l5-growth/skill-closure.js';
import { validateSkillDefinition } from '../src/kernel/l5-growth/automation-contracts.js';

function proposal(patch = {}) {
  return {
    name: '  주간 정산 정리  ',
    purpose: ' 지난주 정산 자료를 읽고 거래처별 초안을 만든다. ',
    inputs: [{ name: 'folder', required: true }],
    steps: [
      { kind: 'inspect', instruction: '  정산 파일을 읽는다. ' },
      { kind: 'calculate', instruction: ' 거래처별 합계를 계산한다. ' },
    ],
    resultContract: { kind: 'drafts', delivery: 'none' },
    requiredCapabilities: ['local.file.read', ' local.file.read ', 'local.file.write'],
    authorityHints: ['A1', ' no_delivery '],
    replayCases: [
      {
        id: 'positive-weekly-settlement',
        kind: 'positive',
        request: { folder: '/work/settlement' },
        expected: { status: 'succeeded', result: { total: 30 } },
      },
      {
        id: 'negative-unrelated-request',
        kind: 'negative',
        request: { text: '오늘 날씨 알려줘' },
        expected: { status: 'not_applicable' },
      },
      {
        id: 'boundary-outside-folder',
        kind: 'boundary',
        request: { folder: '/private' },
        expected: { status: 'blocked' },
      },
    ],
    source: { kind: 'model_proposal' },
    ...patch,
  };
}

test('AC-2A: skill.propose is a model control schema, not an execution grant', () => {
  assert.equal(SKILL_PROPOSE_CONTROL_SCHEMA.name, 'skill.propose');
  assert.equal(SKILL_PROPOSE_CONTROL_SCHEMA.controlOnly, true);
  assert.equal(SKILL_PROPOSE_CONTROL_SCHEMA.executionAuthority, 'none');
});

test('AC-2A: a model proposal is normalized into a valid, influence-free v2 definition', () => {
  const result = normalizeSkillProposal(proposal(), {
    sessionId: 'session-1',
    traceIds: ['trace-2', 'trace-1', 'trace-1'],
    now: 100,
  });

  assert.equal(result.ok, true, result.errors?.join('; '));
  assert.equal(result.skill.name, '주간 정산 정리');
  assert.equal(result.skill.purpose, '지난주 정산 자료를 읽고 거래처별 초안을 만든다.');
  assert.deepEqual(result.skill.requiredCapabilities, ['local.file.read', 'local.file.write']);
  assert.deepEqual(result.skill.source.traceIds, ['trace-1', 'trace-2']);
  assert.equal(result.skill.state, 'proposed');
  assert.equal(result.skill.version, 1);
  assert.equal(result.skill.userConfirmed, undefined);
  assert.equal(result.skill.executionAuthority, undefined);
  assert.equal(validateSkillDefinition(result.skill).ok, true);
});

test('AC-2A: normalization is reproducible across whitespace, duplicate order, and object key order', () => {
  const first = normalizeSkillProposal(proposal(), { sessionId: 's', now: 1 });
  const second = normalizeSkillProposal(proposal({
    requiredCapabilities: ['local.file.write', 'local.file.read'],
    authorityHints: ['no_delivery', 'A1'],
    resultContract: { delivery: 'none', kind: 'drafts' },
  }), { sessionId: 'other-session', now: 999 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.skill.id, second.skill.id, 'same content must produce the same proposal id');
  assert.equal(first.skill.contentHash, second.skill.contentHash);
});

test('AC-2A: arbitrary malformed model JSON is rejected without throwing', () => {
  const malformed = [
    null,
    [],
    {},
    proposal({ steps: [''] }),
    proposal({ replayCases: [{ kind: 'positive' }] }),
    proposal({ replayCases: [
      ...proposal().replayCases,
      { id: 'surprise', kind: 'authority', request: {}, expected: { status: 'succeeded' } },
    ] }),
  ];

  for (const value of malformed) {
    assert.doesNotThrow(() => normalizeSkillProposal(value, { now: 1 }));
    assert.equal(normalizeSkillProposal(value, { now: 1 }).ok, false);
  }
});

test('AC-2A: positive, negative, and boundary cases are all mandatory', () => {
  for (const missing of ['positive', 'negative', 'boundary']) {
    const result = normalizeSkillProposal(proposal({
      replayCases: proposal().replayCases.filter((entry) => entry.kind !== missing),
    }), { now: 1 });
    assert.equal(result.ok, false, `${missing} replay should be required`);
    assert.ok(result.errors.some((error) => error.includes(missing)));
  }
});

test('AC-2A: caller-supplied lifecycle, hash, version, and authority are ignored', () => {
  const result = normalizeSkillProposal(proposal({
    id: 'attacker-id',
    state: 'active',
    version: 99,
    contentHash: 'f'.repeat(64),
    userConfirmed: true,
    executionAuthority: 'A3',
  }), { now: 20 });

  assert.equal(result.ok, true);
  assert.notEqual(result.skill.id, 'attacker-id');
  assert.equal(result.skill.state, 'proposed');
  assert.equal(result.skill.version, 1);
  assert.notEqual(result.skill.contentHash, 'f'.repeat(64));
  assert.equal(result.skill.userConfirmed, undefined);
  assert.equal(result.skill.executionAuthority, undefined);
});
