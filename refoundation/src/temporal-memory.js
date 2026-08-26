import { assertDurableMemorySourceSet } from './record-reference.js';

const FIELDS = new Set([
  'memoryId', 'kind', 'subjectKey', 'value', 'scope', 'sources', 'recordedAt',
  'validFrom', 'validTo', 'subjectRevision', 'sourceOrder', 'status', 'supersedes',
  'conflictsWith', 'sensitivity', 'alwaysRelevant',
]);
const SCOPE_FIELDS = new Set([
  'global', 'workId', 'projectId', 'personId', 'organizationId',
]);
const KINDS = new Set(['fact', 'preference', 'decision']);
const STATUSES = new Set(['active', 'superseded', 'retracted', 'disputed']);
const SENSITIVITY = new Set(['normal', 'personal', 'private', 'secret_ref', 'never_store']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exact(value, fields, label) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new TypeError(`${label} has unknown field: ${key}`);
  }
  for (const key of fields) {
    if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
  }
}

function text(value, label, max = 2_000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function optionalText(value, label) { return value === null ? null : text(value, label, 256); }

function oneOf(value, choices, label) {
  if (!choices.has(value)) throw new TypeError(`${label} is not supported`);
  return value;
}

function time(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a canonical UTC timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer`);
  return value;
}

function identifiers(value, label) {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError(`${label} must be a bounded array`);
  const items = value.map((item) => text(item, `${label} item`, 256));
  if (new Set(items).size !== items.length) throw new TypeError(`${label} must be unique`);
  return items;
}

function memoryScope(input) {
  const value = record(input, 'MemoryClaim.scope'); exact(value, SCOPE_FIELDS, 'MemoryClaim.scope');
  if (typeof value.global !== 'boolean') throw new TypeError('MemoryClaim.scope.global must be boolean');
  const scope = {
    global: value.global,
    workId: optionalText(value.workId, 'MemoryClaim.scope.workId'),
    projectId: optionalText(value.projectId, 'MemoryClaim.scope.projectId'),
    personId: optionalText(value.personId, 'MemoryClaim.scope.personId'),
    organizationId: optionalText(value.organizationId, 'MemoryClaim.scope.organizationId'),
  };
  if (!scope.global && ![scope.workId, scope.projectId, scope.personId, scope.organizationId].some(Boolean)) {
    throw new TypeError('non-global MemoryClaim scope needs an exact identity');
  }
  return scope;
}

export function makeMemoryClaim(input) {
  const value = record(input, 'MemoryClaim'); exact(value, FIELDS, 'MemoryClaim');
  const memoryId = text(value.memoryId, 'MemoryClaim.memoryId', 256);
  const sources = assertDurableMemorySourceSet(value.sources);
  const validFrom = time(value.validFrom, 'MemoryClaim.validFrom', true);
  const validTo = time(value.validTo, 'MemoryClaim.validTo', true);
  if (validFrom != null && validTo != null && validFrom >= validTo) {
    throw new TypeError('MemoryClaim validFrom must be before validTo');
  }
  const supersedes = identifiers(value.supersedes, 'MemoryClaim.supersedes');
  const conflictsWith = identifiers(value.conflictsWith, 'MemoryClaim.conflictsWith');
  if (supersedes.includes(memoryId) || conflictsWith.includes(memoryId)) {
    throw new TypeError('MemoryClaim cannot relate to itself');
  }
  if (typeof value.alwaysRelevant !== 'boolean') {
    throw new TypeError('MemoryClaim.alwaysRelevant must be boolean');
  }
  return {
    memoryId,
    kind: oneOf(value.kind, KINDS, 'MemoryClaim.kind'),
    subjectKey: text(value.subjectKey, 'MemoryClaim.subjectKey', 256),
    value: text(value.value, 'MemoryClaim.value'),
    scope: memoryScope(value.scope),
    sources,
    recordedAt: time(value.recordedAt, 'MemoryClaim.recordedAt'),
    validFrom,
    validTo,
    subjectRevision: positiveInteger(value.subjectRevision, 'MemoryClaim.subjectRevision'),
    sourceOrder: positiveInteger(value.sourceOrder, 'MemoryClaim.sourceOrder'),
    status: oneOf(value.status, STATUSES, 'MemoryClaim.status'),
    supersedes,
    conflictsWith,
    sensitivity: oneOf(value.sensitivity, SENSITIVITY, 'MemoryClaim.sensitivity'),
    alwaysRelevant: value.alwaysRelevant,
  };
}

function scopeIdentity(scope) { return JSON.stringify(scope); }
function claimIdentity(claim) { return `${claim.subjectKey}\u0000${scopeIdentity(claim.scope)}`; }
function scopeMatches(claim, requested) { return scopeIdentity(claim.scope) === scopeIdentity(requested); }
function later(left, right) {
  return left.subjectRevision - right.subjectRevision
    || left.sourceOrder - right.sourceOrder
    || left.recordedAt.localeCompare(right.recordedAt);
}

export function selectMemoryClaimsAt({
  claims: input, asOf: inputAsOf, scope: inputScope, knowledgeAsOf: inputKnowledgeAsOf = null,
  currentCorrections: inputCorrections = [],
} = {}) {
  if (!Array.isArray(input) || !Array.isArray(inputCorrections)) {
    throw new TypeError('claims and currentCorrections must be arrays');
  }
  const claims = input.map(makeMemoryClaim); const corrections = inputCorrections.map(makeMemoryClaim);
  const asOf = time(inputAsOf, 'asOf');
  const knowledgeAsOf = time(inputKnowledgeAsOf, 'knowledgeAsOf', true);
  const requestedScope = memoryScope(inputScope);
  const result = {
    current: [], historical: [], future: [], temporalUnknown: [], contested: [],
    overridden: [], notYetRecorded: [],
  };
  const eligible = [];
  for (const claim of claims) {
    if (!scopeMatches(claim, requestedScope)) continue;
    if (knowledgeAsOf != null && claim.recordedAt > knowledgeAsOf) {
      result.notYetRecorded.push(claim); continue;
    }
    if (claim.status === 'disputed' || claim.conflictsWith.length > 0) {
      result.contested.push(claim); continue;
    }
    if (['superseded', 'retracted'].includes(claim.status)) {
      result.historical.push(claim); continue;
    }
    if (claim.validFrom == null || claim.validTo == null) {
      result.temporalUnknown.push(claim); continue;
    }
    if (asOf < claim.validFrom) { result.future.push(claim); continue; }
    if (asOf >= claim.validTo) { result.historical.push(claim); continue; }
    eligible.push(claim);
  }

  const correctionByIdentity = new Map();
  for (const correction of corrections) {
    if (!scopeMatches(correction, requestedScope)) continue;
    if (correction.status !== 'active' || correction.conflictsWith.length > 0
      || !correction.sources.some((reference) => reference.trust === 'user_asserted')) {
      throw new TypeError('current correction must be an active user-asserted claim');
    }
    const key = claimIdentity(correction); const previous = correctionByIdentity.get(key);
    if (!previous || later(correction, previous) > 0) correctionByIdentity.set(key, correction);
  }

  const eligibleByIdentity = new Map();
  for (const candidate of eligible) {
    const key = claimIdentity(candidate);
    const values = eligibleByIdentity.get(key) ?? []; values.push(candidate); eligibleByIdentity.set(key, values);
  }
  for (const [key, values] of eligibleByIdentity) {
    values.sort((left, right) => later(right, left));
    if (correctionByIdentity.has(key)) result.overridden.push(...values);
    else { result.current.push(values[0]); result.overridden.push(...values.slice(1)); }
  }
  for (const [key, correction] of correctionByIdentity) {
    result.current.push(correction);
    for (const category of ['historical', 'future', 'temporalUnknown', 'contested']) {
      const retained = [];
      for (const item of result[category]) {
        if (claimIdentity(item) === key) result.overridden.push(item); else retained.push(item);
      }
      result[category] = retained;
    }
  }
  return structuredClone(result);
}
