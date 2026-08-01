import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  skillHashSource,
  validateSkillDefinition,
} from './automation-contracts.js';
import { 자동화후보저장가능 } from './automation.js';
import { SUITE_MINIMUM } from './tcell-replay.js';

const REPLAY_KINDS = Object.freeze(['positive', 'negative', 'boundary', 'authority']);
const CONTENT_FIELDS = Object.freeze([
  'name', 'purpose', 'inputs', 'steps', 'resultContract',
  'requiredCapabilities', 'authorityHints', 'replayCases',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function stringList(value, { sort = true } = {}) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(text);
  if (normalized.some((entry) => !entry)) return null;
  const unique = [...new Set(normalized)];
  return sort ? unique.sort() : unique;
}

function jsonClone(value) {
  const seen = new WeakSet();
  function validJson(entry) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry !== 'object') return false;
    if (seen.has(entry)) return false;
    seen.add(entry);
    if (Array.isArray(entry)) return entry.every(validJson);
    if (Object.getPrototypeOf(entry) !== Object.prototype) return false;
    return Object.entries(entry).every(([key, child]) => typeof key === 'string' && validJson(child));
  }

  try {
    if (!validJson(value)) return { ok: false, value: null };
    return { ok: true, value: JSON.parse(JSON.stringify(value)) };
  } catch {
    return { ok: false, value: null };
  }
}

function proposalCanPersist(value) {
  return 자동화후보저장가능({
    statement: 'skill proposal',
    action: { tool: 'skill.propose', args: value },
  });
}

function normalizeSteps(value, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('skill steps must be an array');
    return [];
  }
  const steps = [];
  for (const raw of value) {
    if (typeof raw === 'string') {
      const instruction = text(raw);
      if (!instruction) errors.push('skill step instruction is required');
      else steps.push({ kind: 'instruction', instruction });
      continue;
    }
    if (!object(raw)) {
      errors.push('each skill step must be a string or object');
      continue;
    }
    const cloned = jsonClone(raw);
    const kind = text(raw.kind) || 'instruction';
    const instruction = text(raw.instruction);
    if (!cloned.ok) errors.push('skill step must contain JSON values');
    if (!instruction) errors.push('skill step instruction is required');
    if (cloned.ok && instruction) steps.push({ ...cloned.value, kind, instruction });
  }
  return steps;
}

function normalizeSourceRefs(value, caseId, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push(`replay case ${caseId} sourceRefs must be an array`);
    return [];
  }
  const refs = [];
  for (const ref of value) {
    const sessionId = text(ref?.sessionId);
    const turnSeq = ref?.turnSeq;
    if (!sessionId || !Number.isInteger(turnSeq) || turnSeq < 0) {
      errors.push(`replay case ${caseId} sourceRefs are invalid`);
      continue;
    }
    refs.push({ sessionId, turnSeq });
  }
  const unique = new Map(refs.map((ref) => [`${ref.sessionId}\0${ref.turnSeq}`, ref]));
  return [...unique.values()].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId) || left.turnSeq - right.turnSeq);
}

function normalizeReplayCases(value, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('skill replayCases must be an array');
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
    const inputFacts = stringList(raw.inputFacts ?? []);
    const expectedFacts = stringList(raw.expectedFacts ?? []);
    const forbiddenFacts = stringList(raw.forbiddenFacts ?? []);
    const allowedFacts = raw.allowedFacts === undefined ? [] : stringList(raw.allowedFacts);
    const exactFacts = raw.exactFacts === undefined ? [] : stringList(raw.exactFacts);
    if (!id) errors.push('each replay case needs an id');
    if (ids.has(id)) errors.push(`duplicate replay case id: ${id}`);
    if (!REPLAY_KINDS.includes(kind)) errors.push(`unsupported replay kind: ${kind || '(empty)'}`);
    if (!inputFacts) errors.push(`replay case ${id || '(unknown)'} inputFacts must be strings`);
    if (!expectedFacts) errors.push(`replay case ${id || '(unknown)'} expectedFacts must be strings`);
    if (!forbiddenFacts) errors.push(`replay case ${id || '(unknown)'} forbiddenFacts must be strings`);
    if (!allowedFacts) errors.push(`replay case ${id || '(unknown)'} allowedFacts must be strings`);
    if (!exactFacts) errors.push(`replay case ${id || '(unknown)'} exactFacts must be strings`);
    const sourceRefs = normalizeSourceRefs(raw.sourceRefs, id || '(unknown)', errors);
    if (!id || ids.has(id) || !REPLAY_KINDS.includes(kind)
      || !inputFacts || !expectedFacts || !forbiddenFacts || !allowedFacts || !exactFacts) continue;
    ids.add(id);
    cases.push({
      id,
      kind,
      sourceRefs,
      inputFacts,
      expectedFacts,
      forbiddenFacts,
      ...(allowedFacts.length ? { allowedFacts } : {}),
      ...(exactFacts.length ? { exactFacts } : {}),
    });
  }
  const rank = new Map(REPLAY_KINDS.map((kind, index) => [kind, index]));
  return cases.sort((left, right) =>
    rank.get(left.kind) - rank.get(right.kind) || left.id.localeCompare(right.id));
}

