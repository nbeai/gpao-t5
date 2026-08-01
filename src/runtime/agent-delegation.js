import {
  AUTOMATION_SCHEMA_VERSION,
  agentRunIdempotencyKey,
  contentHash,
  skillHashSource,
  validateAgentRun,
  validateAuthorityEnvelope,
} from '../kernel/l5-growth/automation-contracts.js';
import { validateAgentBudgets } from '../kernel/l5-growth/agent-profile.js';

function checked(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedBudgets(parent, childCount) {
  checked(parent.maxToolCalls >= childCount, 'delegation_step_budget_too_small');
  return {
    maxToolCalls: Math.max(1, Math.floor(parent.maxToolCalls / childCount)),
    timeoutMs: parent.timeoutMs,
    maxCost: parent.maxCost / childCount,
    maxConcurrency: Math.min(parent.maxConcurrency, childCount),
  };
}

function childAuthority(parent, childBudget) {
  return {
    ...structuredClone(parent),
    allowedKinds: [...parent.allowedKinds],
    allowedTools: [...(parent.allowedTools ?? [])],
    allowedTargets: [...parent.allowedTargets],
    workspaceRoots: [...parent.workspaceRoots],
    requiresFreshApprovalFor: [...parent.requiresFreshApprovalFor],
    maxRuns: 1,
    maxCost: parent.maxCost === null
      ? childBudget.maxCost
      : Math.min(parent.maxCost, childBudget.maxCost),
  };
}

function delegationSkill({ parentId, index, text, authorityEnvelope, now }) {
  const skill = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `skill-${parentId}-${index + 1}`,
    name: `분할 작업 ${index + 1}`,
    purpose: text,
    version: 1,
    contentHash: '',
    inputs: [{ name: 'partition', required: true }],
    steps: [{ kind: 'delegate_part', instruction: '할당된 범위만 처리하고 근거와 결과를 반환한다' }],
    resultContract: { kind: 'bounded_child_result', parentRequestId: parentId },
    requiredCapabilities: [...(authorityEnvelope.allowedTools ?? [])],
    authorityHints: [...authorityEnvelope.allowedKinds],
    replayCases: [],
    source: { kind: 'delegation', sessionId: parentId, traceIds: [parentId] },
    state: 'active',
    createdAt: now,
    updatedAt: now,
    previousVersion: null,
  };
  skill.contentHash = contentHash(skillHashSource(skill));
  return skill;
}

function childProfile({ parentId, index, authorityEnvelope, budgets, now }) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `agent-${parentId}-${index + 1}`,
    name: `분할 실행자 ${index + 1}`,
    purpose: '부모 요청에서 할당된 범위만 실행한다',
    modelRole: 'worker',
    toolAllowlist: [...(authorityEnvelope.allowedTools ?? [])],
    workspaceScope: [...authorityEnvelope.workspaceRoots],
    defaultBudgets: structuredClone(budgets),
    authorityCeiling: authorityEnvelope.ceiling,
    state: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export function buildDelegation({
  requestId,
  text,
  partitions,
  authorityEnvelope,
  budgets,
  now,
}) {
  checked(typeof requestId === 'string' && requestId.length > 0, 'delegation_request_id_required');
  checked(typeof text === 'string' && text.trim().length > 0, 'delegation_text_required');
  checked(Array.isArray(partitions) && partitions.length > 0, 'delegation_partitions_required');
  checked(partitions.every((part) => part && typeof part === 'object' && !Array.isArray(part)), 'delegation_partition_invalid');
  const authority = validateAuthorityEnvelope(authorityEnvelope);
  checked(authority.ok, `delegation_authority_invalid: ${authority.errors.join('; ')}`);
  const budgetCheck = validateAgentBudgets(budgets);
  checked(budgetCheck.ok, `delegation_budgets_invalid: ${budgetCheck.errors.join('; ')}`);
  checked(partitions.length <= authorityEnvelope.maxRuns, 'delegation_run_count_outside_parent');

  const createdAt = Number.isFinite(now) ? now : Date.now();
  const parentId = `delegation-${contentHash({ requestId, partitions }).slice(0, 24)}`;
  const childBudgets = boundedBudgets(budgets, partitions.length);
  const childEnvelope = childAuthority(authorityEnvelope, childBudgets);
  const children = partitions.map((partition, index) => {
    const skillSnapshot = delegationSkill({
      parentId, index, text, authorityEnvelope: childEnvelope, now: createdAt,
    });
    const scheduledFor = createdAt + index;
    const jobId = `${parentId}:child:${index + 1}`;
    const run = {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      id: `run-${contentHash({ parentId, index, partition }).slice(0, 32)}`,
      jobId,
      scheduledFor,
      idempotencyKey: agentRunIdempotencyKey({
        jobId,
        scheduledFor,
        skillVersion: skillSnapshot.version,
        skillHash: skillSnapshot.contentHash,
      }),
      skillSnapshot,
      triggerSnapshot: {
        kind: 'once',
        timezone: 'UTC',
        at: scheduledFor,
        misfirePolicy: 'skip',
        nextRunAt: scheduledFor,
      },
      inputSnapshot: {
        parentRequestId: parentId,
        ...structuredClone(partition),
      },
      agentSnapshot: childProfile({
        parentId, index, authorityEnvelope: childEnvelope, budgets: childBudgets, now: createdAt,
      }),
      authorityEnvelope: structuredClone(childEnvelope),
      status: 'queued',
      owner: null,
      heartbeatAt: null,
      budgets: structuredClone(childBudgets),
      receipts: [],
      result: null,
      deliveryState: { status: 'not_requested' },
      startedAt: null,
      finishedAt: null,
    };
    const valid = validateAgentRun(run);
    checked(valid.ok, `delegated_run_invalid: ${valid.errors.join('; ')}`);
    return run;
  });

  return {
    parent: {
      id: parentId,
      requestId,
      status: 'delegated',
      childRunIds: children.map((run) => run.id),
      authorityEnvelope: structuredClone(authorityEnvelope),
      budgets: structuredClone(budgets),
      createdAt,
    },
    children,
  };
}
