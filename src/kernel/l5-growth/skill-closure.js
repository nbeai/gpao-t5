import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  validateSkillDefinition,
} from './automation-contracts.js';

const REPLAY_KINDS = Object.freeze(['positive', 'negative', 'boundary']);
const REPLAY_STATUSES = Object.freeze(['succeeded', 'not_applicable', 'blocked']);

export const SKILL_PROPOSE_CONTROL_SCHEMA = Object.freeze({
  name: 'skill.propose',
  description: 'Propose a reusable skill for replay and user review.',
  controlOnly: true,
  executionAuthority: 'none',
  inputSchema: {
    type: 'object',
    required: ['name', 'purpose', 'steps', 'resultContract', 'replayCases'],
  },
});

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function stringList(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(text);
  if (normalized.some((entry) => !entry)) return null;
  return [...new Set(normalized)].sort();
}

function jsonValue(value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return { ok: false };
    return { ok: true, value: JSON.parse(serialized) };
  } catch {
    return { ok: false };
  }
}

function normalizeSteps(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const steps = [];
  for (const raw of value) {
    if (!object(raw)) return null;
    const kind = text(raw.kind);
    const instruction = text(raw.instruction);
    if (!kind || !instruction) return null;
    const extra = jsonValue(raw);
    if (!extra.ok) return null;
    steps.push({ ...extra.value, kind, instruction });
  }
  return steps;
}

function normalizeReplayCases(value, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('replayCases must be a non-empty array');
    return [];
  }
  const cases = [];
  const ids = new Set();
  for (const raw of value) {
    if (!object(raw)) {
      errors.push('each replay case must be an object');
      continue;
    }
    const id = text(raw.id);
    const kind = text(raw.kind);
    const request = jsonValue(raw.request);
    const expected = jsonValue(raw.expected);
    const status = text(expected.value?.status);
    if (!id) errors.push('each replay case needs an id');
    if (id && ids.has(id)) errors.push(`duplicate replay case id: ${id}`);
    if (!REPLAY_KINDS.includes(kind)) errors.push(`unsupported replay kind: ${kind || '(empty)'}`);
    if (!request.ok) errors.push(`replay case ${id || '(unknown)'} request must be JSON`);
    if (!expected.ok || !object(expected.value) || !REPLAY_STATUSES.includes(status)) {
      errors.push(`replay case ${id || '(unknown)'} expected.status is invalid`);
    }
    if (!id || ids.has(id) || !REPLAY_KINDS.includes(kind)
      || !request.ok || !expected.ok || !object(expected.value)
      || !REPLAY_STATUSES.includes(status)) continue;
    ids.add(id);
    cases.push({
      id,
      kind,
      request: request.value,
      expected: { ...expected.value, status },
    });
  }
  for (const kind of REPLAY_KINDS) {
    if (!cases.some((entry) => entry.kind === kind)) errors.push(`${kind} replay case is required`);
  }
  const rank = new Map(REPLAY_KINDS.map((kind, index) => [kind, index]));
  return cases.sort((left, right) =>
    rank.get(left.kind) - rank.get(right.kind) || left.id.localeCompare(right.id));
}

function hashSource(skill) {
  return {
    name: skill.name,
    purpose: skill.purpose,
    inputs: skill.inputs,
    steps: skill.steps,
    resultContract: skill.resultContract,
    requiredCapabilities: skill.requiredCapabilities,
    authorityHints: skill.authorityHints,
    replayCases: skill.replayCases,
  };
}

export function normalizeSkillProposal(raw, context = {}) {
  try {
    const errors = [];
    if (!object(raw)) return { ok: false, errors: ['skill proposal must be an object'] };

    const name = text(raw.name);
    const purpose = text(raw.purpose);
    const inputs = jsonValue(raw.inputs ?? []);
    const steps = normalizeSteps(raw.steps);
    const resultContract = jsonValue(raw.resultContract);
    const requiredCapabilities = stringList(raw.requiredCapabilities ?? []);
    const authorityHints = stringList(raw.authorityHints ?? []);
    const replayCases = normalizeReplayCases(raw.replayCases, errors);
    const traceIds = stringList(context.traceIds ?? []);
    const now = Number.isFinite(context.now) ? context.now : 0;

    if (!name) errors.push('skill name is required');
    if (!purpose) errors.push('skill purpose is required');
    if (!inputs.ok || !Array.isArray(inputs.value)) errors.push('skill inputs must be a JSON array');
    if (!steps) errors.push('skill steps must contain kind and instruction');
    if (!resultContract.ok || !object(resultContract.value)) {
      errors.push('skill resultContract must be a JSON object');
    }
    if (!requiredCapabilities) errors.push('requiredCapabilities must contain non-empty strings');
    if (!authorityHints) errors.push('authorityHints must contain non-empty strings');
    if (!traceIds) errors.push('traceIds must contain non-empty strings');
    if (errors.length) return { ok: false, errors };

    const skill = {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      id: '',
      name,
      purpose,
      version: 1,
      contentHash: '',
      inputs: inputs.value,
      steps,
      resultContract: resultContract.value,
      requiredCapabilities,
      authorityHints,
      replayCases,
      source: {
        kind: 'model_proposal',
        sessionId: text(context.sessionId) || null,
        traceIds,
      },
      state: 'proposed',
      createdAt: now,
      updatedAt: now,
      previousVersion: null,
    };
    skill.contentHash = contentHash(hashSource(skill));
    skill.id = `skill-${skill.contentHash.slice(0, 20)}`;
    const checked = validateSkillDefinition(skill);
    return checked.ok ? { ok: true, skill } : { ok: false, errors: checked.errors };
  } catch (error) {
    return { ok: false, errors: [`skill proposal normalization failed: ${error?.message ?? 'unknown error'}`] };
  }
}
