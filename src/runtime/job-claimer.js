import {
  claimAgentRun,
  validateAgentRun,
} from '../kernel/l5-growth/automation-contracts.js';
import { applyAutomationJobPatch } from '../kernel/l5-growth/automation.js';

function assertQueuedRun(run) {
  const checked = validateAgentRun(run);
  if (!checked.ok) throw new TypeError(`queued agent run invalid: ${checked.errors.join('; ')}`);
  if (run.status !== 'queued') throw new TypeError('only a queued agent run can be claimed');
}

function assertOwner(owner) {
  if (!(Number.isInteger(owner?.pid) && owner.pid > 0
    && typeof owner.ownerToken === 'string' && owner.ownerToken.length > 0)) {
    throw new TypeError('claim owner requires pid and ownerToken');
  }
}

function assertCommittedRecord(result, occurrenceKey) {
  if (!result?.record) return;
  const checked = validateAgentRun(result.record);
  if (!checked.ok) throw new Error(`claim adapter returned an invalid run: ${checked.errors.join('; ')}`);
  if (result.record.idempotencyKey !== occurrenceKey) {
    throw new Error('claim adapter returned a different occurrence');
  }
}

async function existingOccurrence(runLedger, occurrenceKey) {
  const loaded = await runLedger.load();
  if (loaded.recovery) throw new Error('automation run ledger requires recovery before claim');
  return loaded.runs.find((run) => run.idempotencyKey === occurrenceKey) ?? null;
}

/** Commit a prepared claim through the canonical persistent run ledger. */
export async function commitClaimToRunLedger(runLedger, delta) {
  if (typeof runLedger?.append !== 'function' || typeof runLedger?.load !== 'function') {
    throw new TypeError('runLedger must provide append and load');
  }

  try {
    await runLedger.append(delta.queuedRecord);
  } catch (error) {
    const existing = await existingOccurrence(runLedger, delta.occurrenceKey);
    if (existing) {
      return { ok: true, claimed: false, duplicate: true, record: existing };
    }
    return { ok: false, claimed: false, duplicate: false, reason: 'queue_failed', error };
  }

  try {
    const committed = await runLedger.append(delta.record);
    return { ok: true, claimed: true, duplicate: false, record: committed.record };
  } catch (error) {
    const existing = await existingOccurrence(runLedger, delta.occurrenceKey);
    if (existing && existing.status !== 'queued') {
      return { ok: true, claimed: false, duplicate: true, record: existing };
    }
    return { ok: false, claimed: false, duplicate: false, reason: 'claim_failed', error };
  }
}

/**
 * Build the compare-and-set command consumed by the parent-owned run ledger.
 * The ledger must serialize the queued insert and the queued-to-claimed CAS,
 * or return the already-persisted occurrence. The job guard is carried for the
 * parent integration lock; this worker does not rewrite AutomationJobStore.
 */
export function prepareRunClaim(run, { owner, now, jobGuard }) {
  assertQueuedRun(run);
  assertOwner(owner);
  if (!Number.isFinite(now)) throw new TypeError('claim time must be finite');
  if (!jobGuard || jobGuard.jobId !== run.jobId) throw new TypeError('claim requires a matching job guard');

  const claimed = claimAgentRun(structuredClone(run), owner, now);
  if (!claimed.ok) throw new Error(`agent run claim invalid: ${claimed.reason}`);

  return {
    kind: 'agent_run.claim_occurrence',
    occurrenceKey: run.idempotencyKey,
    runId: run.id,
    expected: {
      runStatus: 'absent_or_queued',
      job: structuredClone(jobGuard),
    },
    queuedRecord: structuredClone(run),
    record: claimed.record,
  };
}

export class JobClaimer {
  constructor({ owner, runLedger, jobStore = null, clock = Date.now }) {
    assertOwner(owner);
    if (typeof runLedger?.append !== 'function' || typeof runLedger?.load !== 'function') {
      throw new TypeError('runLedger with append and load is required');
    }
    this.owner = { pid: owner.pid, ownerToken: owner.ownerToken };
    this.runLedger = runLedger;
    this.jobStore = jobStore;
    this.clock = clock;
  }

  async claim(run, { jobGuard, jobDelta, now = this.clock() } = {}) {
    const delta = prepareRunClaim(run, { owner: this.owner, now, jobGuard });
    let result;
    if (this.jobStore) {
      if (typeof this.jobStore.update !== 'function') {
        throw new TypeError('jobStore must provide canonical update');
      }
      await this.jobStore.update(async (state) => {
        const current = (state.jobs ?? []).find((job) => job.id === jobGuard.jobId);
        const guardMatches = current
          && current.state === jobGuard.state
          && current.updatedAt === jobGuard.updatedAt
          && current.nextRunAt === jobGuard.nextRunAt
          && current.trigger?.nextRunAt === jobGuard.triggerNextRunAt;
        if (!guardMatches) {
          result = { ok: false, claimed: false, duplicate: false, reason: 'job_guard_changed' };
          return state;
        }
        const committed = await commitClaimToRunLedger(this.runLedger, delta);
        if (!committed?.ok) { result = committed; return state; }
        const applied = applyAutomationJobPatch(state, jobDelta);
        if (!applied.ok) {
          result = { ok: false, claimed: false, duplicate: false, reason: applied.reason };
          return state;
        }
        result = { ...committed, jobApplied: true };
        return applied.state;
      });
    } else {
      result = await commitClaimToRunLedger(this.runLedger, delta);
    }
    if (!result || result.ok !== true) {
      return {
        ok: false,
        claimed: false,
        duplicate: false,
        reason: result?.reason ?? 'claim_failed',
        delta,
      };
    }
    if (result.claimed === result.duplicate) {
      throw new Error('claim adapter must report exactly one of claimed or duplicate');
    }
    assertCommittedRecord(result, delta.occurrenceKey);
    return {
      ok: true,
      claimed: result.claimed === true,
      duplicate: result.duplicate === true,
      record: result.record,
      delta,
      jobApplied: result.jobApplied === true,
    };
  }
}
