import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function approvalBody(entry) {
  return compact({
    kind: 'automation_settlement', operation: entry.operation,
    principalRef: entry.principalRef,
    candidateRef: entry.candidateRef, candidateRevision: entry.candidateRevision,
    controlRef: entry.controlRef,
    jobRef: entry.jobRef, jobRevision: entry.jobRevision,
    state: entry.state, trigger: structuredClone(entry.trigger), nextRunAt: entry.nextRunAt,
    skillRef: structuredClone(entry.skillRef), agentProfileId: entry.agentProfileId,
    authorityEnvelope: structuredClone(entry.authorityEnvelope),
    deliveryPolicy: structuredClone(entry.deliveryPolicy), observedAt: entry.observedAt,
    tool: entry.tool, actionArgs: structuredClone(entry.actionArgs ?? {}),
    skillPurpose: entry.skillPurpose, deliveryIntent: entry.deliveryIntent,
    previousSettlementRef: entry.previousSettlementRef,
    previousSettlementDigest: entry.previousSettlementDigest,
    verificationPassed: entry.verificationPassed,
  });
}

function controlBody(entry) {
  return compact({
    kind: 'automation_control_settlement', operation: entry.operation,
    principalRef: entry.principalRef,
    jobRef: entry.jobRef, jobRevision: entry.jobRevision,
    state: entry.state, trigger: structuredClone(entry.trigger), nextRunAt: entry.nextRunAt,
    observedAt: entry.observedAt, ordinal: entry.ordinal,
    mutated: entry.mutated, verificationPassed: entry.verificationPassed,
    previousSettlementRef: entry.previousSettlementRef,
    previousSettlementDigest: entry.previousSettlementDigest,
  });
}

export function automationSettlementBody(entry) {
  if (entry?.kind === 'automation_settlement'
    && ['create', 'update'].includes(entry.operation)) return approvalBody(entry);
  if (entry?.kind === 'automation_control_settlement'
    && ['pause', 'resume', 'status'].includes(entry.operation)) return controlBody(entry);
  throw new Error('automation settlement kind or operation is invalid');
}

export function sealAutomationSettlement(entry) {
  const body = automationSettlementBody(entry);
  if (body.verificationPassed !== true) throw new Error('automation settlement must be verified');
  const settlementRef = sha256(body);
  const settlementDigest = sha256({ ...body, settlementRef });
  return { ...body, settlementRef, settlementDigest };
}

export function verifyAutomationSettlement(entry) {
  try {
    return isDeepStrictEqual(entry, sealAutomationSettlement(entry));
  } catch {
    return false;
  }
}

