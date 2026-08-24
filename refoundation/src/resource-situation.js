const SCHEMA = 't5.resource-situation.v1';
const MAX_BYTES = 8 * 1024;

export function resourceSituationBlock(situation) {
  if (!situation || situation.state !== 'observed') return null;
  const value = { schema: SCHEMA, ...structuredClone(situation) };
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) throw new Error('resource situation exceeds bounded projection');
  const active = value.intervention?.active === true;
  return [
    active
      ? '[T5 CURRENT WORKING CONDITION — observed active control, not a user request]'
      : '[T5 CURRENT RESOURCE SITUATION — runtime observation, not a user request and not a stop command]',
    json,
    active
      ? 'The recovery method you selected produced no new Evidence, so additional tool execution is unavailable in this Run. Do not claim unobserved success. Write the most useful honest result from current Evidence, including what remains unfinished. Do not mention internal control fields unless the user explicitly asks.'
      : 'This is current working-condition data. It does not decide whether to continue, batch, change method, settle, or stop. You make that decision from the user objective and Evidence. Do not mention internal resource fields unless the user explicitly asks.',
  ].join('\n');
}

export function resourceSituationTransitionKey(situation) {
  if (!situation || situation.state !== 'observed') return null;
  const signals = situation.anomaly?.signals ?? [];
  const latestEvidence = situation.evidence?.latestToolEvidence ?? null;
  const rawCategory = situation.anomaly?.category ?? null;
  const anomalyCategory = rawCategory === 'reliability_candidate'
    || (rawCategory === 'pathology_candidate' && latestEvidence !== 'new') ? rawCategory : null;
  const boundaries = situation.legacyFixedBoundaries ?? {};
  const state = {
    anomalyCategory,
    anomalySignals: anomalyCategory ? signals : [],
    latestEvidence,
    currentRepeatedEvidence: latestEvidence === 'repeated',
    retryObserved: Number(situation.usage?.providerRetryAttempts ?? 0) > 0,
    unknownObserved: Number(situation.usage?.unknownSettlements ?? 0) > 0,
    modelTurnBoundary: boundaries.modelTurns?.wouldReachOnNextObservedPattern === true,
    toolCallBoundary: boundaries.toolCalls?.wouldReachOnNextObservedPattern === true,
    providerTokenBoundary: boundaries.providerTokens?.wouldReachOnNextObservedPattern === true,
  };
  if (!state.anomalyCategory && !state.currentRepeatedEvidence
    && !state.retryObserved && !state.unknownObserved && !state.modelTurnBoundary
    && !state.toolCallBoundary && !state.providerTokenBoundary) return null;
  return JSON.stringify(state);
}

export const RESOURCE_SITUATION_SCHEMA = SCHEMA;
