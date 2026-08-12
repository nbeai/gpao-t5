import {
  authorityWithin,
  contentHash,
  validateAgentRun,
  validateSkillDefinition,
} from './automation-contracts.js';
import { validateSkillReplayCases } from './skill-closure.js';
import {
  judgeSuite,
  makeReplayCase,
  outputDigestOf,
  verifyCallIdentity,
  verifyReplayEvidence,
} from './tcell-replay.js';
import { AUTO_SAFE_KINDS, decideAutoGrant } from '../l2-plan/authority.js';
import { toolActionKind } from '../l2-plan/action-plan.js';
import {
  computeReplayVerdict,
  parseReplayJudgement,
} from './replay-verdict.js';

function replayEnvelope(skill) {
  return {
    ceiling: 'A0',
    allowedKinds: [...AUTO_SAFE_KINDS.always],
    allowedTools: [...new Set(skill.requiredCapabilities)].sort(),
    allowedTargets: [],
    workspaceRoots: [],
    expiresAt: null,
    maxRuns: 1,
    maxCost: 0,
    requiresFreshApprovalFor: [],
  };
}

function canonicalCase(skill, replayCase) {
  return makeReplayCase({
    caseId: replayCase.id,
    principleId: skill.id,
    principleVersion: skill.version,
    kind: replayCase.kind,
    sourceRefs: replayCase.sourceRefs ?? [],
    inputFacts: replayCase.inputFacts,
    expectedFacts: replayCase.expectedFacts,
    forbiddenFacts: replayCase.forbiddenFacts,
    allowedFacts: replayCase.allowedFacts,
    exactFacts: replayCase.exactFacts,
  });
}

export function makeSkillReplayRequest(skill, replayCase) {
  return {
    kind: 'skill_replay',
    skillSnapshot: structuredClone(skill),
    replayCase: canonicalCase(skill, replayCase),
    authorityEnvelope: replayEnvelope(skill),
    maxExternalEffects: 0,
    deliveryPolicy: { mode: 'none' },
  };
}

function runEvidence(run, runId, request, selfState) {
  const checked = validateAgentRun(run);
  if (!checked.ok) return { ok: false, reason: 'agent_run_invalid', errors: checked.errors };
  if (run.id !== runId) return { ok: false, reason: 'agent_run_id_mismatch' };
  if (run.status !== 'succeeded') return { ok: false, reason: 'agent_run_not_succeeded' };
  if (run.skillSnapshot?.id !== request.skillSnapshot.id
    || run.skillSnapshot?.version !== request.skillSnapshot.version
    || run.skillSnapshot?.contentHash !== request.skillSnapshot.contentHash) {
    return { ok: false, reason: 'agent_run_skill_snapshot_mismatch' };
  }
  if (run.authorityEnvelope?.ceiling !== 'A0') {
    return { ok: false, reason: 'replay_authority_not_a0' };
  }
  if (!authorityWithin(request.authorityEnvelope, run.authorityEnvelope)) {
    return { ok: false, reason: 'replay_authority_widened' };
  }
  if (run.result?.externalEffects !== 0) {
    return { ok: false, reason: 'external_effects_not_zero' };
  }
  if (run.deliveryState?.status !== 'not_requested') {
    return { ok: false, reason: 'replay_delivery_not_none' };
  }
  if (run.result?.caseInputDigest !== request.replayCase.caseInputDigest) {
    return { ok: false, reason: 'agent_run_case_digest_mismatch' };
  }
  if (typeof run.result?.replayReceiptRef !== 'string' || !run.result.replayReceiptRef) {
    return { ok: false, reason: 'run_receipt_ref_missing' };
  }

  for (const receipt of run.receipts) {
    if (!receipt?.actualCall) continue;
    const tool = receipt.actualCall.tool;
    const kind = toolActionKind({ toolId: tool, args: receipt.actualCall.args, selfState });
    if (!(run.authorityEnvelope.allowedTools ?? []).includes(tool)
      || !run.authorityEnvelope.allowedKinds.includes(kind)
      || !AUTO_SAFE_KINDS.always.includes(kind)
      || !decideAutoGrant({ kind })) {
      return { ok: false, reason: 'tool_call_outside_replay_envelope' };
    }
  }
  return { ok: true, replayReceiptRef: run.result.replayReceiptRef };
}

