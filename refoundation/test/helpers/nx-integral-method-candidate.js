const MAX_SERIALIZED_BYTES = 6 * 1024;
const MAX_SOURCES = 12;
const MAX_TEXT = 500;
const OPAQUE_ID = /^[a-z][a-z0-9-]{7,80}$/iu;
const OPERATORS = new Set([
  'select', 'filter', 'join', 'group', 'deduplicate', 'compare', 'reconcile',
  'aggregate', 'calculate', 'validate', 'order', 'format',
]);
const OUTPUT_KINDS = new Set(['answer', 'xlsx', 'pdf', 'docx']);
const EFFECTS = new Set(['observe', 'managed_local_artifact']);

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TypeError(`${label} fields are invalid`);
}

function boundedText(value, label, maxLength = MAX_TEXT) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) throw new TypeError(`${label} is invalid`);
  return text;
}

function boundedList(value, label, { maxItems = 12, maxLength = 300, allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length < 1) || value.length > maxItems) {
    throw new TypeError(`${label} is invalid`);
  }
  const items = value.map((item) => boundedText(item, label, maxLength));
  if (new Set(items).size !== items.length) throw new TypeError(`${label} contains duplicates`);
  return items;
}

function opaqueId(value, label) {
  const text = String(value ?? ''); if (!OPAQUE_ID.test(text)) throw new TypeError(`${label} is invalid`); return text;
}

function unsafeContent(value, key = '') {
  if (/secret|password|credential|api.?key|access.?token|refresh.?token/iu.test(key)) return true;
  if (typeof value === 'string') return /(?:^|\s)(?:file:\/\/|~[/\\]|[A-Za-z]:[/\\]|\\\\|\/(?:Users|home|private|var|tmp|Volumes|etc|opt|usr)(?:[/\s]|$)|Bearer\s+|sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})/u.test(value);
  if (Array.isArray(value)) return value.some((item) => unsafeContent(item, key));
  if (value && typeof value === 'object') return Object.entries(value).some(([childKey, child]) => unsafeContent(child, childKey));
  return false;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function validManifest(manifest) {
  return manifest && manifest.state === 'verified' && OPAQUE_ID.test(String(manifest.manifestId ?? ''))
    && Array.isArray(manifest.inputHandles) && manifest.inputHandles.length >= 1
    && manifest.inputHandles.length <= MAX_SOURCES
    && manifest.inputHandles.every((handle) => OPAQUE_ID.test(String(handle)))
    && new Set(manifest.inputHandles).size === manifest.inputHandles.length;
}

export function assessIntegralMethodAdmission({ currentWork, sourceManifest, requestedEffect = 'observe' } = {}) {
  if (!currentWork || currentWork.status !== 'active' || !OPAQUE_ID.test(String(currentWork.workId ?? ''))
    || !Number.isInteger(currentWork.revision) || currentWork.revision < 1) {
    return { eligible: false, reason: 'active_work_revision_absent' };
  }
  if (!sourceManifest) return { eligible: false, reason: 'source_manifest_absent' };
  if (!validManifest(sourceManifest)) return { eligible: false, reason: 'source_manifest_unverified' };
  if (sourceManifest.inputHandles.length === 1) return { eligible: false, reason: 'single_source_path' };
  if (!EFFECTS.has(requestedEffect)) return { eligible: false, reason: 'unsupported_effect' };
  return { eligible: true, reason: 'verified_multi_source_reality' };
}

