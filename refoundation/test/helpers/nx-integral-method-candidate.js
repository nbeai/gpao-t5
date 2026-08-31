import { createHash } from 'node:crypto';

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
  if (JSON.stringify([...exactInputHandles].sort())
    !== JSON.stringify([...sourceManifest.inputHandles].sort())) {
    throw new Error('input handles must equal the exact source manifest set');
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

function schemaSourceRef() {
  return { type: 'object', additionalProperties: false, properties: {
    handle: { type: 'string', maxLength: 80 }, location: { type: 'string', maxLength: 200 },
  }, required: ['handle', 'location'] };
}
function schemaStringList(maxItems, maxLength, minItems = 0, values = null) {
  return { type: 'array', minItems, maxItems, items: values
    ? { type: 'string', enum: [...values] } : { type: 'string', maxLength } };
}

export function integralMethodCandidateJsonSchema() {
  return structuredClone({ type: 'object', additionalProperties: false, properties: {
    schema: { type: 'string', enum: ['t5.integral-outcome-method.v1'] },
    work: { type: 'object', additionalProperties: false, properties: {
      workId: { type: 'string', maxLength: 80 }, revision: { type: 'integer', minimum: 1 },
    }, required: ['workId', 'revision'] },
    human: { type: 'object', additionalProperties: false, properties: {
      purpose: { type: 'string', maxLength: MAX_TEXT }, useContext: { type: 'string', maxLength: MAX_TEXT },
      audience: { type: 'string', maxLength: MAX_TEXT },
    }, required: ['purpose', 'useContext', 'audience'] },
    strategy: { type: 'object', additionalProperties: false, properties: {
      primaryOutcome: { type: 'string', maxLength: MAX_TEXT },
      requestedScope: schemaStringList(12, 300, 1), excludedScope: schemaStringList(12, 300),
      sufficientWhen: schemaStringList(12, 300, 1),
    }, required: ['primaryOutcome', 'requestedScope', 'excludedScope', 'sufficientWhen'] },
    reality: { type: 'object', additionalProperties: false, properties: {
      sourceManifestId: { type: 'string', maxLength: 80 },
      exactInputHandles: schemaStringList(MAX_SOURCES, 80, 1),
      unresolvedFacts: schemaStringList(20, 300),
    }, required: ['sourceManifestId', 'exactInputHandles', 'unresolvedFacts'] },
    method: { type: 'object', additionalProperties: false, properties: {
      operators: schemaStringList(16, 32, 1, OPERATORS), checks: schemaStringList(20, 300, 1),
      expectedOutputs: { type: 'array', minItems: 1, maxItems: 8,
        items: { type: 'object', additionalProperties: false, properties: {
          name: { type: 'string', maxLength: 120 }, kind: { type: 'string', enum: [...OUTPUT_KINDS] },
          effect: { type: 'string', enum: [...EFFECTS] },
        }, required: ['name', 'kind', 'effect'] } },
    }, required: ['operators', 'checks', 'expectedOutputs'] },
    form: { type: 'object', additionalProperties: false, properties: {
      deliverableForms: schemaStringList(4, 32, 1, OUTPUT_KINDS),
      informationOrder: schemaStringList(8, 300, 1), visualHierarchyGoals: schemaStringList(8, 300, 1),
    }, required: ['deliverableForms', 'informationOrder', 'visualHierarchyGoals'] },
  }, required: ['schema', 'work', 'human', 'strategy', 'reality', 'method', 'form'] });
}

export function compactClaimEvidenceJsonSchema() {
  const ref = schemaSourceRef();
  return structuredClone({ type: 'object', additionalProperties: false, properties: {
    schema: { type: 'string', enum: ['t5.compact-claim-evidence.v1'] },
    sourceManifestId: { type: 'string', maxLength: 80 },
    coverage: { type: 'object', additionalProperties: false, properties: {
      state: { type: 'string', enum: ['complete'] },
      observedHandles: schemaStringList(MAX_SOURCES, 80, 1), unresolvedHandles: schemaStringList(MAX_SOURCES, 80),
    }, required: ['state', 'observedHandles', 'unresolvedHandles'] },
    claims: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', additionalProperties: false,
      properties: { claimId: { type: 'string', maxLength: 80 }, state: { type: 'string', enum: [...CLAIM_STATES] },
        summary: { type: 'string', maxLength: MAX_TEXT,
          description: 'Compact semantic claim summary. Verification and final-display values are carried separately.' },
        sourceRefs: { type: 'array', minItems: 1, maxItems: 8, items: ref },
        evidenceValues: { type: 'array', minItems: 1, maxItems: 16,
          description: 'All values needed to verify this claim. These values do not all need to appear in the final answer.',
          items: { type: 'object', additionalProperties: false, properties: {
            valueId: { type: 'string', maxLength: 80 }, label: { type: 'string', maxLength: 80 },
            value: { type: ['string', 'number'] },
            unit: { type: 'string', maxLength: 40,
              description: 'Physical or business unit. Use an empty string for an identifier, date, state, or other unitless value.' }, source: ref,
          }, required: ['valueId', 'label', 'value', 'unit', 'source'] } },
        presentationValueIds: { type: 'array', minItems: 1, maxItems: 16,
          description: 'IDs of evidenceValues that must appear in the final user result.',
          items: { type: 'string', maxLength: 80 } },
        calculation: { type: ['object', 'null'], additionalProperties: false, properties: {
          expression: { type: 'string', maxLength: 200 },
          inputs: { type: 'array', minItems: 1, maxItems: 16,
            items: { type: 'object', additionalProperties: false, properties: {
              label: { type: 'string', maxLength: 80 }, value: { type: 'number' },
              unit: { type: 'string', maxLength: 40 }, source: ref,
            }, required: ['label', 'value', 'unit', 'source'] } },
          result: { type: 'object', additionalProperties: false, properties: {
            value: { type: 'number' }, unit: { type: 'string', maxLength: 40 },
          }, required: ['value', 'unit'] },
        }, required: ['expression', 'inputs', 'result'] } },
      required: ['claimId', 'state', 'summary', 'sourceRefs', 'evidenceValues', 'presentationValueIds', 'calculation'] } },
    excludedFindings: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false,
      properties: { findingId: { type: 'string', maxLength: 80 }, reason: { type: 'string', maxLength: MAX_TEXT },
        sourceRefs: { type: 'array', minItems: 1, maxItems: 8, items: ref } },
      required: ['findingId', 'reason', 'sourceRefs'] } },
  }, required: ['schema', 'sourceManifestId', 'coverage', 'claims', 'excludedFindings'] });
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildIntegralMethodContractBinding(candidate) {
  return deepFreeze({
    schema: 't5.integral-method-contract-binding.v1',
    humanSha256: digest(candidate.human), strategySha256: digest(candidate.strategy),
    formSha256: digest(candidate.form),
  });
}

