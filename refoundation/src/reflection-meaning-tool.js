const TOP_LEVEL_FIELDS = new Set([
  'action', 'hypothesis', 'sourceEpisodeHandles', 'counterexampleHandles',
  'affectedScopeHandles', 'correctionRelations', 'unknowns',
]);
const RELATION_FIELDS = new Set(['handle', 'relation']);
const SNAPSHOT_CORRECTION_FIELDS = new Set(['handle', 'appliesToScopeHandles', 'head', 'recordRefs']);

function exactObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
}

function boundedText(value, label, { empty = false, maximum = 4_000 } = {}) {
  if (typeof value !== 'string' || value.trim() !== value || value.length > maximum
    || (!empty && value.length === 0) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function snapshotHandles(items, label, maximum) {
  if (!Array.isArray(items)) throw new TypeError(`${label} must be supplied by the runtime snapshot`);
  if (items.length > maximum) throw new TypeError(`${label} exceeds its runtime bound`);
  const handles = items.map((item) => boundedText(item?.handle, `${label} handle`, { maximum: 256 }));
  if (new Set(handles).size !== handles.length) throw new TypeError(`${label} runtime handles must be unique`);
  return handles;
}

function selectedHandles(value, allowed, label, maximum = 128) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must be a bounded array`);
  const handles = value.map((item) => boundedText(item, `${label} item`, { maximum: 256 }));
  if (new Set(handles).size !== handles.length) throw new TypeError(`${label} must not contain duplicates`);
  if (handles.some((handle) => !allowed.has(handle))) throw new TypeError(`${label} contains a foreign handle`);
  return handles;
}

function unknowns(value) {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError('unknowns must be a bounded array');
  const normalized = value.map((item) => boundedText(item, 'unknown', { maximum: 1_000 }));
  if (new Set(normalized).size !== normalized.length) throw new TypeError('unknowns must not contain duplicates');
  return normalized;
}

function handleItems(handles) {
  return { type: 'string', enum: handles.length ? handles : ['__t5_no_available_runtime_handle__'] };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

export function projectReflectionMeaningSnapshot(runtimeSnapshot) {
  if (!runtimeSnapshot || typeof runtimeSnapshot !== 'object' || Array.isArray(runtimeSnapshot)) {
    throw new TypeError('authoritative Reflection runtime snapshot is required');
  }
  const episodeHandles = snapshotHandles(runtimeSnapshot.episodeAllowlist, 'Episode allowlist', 64);
  const counterexampleHandles = snapshotHandles(runtimeSnapshot.counterexampleSearch?.results,
    'counterexample allowlist', 64);
  const scopeHandles = snapshotHandles(runtimeSnapshot.affectedScopes, 'affected scope allowlist', 32);
  const scopeSet = new Set(scopeHandles);
  snapshotHandles(runtimeSnapshot.currentCorrections, 'current correction allowlist', 64);
  const corrections = [];
  for (const correction of runtimeSnapshot.currentCorrections) {
    exactObject(correction, SNAPSHOT_CORRECTION_FIELDS, 'runtime current correction');
    if (!correction.head || typeof correction.head !== 'object' || Array.isArray(correction.head)
      || !Array.isArray(correction.recordRefs)) {
      throw new TypeError('runtime current correction requires authoritative head and recordRefs');
    }
    if (!Array.isArray(correction.appliesToScopeHandles)
      || correction.appliesToScopeHandles.length === 0
      || correction.appliesToScopeHandles.length > 32) {
      throw new TypeError('current correction appliesToScopeHandles must be a bounded non-empty array');
    }
    const applies = correction.appliesToScopeHandles.map((handle) => (
      boundedText(handle, 'current correction appliesToScopeHandle', { maximum: 256 })
    ));
    if (new Set(applies).size !== applies.length) {
      throw new TypeError('current correction appliesToScopeHandles must not contain duplicates');
    }
    const related = applies.filter((handle) => scopeSet.has(handle));
    if (!related.length) continue;
    if (related.length !== applies.length) {
      throw new TypeError('current correction mixes an advertised scope with a foreign scope');
    }
    corrections.push({ handle: correction.handle, appliesToScopeHandles: [...applies] });
  }
  return deepFreeze(structuredClone({ episodeHandles, counterexampleHandles,
    affectedScopeHandles: scopeHandles, corrections }));
}

function normalizeProposal(args, allowlists) {
  exactObject(args, TOP_LEVEL_FIELDS, 'Reflection meaning input');
  if (!['propose', 'abstain'].includes(args.action)) throw new TypeError('Reflection action is invalid');
  const hypothesis = boundedText(args.hypothesis, 'hypothesis', { empty: args.action === 'abstain' });
  const sourceEpisodeHandles = selectedHandles(args.sourceEpisodeHandles,
    allowlists.episodes, 'sourceEpisodeHandles', 64);
  const counterexampleHandles = selectedHandles(args.counterexampleHandles,
    allowlists.counterexamples, 'counterexampleHandles', 64);
  const affectedScopeHandles = selectedHandles(args.affectedScopeHandles,
    allowlists.scopes, 'affectedScopeHandles', 32);
  if (!Array.isArray(args.correctionRelations) || args.correctionRelations.length > 64) {
    throw new TypeError('correctionRelations must be a bounded array');
  }
  const seenCorrections = new Set();
  const correctionRelations = args.correctionRelations.map((item) => {
    exactObject(item, RELATION_FIELDS, 'Reflection correction relation');
    const handle = boundedText(item.handle, 'correction handle', { maximum: 256 });
    if (seenCorrections.has(handle)) throw new TypeError('correctionRelations must not contain duplicates');
    if (!allowlists.corrections.has(handle)) throw new TypeError('correctionRelations contains a foreign handle');
    if (!['preserved', 'conflicts'].includes(item.relation)) {
      throw new TypeError('Reflection correction relation is invalid');
    }
    seenCorrections.add(handle); return { correctionHandle: handle, relation: item.relation };
  });
  const normalizedUnknowns = unknowns(args.unknowns);
  if (args.action === 'abstain') {
    if (hypothesis || sourceEpisodeHandles.length || counterexampleHandles.length
      || affectedScopeHandles.length || correctionRelations.length || normalizedUnknowns.length) {
      throw new TypeError('abstain must not carry a Reflection proposal');
    }
  } else if (sourceEpisodeHandles.length < 2 || affectedScopeHandles.length < 1) {
    throw new TypeError('Reflection proposal requires two Episodes and one affected scope');
  }
  return { action: args.action, hypothesis, sourceEpisodeHandles, counterexampleHandles,
    affectedScopeHandles, correctionRelations, unknowns: normalizedUnknowns };
}

export function makeReflectionMeaningTool({ coordinator, runtimeSnapshot } = {}) {
  if (typeof coordinator?.materializeAndPropose !== 'function' || !runtimeSnapshot) {
    throw new TypeError('Reflection meaning tool requires an isolated coordinator and runtime snapshot');
  }
  const projected = projectReflectionMeaningSnapshot(runtimeSnapshot);
  const episodeHandles = projected.episodeHandles;
  const counterexampleHandles = projected.counterexampleHandles;
  const scopeHandles = projected.affectedScopeHandles;
  const correctionHandles = projected.corrections.map((correction) => correction.handle);
  const allowlists = { episodes: new Set(episodeHandles), counterexamples: new Set(counterexampleHandles),
    scopes: new Set(scopeHandles), corrections: new Set(correctionHandles) };
  const parameters = {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['propose', 'abstain'] },
      hypothesis: { type: 'string', maxLength: 4_000 },
      sourceEpisodeHandles: { type: 'array',
        maxItems: episodeHandles.length ? 64 : 0,
        items: handleItems(episodeHandles) },
      counterexampleHandles: { type: 'array',
        maxItems: counterexampleHandles.length ? 64 : 0,
        items: handleItems(counterexampleHandles) },
      affectedScopeHandles: { type: 'array',
        maxItems: scopeHandles.length ? 32 : 0,
        items: handleItems(scopeHandles) },
      correctionRelations: { type: 'array',
        maxItems: correctionHandles.length ? 64 : 0,
        items: { type: 'object', additionalProperties: false, properties: {
          handle: handleItems(correctionHandles),
          relation: { type: 'string', enum: ['preserved', 'conflicts'] },
        }, required: ['handle', 'relation'] } },
      unknowns: { type: 'array', maxItems: 32,
        items: { type: 'string', maxLength: 1_000 } },
    },
    required: [...TOP_LEVEL_FIELDS],
  };
  return {
    name: 'reflection_meaning', informationFamily: 'reflection',
    informationAlwaysVisible: false, strict: true,
    description: 'Propose one provisional procedure hypothesis from the exact opaque Episode, counterexample, scope, and current-correction handles supplied by T5, or abstain. This creates only inactive review evidence and cannot install tools, change capabilities, write Memory, or publish a Principle.',
    parameters,
    async execute(args) {
      const normalized = normalizeProposal(args, allowlists);
      if (normalized.action === 'abstain') {
        return { state: 'abstained', writes: 0, publicationQualified: false,
          productProjection: 'none', managedCapabilityChanges: 0 };
      }
      const { action: ignored, ...meaningProposal } = normalized;
      const proposal = await coordinator.materializeAndPropose({ meaningProposal });
      return { state: 'proposed_inactive', proposal, publicationQualified: false,
        productProjection: 'none', managedCapabilityChanges: 0 };
    },
  };
}
