// 모델 왕복 회계. 사용자 진실 원장이 아니라 비용·지연·호출 구조를 보는 진단면이다.
// 논리 `respond()` 한 번을 한 건으로 센다. provider 내부 재시도 횟수는 현재 관측할 수 없으므로
// 절대로 1이라고 지어내지 않고 `upstreamAttempts:null`로 둔다.
import { randomUUID } from 'node:crypto';
import { buildModelMessages } from './model-provider.js';
import { dumpModelCallMetric, 토큰어림 } from './prompt-dump.js';

export const MODEL_CALL_PURPOSES = Object.freeze([
  'work_contract', 'answer_retry', 'completion_repair', 'primary', 'deliverable_followup',
  'required_tool_followup', 'automation_proposal', 'automation_control', 'automation_observe',
  'goal_recovery', 'tool_loop', 'final_response', 'work_state_settlement', 'welcome',
  'replay_execute', 'replay_judge',
  'growth_propose', 'growth_validate', 'growth_execute', 'growth_judge',
]);

const INSTRUMENTED = Symbol('t5.model-call-accounting.instrumented');

const finite = (v) => {
  if (v === null || v === undefined || v === '') return null;
  return Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null;
};
const firstFinite = (...values) => {
  for (const value of values) { const n = finite(value); if (n !== null) return n; }
  return null;
};

function actualTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = firstFinite(usage.prompt_tokens, usage.input_tokens, usage.promptTokenCount);
  const output = firstFinite(usage.completion_tokens, usage.output_tokens, usage.candidatesTokenCount);
  const total = firstFinite(usage.total_tokens, usage.totalTokenCount,
    input !== null && output !== null ? input + output : null);
  if (input === null && output === null && total === null) return null;
  return {
    source: 'actual', coverage: 'reported_response', estimateVersion: null,
    input, output, total,
    cacheRead: firstFinite(usage.prompt_tokens_details?.cached_tokens,
      usage.cache_read_input_tokens, usage.cachedContentTokenCount),
    cacheWrite: firstFinite(usage.cache_creation_input_tokens),
    reasoning: firstFinite(usage.completion_tokens_details?.reasoning_tokens, usage.thoughtsTokenCount),
  };
}

const serialized = (value) => {
  try { return JSON.stringify(value ?? ''); } catch { return ''; }
};

function inputFacts(tc, opts) {
  let messages = {};
  try { messages = buildModelMessages(tc) ?? {}; } catch { messages = {}; }
  const system = typeof messages.system === 'string' ? messages.system
    : Array.isArray(messages.system) ? messages.system.join('\n') : '';
  const breakdown = {
    system: 토큰어림(system),
    tools: 토큰어림(serialized(opts?.tools ?? [])),
    requiredTool: 토큰어림(opts?.requiredTool ?? ''),
    history: 토큰어림(serialized(messages.history ?? [])),
    exchange: 토큰어림(serialized(messages.exchange ?? [])),
    admitted: 토큰어림(serialized(tc?.admittedContext ?? [])),
    user: 토큰어림(typeof messages.user === 'string' ? messages.user : serialized(messages.user)),
  };
  // admitted는 system 안에 조립된 부분집합이라 구성비로만 보이고 total에는 두 번 더하지 않는다.
  breakdown.total = breakdown.system + breakdown.tools + breakdown.requiredTool
    + breakdown.history + breakdown.exchange + breakdown.user;
  return breakdown;
}

function estimatedTokens(inputBreakdown, output, completed = true) {
  if (!completed) {
    return {
      source: 'estimate', coverage: 'logical_respond', estimateVersion: 't5-char-v1',
      input: inputBreakdown.total, output: null, total: null,
      cacheRead: null, cacheWrite: null, reasoning: null,
    };
  }
  const text = typeof output === 'string' ? output : output?.text ?? '';
  const toolCalls = typeof output === 'string' ? [] : output?.toolCalls ?? [];
  const out = 토큰어림(text) + (toolCalls.length ? 토큰어림(serialized(toolCalls)) : 0);
  return {
    source: 'estimate', coverage: 'logical_respond', estimateVersion: 't5-char-v1',
    input: inputBreakdown.total, output: out, total: inputBreakdown.total + out,
    cacheRead: null, cacheWrite: null, reasoning: null,
  };
}

function identityFacts(identity) {
  const selection = identity?.selection ?? {};
  return {
    provider: selection.providerId ?? selection.provider ?? identity?.provider ?? null,
    requestModelId: identity?.actualRequestModelId ?? identity?.requestModelId
      ?? selection.requestModelId ?? null,
    responseModelId: identity?.responseModelId ?? null,
    connectionInstanceId: selection.connectionInstanceId ?? null,
    connectionGeneration: identity?.connectionGeneration ?? selection.generation ?? null,
  };
}

function failureStatus(error, opts) {
  if (error?.isModelTimeout === true || error?.name === 'TimeoutError') return 'timeout';
  if (error?.name === 'AbortError' || opts?.signal?.aborted === true) return 'cancelled';
  return 'failed';
}