function exactContractBinding(value, candidate) {
  const expected = buildIntegralMethodContractBinding(candidate);
  if (!value || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error('Integral Method human strategy form binding is missing');
  }
  return expected;
}

const CLAIM_EVIDENCE_MAX_BYTES = 32 * 1024;
const CLAIM_STATES = new Set(['supported', 'conflict', 'unknown']);

function sourceRef(value, allowedHandles) {
  exactObject(value, ['handle', 'location'], 'claim source reference');
  const handle = opaqueId(value.handle, 'claim source handle');
  if (!allowedHandles.includes(handle)) throw new Error('ClaimEvidence source escapes the manifest');
  return { handle, location: boundedText(value.location, 'claim source location', 200) };
}

function calculation(value, allowedHandles) {
  if (value == null) return null;
  exactObject(value, ['expression', 'inputs', 'result'], 'calculation');
  if (!Array.isArray(value.inputs) || value.inputs.length < 1 || value.inputs.length > 16) {
    throw new TypeError('calculation inputs are invalid');
  }
  const inputs = value.inputs.map((input) => {
    exactObject(input, ['label', 'value', 'unit', 'source'], 'calculation input');
    if (!Number.isFinite(input.value)) throw new TypeError('calculation input value is invalid');
    return { label: boundedText(input.label, 'calculation input label', 80), value: input.value,
      unit: boundedText(input.unit, 'calculation input unit', 40),
      source: sourceRef(input.source, allowedHandles) };
  });
  exactObject(value.result, ['value', 'unit'], 'calculation result');
  if (!Number.isFinite(value.result.value)) throw new TypeError('calculation result value is invalid');
  return { expression: boundedText(value.expression, 'calculation expression', 200), inputs,
    result: { value: value.result.value, unit: boundedText(value.result.unit, 'calculation result unit', 40) } };
}

