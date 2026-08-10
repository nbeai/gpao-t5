import { createHash } from 'node:crypto';
import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunIdempotencyKey,
  validateAgentProfile,
  validateAgentRun,
  validateAutomationJob,
  validateSkillDefinition,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  appendAutomationLedger,
  automationJobPatchDelta,
  isJobRunnable,
  jobExpired,
  resolveAfterRun,
} from '../kernel/l5-growth/automation.js';
import { toolActionKind } from '../kernel/l2-plan/action-plan.js';
import { UNKNOWN_KIND, isSafetyFloor } from '../kernel/l2-plan/authority.js';
import { blockedReceipt } from '../kernel/l0-evidence/tool-receipt.js';
import { BuiltinTriggerProvider } from './trigger-provider.js';

function runIdFor(idempotencyKey) {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  return `run-${digest.slice(0, 32)}`;
}

function exactSkill(job, skill) {
  return skill?.id === job.skillRef.id
    && skill.version === job.skillRef.version
    && skill.contentHash === job.skillRef.contentHash;
}

function queuedRunFor(job, skill, profile, scheduledFor) {
  const idempotencyKey = agentRunIdempotencyKey({
    jobId: job.id,
    scheduledFor,
    skillVersion: skill.version,
    skillHash: skill.contentHash,
  });
  const run = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: runIdFor(idempotencyKey),
    jobId: job.id,
    scheduledFor,
    idempotencyKey,
    skillSnapshot: structuredClone(skill),
    triggerSnapshot: structuredClone(job.trigger),
    inputSnapshot: structuredClone(job.inputTemplate),
    agentSnapshot: structuredClone(profile),
    authorityEnvelope: structuredClone(job.authorityEnvelope),
    status: 'queued',
    owner: null,
    heartbeatAt: null,
    budgets: structuredClone(profile.defaultBudgets),
    receipts: [],
    result: null,
    deliveryState: {
      status: job.deliveryPolicy?.mode === 'none' ? 'not_requested' : 'pending',
    },
    startedAt: null,
    finishedAt: null,
  };
  const checked = validateAgentRun(run);
  if (!checked.ok) throw new Error(`prepared agent run invalid: ${checked.errors.join('; ')}`);
  return run;
}

function jobGuard(job) {
  return {
    jobId: job.id,
    state: job.state,
    updatedAt: job.updatedAt,
    nextRunAt: job.nextRunAt,
    triggerNextRunAt: job.trigger.nextRunAt,
  };
}

function failed(failures, job, reason, errors = []) {
  failures.push({ jobId: job?.id ?? null, reason, errors });
}

/**
 * Derive AgentRun-compatible work and field-level store commands. This function
 * has no ToolRunner dependency and never mutates jobs, skills, or profiles.
 */