export function validateIntegralMethodCandidate(input, { currentWork, sourceManifest } = {}) {
  let serialized;
  try { serialized = JSON.stringify(input); } catch { throw new TypeError('Integral Method must be serializable'); }
  if (Buffer.byteLength(serialized ?? '', 'utf8') > MAX_SERIALIZED_BYTES) {
    throw new TypeError('Integral Method exceeds 6KiB');
  }
  if (unsafeContent(input)) throw new TypeError('Integral Method contains a raw path or secret');
  exactObject(input, ['schema', 'work', 'human', 'strategy', 'reality', 'method', 'form'], 'Integral Method');
  if (input.schema !== 't5.integral-outcome-method.v1') throw new TypeError('Integral Method schema is invalid');

  exactObject(input.work, ['workId', 'revision'], 'work');
  const workId = opaqueId(input.work.workId, 'workId');
  if (!Number.isInteger(input.work.revision) || input.work.revision < 1) throw new TypeError('work revision is invalid');
  if (!currentWork || currentWork.status !== 'active' || currentWork.workId !== workId
    || currentWork.revision !== input.work.revision) throw new Error('stale or foreign Work revision');

  exactObject(input.human, ['purpose', 'useContext', 'audience'], 'human');
  exactObject(input.strategy, ['primaryOutcome', 'requestedScope', 'excludedScope', 'sufficientWhen'], 'strategy');
  exactObject(input.reality, ['sourceManifestId', 'exactInputHandles', 'unresolvedFacts'], 'reality');
  exactObject(input.method, ['operators', 'checks', 'expectedOutputs'], 'method');
  exactObject(input.form, ['deliverableForms', 'informationOrder', 'visualHierarchyGoals'], 'form');

  if (!validManifest(sourceManifest)) throw new Error('source manifest is unverified');
  const sourceManifestId = opaqueId(input.reality.sourceManifestId, 'sourceManifestId');
  if (sourceManifest.manifestId !== sourceManifestId) throw new Error('source manifest is stale or foreign');
  const exactInputHandles = boundedList(input.reality.exactInputHandles, 'exactInputHandles', {
    maxItems: MAX_SOURCES, maxLength: 80,
  }).map((handle) => opaqueId(handle, 'input handle'));
  if (exactInputHandles.some((handle) => !sourceManifest.inputHandles.includes(handle))) {
    throw new Error('input handle escapes the source manifest');
  }

  const operators = boundedList(input.method.operators, 'operators', { maxItems: 16, maxLength: 32 });
  if (operators.some((operator) => !OPERATORS.has(operator))) throw new TypeError('unsupported method operator');
  if (!Array.isArray(input.method.expectedOutputs) || input.method.expectedOutputs.length < 1
    || input.method.expectedOutputs.length > 8) throw new TypeError('expectedOutputs is invalid');
  const expectedOutputs = input.method.expectedOutputs.map((output) => {
    exactObject(output, ['name', 'kind', 'effect'], 'expected output');
    const kind = boundedText(output.kind, 'output kind', 32);
    const effect = boundedText(output.effect, 'output effect', 32);
    if (!OUTPUT_KINDS.has(kind) || !EFFECTS.has(effect)) throw new TypeError('unsupported output or effect');
    return { name: boundedText(output.name, 'output name', 120), kind, effect };
  });

  const normalized = {
    schema: input.schema,
    work: { workId, revision: input.work.revision },
    human: {
      purpose: boundedText(input.human.purpose, 'purpose'),
      useContext: boundedText(input.human.useContext, 'useContext'),
      audience: boundedText(input.human.audience, 'audience'),
    },
    strategy: {
      primaryOutcome: boundedText(input.strategy.primaryOutcome, 'primaryOutcome'),
      requestedScope: boundedList(input.strategy.requestedScope, 'requestedScope'),
      excludedScope: boundedList(input.strategy.excludedScope, 'excludedScope', { allowEmpty: true }),
      sufficientWhen: boundedList(input.strategy.sufficientWhen, 'sufficientWhen'),
    },
    reality: {
      sourceManifestId, exactInputHandles,
      unresolvedFacts: boundedList(input.reality.unresolvedFacts, 'unresolvedFacts', { maxItems: 20, allowEmpty: true }),
    },
    method: {
      operators,
      checks: boundedList(input.method.checks, 'checks', { maxItems: 20 }),
      expectedOutputs,
    },
    form: {
      deliverableForms: boundedList(input.form.deliverableForms, 'deliverableForms', { maxItems: 4, maxLength: 32 }),
      informationOrder: boundedList(input.form.informationOrder, 'informationOrder', { maxItems: 8 }),
      visualHierarchyGoals: boundedList(input.form.visualHierarchyGoals, 'visualHierarchyGoals', { maxItems: 8 }),
    },
  };
  if (normalized.form.deliverableForms.some((kind) => !OUTPUT_KINDS.has(kind))) {
    throw new TypeError('unsupported deliverable form');
  }
  return deepFreeze(normalized);
}

export const NX_INTEGRAL_METHOD_LIMITS = deepFreeze({
  serializedBytes: MAX_SERIALIZED_BYTES, sourceHandles: MAX_SOURCES,
  operators: [...OPERATORS], effects: [...EFFECTS], outputKinds: [...OUTPUT_KINDS],
});
