import { createHash } from 'node:crypto';

const PLAN_FIELDS = new Set(['requestId', 'selector', 'targets', 'backupAvailable', 'previewDigest']);
const PLAN_INPUT_FIELDS = new Set(['requestId', 'selector', 'targets', 'backupAvailable']);
const SELECTOR_FIELDS = new Set(['memoryIds', 'subjectKeys', 'scopeIds']);
const TARGET_FIELDS = new Set(['kind', 'id', 'action', 'revision']);
const TARGET_KINDS = new Set([
  'record', 'memory', 'knowledge', 'reflection', 'principle', 'skill_candidate',
  'fts', 'embedding', 'relationship_index', 'library_view', 'spotlight',
  'windows_search', 'backup', 'external_copy',
]);
const TARGET_ACTIONS = new Set(['retract', 'delete', 'rebuild', 'unknown']);
const RECEIPT_FIELDS = new Set([
  'requestId', 'executedTargets', 'unknownTargets', 'retainedTargets',
  'searchHitAfter', 'contextProjectionAfter', 'behaviorProbeAfter', 'reversibleUntil',
]);
const RECEIPT_INPUT_FIELDS = new Set(['plan', ...RECEIPT_FIELDS].filter((key) => key !== 'requestId'));
const RETAINED_FIELDS = new Set(['id', 'reason']);

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function exact(value, fields, label) {
  for (const key of Object.keys(value)) if (!fields.has(key)) throw new TypeError(`${label} has unknown field: ${key}`);
  for (const key of fields) if (!(key in value)) throw new TypeError(`${label}.${key} is required`);
}
function text(value, label, max = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max
    || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}
function uniqueIds(value, label) {
  if (!Array.isArray(value) || value.length > 256) throw new TypeError(`${label} must be a bounded array`);
  const result = value.map((item) => text(item, `${label} item`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result;
}
function oneOf(value, choices, label) {
  if (!choices.has(value)) throw new TypeError(`${label} is not supported`);
  return value;
}
function nullableRevision(value) {
  if (value === null) return null;
  if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 256)) return value;
  throw new TypeError('ForgetPlan target revision is invalid');
}
function nullableCount(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be null or non-negative integer`);
  return value;
}
function nullableTime(value) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('reversibleUntil must be canonical UTC time or null');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError('reversibleUntil must be canonical UTC time or null');
  }
  return value;
}

function normalizePlan(input, includesDigest) {
  const value = record(input, 'ForgetPlan');
  exact(value, includesDigest ? PLAN_FIELDS : PLAN_INPUT_FIELDS, 'ForgetPlan');
  const selectorInput = record(value.selector, 'ForgetPlan.selector');
  exact(selectorInput, SELECTOR_FIELDS, 'ForgetPlan.selector');
  const selector = {
    memoryIds: uniqueIds(selectorInput.memoryIds, 'ForgetPlan.selector.memoryIds'),
    subjectKeys: uniqueIds(selectorInput.subjectKeys, 'ForgetPlan.selector.subjectKeys'),
    scopeIds: uniqueIds(selectorInput.scopeIds, 'ForgetPlan.selector.scopeIds'),
  };
  if (!selector.memoryIds.length && !selector.subjectKeys.length && !selector.scopeIds.length) {
    throw new TypeError('ForgetPlan selector must name at least one exact identity');
  }
  if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length > 512) {
    throw new TypeError('ForgetPlan targets must be a bounded non-empty array');
  }
  const targets = value.targets.map((inputTarget) => {
    const target = record(inputTarget, 'ForgetPlan target'); exact(target, TARGET_FIELDS, 'ForgetPlan target');
    return {
      kind: oneOf(target.kind, TARGET_KINDS, 'ForgetPlan target kind'),
      id: text(target.id, 'ForgetPlan target id'),
      action: oneOf(target.action, TARGET_ACTIONS, 'ForgetPlan target action'),
      revision: nullableRevision(target.revision),
    };
  });
  const handles = targets.map((target) => `${target.kind}:${target.id}`);
  if (new Set(handles).size !== handles.length) throw new TypeError('ForgetPlan target handles must be unique');
  if (value.backupAvailable !== null && typeof value.backupAvailable !== 'boolean') {
    throw new TypeError('ForgetPlan backupAvailable must be boolean or null');
  }
  const core = {
    requestId: text(value.requestId, 'ForgetPlan.requestId'), selector, targets,
    backupAvailable: value.backupAvailable,
  };
  const previewDigest = createHash('sha256').update(JSON.stringify(core)).digest('hex');
  if (includesDigest && value.previewDigest !== previewDigest) {
    throw new TypeError('ForgetPlan previewDigest does not match exact selector and targets');
  }
  return { ...core, previewDigest };
}

export function makeForgetPlan(input) { return normalizePlan(input, false); }
export function validateForgetPlan(input) { return normalizePlan(input, true); }

function normalizeReceipt(input, planArgument = null, includesRequestId = false) {
  const value = record(input, 'ForgetReceipt');
  exact(value, includesRequestId ? RECEIPT_FIELDS : RECEIPT_INPUT_FIELDS, 'ForgetReceipt');
  const plan = validateForgetPlan(planArgument ?? value.plan);
  if (includesRequestId && value.requestId !== plan.requestId) throw new TypeError('ForgetReceipt requestId mismatch');
  const executedTargets = uniqueIds(value.executedTargets, 'ForgetReceipt.executedTargets');
  const unknownTargets = uniqueIds(value.unknownTargets, 'ForgetReceipt.unknownTargets');
  if (!Array.isArray(value.retainedTargets)) throw new TypeError('ForgetReceipt.retainedTargets must be an array');
  const retainedTargets = value.retainedTargets.map((inputRetained) => {
    const retained = record(inputRetained, 'ForgetReceipt retained target');
    exact(retained, RETAINED_FIELDS, 'ForgetReceipt retained target');
    return { id: text(retained.id, 'ForgetReceipt retained id'), reason: text(retained.reason, 'ForgetReceipt retained reason') };
  });
  const dispositioned = [...executedTargets, ...unknownTargets, ...retainedTargets.map((item) => item.id)];
  if (new Set(dispositioned).size !== dispositioned.length) {
    throw new TypeError('ForgetReceipt target partition contains duplicates');
  }
  const expected = plan.targets.map((target) => `${target.kind}:${target.id}`).sort();
  if (JSON.stringify([...dispositioned].sort()) !== JSON.stringify(expected)) {
    throw new TypeError('ForgetReceipt target partition must cover every plan target exactly once');
  }
  return {
    requestId: plan.requestId,
    executedTargets,
    unknownTargets,
    retainedTargets,
    searchHitAfter: nullableCount(value.searchHitAfter, 'ForgetReceipt.searchHitAfter'),
    contextProjectionAfter: nullableCount(value.contextProjectionAfter, 'ForgetReceipt.contextProjectionAfter'),
    behaviorProbeAfter: oneOf(value.behaviorProbeAfter, new Set(['pass', 'fail', 'unknown']),
      'ForgetReceipt.behaviorProbeAfter'),
    reversibleUntil: nullableTime(value.reversibleUntil),
  };
}

export function makeForgetReceipt(input) { return normalizeReceipt(input, null, false); }
export function validateForgetReceipt(input, plan) { return normalizeReceipt(input, plan, true); }