export function prepareAutomationRuns({
  jobs = [],
  runs = [],
  skills = [],
  profiles = [],
  now,
  recovering = false,
  triggerProvider = new BuiltinTriggerProvider({ clock: () => now }),
} = {}) {
  if (!Number.isFinite(now)) throw new TypeError('automation preparation time must be finite');
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const entries = [];
  const ignored = [];
  const failures = [];

  for (const job of jobs) {
    const checkedJob = validateAutomationJob(job);
    if (!checkedJob.ok) {
      failed(failures, job, 'invalid_job', checkedJob.errors);
      continue;
    }
    if (job.state !== 'scheduled') {
      ignored.push({ jobId: job.id, reason: `job_${job.state}` });
      continue;
    }
    const usedRuns = runs.filter((run) => run?.jobId === job.id).length;
    if (usedRuns >= job.authorityEnvelope.maxRuns) {
      entries.push({
        jobId: job.id,
        run: null,
        jobGuard: jobGuard(job),
        jobDelta: automationJobPatchDelta(job, { state: 'expired' }, {
          reason: 'authority_max_runs_reached', now,
        }),
        reason: 'authority_max_runs_reached',
      });
      continue;
    }
    if (Number.isFinite(job.authorityEnvelope.expiresAt)
      && now > job.authorityEnvelope.expiresAt) {
      entries.push({
        jobId: job.id,
        run: null,
        jobGuard: jobGuard(job),
        jobDelta: automationJobPatchDelta(job, { state: 'expired' }, {
          reason: 'authority_expired', now,
        }),
        reason: 'authority_expired',
      });
      continue;
    }

    const skill = skillById.get(job.skillRef.id);
    const checkedSkill = validateSkillDefinition(skill);
    if (!checkedSkill.ok || !exactSkill(job, skill) || skill.state !== 'active') {
      entries.push({
        jobId: job.id,
        run: null,
        jobGuard: jobGuard(job),
        jobDelta: automationJobPatchDelta(job, { state: 'needs_review' }, {
          reason: 'skill_binding_changed', now,
        }),
        reason: 'skill_binding_changed',
      });
      continue;
    }

    const profile = profileById.get(job.agentProfileId);
    const checkedProfile = validateAgentProfile(profile);
    if (!checkedProfile.ok || profile.state !== 'active') {
      ignored.push({ jobId: job.id, reason: 'agent_profile_inactive' });
      continue;
    }

    let triggerPlan;
    try {
      triggerPlan = triggerProvider.plan(job, { now, recovering });
    } catch (error) {
      failed(failures, job, 'trigger_failed', [error.message]);
      continue;
    }
    if (triggerPlan.reason === 'cursor_conflict') {
      failed(failures, job, 'trigger_cursor_conflict');
      continue;
    }
    if (triggerPlan.dueCount === 0) {
      ignored.push({ jobId: job.id, reason: triggerPlan.reason });
      continue;
    }

    if (triggerPlan.occurrences.length === 0) {
      entries.push({
        jobId: job.id,
        run: null,
        jobGuard: jobGuard(job),
        jobDelta: automationJobPatchDelta(job, {
          nextRunAt: triggerPlan.nextRunAt,
          triggerNextRunAt: triggerPlan.nextRunAt,
        }, { reason: triggerPlan.reason, now }),
        triggerPlan,
        reason: triggerPlan.reason,
      });
      continue;
    }

    const scheduledFor = triggerPlan.occurrences[0];
    const run = queuedRunFor(job, skill, profile, scheduledFor);
    entries.push({
      jobId: job.id,
      scheduledFor,
      run,
      jobGuard: jobGuard(job),
      jobDelta: automationJobPatchDelta(job, {
        nextRunAt: triggerPlan.nextRunAt,
        triggerNextRunAt: triggerPlan.nextRunAt,
        lastRunId: run.id,
      }, { reason: triggerPlan.reason, now }),
      triggerPlan,
      reason: triggerPlan.reason,
    });
  }

  return { at: now, recovering, entries, ignored, failures };
}

/**
 * @deprecated v1 server compatibility until the parent runtime cut. Durable
 * schedulers never call this function; they call prepareAutomationRuns above.
 */
export async function tickAutomation(jobs, context) {
  const { tools, selfState, now } = context;
  const ran = [];
  for (const job of jobs) {
    if (job.state === 'scheduled' && jobExpired(job, now)) {
      job.state = 'expired';
      continue;
    }
    if (!isJobRunnable(job, now)) continue;

    const kind = toolActionKind({ toolId: job.action.tool, args: job.action.args, selfState });
    if (kind === UNKNOWN_KIND || isSafetyFloor(kind)) {
      const receipt = blockedReceipt(
        `${job.action.tool} 자동 실행`,
        job.action.tool,
        '되돌리기 어려운 일이라 자동으로는 하지 않았어요.',
        '지금 확인해 주시면 이번 것만 실행할게요.',
      );
      appendAutomationLedger(job, receipt);
      job.state = 'paused';
      continue;
    }

    const receipt = await tools.run(job.action.tool, job.action.args ?? {}, selfState);
    appendAutomationLedger(job, receipt);
    const next = resolveAfterRun(job, receipt.failureState, now);
    job.state = next.state;
    job.failureCount = next.failureCount;
    if (next.nextRunAt !== undefined) job.nextRunAt = next.nextRunAt;
    ran.push({ jobId: job.id, receipt });
  }
  return ran;
}
