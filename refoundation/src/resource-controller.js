import { createHash, randomUUID } from 'node:crypto';
import { deriveResourceAnomalyCandidate } from './resource-anomaly-shadow.js';

function stableId(kind, value) {
  return `${kind}:${createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;
}

function tokenUsage(usage = {}) {
  const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.trunc(Number(value)) : null;
  return {
    inputTokens: number(usage.input_tokens ?? usage.prompt_tokens),
    outputTokens: number(usage.output_tokens ?? usage.completion_tokens),
    cachedInputTokens: number(
      usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
    ),
    cacheWriteInputTokens: number(
      usage.input_tokens_details?.cache_write_tokens
      ?? usage.prompt_tokens_details?.cache_write_tokens,
    ),
    reasoningTokens: number(
      usage.output_tokens_details?.reasoning_tokens
      ?? usage.completion_tokens_details?.reasoning_tokens,
    ),
    totalTokens: number(usage.total_tokens),
  };
}

function contextResources(receipt = {}) {
  const integer = (value) => Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.trunc(Number(value)) : null;
  return {
    requestBytes: integer(receipt.requestBytes),
    inputBytes: integer(receipt.input?.bytes),
    instructionsBytes: integer(receipt.instructionsBytes),
    toolSchemaBytes: integer(receipt.tools?.bytes),
    sourceMessageBytes: integer(receipt.source?.bytes),
    sourceMessages: integer(receipt.source?.messages),
    functionOutputBytes: integer(receipt.input?.byKind?.function_call_output?.bytes),
    functionOutputItems: integer(receipt.input?.byKind?.function_call_output?.items),
  };
}

function diagnostic(stage, error) {
  const code = typeof error?.code === 'string' && /^[A-Za-z0-9_.-]{1,80}$/u.test(error.code)
    ? error.code : null;
  return {
    state: 'accounting_degraded', stage,
    errorClass: String(error?.name ?? 'Error').slice(0, 80),
    ...(code ? { errorCode: code } : {}),
  };
}

async function publishDiagnostic(callback, stage, error) {
  if (typeof callback !== 'function') return;
  try { await callback(diagnostic(stage, error)); } catch { /* accounting diagnostics never block work */ }
}

export class ResourceController {
  constructor(ledger, { now = Date.now, makeId = randomUUID } = {}) {
    if (!ledger) throw new TypeError('resource ledger is required');
    this.ledger = ledger; this.now = now; this.makeId = makeId;
    this.recovery = null;
  }

  async ensureRecovered() {
    this.recovery ??= this.ledger.recoverOpenReservations();
    return this.recovery;
  }

  async startRun({ sessionId, runId, trigger = 'user', onDiagnostic = null }) {
    const sessionScopeId = stableId('session', sessionId);
    const runScopeId = stableId('run', runId);
    try {
      await this.ensureRecovered();
      await this.ledger.createScope({
        scopeId: sessionScopeId, kind: 'session', dedupeKey: `scope:${sessionScopeId}`,
      });
      await this.ledger.createScope({
        scopeId: runScopeId, parentScopeId: sessionScopeId, kind: 'run',
        dedupeKey: `scope:${runScopeId}`, facts: { trigger },
      });
    } catch (error) {
      await publishDiagnostic(onDiagnostic, 'start_run', error);
      return new DegradedResourceRun({ onDiagnostic });
    }
    return new ResourceRun({
      controller: this, runScopeId, sessionScopeId, runIdentity: String(runId), onDiagnostic,
    });
  }
}

class DegradedResourceRun {
  constructor({ onDiagnostic = null } = {}) { this.onDiagnostic = onDiagnostic; }
  modelObserver() {
    return {
      reserve: async () => ({ degraded: true }),
      commit: async () => false, unknown: async () => false, release: async () => false,
      degraded: async ({ stage, error }) => publishDiagnostic(this.onDiagnostic, stage, error),
    };
  }
  async observeTool() {}
  situation() { return null; }
  async close() {}
}

class ResourceRun {
  constructor({ controller, runScopeId, sessionScopeId, runIdentity, onDiagnostic = null }) {
    this.controller = controller; this.ledger = controller.ledger;
    this.runScopeId = runScopeId; this.sessionScopeId = sessionScopeId;
    this.runIdentity = runIdentity; this.modelScopes = new Set(); this.closed = false;
    this.onDiagnostic = onDiagnostic; this.degraded = false; this.diagnosticStages = new Set();
    this.evidenceFingerprints = new Set();
    this.resourceShadow = {
      modelCalls: 0, toolCalls: 0, novelEvidence: 0, repeatedEvidence: 0, noEvidence: 0,
      intervalsWithoutNewEvidence: 0, repeatedEvidenceOnlyIntervals: 0,
      contextGrowthWithoutNewEvidenceBytes: 0,
      priorFunctionOutputBytesAtNondecreasingProjection: 0,
      requestProjectionGrowthBytes: 0, priorRequestBytesAtGrowth: 0,
      firstEfficiencyCandidateModelCall: 0, firstPathologyCandidateModelCall: 0,
      firstReliabilityCandidateModelCall: 0,
      retryAttempts: 0, unknownSettlements: 0,
      providerTokensCommitted: 0, requestBytesReserved: 0,
      latestToolEvidence: null,
    };
    this.progressContexts = new Map();
  }

  async markDegraded(stage, error) {
    this.degraded = true;
    if (this.diagnosticStages.has(stage)) return;
    this.diagnosticStages.add(stage);
    await publishDiagnostic(this.onDiagnostic, stage, error);
  }

  modelObserver({ logicalCallId, purpose = 'main' }) {
    const ledger = this.ledger;
    const logicalScopeId = stableId('model-call', `${this.runIdentity}:${logicalCallId}`);
    const ensureLogical = async () => {
      if (this.modelScopes.has(logicalScopeId)) return;
      await ledger.createScope({
        scopeId: logicalScopeId, parentScopeId: this.runScopeId, kind: 'model_call',
        dedupeKey: `scope:${logicalScopeId}`, facts: { purpose },
      });
      this.modelScopes.add(logicalScopeId);
    };
    const observeProgressContext = (resources, attempt) => {
      if (attempt > 1) {
        this.resourceShadow.retryAttempts += 1;
        this.resourceShadow.firstReliabilityCandidateModelCall ||= this.resourceShadow.modelCalls;
        return;
      }
      this.resourceShadow.modelCalls += 1;
      if (purpose !== 'main' && purpose !== 'automation_main') return;
      const previous = this.progressContexts.get(purpose);
      if (previous) {
        const novelDelta = this.resourceShadow.novelEvidence - previous.novelEvidence;
        const repeatedDelta = this.resourceShadow.repeatedEvidence - previous.repeatedEvidence;
        if (novelDelta === 0) {
          this.resourceShadow.firstPathologyCandidateModelCall ||= this.resourceShadow.modelCalls;
          this.resourceShadow.intervalsWithoutNewEvidence += 1;
          if (repeatedDelta > 0) this.resourceShadow.repeatedEvidenceOnlyIntervals += 1;
          if (resources.requestBytes > previous.requestBytes) {
            this.resourceShadow.contextGrowthWithoutNewEvidenceBytes += (
              resources.requestBytes - previous.requestBytes
            );
          }
        }
        if (resources.requestBytes > previous.requestBytes) {
          this.resourceShadow.requestProjectionGrowthBytes += resources.requestBytes - previous.requestBytes;
          this.resourceShadow.priorRequestBytesAtGrowth += previous.requestBytes;
          this.resourceShadow.firstEfficiencyCandidateModelCall ||= this.resourceShadow.modelCalls;
        }
        if (resources.functionOutputItems >= previous.functionOutputItems
          && resources.functionOutputBytes >= previous.functionOutputBytes) {
          this.resourceShadow.priorFunctionOutputBytesAtNondecreasingProjection += (
            previous.functionOutputBytes
          );
          if (previous.functionOutputBytes > 0) {
            this.resourceShadow.firstEfficiencyCandidateModelCall ||= this.resourceShadow.modelCalls;
          }
        }
      }
      this.progressContexts.set(purpose, {
        requestBytes: resources.requestBytes ?? 0,
        functionOutputBytes: resources.functionOutputBytes ?? 0,
        functionOutputItems: resources.functionOutputItems ?? 0,
        novelEvidence: this.resourceShadow.novelEvidence,
        repeatedEvidence: this.resourceShadow.repeatedEvidence,
      });
    };
    return {
      reserve: async ({ provider, model, attempt = 1, contextReceipt }) => {
        if (this.degraded) return { degraded: true };
        const requestId = `${logicalScopeId}:request`;
        const attemptScopeId = stableId('model-attempt', `${requestId}:${attempt}`);
        const reservationId = this.controller.makeId();
        try {
          await ensureLogical();
          await ledger.createScope({
            scopeId: attemptScopeId, parentScopeId: logicalScopeId, kind: 'model_attempt',
            dedupeKey: `scope:${attemptScopeId}`, facts: { provider, model, attempt, purpose },
          });
          const resources = contextResources(contextReceipt);
          await ledger.forecast({
            scopeId: attemptScopeId, dedupeKey: `forecast:${attemptScopeId}`,
            requestId, attempt, resources,
          });
          await ledger.reserve({
            scopeId: attemptScopeId, dedupeKey: `reserve:${attemptScopeId}`,
            reservationId, requestId, attempt, resources,
          });
          this.resourceShadow.requestBytesReserved += Number(resources.requestBytes ?? 0);
          observeProgressContext(resources, attempt);
          return { reservationId, requestId, attemptScopeId, startedAt: this.controller.now() };
        } catch (error) {
          await this.markDegraded('reservation', error);
          return { degraded: true };
        }
      },
      commit: async (handle, { usage, responseId = null }) => {
        if (handle?.degraded || this.degraded) return false;
        try {
          const resources = tokenUsage(usage);
          await ledger.commit({
            scopeId: handle.attemptScopeId, dedupeKey: `commit:${handle.reservationId}`,
            reservationId: handle.reservationId, responseId, resources,
          });
          this.resourceShadow.providerTokensCommitted += Number(resources.totalTokens ?? 0);
          await ledger.observe({
            scopeId: handle.attemptScopeId, dedupeKey: `wall:${handle.reservationId}`,
            resources: { wallMs: Math.max(0, this.controller.now() - handle.startedAt), modelCalls: 1 },
          });
          await ledger.closeScope({
            scopeId: handle.attemptScopeId, dedupeKey: `close:${handle.attemptScopeId}`, status: 'completed',
          });
          return true;
        } catch (error) { await this.markDegraded('settlement', error); return false; }
      },
      unknown: async (handle, { reason, facts = {} }) => {
        if (handle?.degraded || this.degraded) return false;
        try {
          await ledger.markUnknown({
            scopeId: handle.attemptScopeId, dedupeKey: `unknown:${handle.reservationId}`,
            reservationId: handle.reservationId, reason, facts,
          });
          await ledger.observe({
            scopeId: handle.attemptScopeId, dedupeKey: `wall:${handle.reservationId}`,
            resources: { wallMs: Math.max(0, this.controller.now() - handle.startedAt), modelCalls: 1 },
          });
          await ledger.closeScope({
            scopeId: handle.attemptScopeId, dedupeKey: `close:${handle.attemptScopeId}`, status: 'unknown',
          });
          this.resourceShadow.unknownSettlements += 1;
          this.resourceShadow.firstReliabilityCandidateModelCall ||= this.resourceShadow.modelCalls;
          return true;
        } catch (error) { await this.markDegraded('settlement', error); return false; }
      },
      release: async (handle, { reason }) => {
        if (handle?.degraded || this.degraded) return false;
        try {
          await ledger.release({
            scopeId: handle.attemptScopeId, dedupeKey: `release:${handle.reservationId}`,
            reservationId: handle.reservationId, reason,
          });
          await ledger.closeScope({
            scopeId: handle.attemptScopeId, dedupeKey: `close:${handle.attemptScopeId}`, status: 'released',
          });
          return true;
        } catch (error) { await this.markDegraded('settlement', error); return false; }
      },
      degraded: async ({ stage, error }) => this.markDegraded(stage, error),
    };
  }

  async observeTool({ turn, toolCallId, name, outcome, startedAt, evidenceFingerprint = null }) {
    if (this.degraded) return;
    this.resourceShadow.toolCalls += 1;
    let evidence = 'none';
    if (evidenceFingerprint) {
      evidence = this.evidenceFingerprints.has(evidenceFingerprint) ? 'repeated' : 'new';
      this.evidenceFingerprints.add(evidenceFingerprint);
    }
    if (evidence === 'new') this.resourceShadow.novelEvidence += 1;
    else if (evidence === 'repeated') this.resourceShadow.repeatedEvidence += 1;
    else this.resourceShadow.noEvidence += 1;
    this.resourceShadow.latestToolEvidence = evidence;
    const toolScopeId = stableId('tool-call', `${this.runIdentity}:${turn}:${toolCallId}`);
    try { await this.ledger.createScope({
      scopeId: toolScopeId, parentScopeId: this.runScopeId, kind: 'tool_call',
      dedupeKey: `scope:${toolScopeId}`, facts: { name },
    });
    await this.ledger.observe({
      scopeId: toolScopeId, dedupeKey: `tool-observed:${toolScopeId}`,
      resources: { toolCalls: 1, wallMs: Math.max(0, this.controller.now() - startedAt) },
      facts: { outcome, evidence },
    });
    await this.ledger.closeScope({
      scopeId: toolScopeId, dedupeKey: `close:${toolScopeId}`, status: outcome,
    }); } catch (error) { await this.markDegraded('tool_observation', error); }
  }

  situation({ agent = {}, limits = {}, information = {} } = {}) {
    if (this.degraded) return null;
    const candidate = deriveResourceAnomalyCandidate(this.resourceShadow);
    const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0
      ? Math.trunc(Number(value)) : 0;
    const used = {
      foregroundModelTurns: number(agent.modelTurns),
      foregroundToolCalls: number(agent.toolCalls),
      foregroundProviderTokens: number(agent.providerTokens),
    };
    const next = {
      modelTurns: used.foregroundModelTurns + 1,
      toolCalls: used.foregroundToolCalls + Math.max(1, number(agent.lastTurnToolCalls)),
      providerTokens: used.foregroundProviderTokens + Math.max(1, number(agent.lastProviderTokens)),
    };
    return {
      state: 'observed', accounting: 'exact_or_explicit_unknown', intervention: false,
      usage: {
        ...used,
        allObservedModelCalls: number(this.resourceShadow.modelCalls),
        providerRetryAttempts: number(this.resourceShadow.retryAttempts),
        allObservedProviderTokens: number(this.resourceShadow.providerTokensCommitted),
        allObservedRequestBytes: number(this.resourceShadow.requestBytesReserved),
        toolCallsObserved: number(this.resourceShadow.toolCalls),
        unknownSettlements: number(this.resourceShadow.unknownSettlements),
      },
      evidence: {
        novel: number(this.resourceShadow.novelEvidence),
        repeated: number(this.resourceShadow.repeatedEvidence),
        none: number(this.resourceShadow.noEvidence),
        intervalsWithoutNovelEvidence: number(this.resourceShadow.intervalsWithoutNewEvidence),
        latestToolEvidence: this.resourceShadow.latestToolEvidence,
      },
      input: {
        historicalConversationBytes: number(information.historicalConversationBytes),
        memoryBytes: number(information.memoryBytes),
        currentRunToolReceiptBytes: number(information.currentRunToolReceiptBytes),
        repeatedToolReceiptBytes: number(information.repeatedToolReceiptBytes),
        activeToolDefinitionBytes: number(information.activeToolDefinitionBytes),
      },
      legacyFixedBoundaries: {
        modelTurns: { used: used.foregroundModelTurns, configured: number(limits.maxModelTurns),
          projectedNext: next.modelTurns,
          wouldReachOnNextObservedPattern: next.modelTurns >= number(limits.maxModelTurns) },
        toolCalls: { used: used.foregroundToolCalls, configured: number(limits.maxToolCalls),
          projectedNext: next.toolCalls,
          wouldReachOnNextObservedPattern: next.toolCalls >= number(limits.maxToolCalls) },
        providerTokens: { used: used.foregroundProviderTokens, configured: number(limits.maxProviderTokens),
          projectedNext: next.providerTokens,
          wouldReachOnNextObservedPattern: next.providerTokens >= number(limits.maxProviderTokens) },
        changedBySituation: false,
      },
      anomaly: candidate ? {
        category: candidate.category, signals: candidate.signals,
        firstPathologyModelCall: number(candidate.metrics.firstPathologyCandidateModelCall),
        firstEfficiencyModelCall: number(candidate.metrics.firstEfficiencyCandidateModelCall),
      } : null,
    };
  }

  async close(status) {
    if (this.closed || this.degraded) return;
    try {
      const anomaly = deriveResourceAnomalyCandidate(this.resourceShadow);
      if (anomaly) {
        await this.ledger.recordAnomaly({
          scopeId: this.runScopeId, dedupeKey: `anomaly-shadow:${this.runScopeId}`,
          category: anomaly.category, signals: anomaly.signals, metrics: anomaly.metrics,
          shadow: true,
        });
      }
      for (const scopeId of this.modelScopes) {
        await this.ledger.closeScope({
          scopeId, dedupeKey: `close:${scopeId}`, status,
        });
      }
      await this.ledger.closeScope({
        scopeId: this.runScopeId, dedupeKey: `close:${this.runScopeId}`, status,
      });
    } catch (error) { await this.markDegraded('scope_close', error); }
    this.closed = true;
  }
}
