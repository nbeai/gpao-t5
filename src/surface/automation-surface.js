import { containsSensitiveValue } from '../kernel/l0-evidence/sensitive-text.js';

const ACTIVE_AUTOMATION_STATES = new Set(['scheduled', 'paused', 'needs_review']);

export function automationEntryVisible(entry) {
  return ![entry?.statement, entry?.name]
    .filter((value) => typeof value === 'string')
    .some((value) => containsSensitiveValue(value));
}

export function projectAutomations(jobs = []) {
  return {
    active: jobs
      .filter((job) => ACTIVE_AUTOMATION_STATES.has(job.state) && automationEntryVisible(job))
      .map((job) => ({ id: job.id, label: job.name, state: job.state })),
  };
}

export function projectAgents(profiles = []) {
  return {
    active: profiles
      .filter((profile) => profile.state === 'active')
      .map((profile) => ({ id: profile.id, label: profile.name })),
  };
}

export function projectAutomationRun(run) {
  const projected = {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    scheduledFor: run.scheduledFor,
    finishedAt: run.finishedAt,
  };
  if (run.status !== 'failed' && run.status !== 'unknown') return projected;
  return {
    ...projected,
    userSafeSummary: run.status === 'unknown'
      ? '이전 실행의 마지막 상태를 확인하지 못했어요.'
      : '자동화 실행을 마치지 못했어요.',
    nextSafeAction: '원래 작업과 필요한 연결을 확인한 뒤 다시 시도해 주세요.',
  };
}

/** Same-principal, bounded projection of canonical automation stores. */
export function projectAutomationReality({ candidates = [], jobs = [], runs = [] }, {
  principalRef, now, limit = 20,
} = {}) {
  if (typeof principalRef !== 'string' || !principalRef.trim()) {
    const unknown = { observed: false, total: null, truncated: null, items: [] };
    return {
      observedAt: now, principalBound: false, availability: 'unknown',
      candidates: structuredClone(unknown), jobs: structuredClone(unknown),
      recentRuns: structuredClone(unknown),
    };
  }
  const owns = (entry) => entry?.principalRef === principalRef;
  const currentCandidates = candidates.filter((entry) => owns(entry)
    && automationEntryVisible(entry)
    && entry.approved !== true && entry.current !== false && entry.superseded !== true
    && (!Number.isFinite(entry.expiresAt) || entry.expiresAt >= now));
  const ownedJobs = jobs.filter((entry) => owns(entry) && automationEntryVisible(entry));
  const jobIds = new Set(ownedJobs.map((job) => job.id));
  const ownedRuns = runs.filter((run) => jobIds.has(run.jobId));
  const bounded = (all, project) => ({
    total: all.length,
    truncated: all.length > limit,
    items: all.slice(0, limit).map(project),
  });
  return {
    observedAt: now,
    principalBound: true,
    candidates: bounded(currentCandidates, (entry) => ({
      candidateRef: entry.candidateId,
      revision: entry.revision,
      operation: entry.operation,
      ...(entry.targetJobRef ? { targetJobRef: entry.targetJobRef } : {}),
      statement: entry.statement,
      trigger: entry.trigger,
      current: true,
      expiresAt: entry.expiresAt,
    })),
    jobs: bounded(ownedJobs, (job) => ({
      jobRef: job.id,
      revision: job.updatedAt,
      name: job.name,
      state: job.state,
      jobRevision: job.jobRevision,
      settlementRef: job.settlementRef,
      settlementDigest: job.settlementDigest,
      candidateLineage: job.candidateLineage,
      lastControlSettlement: job.lastControlSettlement,
      trigger: job.trigger,
      nextRunAt: job.nextRunAt,
    })),
    recentRuns: bounded(ownedRuns.slice().sort((a, b) => (b.updatedAt ?? b.finishedAt ?? 0)
      - (a.updatedAt ?? a.finishedAt ?? 0)), projectAutomationRun),
  };
}