export function validateCompactClaimEvidence(input, { sourceManifestId, exactInputHandles } = {}) {
  let serialized;
  try { serialized = JSON.stringify(input); } catch { throw new TypeError('ClaimEvidence must be serializable'); }
  if (Buffer.byteLength(serialized ?? '', 'utf8') > CLAIM_EVIDENCE_MAX_BYTES) {
    throw new TypeError('ClaimEvidence exceeds 32KiB');
  }
  if (unsafeContent(input)) throw new TypeError('ClaimEvidence contains a raw path or secret');
  exactObject(input, ['schema', 'sourceManifestId', 'coverage', 'claims', 'excludedFindings'], 'ClaimEvidence');
  if (input.schema !== 't5.compact-claim-evidence.v1'
    || input.sourceManifestId !== sourceManifestId) throw new Error('ClaimEvidence manifest is stale or foreign');
  exactObject(input.coverage, ['state', 'observedHandles', 'unresolvedHandles'], 'ClaimEvidence coverage');
  const observedHandles = boundedList(input.coverage.observedHandles, 'observedHandles', {
    maxItems: MAX_SOURCES, maxLength: 80,
  }).map((handle) => opaqueId(handle, 'observed handle'));
  const unresolvedHandles = boundedList(input.coverage.unresolvedHandles, 'unresolvedHandles', {
    maxItems: MAX_SOURCES, maxLength: 80, allowEmpty: true,
  }).map((handle) => opaqueId(handle, 'unresolved handle'));
  const expected = [...exactInputHandles].sort();
  if (input.coverage.state !== 'complete' || unresolvedHandles.length
    || JSON.stringify([...observedHandles].sort()) !== JSON.stringify(expected)) {
    throw new Error('ClaimEvidence source coverage is incomplete');
  }
  if (!Array.isArray(input.claims) || input.claims.length < 1 || input.claims.length > 32) {
    throw new TypeError('ClaimEvidence claims are invalid');
  }
  const claims = input.claims.map((claim) => {
    exactObject(claim, ['claimId', 'state', 'summary', 'sourceRefs', 'evidenceValues', 'presentationValueIds', 'calculation'], 'claim');
    const state = boundedText(claim.state, 'claim state', 20);
    if (!CLAIM_STATES.has(state)) throw new TypeError('claim state is invalid');
    if (!Array.isArray(claim.sourceRefs) || claim.sourceRefs.length < 1 || claim.sourceRefs.length > 8) {
      throw new TypeError('claim source references are invalid');
    }
    if (!Array.isArray(claim.evidenceValues) || claim.evidenceValues.length < 1 || claim.evidenceValues.length > 16) {
      throw new TypeError('claim evidence values are invalid');
    }
    const evidenceValues = claim.evidenceValues.map((item) => {
      exactObject(item, ['valueId', 'label', 'value', 'unit', 'source'], 'claim evidence value');
      if (!['string', 'number'].includes(typeof item.value)
        || (typeof item.value === 'number' && !Number.isFinite(item.value))) {
        throw new TypeError('claim evidence value is invalid');
      }
      const unit = String(item.unit ?? '').trim();
      if (unit.length > 40) throw new TypeError('claim evidence value unit is invalid');
      return { valueId: boundedText(item.valueId, 'claim evidence value ID', 80),
        label: boundedText(item.label, 'claim evidence value label', 80), value: item.value,
        unit,
        source: sourceRef(item.source, exactInputHandles) };
    });
    if (new Set(evidenceValues.map((item) => item.valueId)).size !== evidenceValues.length) {
      throw new TypeError('claim evidence value IDs are duplicated');
    }
    const presentationValueIds = boundedList(claim.presentationValueIds, 'presentationValueIds', {
      maxItems: 16, maxLength: 80,
    });
    if (presentationValueIds.some((valueId) => !evidenceValues.some((item) => item.valueId === valueId))) {
      throw new TypeError('presentation value escapes claim evidence values');
    }
    return { claimId: boundedText(claim.claimId, 'claimId', 80), state,
      summary: boundedText(claim.summary, 'claim summary'),
      sourceRefs: claim.sourceRefs.map((item) => sourceRef(item, exactInputHandles)),
      evidenceValues, presentationValueIds,
      calculation: calculation(claim.calculation, exactInputHandles) };
  });
  if (new Set(claims.map((claim) => claim.claimId)).size !== claims.length) {
    throw new TypeError('ClaimEvidence claim IDs are duplicated');
  }
  if (!Array.isArray(input.excludedFindings) || input.excludedFindings.length > 32) {
    throw new TypeError('excluded findings are invalid');
  }
  const excludedFindings = input.excludedFindings.map((finding) => {
    exactObject(finding, ['findingId', 'reason', 'sourceRefs'], 'excluded finding');
    if (!Array.isArray(finding.sourceRefs) || finding.sourceRefs.length < 1 || finding.sourceRefs.length > 8) {
      throw new TypeError('excluded finding source references are invalid');
    }
    return { findingId: boundedText(finding.findingId, 'findingId', 80),
      reason: boundedText(finding.reason, 'excluded finding reason'),
      sourceRefs: finding.sourceRefs.map((item) => sourceRef(item, exactInputHandles)) };
  });
  if (new Set(excludedFindings.map((finding) => finding.findingId)).size !== excludedFindings.length) {
    throw new TypeError('excluded finding IDs are duplicated');
  }
  return deepFreeze({ schema: input.schema, sourceManifestId: input.sourceManifestId,
    coverage: { state: 'complete', observedHandles, unresolvedHandles: [] }, claims, excludedFindings });
}