export function createModelCallAccounting({
  lane = 'foreground', role = 'default', turnRef = null, workRef = null, runId = null,
  records = [], sequence = 0, env = process.env, onRecord = null,
} = {}) {
  const accounting = {
    lane, role, turnRef, workRef, runId, records: structuredClone(records), sequence, env, onRecord,
    dumpPaths: [],
    snapshot() {
      return {
        schemaVersion: 1, lane: this.lane, role: this.role,
        turnRef: this.turnRef, workRef: this.workRef, runId: this.runId,
        sequence: this.sequence, records: structuredClone(this.records.filter((r) => r.status !== 'started')),
      };
    },
  };
  return accounting;
}

export function restoreModelCallAccounting(snapshot, override = {}) {
  return createModelCallAccounting({
    lane: snapshot?.lane, role: snapshot?.role, turnRef: snapshot?.turnRef,
    workRef: snapshot?.workRef, runId: snapshot?.runId,
    sequence: Number.isInteger(snapshot?.sequence) ? snapshot.sequence : 0,
    records: Array.isArray(snapshot?.records) ? snapshot.records : [],
    ...override,
  });
}

async function safeDump(accounting, record) {
  try {
    const path = await dumpModelCallMetric(record, accounting.env);
    if (path && !accounting.dumpPaths.includes(path)) accounting.dumpPaths.push(path);
  } catch { /* 계측 실패는 제품 응답을 막지 않는다 */ }
}

/** model을 한 번만 감싸되 현재 요청의 accounting은 호출 때 읽는다. */
export function instrumentModelCalls(model, accountingForCall, onLogicalCall) {
  if (!model?.respond) return model;
  const prior = model[INSTRUMENTED];
  if (prior?.accountingForCall?.() === accountingForCall?.()) return model;
  // 다른 요청/sink가 이미 감싼 모델을 받았으면 앞 계측기를 중첩하지 않고 원본에 새 문 하나만 건다.
  // 그래야 실제 호출 1·현재 sink 1·현재 예산 1이고, 이전 sink로 오귀속되지 않는다.
  const baseModel = prior?.baseModel ?? model;
  const wrapped = Object.create(baseModel);
  Object.defineProperty(wrapped, INSTRUMENTED, {
    value: { baseModel, accountingForCall },
  });
  wrapped.respond = async (tc, opts = {}) => {
    const accounting = accountingForCall?.();
    if (!accounting) return baseModel.respond(tc, opts);
    onLogicalCall?.();
    accounting.sequence += 1;
    const callId = randomUUID();
    const inputBreakdown = inputFacts(tc, opts);
    const purpose = MODEL_CALL_PURPOSES.includes(opts.accountingPurpose)
      ? opts.accountingPurpose : 'unlabeled';
    const lane = opts.accountingLane === 'background' ? 'background' : accounting.lane;
    const role = typeof opts.accountingRole === 'string' ? opts.accountingRole : accounting.role;
    const base = {
      schemaVersion: 1, callId, sequence: accounting.sequence, purpose, lane, role,
      turnRef: accounting.turnRef, workRef: accounting.workRef, runId: accounting.runId,
      parentCallId: null, status: 'started', upstreamAttempts: null, inputBreakdown,
      inputBreakdownSource: 'estimate', inputBreakdownVersion: 't5-char-v1',
    };
    accounting.records.push(base);
    await safeDump(accounting, base);
    const modelStartedAt = performance.now();
    let identity = null;
    let output;
    let error = null;
    let ttftMs = null;
    const originalIdentity = opts.onCallIdentity;
    const originalDelta = opts.onDelta;
    const providerOpts = {
      ...opts,
      onCallIdentity: (value) => { identity = value; originalIdentity?.(value); },
      // 없던 onDelta를 만들면 provider가 비스트리밍 호출을 스트리밍으로 바꾼다.
      // 원래 있던 호출만 감싸고, 없던 호출의 TTFT는 정직하게 null이다.
      ...(typeof originalDelta === 'function' ? { onDelta: (value) => {
        if (ttftMs === null) ttftMs = Math.max(0, performance.now() - modelStartedAt);
        originalDelta(value);
      } } : {}),
    };
    delete providerOpts.accountingPurpose;
    delete providerOpts.accountingLane;
    delete providerOpts.accountingRole;
    try {
      output = await baseModel.respond(tc, providerOpts);
      return output;
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      const actual = actualTokens(identity?.usage);
      const terminal = {
        ...base,
        ...identityFacts(identity),
        status: error ? failureStatus(error, opts) : 'succeeded',
        durationMs: Math.max(0, performance.now() - modelStartedAt),
        ttftMs,
        tokens: actual ?? estimatedTokens(inputBreakdown, output, error === null),
      };
      accounting.records[accounting.records.findIndex((r) => r.callId === callId)] = terminal;
      await safeDump(accounting, terminal);
      try { accounting.onRecord?.(structuredClone(terminal)); } catch { /* 관측 소비자 실패 격리 */ }
    }
  };
  return wrapped;
}
