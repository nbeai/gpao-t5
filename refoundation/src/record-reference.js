import { createHash } from 'node:crypto';

const SOURCE_KINDS = new Set([
  'conversation_message', 'run_event', 'work_event', 'attachment', 'artifact',
  'local_file', 'web_source', 'connection_resource', 'channel_message',
  'calendar_item', 'reminder_item', 'user_note',
]);
const TRUST = new Set([
  'user_asserted', 'runtime_observed', 'verified_external', 'external_untrusted',
  'model_inferred',
]);
const SENSITIVITY = new Set(['normal', 'personal', 'private', 'secret_ref', 'never_store']);
const COVERAGE = new Set(['full', 'partial', 'metadata_only', 'unknown']);
const AVAILABILITY = new Set([
  'available', 'missing', 'changed', 'permission_denied', 'unknown',
]);
const REFERENCE_FIELDS = new Set([
  'recordId', 'sourceKind', 'sourceStore', 'sourceId', 'sourceRevision', 'sha256',
  'occurredAt', 'recordedAt', 'scope', 'trust', 'sensitivity', 'coverage',
  'availability',
]);
const INPUT_FIELDS = new Set([...REFERENCE_FIELDS].filter((field) => field !== 'recordId'));
const SCOPE_FIELDS = new Set(['sessionId', 'workId', 'subjectKeys', 'channel']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exactFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new TypeError(`${label} has unknown field: ${field}`);
  }
  for (const field of allowed) {
    if (!(field in value)) throw new TypeError(`${label}.${field} is required`);
  }
}

function text(value, label, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function optionalText(value, label, max) {
  return value === null ? null : text(value, label, max);
}

function oneOf(value, choices, label) {
  if (!choices.has(value)) throw new TypeError(`${label} is not supported`);
  return value;
}

function time(value, label, nullable) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be an ISO timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function revision(value) {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('sourceRevision number must be a non-negative safe integer');
    }
    return value;
  }
  return text(value, 'sourceRevision', 256);
}

function digest(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError('sha256 must be null or lowercase 64-character hex');
  }
  return value;
}

function scope(value) {
  object(value, 'scope');
  exactFields(value, SCOPE_FIELDS, 'scope');
  if (!Array.isArray(value.subjectKeys) || value.subjectKeys.length > 32) {
    throw new TypeError('scope.subjectKeys must be a bounded array');
  }
  const subjectKeys = value.subjectKeys.map((item) => text(item, 'scope.subjectKeys item', 256));
  if (new Set(subjectKeys).size !== subjectKeys.length) {
    throw new TypeError('scope.subjectKeys must be unique');
  }
  return {
    sessionId: optionalText(value.sessionId, 'scope.sessionId', 256),
    workId: optionalText(value.workId, 'scope.workId', 256),
    subjectKeys,
    channel: optionalText(value.channel, 'scope.channel', 128),
  };
}

function recordIdFor(reference) {
  const identity = JSON.stringify({
    sourceKind: reference.sourceKind,
    sourceStore: reference.sourceStore,
    sourceId: reference.sourceId,
    sourceRevision: reference.sourceRevision,
  });
  return `rr_${createHash('sha256').update(identity).digest('hex')}`;
}

function normalize(input, includesRecordId) {
  object(input, 'RecordRef');
  exactFields(input, includesRecordId ? REFERENCE_FIELDS : INPUT_FIELDS, 'RecordRef');
  const reference = {
    sourceKind: oneOf(input.sourceKind, SOURCE_KINDS, 'sourceKind'),
    sourceStore: text(input.sourceStore, 'sourceStore', 128),
    sourceId: text(input.sourceId, 'sourceId', 1024),
    sourceRevision: revision(input.sourceRevision),
    sha256: digest(input.sha256),
    occurredAt: time(input.occurredAt, 'occurredAt', true),
    recordedAt: time(input.recordedAt, 'recordedAt', false),
    scope: scope(input.scope),
    trust: oneOf(input.trust, TRUST, 'trust'),
    sensitivity: oneOf(input.sensitivity, SENSITIVITY, 'sensitivity'),
    coverage: oneOf(input.coverage, COVERAGE, 'coverage'),
    availability: oneOf(input.availability, AVAILABILITY, 'availability'),
  };
  const recordId = recordIdFor(reference);
  if (includesRecordId && input.recordId !== recordId) {
    throw new TypeError('recordId does not match canonical source identity');
  }
  if (reference.sensitivity === 'secret_ref' && !(
    reference.sourceKind === 'connection_resource'
    && reference.trust === 'runtime_observed'
    && reference.coverage === 'metadata_only'
    && reference.sha256 === null
  )) throw new TypeError('secret_ref must be a runtime-observed metadata-only connection resource');
  return { recordId, ...reference };
}

export function makeRecordReference(input) {
  return normalize(input, false);
}

export function validateRecordReference(input) {
  return normalize(input, true);
}

export function assertDurableMemorySourceSet(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError('durable Memory requires a supporting source');
  }
  const references = input.map(validateRecordReference);
  const usable = references.filter((reference) => (
    ['user_asserted', 'runtime_observed', 'verified_external'].includes(reference.trust)
    && reference.availability === 'available'
    && !['secret_ref', 'never_store'].includes(reference.sensitivity)
  ));
  if (usable.length === 0) {
    const trusts = [...new Set(references.map((reference) => reference.trust))].join(',');
    throw new TypeError(`durable Memory cannot rely on ${trusts} without a trusted supporting source`);
  }
  return references;
}

export const RECORD_REFERENCE_CONTRACT = Object.freeze({
  sourceKinds: Object.freeze([...SOURCE_KINDS]),
  trust: Object.freeze([...TRUST]),
  sensitivity: Object.freeze([...SENSITIVITY]),
  coverage: Object.freeze([...COVERAGE]),
  availability: Object.freeze([...AVAILABILITY]),
});
