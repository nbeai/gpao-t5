import { readFile } from 'node:fs/promises';
import { normalizeWebUrl } from './web-read-tool.js';

const TURN_KINDS = new Set(['context', 'analysis', 'constraint', 'correction', 'challenge', 'final']);
const INTERNAL_TERMS = /toolCallId|runId|ToolReceipt|pendingId|observationId|local_change/u;
const REVIEW_DIMENSIONS = [
  'sourceFactsPreserved', 'userFactsUsed', 'goalSpecific', 'correctionApplied',
  'coverageHonest', 'universalRuleAvoided', 'actionProportional',
];

function text(value, label) { const result = String(value ?? '').trim(); if (!result) throw new Error(`${label} is required`); return result; }

export async function loadUserGroundedSocialScenarios(input) {
  const raw = typeof input === 'string' ? JSON.parse(await readFile(input, 'utf8')) : structuredClone(input);
  if (raw?.schema !== 't5.user-grounded-social-scenarios.v1' || !Array.isArray(raw.scenarios)) throw new Error('invalid user-grounded social scenario schema');
  if (raw.scope?.representativeOfUsers !== false || raw.scope?.purpose !== 'prove_same_source_different_user_goal_analysis'
    || raw.scope?.analysisTargetsComeFrom !== 'current_user_business_taste_goal_and_corrections') {
    throw new Error('social scenarios must not claim to represent users');
  }
  raw.sharedSource.url = normalizeWebUrl(raw.sharedSource?.url);
  if (!Array.isArray(raw.sharedSource.observed) || !Array.isArray(raw.sharedSource.missing)
    || raw.sharedSource.observed.some((field) => raw.sharedSource.missing.includes(field))) throw new Error('invalid shared source coverage');
  const ids = new Set(); const outcomes = new Set();
  for (const scenario of raw.scenarios) {
    scenario.id = text(scenario.id, 'scenario id'); scenario.title = text(scenario.title, 'scenario title');
    scenario.expectedOutcomeType = text(scenario.expectedOutcomeType, 'expected outcome type');
    if (ids.has(scenario.id) || outcomes.has(scenario.expectedOutcomeType)) throw new Error('duplicate scenario identity or outcome');
    ids.add(scenario.id); outcomes.add(scenario.expectedOutcomeType);
    if (!Array.isArray(scenario.turns) || scenario.turns.length < 6) throw new Error('social scenario needs at least six turns');
    const kinds = new Set();
    for (const turn of scenario.turns) {
      if (!TURN_KINDS.has(turn.kind)) throw new Error('invalid social scenario turn kind');
      turn.prompt = text(turn.prompt, 'turn prompt'); kinds.add(turn.kind);
    }
    for (const required of TURN_KINDS) if (!kinds.has(required)) throw new Error(`social scenario is missing ${required}`);
  }
  return Object.freeze({
    schema: raw.schema, scope: Object.freeze({ ...raw.scope }),
    sharedSource: Object.freeze({ ...raw.sharedSource }),
    scenarios: Object.freeze(raw.scenarios.map(Object.freeze)),
  });
}

export function assessUserGroundedSocialScenario({ definition, sourceUrl, turns = [], capabilityInstalls = 0, review = {} } = {}) {
  const answers = turns.map((turn) => String(turn.answer ?? ''));
  const checks = {
    allTurnsAnswered: turns.length === definition.turns.length && answers.every((answer) => answer.trim()),
    noInternalTerms: answers.every((answer) => !INTERNAL_TERMS.test(answer)),
    sameSource: normalizeWebUrl(sourceUrl) === normalizeWebUrl(review.sourceUrl),
    expectedOutcome: review.outcomeType === definition.expectedOutcomeType,
    noCapabilityInstall: capabilityInstalls === 0,
    reviewEvidence: REVIEW_DIMENSIONS.every((dimension) => String(review.evidence?.[dimension] ?? '').trim()),
    ...Object.fromEntries(REVIEW_DIMENSIONS.map((dimension) => [dimension, review[dimension] === true])),
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}

export function assessUserGroundedSocialSuite(results = []) {
  const outcomeTypes = results.map((result) => result.review?.outcomeType).filter(Boolean);
  return {
    scenarioCount: results.length,
    sameSourceDifferentOutcomes: new Set(outcomeTypes).size === results.length,
    passed: results.length >= 3 && results.every((result) => result.verdict?.passed)
      && new Set(outcomeTypes).size === results.length,
  };
}

export const USER_GROUNDED_SOCIAL_REVIEW_DIMENSIONS = Object.freeze([...REVIEW_DIMENSIONS]);
