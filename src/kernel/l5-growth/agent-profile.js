import {
  AUTOMATION_SCHEMA_VERSION,
  transitionState,
  validateAgentProfile,
} from './automation-contracts.js';

export const AGENT_BUDGET_KEYS = Object.freeze([
  'maxToolCalls',
  'timeoutMs',
  'maxCost',
  'maxConcurrency',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}

export function validateAgentBudgets(value) {
  const budgets = value ?? {};
  const errors = [];
  if (!object(budgets)) errors.push('agent budgets must be an object');
  if (!(Number.isInteger(budgets.maxToolCalls) && budgets.maxToolCalls > 0)) {
    errors.push('maxToolCalls must be a positive integer');
  }
  if (!(Number.isFinite(budgets.timeoutMs) && budgets.timeoutMs > 0)) {
    errors.push('timeoutMs must be a positive finite number');
  }
  if (!(Number.isFinite(budgets.maxCost) && budgets.maxCost >= 0)) {
    errors.push('maxCost must be a non-negative finite number');
  }
  if (!(Number.isInteger(budgets.maxConcurrency) && budgets.maxConcurrency > 0)) {
    errors.push('maxConcurrency must be a positive integer');
  }
  return result(errors);
}

export function validateBoundedAgentProfile(profile) {
  const common = validateAgentProfile(profile);
  const budgets = validateAgentBudgets(profile?.defaultBudgets);
  return result([
    ...common.errors,
    ...budgets.errors.map((error) => `defaultBudgets: ${error}`),
  ]);
}

function assertBounded(profile, label) {
  const checked = validateBoundedAgentProfile(profile);
  if (!checked.ok) throw new Error(`${label} invalid: ${checked.errors.join('; ')}`);
  return profile;
}

function mutableFields(input) {
  return {
    name: input?.name,
    purpose: input?.purpose,
    modelRole: input?.modelRole,
    toolAllowlist: Array.isArray(input?.toolAllowlist) ? [...input.toolAllowlist] : input?.toolAllowlist,
    workspaceScope: Array.isArray(input?.workspaceScope) ? [...input.workspaceScope] : input?.workspaceScope,
    defaultBudgets: object(input?.defaultBudgets) ? { ...input.defaultBudgets } : input?.defaultBudgets,
    authorityCeiling: input?.authorityCeiling,
  };
}

export function proposeAgentProfile(input, now) {
  const profile = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: input?.id,
    ...mutableFields(input),
    state: 'proposed',
    createdAt: now,
    updatedAt: now,
  };
  return assertBounded(profile, 'agent profile proposal');
}

export function reviseAgentProfile(profile, patch, now) {
  assertBounded(profile, 'agent profile');
  const revised = {
    ...profile,
    ...mutableFields({ ...profile, ...patch }),
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: profile.id,
    state: 'proposed',
    createdAt: profile.createdAt,
    updatedAt: now,
  };
  return assertBounded(revised, 'agent profile revision');
}

export function transitionAgentProfile(profile, nextState, now) {
  const checked = validateBoundedAgentProfile(profile);
  if (!checked.ok) {
    return { ok: false, record: profile, reason: 'invalid_profile', errors: checked.errors };
  }
  const moved = transitionState('agentProfile', profile, nextState, now);
  if (!moved.ok) return moved;
  const next = validateBoundedAgentProfile(moved.record);
  if (!next.ok) {
    return { ok: false, record: profile, reason: 'invalid_profile', errors: next.errors };
  }
  return moved;
}

export function canStartAgentRun(profile) {
  return profile?.state === 'active' && validateBoundedAgentProfile(profile).ok;
}