function normalizeContent(raw) {
  const errors = [];
  if (!object(raw)) return { ok: false, errors: ['skill content must be an object'] };
  const name = text(raw.name);
  const purpose = text(raw.purpose);
  const inputs = jsonClone(raw.inputs ?? []);
  const steps = normalizeSteps(raw.steps, errors);
  const resultContract = jsonClone(raw.resultContract ?? { kind: 'unspecified' });
  const requiredCapabilities = stringList(raw.requiredCapabilities ?? []);
  const authorityHints = stringList(raw.authorityHints ?? []);
  const replayCases = normalizeReplayCases(raw.replayCases, errors);
  if (!name) errors.push('skill name is required');
  if (!purpose) errors.push('skill purpose is required');
  if (!inputs.ok || !Array.isArray(inputs.value)) errors.push('skill inputs must be a JSON array');
  if (!resultContract.ok || !object(resultContract.value)) {
    errors.push('skill resultContract must be a JSON object');
  }
  if (!requiredCapabilities) errors.push('requiredCapabilities must contain non-empty strings');
  if (!authorityHints) errors.push('authorityHints must contain non-empty strings');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    content: {
      name,
      purpose,
      inputs: inputs.value,
      steps,
      resultContract: resultContract.value,
      requiredCapabilities,
      authorityHints,
      replayCases,
    },
  };
}

export function validateSkillReplayCases(cases) {
  const errors = [];
  if (!Array.isArray(cases)) return { ok: false, errors: ['replayCases must be an array'] };
  const ids = new Set();
  for (const replayCase of cases) {
    if (!object(replayCase)) {
      errors.push('replay case must be an object');
      continue;
    }
    if (!text(replayCase.id)) errors.push('replay case id is required');
    else if (ids.has(replayCase.id)) errors.push(`duplicate replay case id: ${replayCase.id}`);
    else ids.add(replayCase.id);
    if (!REPLAY_KINDS.includes(replayCase.kind)) errors.push('replay case kind is invalid');
    for (const key of ['sourceRefs', 'inputFacts', 'expectedFacts', 'forbiddenFacts']) {
      if (!Array.isArray(replayCase[key])) errors.push(`replay case ${replayCase.id ?? '(unknown)'} ${key} is invalid`);
    }
  }
  for (const kind of REPLAY_KINDS) {
    const minimum = SUITE_MINIMUM[kind];
    const count = cases.filter((entry) => entry?.kind === kind).length;
    if (count < minimum) errors.push(`${kind} replay requires at least ${minimum} case(s)`);
  }
  return { ok: errors.length === 0, errors };
}

export function normalizeSkillProposal(raw, context = {}) {
  try {
    if (!object(raw)) return { ok: false, errors: ['skill proposal must be an object'] };
    if (!proposalCanPersist(raw)) {
      return { ok: false, reason: 'sensitive_input', errors: ['skill proposal contains sensitive input'] };
    }
    const normalized = normalizeContent(raw);
    if (!normalized.ok) return normalized;
    const traceIds = stringList(context.traceIds ?? []);
    if (!traceIds) return { ok: false, errors: ['traceIds must contain non-empty strings'] };
    const now = Number.isFinite(context.now) ? context.now : 0;
    const skill = {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      id: '',
      ...normalized.content,
      version: 1,
      contentHash: '',
      source: {
        kind: context.sourceKind === 'observed_pattern' ? 'observed_pattern' : 'model_proposal',
        sessionId: text(context.sessionId) || null,
        traceIds,
      },
      state: 'proposed',
      createdAt: now,
      updatedAt: now,
      previousVersion: null,
    };
    skill.contentHash = contentHash(skillHashSource(skill));
    skill.id = `skill-${skill.contentHash.slice(0, 20)}`;
    const checked = validateSkillDefinition(skill);
    return checked.ok ? { ok: true, skill } : { ok: false, errors: checked.errors };
  } catch (error) {
    return { ok: false, errors: [`skill proposal normalization failed: ${error?.message ?? 'unknown error'}`] };
  }
}

export function normalizeSkillRevision(skill, patch) {
  try {
    if (!object(patch)) return { ok: false, errors: ['skill revision must be an object'] };
    if (!proposalCanPersist(patch)) {
      return { ok: false, reason: 'sensitive_input', errors: ['skill revision contains sensitive input'] };
    }
    const merged = {};
    for (const key of CONTENT_FIELDS) merged[key] = Object.hasOwn(patch, key) ? patch[key] : skill?.[key];
    const normalized = normalizeContent(merged);
    return normalized.ok ? { ok: true, patch: normalized.content } : normalized;
  } catch (error) {
    return { ok: false, errors: [`skill revision normalization failed: ${error?.message ?? 'unknown error'}`] };
  }
}

export function activeSkillSnapshot(skill) {
  if (skill?.state !== 'active' || !validateSkillDefinition(skill).ok) return null;
  return structuredClone({
    id: skill.id,
    name: skill.name,
    purpose: skill.purpose,
    version: skill.version,
    contentHash: skill.contentHash,
    inputs: skill.inputs,
    steps: skill.steps,
    resultContract: skill.resultContract,
    requiredCapabilities: skill.requiredCapabilities,
    authorityHints: skill.authorityHints,
    executionAuthority: null,
  });
}
