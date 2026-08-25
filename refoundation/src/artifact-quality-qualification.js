const SCHEMA = 't5.artifact-purpose-contract.v1';
const RECEIPT_SCHEMA = 't5.artifact-quality-receipt.v1';
const OBSERVATION_SCHEMA = 't5.artifact-quality-observation.v1';
const LANES = Object.freeze(['semantic', 'domain', 'structural', 'screen', 'print']);
const DELIVERY_MEDIA = new Set(['screen', 'print', 'both']);
const REQUIREMENT_KINDS = Object.freeze({
  semantic: new Set(['semantic_reconciliation']),
  domain: new Set(['domain_traceability']),
  structural: new Set(['structural_scan', 'artifact_forms']),
  screen: new Set(['render_coverage', 'visual_integrity', 'visual_hierarchy']),
  print: new Set(['render_coverage', 'visual_integrity', 'visual_hierarchy', 'openxml_page_setup']),
});
const PRODUCER_KINDS = new Set(['semantic_verifier', 'domain_verifier', 'structural_verifier', 'render_verifier']);
const PRODUCER_REQUIREMENT_KINDS = Object.freeze({
  semantic_verifier: new Set(['semantic_reconciliation']),
  domain_verifier: new Set(['domain_traceability']),
  structural_verifier: new Set(['structural_scan', 'artifact_forms', 'openxml_page_setup']),
  render_verifier: new Set(['render_coverage', 'visual_integrity', 'visual_hierarchy']),
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
function strictText(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
  return value.trim();
}
function stringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`);
  return result;
}
function strictStringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  const result = value.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) fail(`${label}[${index}] must be a non-empty string`);
    return item.trim();
  });
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
  if (kind === 'artifact_forms') {
    return { formIds: stringList(expected.formIds, `${label}.formIds`) };
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
  if (kind === 'visual_hierarchy') {
    const surface = text(expected.surface, `${label}.surface`);
    if (surface !== lane) fail(`${label}.surface must match ${lane}`);
    return {
      surface,
      unitIds: stringList(expected.unitIds, `${label}.unitIds`),
      goalIds: stringList(expected.goalIds, `${label}.goalIds`),
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
  const requiredArtifactForms = stringList(input.requiredArtifactForms, 'requiredArtifactForms');
  const visualHierarchyGoals = stringList(input.visualHierarchyGoals, 'visualHierarchyGoals');
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
    if (requirement.kind === 'structural_scan' && requirement.expected.reopenedArtifactSha256 !== artifact.sha256) {
      fail(`${requirement.requirementId} must reopen the contracted artifact`);
    }
  }
  for (const lane of ['semantic', 'domain', 'structural']) {
    if (laneRequirements[lane].length === 0) fail(`${lane} lane must have at least one requirement`);
  }
  requireKinds(laneRequirements.structural, 'structural', ['artifact_forms']);
  const formRequirements = laneRequirements.structural.filter((item) => item.kind === 'artifact_forms');
  if (formRequirements.length !== 1 || !exactSet(formRequirements[0].expected.formIds, requiredArtifactForms)) {
    fail('structural artifact_forms must exactly bind requiredArtifactForms');
  }
  if (['screen', 'both'].includes(deliveryMedium)) requireKinds(laneRequirements.screen, 'screen', ['render_coverage', 'visual_integrity']);
  else if (laneRequirements.screen.length > 0) fail('screen requirements must be empty when deliveryMedium is print');
  if (['print', 'both'].includes(deliveryMedium)) {
    requireKinds(laneRequirements.print, 'print', ['render_coverage', 'visual_integrity']);
    if (artifactKind === 'xlsx') requireKinds(laneRequirements.print, 'print', ['openxml_page_setup']);
  } else if (laneRequirements.print.length > 0) fail('print requirements must be empty when deliveryMedium is screen');
  for (const lane of ['screen', 'print']) {
    if (!laneRequired({ deliveryMedium }, lane)) continue;
    requireKinds(laneRequirements[lane], lane, ['visual_hierarchy']);
    const renderedUnits = [...new Set(laneRequirements[lane].filter((item) => item.kind === 'render_coverage').flatMap((item) => item.expected.unitIds))];
    const visuallyObservedUnits = [...new Set(laneRequirements[lane].filter((item) => item.kind === 'visual_integrity').flatMap((item) => item.expected.unitIds))];
    if (!exactSet(renderedUnits, visuallyObservedUnits)) fail(`${lane} render and visual coverage must name the same units`);
    const hierarchyRequirements = laneRequirements[lane].filter((item) => item.kind === 'visual_hierarchy');
    const hierarchyUnits = [...new Set(hierarchyRequirements.flatMap((item) => item.expected.unitIds))];
    const hierarchyGoals = [...new Set(hierarchyRequirements.flatMap((item) => item.expected.goalIds))];
    if (!exactSet(renderedUnits, hierarchyUnits)) fail(`${lane} render and hierarchy coverage must name the same units`);
    if (!exactSet(hierarchyGoals, visualHierarchyGoals)) fail(`${lane} visual_hierarchy must exactly bind visualHierarchyGoals`);
  }

  return {
    schema: SCHEMA,
    contractId: text(input.contractId, 'contractId'),
    artifact: { artifactId: text(artifact.artifactId, 'artifact.artifactId'), kind: artifactKind, sha256: artifact.sha256 },
    audience: text(input.audience, 'audience'), domain: text(input.domain, 'domain'),
    usePurpose: text(input.usePurpose, 'usePurpose'), deliveryMedium,
    sourceFacts, calculations,
    requiredArtifactForms,
    visualHierarchyGoals,
    domainProfile, laneRequirements,
  };
}

function trustedProducerKey(producer) { return `${producer.kind}\u0000${producer.identity}`; }

function normalizeTrustedProducers(value) {
  if (!Array.isArray(value)) fail('trustedProducers must be an array');
  return new Set(value.map((producer, index) => {
    object(producer, `trustedProducers[${index}]`);
    const kind = text(producer.kind, `trustedProducers[${index}].kind`);
    if (!PRODUCER_KINDS.has(kind)) fail(`trustedProducers[${index}].kind is not trusted`);
    return trustedProducerKey({ kind, identity: text(producer.identity, `trustedProducers[${index}].identity`) });
  }));
}

function normalizeObservationFacts(requirement, facts) {
  const label = `observation ${requirement.requirementId}.facts`;
  object(facts, label);
  if (requirement.kind === 'semantic_reconciliation') return {
    satisfiedFactIds: strictStringList(facts.satisfiedFactIds, `${label}.satisfiedFactIds`, { allowEmpty: true }),
    unchangedSourceFactIds: strictStringList(facts.unchangedSourceFactIds, `${label}.unchangedSourceFactIds`, { allowEmpty: true }),
    preservedUnresolvedFactIds: strictStringList(facts.preservedUnresolvedFactIds, `${label}.preservedUnresolvedFactIds`, { allowEmpty: true }),
  };
  if (requirement.kind === 'domain_traceability') {
    if (!Array.isArray(facts.traces)) fail(`${label}.traces must be an array`);
    const traces = facts.traces.map((trace, index) => {
      object(trace, `${label}.traces[${index}]`);
      if (typeof trace.originalValuePresent !== 'boolean' || typeof trace.reversible !== 'boolean') {
        fail(`${label}.traces[${index}] flags must be boolean`);
      }
      return {
        sourceFactId: strictText(trace.sourceFactId, `${label}.traces[${index}].sourceFactId`),
        sourceRef: strictText(trace.sourceRef, `${label}.traces[${index}].sourceRef`),
        originalValuePresent: trace.originalValuePresent,
        reversible: trace.reversible,
      };
    });
    return { traces, calculationIds: strictStringList(facts.calculationIds, `${label}.calculationIds`, { allowEmpty: true }) };
  }
  if (requirement.kind === 'structural_scan') {
    if (!validSha256(facts.reopenedArtifactSha256)) fail(`${label}.reopenedArtifactSha256 must be SHA-256`);
    if (![facts.formulaErrors, facts.schemaErrors].every((value) => Number.isInteger(value) && value >= 0)) {
      fail(`${label} error counts must be non-negative integers`);
    }
    return { reopenedArtifactSha256: facts.reopenedArtifactSha256, formulaErrors: facts.formulaErrors, schemaErrors: facts.schemaErrors };
  }
  if (requirement.kind === 'artifact_forms') {
    return { observedFormIds: strictStringList(facts.observedFormIds, `${label}.observedFormIds`) };
  }
  if (requirement.kind === 'render_coverage') return {
    surface: strictText(facts.surface, `${label}.surface`),
    observedUnitIds: strictStringList(facts.observedUnitIds, `${label}.observedUnitIds`),
  };
  if (requirement.kind === 'visual_integrity') {
    if (!Array.isArray(facts.defects)) fail(`${label}.defects must be an array`);
    const observedUnitIds = strictStringList(facts.observedUnitIds, `${label}.observedUnitIds`);
    const defects = facts.defects.map((defect, index) => {
      object(defect, `${label}.defects[${index}]`);
      const normalized = {
        unitId: strictText(defect.unitId, `${label}.defects[${index}].unitId`),
        type: strictText(defect.type, `${label}.defects[${index}].type`),
      };
      if (!observedUnitIds.includes(normalized.unitId)) fail(`${label}.defects[${index}].unitId was not observed`);
      return normalized;
    });
    return { surface: strictText(facts.surface, `${label}.surface`), observedUnitIds, defects };
  }
  if (requirement.kind === 'visual_hierarchy') return {
    surface: strictText(facts.surface, `${label}.surface`),
    observedUnitIds: strictStringList(facts.observedUnitIds, `${label}.observedUnitIds`),
    achievedGoalIds: strictStringList(facts.achievedGoalIds, `${label}.achievedGoalIds`, { allowEmpty: true }),
  };
  if (requirement.kind === 'openxml_page_setup') {
    if (!Array.isArray(facts.sheets) || facts.sheets.length === 0) fail(`${label}.sheets must be a non-empty array`);
    return { sheets: facts.sheets.map((sheet, index) => {
      const sheetLabel = `${label}.sheets[${index}]`;
      object(sheet, sheetLabel);
      return normalizePageSetupSheet({
        ...sheet,
        sheetId: strictText(sheet.sheetId, `${sheetLabel}.sheetId`),
        paperSize: strictText(sheet.paperSize, `${sheetLabel}.paperSize`),
        orientation: strictText(sheet.orientation, `${sheetLabel}.orientation`),
        printArea: strictText(sheet.printArea, `${sheetLabel}.printArea`),
      }, sheetLabel);
    }) };
  }
  fail(`${label} has unsupported requirement kind`);
}

function normalizeObservation(requirement, observation, contract, trustedProducers) {
  object(observation, `observation ${requirement.requirementId}`);
  if (observation.schema !== OBSERVATION_SCHEMA) fail('observation schema mismatch');
  if (observation.contractId !== contract.contractId) fail('observation contract identity mismatch');
  if (observation.artifactSha256 !== contract.artifact.sha256) fail('observation artifact identity mismatch');
  const producer = object(observation.producer, 'observation producer');
  const normalizedProducer = {
    kind: strictText(producer.kind, 'observation producer.kind'),
    identity: strictText(producer.identity, 'observation producer.identity'),
  };
  if (!PRODUCER_REQUIREMENT_KINDS[normalizedProducer.kind]?.has(requirement.kind)) fail('observation producer kind mismatch');
  if (!trustedProducers.has(trustedProducerKey(normalizedProducer))) fail('observation producer is not trusted');
  const state = strictText(observation.state, 'observation state');
  if (!['observed', 'failed', 'unknown'].includes(state)) fail('observation state is invalid');
  return {
    ...observation,
    observationId: strictText(observation.observationId, 'observationId'),
    state,
    facts: state === 'observed' ? normalizeObservationFacts(requirement, observation.facts) : null,
  };
}

function evaluationFor(requirement, rawObservation, contract, trustedProducers) {
  let observation;
  try {
    observation = rawObservation == null ? null : normalizeObservation(requirement, rawObservation, contract, trustedProducers);
  } catch {
    return { state: 'failed', reason: 'malformed_observation' };
  }
  if (!observation) return { state: 'unmeasured', reason: 'observation_missing' };
  if (observation.state === 'unknown') return { state: 'unmeasured', reason: 'observation_unknown' };
  if (observation.state === 'failed') return { state: 'failed', reason: 'observer_failed' };
  if (observation.state !== 'observed') return { state: 'failed', reason: 'invalid_observation_state' };
  if (observation.kind !== requirement.kind) return { state: 'failed', reason: 'observation_kind_mismatch' };
  const facts = observation.facts;
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
  if (requirement.kind === 'artifact_forms') {
    const passed = exactSet(facts.observedFormIds, expected.formIds);
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'artifact_forms_incomplete' };
  }
  if (requirement.kind === 'render_coverage') {
    const passed = facts.surface === expected.surface && exactSet(facts.observedUnitIds, expected.unitIds);
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'render_coverage_incomplete' };
  }
  if (requirement.kind === 'visual_integrity') {
    const passed = facts.surface === expected.surface && exactSet(facts.observedUnitIds, expected.unitIds)
      && !facts.defects.some((defect) => expected.disallowedDefects.includes(defect.type));
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'visual_integrity_failed' };
  }
  if (requirement.kind === 'visual_hierarchy') {
    const passed = facts.surface === expected.surface && exactSet(facts.observedUnitIds, expected.unitIds)
      && exactSet(facts.achievedGoalIds, expected.goalIds);
    return { state: passed ? 'qualified' : 'failed', reason: passed ? null : 'visual_hierarchy_incomplete' };
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

export function qualifyArtifactQuality({ contract: rawContract, observations = [], trustedProducers = [] } = {}) {
  const contract = createArtifactPurposeContract(rawContract);
  if (!Array.isArray(observations)) fail('observations must be an array');
  const trustedProducerKeys = normalizeTrustedProducers(trustedProducers);
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
        : evaluationFor(requirement, candidates[0], contract, trustedProducerKeys);
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