function storedVerdict(output, replayCase, receipt) {
  try {
    const parsed = JSON.parse(output);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.answer !== 'string') {
      return { ok: false, reason: 'replay_output_invalid' };
    }
    const judgeIdentity = verifyCallIdentity(receipt?.judgeModelCallIdentity);
    if (!judgeIdentity.ok) return { ok: false, reason: judgeIdentity.reason };
    const judgement = parseReplayJudgement(parsed.judgement);
    const verdict = computeReplayVerdict(replayCase, parsed.answer, judgement);
    if (!verdict) return { ok: false, reason: 'replay_judgement_undecidable' };
    return {
      ok: true,
      // Item evidence and rationale stay in the bound replay output. The lifecycle record
      // needs only the computed fact, and must not duplicate potentially sensitive text.
      verdict: { pass: verdict.pass },
    };
  } catch {
    return { ok: false, reason: 'replay_output_invalid' };
  }
}

function failedCase(replayCase, reason, extra = {}) {
  return {
    id: replayCase.caseId,
    kind: replayCase.kind,
    caseInputDigest: replayCase.caseInputDigest,
    evidenceOk: false,
    evidenceReason: reason,
    verdict: null,
    ...extra,
  };
}

function replayDigestSource(skill, cases) {
  return {
    skillVersion: skill.version,
    skillHash: skill.contentHash,
    cases: cases.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      caseInputDigest: entry.caseInputDigest,
      outputDigest: entry.outputDigest ?? null,
      evidenceOk: entry.evidenceOk,
      evidenceReason: entry.evidenceReason ?? null,
      verdict: entry.verdict,
    })),
  };
}

function sameVerdict(left, right) {
  try {
    return left !== undefined && right !== undefined && contentHash(left) === contentHash(right);
  } catch {
    return false;
  }
}

export async function verifyStoredSkillReplay(skill, replay, options = {}) {
  const checked = validateSkillDefinition(skill);
  if (!checked.ok) return { ok: false, reason: 'invalid_skill', errors: checked.errors };
  const suiteContract = validateSkillReplayCases(skill.replayCases);
  if (!suiteContract.ok || skill.steps.length === 0) {
    return {
      ok: false,
      reason: 'invalid_replay_suite',
      errors: [...suiteContract.errors, ...(skill.steps.length ? [] : ['skill steps must not be empty'])],
    };
  }
  if (replay?.ok !== true
    || replay.skillVersion !== skill.version
    || replay.skillHash !== skill.contentHash) {
    return { ok: false, reason: 'replay_skill_binding_mismatch' };
  }
  if (typeof options.evidenceStore?.get !== 'function'
    || typeof options.evidenceStore?.output !== 'function') {
    return { ok: false, reason: 'evidence_store_required' };
  }
  if (!Array.isArray(replay.cases) || replay.cases.length !== skill.replayCases.length) {
    return { ok: false, reason: 'replay_case_set_mismatch' };
  }
  const byId = new Map();
  for (const record of replay.cases) {
    if (typeof record?.id !== 'string' || byId.has(record.id)) {
      return { ok: false, reason: 'replay_case_set_mismatch' };
    }
    byId.set(record.id, record);
  }

  const verified = [];
  for (const replayCase of skill.replayCases) {
    const expected = canonicalCase(skill, replayCase);
    const record = byId.get(expected.caseId);
    if (!record
      || record.kind !== expected.kind
      || record.caseInputDigest !== expected.caseInputDigest
      || record.evidenceOk !== true
      || typeof record.runReceiptRef !== 'string'
      || !record.runReceiptRef) {
      return { ok: false, reason: 'replay_case_binding_mismatch' };
    }
    const bound = { ...expected, runReceiptRef: record.runReceiptRef };
    const evidenceStore = {
      get: (id) => options.evidenceStore.get(id),
      output: (id) => options.evidenceStore.output(id),
    };
    const receipt = await evidenceStore.get(record.runReceiptRef);
    const output = await evidenceStore.output(record.runReceiptRef);
    const evidence = verifyReplayEvidence(bound, {
      store: { get: () => receipt, output: () => output },
    });
    if (!evidence.ok) return { ok: false, reason: evidence.reason };
    if (typeof output !== 'string'
      || !receipt
      || receipt.outputDigest !== outputDigestOf(output)) {
      return { ok: false, reason: 'output_mismatch' };
    }
    const verdict = storedVerdict(output, expected, receipt);
    if (!verdict.ok) return verdict;
    if (record.outputDigest !== receipt.outputDigest
      || !sameVerdict(record.verdict, verdict.verdict)) {
      return { ok: false, reason: 'replay_result_digest_mismatch' };
    }
    verified.push({
      id: expected.caseId,
      kind: expected.kind,
      caseInputDigest: expected.caseInputDigest,
      outputDigest: receipt.outputDigest,
      evidenceOk: true,
      verdict: verdict.verdict,
    });
  }
  const suite = judgeSuite(verified, { touchesAuthority: true });
  if (!suite.pass) return { ok: false, reason: 'replay_failed', errors: suite.missing };
  const replayDigest = contentHash(replayDigestSource(skill, verified));
  if (replay.replayDigest !== replayDigest) {
    return { ok: false, reason: 'replay_digest_mismatch' };
  }
  return { ok: true, replayDigest };
}

