import { createHash } from 'node:crypto';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const bytes = (value) => Buffer.byteLength(String(value ?? ''), 'utf8');
const jsonBytes = (value) => bytes(JSON.stringify(value));

function words(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function repeatedNgrams(surfaces, size = 5, limit = 40) {
  const owners = new Map();
  for (const surface of surfaces) {
    const tokens = words(surface.text); const local = new Set();
    for (let index = 0; index <= tokens.length - size; index += 1) {
      local.add(tokens.slice(index, index + size).join(' '));
    }
    for (const gram of local) {
      const set = owners.get(gram) ?? new Set(); set.add(surface.owner); owners.set(gram, set);
    }
  }
  return [...owners.entries()].filter(([, set]) => set.size >= 2)
    .sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]))
    .slice(0, limit).map(([gram, set]) => ({ gram, owners: [...set].sort() }));
}

export function auditNxContextSurfaces({ instructions, interactionCore, manifest,
  activeTools = [], skills = [], skillBodies = new Map(), runtimeContext = '',
  providerBaseline = {}, sourceModules = [] } = {}) {
  if (!instructions || !interactionCore || !manifest?.families) throw new TypeError('Context audit inputs are incomplete');
  const lines = String(instructions).split('\n'); let cursor = 0;
  const requiredFutureFields = ['incidentRefs', 'modelsQualified', 'measuredBenefit',
    'replacementOwner', 'lastReviewedAt'];
  const families = manifest.families.map((family) => {
    const count = Number(family.globalLineCount ?? 0);
    const slice = family.currentEnforcement === 'global_instructions'
      ? lines.slice(cursor, cursor + count).join('\n') : '';
    if (family.currentEnforcement === 'global_instructions') cursor += count;
    return { id: family.id, kind: family.kind, ownerSource: family.ownerSource,
      currentEnforcement: family.currentEnforcement, targetEnforcement: family.targetEnforcement,
      lineCount: count, bytes: bytes(slice), digestMatches: slice ? sha256(slice) === family.globalSha256 : true,
      countertestCount: family.countertests?.length ?? 0,
      missingFutureAuditFields: requiredFutureFields.filter((field) => family[field] == null) };
  });
  const toolSurfaces = activeTools.map((tool) => ({ name: tool.name,
    descriptionBytes: bytes(tool.description), schemaBytes: jsonBytes(tool.parameters),
    totalBytes: jsonBytes(tool), digest: sha256(JSON.stringify(tool)) }));
  const skillSurfaces = skills.map((skill) => { const body = skillBodies.get(skill.name) ?? ''; return {
    name: skill.name, metadataBytes: jsonBytes({ name: skill.name, description: skill.description,
      contentDigest: skill.contentDigest }), bodyBytes: bytes(body), bodyDigest: sha256(body),
  }; });
  const overlapSurfaces = [
    { owner: 'global_instructions', text: instructions },
    ...activeTools.map((tool) => ({ owner: `tool:${tool.name}`, text: tool.description })),
    ...skills.map((skill) => ({ owner: `skill_metadata:${skill.name}`, text: skill.description })),
    ...skills.map((skill) => ({ owner: `skill_body:${skill.name}`, text: skillBodies.get(skill.name) ?? '' })),
  ];
  return {
    schema: 't5.nx2.context-surface-inventory.v1',
    instructions: { lines: lines.length, bytes: bytes(instructions), sha256: sha256(instructions),
      priorResearchBytes: 29362, driftBytes: bytes(instructions) - 29362 },
    interactionCore: { lines: String(interactionCore).split('\n').length,
      bytes: bytes(interactionCore), sha256: sha256(interactionCore) },
    instructionFamilies: { count: families.length, admittedGlobalLines: cursor,
      allGlobalLinesAdmitted: cursor === lines.length,
      allCurrentDigestsMatch: families.every((family) => family.digestMatches),
      ownerCoverage: families.filter((family) => family.ownerSource).length,
      countertestCoverage: families.filter((family) => family.countertestCount > 0).length,
      families },
    activeTools: { count: toolSurfaces.length, bytes: toolSurfaces.reduce((sum, item) => sum + item.totalBytes, 0),
      tools: toolSurfaces },
    skills: { count: skillSurfaces.length,
      metadataBytes: skillSurfaces.reduce((sum, item) => sum + item.metadataBytes, 0),
      bodyBytes: skillSurfaces.reduce((sum, item) => sum + item.bodyBytes, 0), skills: skillSurfaces },
    runtimeContext: { bytes: bytes(runtimeContext), sha256: sha256(runtimeContext),
      workspacePresent: String(runtimeContext).includes('[T5 CURRENT WORKSPACE') },
    providerBaseline,
    sourceModules,
    repeatedFiveGrams: repeatedNgrams(overlapSurfaces),
    productChanges: 0,
  };
}
