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
  constructor() {
    this.routes = new Map(); this.hands = new Map();
    this.runaway = { phase: 'idle' };
  }

  inspect(call) {
    const key = resourceRouteKey(call); const state = this.routes.get(key);
    const handState = this.hands.get(String(call?.name ?? ''));
    const reason = state?.effectUnknown ? 'unknown_effect_reexecution'
      : state?.verifiedNoProgress ? 'verified_no_progress_route'
        : handState?.globalUnavailable ? 'observed_hand_globally_unavailable' : null;
    if (!reason) return { action: 'execute', key };
    const owner = reason === 'observed_hand_globally_unavailable' ? handState : state;
    if ((owner.blockedNotices ?? 0) > 0) return { action: 'stop', key, reason };
    owner.blockedNotices = 1;
    return { action: 'block', key, reason };
  }

  observe(call, receipt, semantics = {}) {
    const key = resourceRouteKey(call); const prior = this.routes.get(key) ?? {
      lastOutcomeKey: null, verifiedNoProgress: false, effectUnknown: false, blockedNotices: 0,
    };
    if (semantics.pending === true) {
      this.routes.set(key, prior); return { key, state: 'pending_observed' };
    }
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
    if (semantics.globalUnavailable === true) {
      this.hands.set(String(call?.name ?? ''), { globalUnavailable: true, blockedNotices: 0 });
    }
    return { key, state: prior.verifiedNoProgress ? 'verified_no_progress' : 'outcome_observed' };
  }

  beginRunawayRecovery() {
    if (this.runaway.phase === 'idle') this.runaway = { phase: 'recovery_open' };
  }

  completeRunawayRecovery(progressStates = []) {
    if (this.runaway.phase !== 'recovery_open' || !progressStates.length) return;
    if (progressStates.some((state) => state === 'new' || state === 'pending')) {
      this.runaway = { phase: 'idle' }; return;
    }
    this.runaway = { phase: 'final_model_decision' };
  }

  inspectRun(toolCalls = []) {
    if (!toolCalls.length) { this.runaway = { phase: 'idle' }; return { action: 'settle' }; }
    if (this.runaway.phase === 'final_model_decision') {
      this.runaway = { phase: 'tools_blocked' };
      return { action: 'block', reason: 'verified_runaway_after_model_recovery' };
    }
    if (this.runaway.phase === 'tools_blocked') {
      return { action: 'stop', reason: 'verified_runaway_after_model_recovery' };
    }
    return { action: 'execute' };
  }

  situation() {
    if (this.runaway.phase !== 'final_model_decision' && this.runaway.phase !== 'tools_blocked') return null;
    return {
      active: true, state: this.runaway.phase,
      fact: 'model_selected_recovery_produced_no_new_evidence',
      additionalToolExecution: 'not_available',
    };
  }
}