export async function runSkillReplay(skill, options = {}) {
  const checked = validateSkillDefinition(skill);
  if (!checked.ok) return { ok: false, reason: 'invalid_skill', errors: checked.errors };
  const suiteContract = validateSkillReplayCases(skill.replayCases);
  if (!suiteContract.ok || skill.steps.length === 0) {
    return {
      ok: false,
      reason: 'invalid_replay_suite',
      errors: [...suiteContract.errors, ...(skill.steps.length ? [] : ['skill steps must not be empty'])],
    };
  }
  if (typeof options.agentRunner?.run !== 'function'
    || typeof options.agentRunner?.get !== 'function') {
    return { ok: false, reason: 'agent_runner_required', errors: ['shared AgentRun runner is required'] };
  }
  if (typeof options.evidenceStore?.get !== 'function'
    || typeof options.evidenceStore?.output !== 'function') {
    return { ok: false, reason: 'evidence_store_required', errors: ['stored replay evidence is required'] };
  }

  const cases = [];
  for (const replayCase of skill.replayCases) {
    const request = makeSkillReplayRequest(skill, replayCase);
    let launch;
    try {
      launch = await options.agentRunner.run(structuredClone(request));
    } catch {
      cases.push(failedCase(request.replayCase, 'agent_run_failed'));
      continue;
    }
    const runId = typeof launch?.runId === 'string' ? launch.runId : null;
    if (!runId) {
      cases.push(failedCase(request.replayCase, 'agent_run_id_missing'));
      continue;
    }
    let run;
    try {
      run = await options.agentRunner.get(runId);
    } catch {
      cases.push(failedCase(request.replayCase, 'agent_run_not_stored', { runId }));
      continue;
    }
    if (!run) {
      cases.push(failedCase(request.replayCase, 'agent_run_not_stored', { runId }));
      continue;
    }
    const runCheck = runEvidence(run, runId, request, options.selfState);
    if (!runCheck.ok) {
      cases.push(failedCase(request.replayCase, runCheck.reason, { runId }));
      continue;
    }

    const bound = { ...request.replayCase, runReceiptRef: runCheck.replayReceiptRef };
    const receipt = await options.evidenceStore.get(runCheck.replayReceiptRef);
    const output = await options.evidenceStore.output(runCheck.replayReceiptRef);
    const evidence = verifyReplayEvidence(bound, {
      store: { get: () => receipt, output: () => output },
    });
    if (!evidence.ok) {
      cases.push(failedCase(bound, evidence.reason, {
        runId,
        runReceiptRef: runCheck.replayReceiptRef,
      }));
      continue;
    }
    if (typeof output !== 'string'
      || !receipt
      || receipt.outputDigest !== outputDigestOf(output)) {
      cases.push(failedCase(bound, 'output_mismatch', {
        runId,
        runReceiptRef: runCheck.replayReceiptRef,
      }));
      continue;
    }
    const verdict = storedVerdict(output, bound, receipt);
    if (!verdict.ok) {
      cases.push(failedCase(bound, verdict.reason, {
        runId,
        runReceiptRef: runCheck.replayReceiptRef,
      }));
      continue;
    }
    cases.push({
      id: bound.caseId,
      kind: bound.kind,
      caseInputDigest: bound.caseInputDigest,
      runId,
      runReceiptRef: runCheck.replayReceiptRef,
      outputDigest: receipt.outputDigest,
      evidenceOk: true,
      verdict: verdict.verdict,
      responseIdentityVerified: evidence.responseIdentityVerified,
    });
  }

  const suite = judgeSuite(cases, { touchesAuthority: true });
  const digestSource = replayDigestSource(skill, cases);
  return {
    ok: suite.pass,
    ...(!suite.pass ? { reason: 'replay_failed', errors: suite.missing } : {}),
    skillVersion: skill.version,
    skillHash: skill.contentHash,
    cases,
    replayDigest: contentHash(digestSource),
    runAt: Number.isFinite(options.runAt) ? options.runAt : 0,
  };
}