function manifestReceipt(value, candidate) {
  if (!value || value.state !== 'verified' || value.manifestId !== candidate.reality.sourceManifestId
    || !Array.isArray(value.inputHandles)
    || JSON.stringify([...value.inputHandles].sort())
      !== JSON.stringify([...candidate.reality.exactInputHandles].sort())) {
    throw new Error('source manifest verification failed');
  }
  return value;
}

export async function executeIntegralMethodCandidate(input, dependencies = {}) {
  const { currentWork, sourceManifest, verifyCurrentSourceManifest, observeSource,
    runMethod, independentVerify, publishResult = null, cleanup = async () => ({ state: 'cleaned' }),
    signal = null } = dependencies;
  const candidate = validateIntegralMethodCandidate(input, { currentWork, sourceManifest });
  const admission = assessIntegralMethodAdmission({ currentWork, sourceManifest,
    requestedEffect: candidate.method.expectedOutputs.some((item) => item.effect === 'managed_local_artifact')
      ? 'managed_local_artifact' : 'observe' });
  if (!admission.eligible) return { state: 'not_admitted', reason: admission.reason };
  if (![verifyCurrentSourceManifest, observeSource, runMethod, independentVerify, cleanup]
    .every((item) => typeof item === 'function')) throw new TypeError('Integral Method dependencies are incomplete');
  let publication = null; let result; let cleanupResult;
  try {
    if (signal?.aborted) return { state: 'cancelled', publication: 'not_started' };
    manifestReceipt(await verifyCurrentSourceManifest(), candidate);
    const observations = [];
    for (const handle of candidate.reality.exactInputHandles) {
      if (signal?.aborted) return { state: 'cancelled', publication: 'not_started' };
      const observed = await observeSource(handle);
      if (!observed || observed.state !== 'observed' || observed.handle !== handle
        || observed.coverage !== 'complete') return { state: 'observation_failed', handle, publication: 'not_started' };
      observations.push(observed);
    }
    if (new Set(observations.map((item) => item.handle)).size !== candidate.reality.exactInputHandles.length) {
      return { state: 'observation_failed', reason: 'duplicate_observation', publication: 'not_started' };
    }
    const guest = await runMethod(deepFreeze({ candidate, observations: deepFreeze(observations) }));
    const verified = await independentVerify(deepFreeze({ candidate, observations, guest }));
    if (!verified || verified.schema !== 't5.integral-method-verification.v1'
      || verified.passed !== true) return { state: 'verification_failed', publication: 'not_started' };
    const contractBinding = exactContractBinding(verified.contractBinding, candidate);
    const claimEvidence = validateCompactClaimEvidence(verified.claimEvidence, {
      sourceManifestId: candidate.reality.sourceManifestId,
      exactInputHandles: candidate.reality.exactInputHandles,
    });
    manifestReceipt(await verifyCurrentSourceManifest(), candidate);
    if (signal?.aborted) return { state: 'cancelled', publication: 'not_started' };
    const requiresPublication = candidate.method.expectedOutputs.some(
      (item) => item.effect === 'managed_local_artifact');
    if (requiresPublication) {
      if (typeof publishResult !== 'function') throw new TypeError('managed artifact publisher is unavailable');
      const artifactPurpose = deepFreeze({ audience: candidate.human.audience,
        usePurpose: candidate.human.useContext,
        deliveryMedium: [...candidate.form.deliverableForms],
        visualHierarchyGoals: [...candidate.form.visualHierarchyGoals] });
      publication = await publishResult(deepFreeze({ candidate, verified, claimEvidence,
        contractBinding, artifactPurpose }));
      if (!publication || publication.state !== 'published_verified' || !publication.undoHandle
        || publication.qualityQualified !== true
        || JSON.stringify(publication.contractBinding) !== JSON.stringify(contractBinding)) {
        return { state: 'publication_failed', publication: publication ?? 'unknown' };
      }
    }
    result = { state: requiresPublication ? 'published_verified' : 'verified',
      sourceUniverse: { coverage: 'complete', manifestId: candidate.reality.sourceManifestId,
        observedHandles: [...candidate.reality.exactInputHandles] },
      contractBinding, claimEvidence, publication };
    return result;
  } finally {
    try { cleanupResult = await cleanup(); } catch { cleanupResult = { state: 'unknown' }; }
    if (result) {
      result.cleanup = cleanupResult?.state === 'cleaned' ? { state: 'cleaned' } : { state: 'unknown' };
      if (result.state === 'published_verified' && result.cleanup.state === 'unknown') {
        result.state = 'published_verified_cleanup_unknown';
      }
    }
  }
}
