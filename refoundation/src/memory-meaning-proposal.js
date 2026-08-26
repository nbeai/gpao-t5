import { makeMemoryClaim } from './temporal-memory.js';

const PROPOSAL_FIELDS = new Set([
  'action', 'kind', 'value', 'subjectHandle', 'validTimeMeaning', 'scopeMeaning',
]);
const TIME_FIELDS = new Set(['from', 'to', 'certainty']);
const ACTIONS = new Set(['remember', 'correct', 'retract']);
const KINDS = new Set(['fact', 'preference', 'decision']);
const CERTAINTY = new Set(['explicit', 'inferred', 'unknown']);
const SCOPE_MEANINGS = new Set(['global', 'current_work', 'project', 'person', 'organization']);
const SENSITIVITY_ORDER = ['normal', 'personal', 'private', 'secret_ref', 'never_store'];

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function exact(value, fields, label) {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new TypeError(`${label} has unknown field: ${key}`);
  }
  for (const key of fields) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
}

function text(value, label, max = 2_000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function optionalText(value, label) { return value === null ? null : text(value, label, 256); }
function oneOf(value, values, label) {
  if (!values.has(value)) throw new TypeError(`${label} is not supported`);
  return value;
}
function canonicalTime(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be null or canonical UTC time`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be null or canonical UTC time`);
  }
  return value;
}

export function validateMemoryMeaningProposal(input) {
  const value = record(input, 'MemoryMeaningProposal'); exact(value, PROPOSAL_FIELDS, 'MemoryMeaningProposal');
  const valid = record(value.validTimeMeaning, 'MemoryMeaningProposal.validTimeMeaning');
  exact(valid, TIME_FIELDS, 'MemoryMeaningProposal.validTimeMeaning');
  const from = canonicalTime(valid.from, 'MemoryMeaningProposal.validTimeMeaning.from');
  const to = canonicalTime(valid.to, 'MemoryMeaningProposal.validTimeMeaning.to');
  if (from != null && to != null && from >= to) {
    throw new TypeError('MemoryMeaningProposal valid time is reversed');
  }
  return {
    action: oneOf(value.action, ACTIONS, 'MemoryMeaningProposal.action'),
    kind: oneOf(value.kind, KINDS, 'MemoryMeaningProposal.kind'),
    value: text(value.value, 'MemoryMeaningProposal.value'),
    subjectHandle: optionalText(value.subjectHandle, 'MemoryMeaningProposal.subjectHandle'),
    validTimeMeaning: {
      from, to, certainty: oneOf(valid.certainty, CERTAINTY, 'MemoryMeaningProposal.validTimeMeaning.certainty'),
    },
    scopeMeaning: oneOf(value.scopeMeaning, SCOPE_MEANINGS, 'MemoryMeaningProposal.scopeMeaning'),
  };
}

function sensitivityFloor(reality) {
  const sourceLevels = (reality.sources ?? []).map((source) => SENSITIVITY_ORDER.indexOf(source.sensitivity));
  const channelLevel = reality.channelSensitivity == null
    ? SENSITIVITY_ORDER.indexOf('personal')
    : SENSITIVITY_ORDER.indexOf(reality.channelSensitivity);
  if (sourceLevels.some((level) => level < 0) || channelLevel < 0) throw new TypeError('runtime sensitivity is invalid');
  const level = Math.max(channelLevel, ...sourceLevels);
  if (level >= SENSITIVITY_ORDER.indexOf('secret_ref')) return 'never_store';
  if (level === 0 && reality.normalPolicyQualified === true) return 'normal';
  return SENSITIVITY_ORDER[Math.max(level, 1)];
}

function subjectFor(proposal, reality) {
  if (proposal.subjectHandle === null) {
    return reality.defaultSubjectKey ? { subjectKey: String(reality.defaultSubjectKey) } : null;
  }
  return reality.verifiedSubjects?.[proposal.subjectHandle] ?? null;
}

function scopeFor(proposal, reality, subject) {
  const base = {
    global: proposal.scopeMeaning === 'global', workId: null, projectId: null,
    personId: null, organizationId: null,
  };
  if (proposal.scopeMeaning === 'current_work') {
    if (!reality.currentWorkId) return null;
    base.workId = String(reality.currentWorkId);
  }
  if (proposal.scopeMeaning === 'project') {
    if (!subject.projectId) return null; base.projectId = String(subject.projectId);
  }
  if (proposal.scopeMeaning === 'person') {
    if (!subject.personId) return null; base.personId = String(subject.personId);
  }
  if (proposal.scopeMeaning === 'organization') {
    if (!subject.organizationId) return null; base.organizationId = String(subject.organizationId);
  }
  if (proposal.scopeMeaning === 'global') {
    if (subject.personId) base.personId = String(subject.personId);
    if (subject.projectId) base.projectId = String(subject.projectId);
    if (subject.organizationId) base.organizationId = String(subject.organizationId);
  }
  return base;
}

export function deriveMemoryMeaningCandidate({ proposal: input, reality: inputReality } = {}) {
  const proposal = validateMemoryMeaningProposal(input); const reality = record(inputReality, 'runtime reality');
  const subject = subjectFor(proposal, reality);
  if (!subject?.subjectKey) return { state: 'needs_verified_subject', claim: null };
  const scope = scopeFor(proposal, reality, subject);
  if (!scope) return { state: 'needs_verified_subject', claim: null };
  if (['correct', 'retract'].includes(proposal.action) && !reality.targetMemoryId) {
    return { state: 'needs_exact_target', claim: null };
  }
  const sensitivity = sensitivityFloor(reality);
  if (sensitivity === 'never_store') return { state: 'never_store', claim: null };
  if (proposal.action === 'retract') return {
    state: 'retract_candidate', targetMemoryId: String(reality.targetMemoryId),
    sources: structuredClone(reality.sources ?? []), recordedAt: String(reality.recordedAt ?? ''), claim: null,
  };
  const explicit = proposal.validTimeMeaning.certainty === 'explicit';
  try {
    const claim = makeMemoryClaim({
      memoryId: String(reality.memoryId ?? ''),
      kind: proposal.kind,
      subjectKey: String(subject.subjectKey),
      value: proposal.value,
      scope,
      sources: structuredClone(reality.sources ?? []),
      recordedAt: String(reality.recordedAt ?? ''),
      validFrom: explicit ? proposal.validTimeMeaning.from : null,
      validTo: explicit ? proposal.validTimeMeaning.to : null,
      subjectRevision: reality.subjectRevision,
      sourceOrder: reality.sourceOrder,
      status: 'active',
      supersedes: proposal.action === 'correct' ? [String(reality.targetMemoryId)] : [],
      conflictsWith: [...new Set((reality.conflictingMemoryIds ?? []).map(String))],
      sensitivity,
      alwaysRelevant: reality.alwaysRelevantQualified === true,
    });
    return {
      state: claim.validFrom == null || claim.validTo == null
        ? 'temporal_unknown_candidate' : 'claim_candidate',
      claim,
    };
  } catch (error) {
    if (/supporting source|cannot rely on/u.test(String(error?.message))) {
      return { state: 'needs_trusted_source', claim: null };
    }
    throw error;
  }
}
