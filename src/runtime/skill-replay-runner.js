import {
  contentHash,
  validateSkillDefinition,
} from '../kernel/l5-growth/automation-contracts.js';

const STATUSES = new Set(['succeeded', 'not_applicable', 'blocked', 'execution_failed']);
const CASE_KINDS = new Set(['positive', 'negative', 'boundary']);

function jsonValue(value) {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? { ok: false, value: null }
      : { ok: true, value: JSON.parse(serialized) };
  } catch {
    return { ok: false, value: null };
  }
}

function stringList(value, errors) {
  if (!Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    errors.push('usedCapabilities must be a string array');
    return [];
  }
  return [...new Set(value
    .map((entry) => entry.normalize('NFC').trim()))].sort();
}

function normalizeActual(value) {
  const errors = [];
  const actual = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (actual !== value) errors.push('replay result must be an object');
  const result = actual.result === undefined ? null : jsonValue(actual.result);
  if (result && !result.ok) errors.push('result must be JSON');
  const effects = jsonValue(actual.externalEffects);
  if (!Array.isArray(actual.externalEffects) || !effects.ok) {
    errors.push('externalEffects must be a JSON array');
  }
  return {
    status: STATUSES.has(actual.status) ? actual.status : 'invalid_result',
    ...(result ? { result: result.value } : {}),
    usedCapabilities: stringList(actual.usedCapabilities, errors),
    externalEffects: Array.isArray(effects.value) ? effects.value : [],
    evidenceErrors: errors,
    ...(typeof actual.error === 'string' && actual.error.trim()
      ? { error: actual.error.trim() }
      : {}),
  };
}

function same(left, right) {
  return contentHash({ value: left }) === contentHash({ value: right });
}

function assess(skill, replayCase, actual) {
  if (actual.evidenceErrors.length > 0) {
    return { ok: false, reason: `invalid replay evidence: ${actual.evidenceErrors.join('; ')}` };
  }
  if (actual.status !== replayCase.expected.status) {
    return { ok: false, reason: `expected ${replayCase.expected.status}, got ${actual.status}` };
  }
  if (Object.hasOwn(replayCase.expected, 'result')
    && !same(actual.result, replayCase.expected.result)) {
    return { ok: false, reason: 'result contract mismatch' };
  }
  const declared = new Set(skill.requiredCapabilities);
  const undeclared = actual.usedCapabilities.find((capability) => !declared.has(capability));
  if (undeclared) return { ok: false, reason: `undeclared capability: ${undeclared}` };
  if (actual.externalEffects.length > 0) {
    return { ok: false, reason: 'replay produced an external effect' };
  }
  return { ok: true };
}

function validateReplayContract(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return ['replayCases must not be empty'];
  const errors = [];
  for (const replayCase of cases) {
    if (!replayCase || typeof replayCase !== 'object' || Array.isArray(replayCase)) {
      errors.push('replay case must be an object');
      continue;
    }
    if (typeof replayCase.id !== 'string' || !replayCase.id.trim()) errors.push('replay case id is required');
    if (!CASE_KINDS.has(replayCase.kind)) errors.push('replay case kind is invalid');
    if (!replayCase.expected || typeof replayCase.expected !== 'object'
      || !STATUSES.has(replayCase.expected.status)
      || replayCase.expected.status === 'execution_failed') {
      errors.push('replay case expected status is invalid');
    }
  }
  for (const kind of CASE_KINDS) {
    if (!cases.some((replayCase) => replayCase?.kind === kind)) {
      errors.push(`${kind} replay case is required`);
    }
  }
  return errors;
}

export async function runSkillReplay(skill, options = {}) {
  const checked = validateSkillDefinition(skill);
  if (!checked.ok) return { ok: false, reason: 'invalid_skill', errors: checked.errors };
  const contractErrors = validateReplayContract(skill.replayCases);
  if (contractErrors.length) {
    return { ok: false, reason: 'invalid_replay_contract', errors: contractErrors };
  }
  if (typeof options.execute !== 'function') {
    return { ok: false, reason: 'executor_required', errors: ['replay requires an isolated executor'] };
  }

  const cases = [];
  for (const replayCase of skill.replayCases) {
    let actual;
    try {
      actual = normalizeActual(await options.execute({
        skill: structuredClone(skill),
        replayCase: structuredClone(replayCase),
      }));
    } catch (error) {
      actual = normalizeActual({
        status: 'execution_failed',
        error: error?.message ?? 'unknown replay failure',
        usedCapabilities: [],
        externalEffects: [],
      });
    }
    const assessed = assess(skill, replayCase, actual);
    cases.push({
      id: replayCase.id,
      kind: replayCase.kind,
      expected: structuredClone(replayCase.expected),
      actual,
      ...assessed,
    });
  }

  const evidence = {
    skillVersion: skill.version,
    skillHash: skill.contentHash,
    cases,
  };
  const ok = cases.length > 0 && cases.every((entry) => entry.ok);
  return {
    ok,
    ...(!ok ? { reason: 'replay_failed' } : {}),
    ...evidence,
    replayDigest: contentHash(evidence),
    runAt: Number.isFinite(options.runAt) ? options.runAt : 0,
  };
}
