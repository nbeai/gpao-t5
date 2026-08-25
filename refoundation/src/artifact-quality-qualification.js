const SCHEMA = 't5.artifact-purpose-contract.v1';
const RECEIPT_SCHEMA = 't5.artifact-quality-receipt.v1';
const LANES = Object.freeze(['semantic', 'domain', 'structural', 'screen', 'print']);
const DELIVERY_MEDIA = new Set(['screen', 'print', 'both']);
const REQUIREMENT_KINDS = Object.freeze({
  semantic: new Set(['semantic_reconciliation']),
  domain: new Set(['domain_traceability']),
  structural: new Set(['structural_scan']),
  screen: new Set(['render_coverage', 'visual_integrity']),
  print: new Set(['render_coverage', 'visual_integrity', 'openxml_page_setup']),
});

function fail(message) { throw new TypeError(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}
function text(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) fail(`${label} must be a non-empty string`);
  return normalized;
}
function stringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`);
  return result;
}
function exactSet(left = [], right = []) {
  return left.length === right.length && left.every((value) => right.includes(value));
}
function includesAll(actual = [], expected = []) { return expected.every((value) => actual.includes(value)); }
function validSha256(value) { return /^[a-f0-9]{64}$/u.test(String(value ?? '')); }

function normalizePageSetupSheet(sheet, label) {
  object(sheet, label);
  const result = {
    sheetId: text(sheet.sheetId, `${label}.sheetId`), paperSize: text(sheet.paperSize, `${label}.paperSize`),
    orientation: text(sheet.orientation, `${label}.orientation`), fitToPage: sheet.fitToPage,
    fitToWidth: sheet.fitToWidth, fitToHeight: sheet.fitToHeight, printArea: text(sheet.printArea, `${label}.printArea`),
  };
  if (!['portrait', 'landscape'].includes(result.orientation)) fail(`${label}.orientation must be portrait or landscape`);
  if (typeof result.fitToPage !== 'boolean') fail(`${label}.fitToPage must be boolean`);
  if (![result.fitToWidth, result.fitToHeight].every((value) => Number.isInteger(value) && value >= 0)) {
    fail(`${label} fit dimensions must be non-negative integers`);
  }
  return result;
}

function normalizeExpected(kind, expected, requirementId, lane) {
  const label = `requirement ${requirementId} expected`;
  object(expected, label);
  if (kind === 'semantic_reconciliation') {
    const result = {
      satisfiedFactIds: stringList(expected.satisfiedFactIds ?? [], `${label}.satisfiedFactIds`, { allowEmpty: true }),
      unchangedSourceFactIds: stringList(expected.unchangedSourceFactIds ?? [], `${label}.unchangedSourceFactIds`, { allowEmpty: true }),
      preservedUnresolvedFactIds: stringList(expected.preservedUnresolvedFactIds ?? [], `${label}.preservedUnresolvedFactIds`, { allowEmpty: true }),
    };
    if (Object.values(result).every((items) => items.length === 0)) fail(`${label} must name at least one semantic fact`);
    return result;
  }
  if (kind === 'domain_traceability') {
    const result = {
      sourceFactIds: stringList(expected.sourceFactIds ?? [], `${label}.sourceFactIds`, { allowEmpty: true }),
      reversibleSourceFactIds: stringList(expected.reversibleSourceFactIds ?? [], `${label}.reversibleSourceFactIds`, { allowEmpty: true }),
      calculationIds: stringList(expected.calculationIds ?? [], `${label}.calculationIds`, { allowEmpty: true }),
    };
    if (Object.values(result).every((items) => items.length === 0)) fail(`${label} must name a trace or calculation`);
    if (!includesAll(result.sourceFactIds, result.reversibleSourceFactIds)) fail(`${label}.reversibleSourceFactIds must be sourceFactIds`);
    return result;
  }
  if (kind === 'structural_scan') {
    const result = {
      reopenedArtifactSha256: text(expected.reopenedArtifactSha256, `${label}.reopenedArtifactSha256`),
      maximumFormulaErrors: expected.maximumFormulaErrors, maximumSchemaErrors: expected.maximumSchemaErrors,
    };
    if (!validSha256(result.reopenedArtifactSha256)) fail(`${label}.reopenedArtifactSha256 must be SHA-256`);
    if (![result.maximumFormulaErrors, result.maximumSchemaErrors].every((value) => Number.isInteger(value) && value >= 0)) {
      fail(`${label} error maxima must be non-negative integers`);
    }
    return result;
  }
  if (kind === 'render_coverage') {
    const surface = text(expected.surface, `${label}.surface`);
    if (surface !== lane) fail(`${label}.surface must match ${lane}`);
    return { surface, unitIds: stringList(expected.unitIds, `${label}.unitIds`) };
  }
  if (kind === 'visual_integrity') {
    const surface = text(expected.surface, `${label}.surface`);
    if (surface !== lane) fail(`${label}.surface must match ${lane}`);
    return {
      surface, unitIds: stringList(expected.unitIds, `${label}.unitIds`),
      disallowedDefects: stringList(expected.disallowedDefects, `${label}.disallowedDefects`),
    };
  }
  if (kind === 'openxml_page_setup') {
    if (!Array.isArray(expected.sheets) || expected.sheets.length === 0) fail(`${label}.sheets must be a non-empty array`);
    return { sheets: expected.sheets.map((sheet, index) => normalizePageSetupSheet(sheet, `${label}.sheets[${index}]`)) };
  }
  fail(`unsupported requirement kind ${kind}`);
}

function normalizeRequirement(requirement, lane, index, invariantRefs, hasDomainProfile) {
  object(requirement, `laneRequirements.${lane}[${index}]`);
  const requirementId = text(requirement.requirementId, `laneRequirements.${lane}[${index}].requirementId`);
  const kind = text(requirement.kind, `requirement ${requirementId} kind`);
  if (!REQUIREMENT_KINDS[lane].has(kind)) fail(`${kind} is not a ${lane} requirement kind`);
  const normalized = { requirementId, kind, expected: normalizeExpected(kind, requirement.expected, requirementId, lane) };
  if (lane === 'domain') {
    normalized.invariantRefs = stringList(requirement.invariantRefs ?? [], `requirement ${requirementId} domain invariant reference`, { allowEmpty: !hasDomainProfile });
    if (normalized.invariantRefs.some((reference) => !invariantRefs.includes(reference))) {
      fail(`requirement ${requirementId} has a domain invariant reference outside its profile`);
    }
  }
  return normalized;
}

function requireKinds(requirements, lane, kinds) {
  for (const kind of kinds) {
    if (!requirements.some((requirement) => requirement.kind === kind)) fail(`${lane} ${kind} requirement is required`);
  }
}

export function createArtifactPurposeContract(input = {}) {
  object(input, 'artifact purpose contract');
  const artifact = object(input.artifact, 'artifact');
  const artifactKind = text(artifact.kind, 'artifact.kind').toLowerCase();
  if (!validSha256(artifact.sha256)) fail('artifact.sha256 must be a lowercase SHA-256 digest');
  const deliveryMedium = text(input.deliveryMedium, 'deliveryMedium');
  if (!DELIVERY_MEDIA.has(deliveryMedium)) fail('deliveryMedium must be screen, print, or both');

  const sourceFacts = (input.sourceFacts ?? []).map((fact, index) => {
    object(fact, `sourceFacts[${index}]`);
    if (!['resolved', 'unresolved'].includes(fact.resolution)) fail(`sourceFacts[${index}].resolution must be resolved or unresolved`);
    return {
      factId: text(fact.factId, `sourceFacts[${index}].factId`),
      sourceRef: text(fact.sourceRef, `sourceFacts[${index}].sourceRef`),
      resolution: fact.resolution, preserveOriginal: fact.preserveOriginal === true,
    };
  });
  if (new Set(sourceFacts.map((fact) => fact.factId)).size !== sourceFacts.length) fail('sourceFacts factId must be unique');
  const sourceFactIds = new Set(sourceFacts.map((fact) => fact.factId));
  const calculations = (input.calculations ?? []).map((calculation, index) => {
    object(calculation, `calculations[${index}]`);
    const sourceIds = stringList(calculation.sourceFactIds, `calculations[${index}].sourceFactIds`);
    if (sourceIds.some((factId) => !sourceFactIds.has(factId))) fail(`calculations[${index}] references an unknown source fact`);
    return { calculationId: text(calculation.calculationId, `calculations[${index}].calculationId`), sourceFactIds: sourceIds };
  });
  if (new Set(calculations.map((item) => item.calculationId)).size !== calculations.length) fail('calculations calculationId must be unique');

  const domainProfileInput = input.domainProfile == null ? null : object(input.domainProfile, 'domainProfile');
  const domainProfile = domainProfileInput == null ? null : {
    profileId: text(domainProfileInput.profileId, 'domainProfile.profileId'),
    version: text(domainProfileInput.version, 'domainProfile.version'),
    invariantRefs: stringList(domainProfileInput.invariantRefs, 'domainProfile.invariantRefs'),
  };
  const rawLanes = object(input.laneRequirements, 'laneRequirements');
  const laneRequirements = {};
  for (const lane of LANES) {
    if (!Array.isArray(rawLanes[lane])) fail(`laneRequirements.${lane} must be an array`);
    laneRequirements[lane] = rawLanes[lane].map((requirement, index) => normalizeRequirement(
      requirement, lane, index, domainProfile?.invariantRefs ?? [], domainProfile != null,
    ));
    const ids = laneRequirements[lane].map((requirement) => requirement.requirementId);
    if (new Set(ids).size !== ids.length) fail(`laneRequirements.${lane} requirementId must be unique`);
  }
  const allRequirementIds = LANES.flatMap((lane) => laneRequirements[lane].map((item) => item.requirementId));
  if (new Set(allRequirementIds).size !== allRequirementIds.length) fail('requirementId must be unique across all lanes');
  const calculationIds = new Set(calculations.map((item) => item.calculationId));
  for (const requirement of laneRequirements.semantic) {
    const namedFacts = Object.values(requirement.expected).flat();
    if (namedFacts.some((factId) => !sourceFactIds.has(factId))) fail(`${requirement.requirementId} references an unknown source fact`);
  }
  for (const requirement of laneRequirements.domain) {
    if ([...requirement.expected.sourceFactIds, ...requirement.expected.reversibleSourceFactIds]
      .some((factId) => !sourceFactIds.has(factId))) fail(`${requirement.requirementId} references an unknown source fact`);
    if (requirement.expected.calculationIds.some((calculationId) => !calculationIds.has(calculationId))) {
      fail(`${requirement.requirementId} references an unknown calculation`);
    }
  }
  for (const requirement of laneRequirements.structural) {
    if (requirement.expected.reopenedArtifactSha256 !== artifact.sha256) fail(`${requirement.requirementId} must reopen the contracted artifact`);
  }
  for (const lane of ['semantic', 'domain', 'structural']) {
    if (laneRequirements[lane].length === 0) fail(`${lane} lane must have at least one requirement`);
  }
  if (['screen', 'both'].includes(deliveryMedium)) requireKinds(laneRequirements.screen, 'screen', ['render_coverage', 'visual_integrity']);
  else if (laneRequirements.screen.length > 0) fail('screen requirements must be empty when deliveryMedium is print');
  if (['print', 'both'].includes(deliveryMedium)) {
    requireKinds(laneRequirements.print, 'print', ['render_coverage', 'visual_integrity']);
    if (artifactKind === 'xlsx') requireKinds(laneRequirements.print, 'print', ['openxml_page_setup']);
  } else if (laneRequirements.print.length > 0) fail('print requirements must be empty when deliveryMedium is screen');
  for (const lane of ['screen', 'print']) {
    if (!laneRequired({ deliveryMedium }, lane)) continue;
    const renderedUnits = [...new Set(laneRequirements[lane].filter((item) => item.kind === 'render_coverage').flatMap((item) => item.expected.unitIds))];
    const visuallyObservedUnits = [...new Set(laneRequirements[lane].filter((item) => item.kind === 'visual_integrity').flatMap((item) => item.expected.unitIds))];
    if (!exactSet(renderedUnits, visuallyObservedUnits)) fail(`${lane} render and visual coverage must name the same units`);
  }

  return {
    schema: SCHEMA,
    contractId: text(input.contractId, 'contractId'),
    artifact: { artifactId: text(artifact.artifactId, 'artifact.artifactId'), kind: artifactKind, sha256: artifact.sha256 },
    audience: text(input.audience, 'audience'), domain: text(input.domain, 'domain'),
    usePurpose: text(input.usePurpose, 'usePurpose'), deliveryMedium,
    sourceFacts, calculations,
    requiredArtifactForms: stringList(input.requiredArtifactForms, 'requiredArtifactForms'),
    visualHierarchyGoals: stringList(input.visualHierarchyGoals, 'visualHierarchyGoals'),
    domainProfile, laneRequirements,
  };
}

function evaluationFor(requirement, observation, contract) {
  if (!observation) return { state: 'unmeasured', reason: 'observation_missing' };
  if (observation.state === 'unknown') return { state: 'unmeasured', reason: 'observation_unknown' };
  if (observation.state === 'failed') return { state: 'failed', reason: 'observer_failed' };
  if (observation.state !== 'observed') return { state: 'failed', reason: 'invalid_observation_state' };
  if (observation.kind !== requirement.kind) return { state: 'failed', reason: 'observation_kind_mismatch' };
  if (observation.artifactSha256 !== contract.artifact.sha256) return { state: 'failed', reason: 'artifact_identity_mismatch' };
  if (!String(observation.observerRef ?? '').trim()) return { state: 'failed', reason: 'observer_reference_missing' };
  const facts = observation.facts ?? {};
  const expected = requirement.expected;

  if (requirement.kind === 'semantic_reconciliation') {
    const passed = includesAll(facts.satisfiedFactIds, expected.satisfiedFactIds)
      && includesAll(facts.unchangedSourceFactIds, expected.unchangedSourceFactIds)
      && includesAll(facts.preservedUnresolvedFactIds, expected.preservedUnresolvedFactIds);
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'semantic_reconciliation_incomplete' };
  }
  if (requirement.kind === 'domain_traceability') {
    const traces = Array.isArray(facts.traces) ? facts.traces : [];
    const tracePassed = (expected.sourceFactIds ?? []).every((factId) => {
      const source = contract.sourceFacts.find((item) => item.factId === factId);
      const trace = traces.find((item) => item.sourceFactId === factId);
      return trace?.sourceRef === source?.sourceRef && trace.originalValuePresent === true;
    });
    const reversiblePassed = (expected.reversibleSourceFactIds ?? []).every((factId) => traces.some(
      (trace) => trace.sourceFactId === factId && trace.reversible === true,
    ));
    const passed = tracePassed && reversiblePassed && includesAll(facts.calculationIds, expected.calculationIds ?? []);
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'domain_traceability_incomplete' };
  }
  if (requirement.kind === 'structural_scan') {
    const passed = facts.reopenedArtifactSha256 === expected.reopenedArtifactSha256
      && Number.isInteger(facts.formulaErrors) && facts.formulaErrors <= expected.maximumFormulaErrors
      && Number.isInteger(facts.schemaErrors) && facts.schemaErrors <= expected.maximumSchemaErrors;
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'structural_scan_failed' };
  }
  if (requirement.kind === 'render_coverage') {
    const passed = facts.surface === expected.surface && exactSet(facts.observedUnitIds, expected.unitIds);
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'render_coverage_incomplete' };
  }
  if (requirement.kind === 'visual_integrity') {
    const defects = Array.isArray(facts.defects) ? facts.defects : null;
    const passed = facts.surface === expected.surface && exactSet(facts.observedUnitIds, expected.unitIds)
      && defects != null && !defects.some((defect) => expected.disallowedDefects.includes(defect.type));
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'visual_integrity_failed' };
  }
  if (requirement.kind === 'openxml_page_setup') {
    const actualSheets = Array.isArray(facts.sheets) ? facts.sheets : [];
    const passed = (expected.sheets ?? []).every((expectedSheet) => {
      const actual = actualSheets.find((sheet) => sheet.sheetId === expectedSheet.sheetId);
      return actual && Object.entries(expectedSheet).every(([key, value]) => actual[key] === value);
    });
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'openxml_page_setup_mismatch' };
  }
  return { state: 'failed', reason: 'unsupported_requirement_kind' };
}

function laneRequired(contract, lane) {
  if (lane === 'screen') return ['screen', 'both'].includes(contract.deliveryMedium);
  if (lane === 'print') return ['print', 'both'].includes(contract.deliveryMedium);
  return true;
}

export function qualifyArtifactQuality({ contract: rawContract, observations = [] } = {}) {
  const contract = createArtifactPurposeContract(rawContract);
  if (!Array.isArray(observations)) fail('observations must be an array');
  const byRequirement = new Map();
  for (const observation of observations) {
    const requirementId = String(observation?.requirementId ?? '');
    const list = byRequirement.get(requirementId) ?? [];
    list.push(observation); byRequirement.set(requirementId, list);
  }
  const lanes = {};
  for (const lane of LANES) {
    const required = laneRequired(contract, lane);
    if (!required) {
      lanes[lane] = { required: false, status: 'not_applicable', requirements: [], missingRequirementIds: [], failedRequirementIds: [] };
      continue;
    }
    const requirements = contract.laneRequirements[lane].map((requirement) => {
      const candidates = byRequirement.get(requirement.requirementId) ?? [];
      const evaluation = candidates.length > 1
        ? { state: 'failed', reason: 'duplicate_observations' }
        : evaluationFor(requirement, candidates[0], contract);
      return { requirementId: requirement.requirementId, kind: requirement.kind, status: evaluation.state, reason: evaluation.reason, observationId: candidates[0]?.observationId ?? null };
    });
    const failedRequirementIds = requirements.filter((item) => item.status === 'failed').map((item) => item.requirementId);
    const missingRequirementIds = requirements.filter((item) => item.status === 'unmeasured').map((item) => item.requirementId);
    const status = failedRequirementIds.length > 0 ? 'failed' : missingRequirementIds.length > 0 ? 'unmeasured' : 'qualified';
    lanes[lane] = { required: true, status, requirements, missingRequirementIds, failedRequirementIds };
  }
  return {
    schema: RECEIPT_SCHEMA, contractId: contract.contractId, artifact: structuredClone(contract.artifact),
    qualified: LANES.every((lane) => !lanes[lane].required || lanes[lane].status === 'qualified'), lanes,
  };
}