export function assertAutomationSettlementState(state) {
  const settlements = state.settlements ?? [];
  if (!Array.isArray(settlements)) throw new Error('automation settlements must be an array');
  const byRef = new Map();
  for (const entry of settlements) {
    if (!verifyAutomationSettlement(entry)) throw new Error('automation settlement digest mismatch');
    if (byRef.has(entry.settlementRef)) throw new Error('automation settlement ref duplicated');
    byRef.set(entry.settlementRef, entry);
  }
  const jobs = new Map((state.jobs ?? []).map((job) => [job.id, job]));
  const candidates = new Map((state.candidates ?? []).map((entry) => [entry.candidateId, entry]));
  settlements.forEach((entry, index) => {
    const job = jobs.get(entry.jobRef);
    if (!job || entry.principalRef !== job.principalRef) {
      throw new Error('automation settlement job or principal linkage mismatch');
    }
    const hasPreviousRef = typeof entry.previousSettlementRef === 'string';
    const hasPreviousDigest = typeof entry.previousSettlementDigest === 'string';
    if (hasPreviousRef !== hasPreviousDigest) {
      throw new Error('automation settlement previous linkage is partial');
    }
    if (hasPreviousRef) {
      const previous = byRef.get(entry.previousSettlementRef);
      if (!previous || previous.settlementDigest !== entry.previousSettlementDigest
        || previous.jobRef !== entry.jobRef || previous.principalRef !== entry.principalRef
        || settlements.indexOf(previous) >= index) {
        throw new Error('automation settlement previous linkage mismatch');
      }
    } else {
      const legacyControlRoot = entry.kind === 'automation_control_settlement'
        && !job.settlementRef && !job.settlementDigest && !job.candidateLineage;
      if (!legacyControlRoot
        && (entry.kind !== 'automation_settlement' || entry.operation !== 'create')) {
        throw new Error('automation settlement chain root must be create or legacy control');
      }
    }
    if (entry.kind === 'automation_settlement') {
      const candidate = candidates.get(entry.candidateRef);
      if (!candidate || candidate.approved !== true || candidate.jobRef !== job.id
        || candidate.revision !== entry.candidateRevision
        || candidate.principalRef !== entry.principalRef
        || candidate.settlementRef !== entry.settlementRef
        || candidate.settlementDigest !== entry.settlementDigest) {
        throw new Error('automation approval settlement is unanchored');
      }
    } else if (entry.ordinal !== index || entry.jobRevision > (job.jobRevision ?? 0)) {
      throw new Error('automation control settlement history mismatch');
    }
  });
  const reachable = new Set();
  for (const job of state.jobs ?? []) {
    const approvalLinkage = [job.settlementRef, job.settlementDigest, job.candidateLineage];
    const latestLinkage = [job.latestSettlementRef, job.latestSettlementDigest];
    const approvalCount = approvalLinkage.filter((value) => value !== undefined && value !== null).length;
    const latestCount = latestLinkage.filter((value) => value !== undefined && value !== null).length;
    if (approvalCount === 0 && latestCount === 0) {
      if (settlements.some((entry) => entry.jobRef === job.id)) {
        throw new Error('automation legacy job cannot own settlement history');
      }
      continue;
    }
    if (!((approvalCount === 0 || approvalCount === approvalLinkage.length)
      && latestCount === latestLinkage.length)) {
      throw new Error('automation job settlement linkage is partial');
    }
    if (approvalCount === approvalLinkage.length) {
      const entry = byRef.get(job.settlementRef);
      if (!entry || entry.kind !== 'automation_settlement'
        || entry.jobRef !== job.id || entry.principalRef !== job.principalRef
        || entry.settlementDigest !== job.settlementDigest
        || entry.candidateRef !== job.candidateLineage?.candidateRef
        || entry.candidateRevision !== job.candidateLineage?.candidateRevision
        || (entry.controlRef ?? null) !== (job.candidateLineage?.controlRef ?? null)) {
        throw new Error('automation job settlement linkage mismatch');
      }
    }
    let ref = job.latestSettlementRef;
    let digest = job.latestSettlementDigest;
    let root = null;
    const jobChain = new Set();
    while (ref) {
      if (jobChain.has(ref) || reachable.has(ref)) {
        throw new Error('automation settlement chain duplicated or cyclic');
      }
      const entry = byRef.get(ref);
      if (!entry || entry.jobRef !== job.id || entry.principalRef !== job.principalRef
        || entry.settlementDigest !== digest) {
        throw new Error('automation job latest settlement linkage mismatch');
      }
      jobChain.add(ref);
      reachable.add(ref);
      root = entry;
      ref = entry.previousSettlementRef ?? null;
      digest = entry.previousSettlementDigest ?? null;
    }
    const expectedRootRef = approvalCount === approvalLinkage.length ? job.settlementRef : null;
    const expectedRootDigest = approvalCount === approvalLinkage.length ? job.settlementDigest : null;
    if ((expectedRootRef && (root?.settlementRef !== expectedRootRef
      || root?.settlementDigest !== expectedRootDigest))
      || (!expectedRootRef && (root?.kind !== 'automation_control_settlement'
        || root?.previousSettlementRef || root?.previousSettlementDigest))) {
      throw new Error('automation settlement chain does not reach job root');
    }
    if (job.lastControlSettlement) {
      const entry = byRef.get(job.lastControlSettlement.settlementRef);
      if (!entry || entry.kind !== 'automation_control_settlement'
        || entry.jobRef !== job.id || !isDeepStrictEqual(entry, job.lastControlSettlement)) {
        throw new Error('automation job control settlement linkage mismatch');
      }
    }
  }
  if (reachable.size !== settlements.length) {
    throw new Error('automation settlement history contains an orphan or branch');
  }
  for (const candidate of state.candidates ?? []) {
    if (candidate.approved !== true) continue;
    const linkage = [candidate.jobRef, candidate.settlementRef, candidate.settlementDigest];
    const linkageCount = linkage.filter((value) => value !== undefined && value !== null).length;
    if (linkageCount === 0) continue;
    if (linkageCount !== linkage.length) {
      throw new Error('automation candidate settlement linkage is partial');
    }
    const job = jobs.get(candidate.jobRef);
    const entry = byRef.get(candidate.settlementRef);
    if (!job || !entry || entry.kind !== 'automation_settlement'
      || entry.jobRef !== job.id || entry.candidateRef !== candidate.candidateId
      || entry.candidateRevision !== candidate.revision
      || entry.principalRef !== candidate.principalRef
      || entry.principalRef !== job.principalRef
      || (entry.controlRef ?? null) !== (candidate.controlRef ?? null)
      || entry.settlementDigest !== candidate.settlementDigest) {
      throw new Error('automation candidate settlement linkage mismatch');
    }
  }
  return true;
}

export function linkedApprovalSettlement(state, jobRef) {
  const candidates = new Map((state.candidates ?? [])
    .filter((entry) => entry.approved === true && entry.jobRef === jobRef)
    .map((entry) => [entry.settlementRef, entry]));
  return (state.settlements ?? []).findLast((entry) => {
    const candidate = candidates.get(entry.settlementRef);
    return entry.kind === 'automation_settlement' && verifyAutomationSettlement(entry)
      && candidate && candidate.candidateId === entry.candidateRef
      && candidate.revision === entry.candidateRevision
      && candidate.principalRef === entry.principalRef
      && candidate.settlementDigest === entry.settlementDigest;
  }) ?? null;
}

export function linkedLatestSettlement(state, job) {
  const ref = job?.latestSettlementRef ?? job?.settlementRef;
  const digest = job?.latestSettlementDigest ?? job?.settlementDigest;
  if (!ref || !digest) return null;
  return (state.settlements ?? []).find((entry) => entry.settlementRef === ref
    && entry.settlementDigest === digest && entry.jobRef === job.id
    && entry.principalRef === job.principalRef && verifyAutomationSettlement(entry)) ?? null;
}
