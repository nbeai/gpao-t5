import { createHash } from 'node:crypto';
import { effectUnknown } from './resource-optimization.js';

const VOLATILE = new Set([
  'toolCallId', 'messageId', 'runId', 'receiptId', 'idempotencyKey', 'timestamp',
  'recordedAt', 'createdAt', 'updatedAt', 'startedAt', 'endedAt', 'durationMs', 'wallMs',
]);

function update(hash, value) {
  if (value === null || value === undefined) { hash.update(`${value};`); return; }
  if (Array.isArray(value)) {
    hash.update('['); for (const item of value) update(hash, item); hash.update(']'); return;
  }
  if (typeof value === 'object') {
    hash.update('{');
    for (const key of Object.keys(value).filter((item) => !VOLATILE.has(item)).sort()) {
      hash.update(key); update(hash, value[key]);
    }
    hash.update('}'); return;
  }
  hash.update(`${typeof value}:${String(value)};`);
}

function digest(value) { const hash = createHash('sha256'); update(hash, value); return hash.digest('hex'); }

export function resourceRouteKey(call) {
  return digest({ name: String(call?.name ?? ''), args: call?.args ?? {} });
}

export function resourceOutcomeKey(receipt) {
  if (!receipt) return null;
  return digest({ outcome: receipt.outcome ?? null, result: receipt.result ?? null });
}

/**
 * Run-scoped last-resort control. It never chooses another route. A route becomes eligible
 * only after the same exact call has produced the same stable outcome twice, or after an
 * effect-unknown result makes the same exact write unsafe to repeat.
 */
export class ResourceIntervention {
  constructor() { this.routes = new Map(); this.tools = new Map(); }

  inspect(call) {
    const key = resourceRouteKey(call); const state = this.routes.get(key);
    const toolState = this.tools.get(String(call?.name ?? ''));
    const reason = state?.effectUnknown ? 'unknown_effect_reexecution'
      : state?.verifiedNoProgress ? 'verified_no_progress_route'
        : toolState?.verifiedFailure ? 'verified_tool_failure' : null;
    if (!reason) return { action: 'execute', key };
    const owner = reason === 'verified_tool_failure' ? toolState : state;
    if ((owner.blockedNotices ?? 0) > 0) return { action: 'stop', key, reason };
    owner.blockedNotices = 1;
    return { action: 'block', key, reason };
  }

  observe(call, receipt) {
    const key = resourceRouteKey(call); const prior = this.routes.get(key) ?? {
      lastOutcomeKey: null, verifiedNoProgress: false, effectUnknown: false, blockedNotices: 0,
    };
    if (effectUnknown(receipt)) {
      prior.effectUnknown = true; this.routes.set(key, prior);
      return { key, state: 'unknown_effect_observed' };
    }
    const outcomeKey = resourceOutcomeKey(receipt);
    if (outcomeKey && prior.lastOutcomeKey === outcomeKey) prior.verifiedNoProgress = true;
    else if (outcomeKey) {
      prior.lastOutcomeKey = outcomeKey; prior.verifiedNoProgress = false; prior.blockedNotices = 0;
    }
    this.routes.set(key, prior);
    const toolName = String(call?.name ?? '');
    const toolState = this.tools.get(toolName) ?? {
      lastFailureKey: null, verifiedFailure: false, blockedNotices: 0,
    };
    if (receipt?.outcome === 'failed' || receipt?.outcome === 'unavailable') {
      if (outcomeKey && toolState.lastFailureKey === outcomeKey) toolState.verifiedFailure = true;
      else {
        toolState.lastFailureKey = outcomeKey; toolState.verifiedFailure = false;
        toolState.blockedNotices = 0;
      }
    } else if (receipt?.outcome === 'succeeded') {
      toolState.lastFailureKey = null; toolState.verifiedFailure = false; toolState.blockedNotices = 0;
    }
    this.tools.set(toolName, toolState);
    return { key, state: prior.verifiedNoProgress ? 'verified_no_progress' : 'outcome_observed' };
  }
}
