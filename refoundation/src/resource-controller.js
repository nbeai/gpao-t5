import { createHash, randomUUID } from 'node:crypto';

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
  async close() {}
}

class ResourceRun {
  constructor({ controller, runScopeId, sessionScopeId, runIdentity, onDiagnostic = null }) {
    this.controller = controller; this.ledger = controller.ledger;
    this.runScopeId = runScopeId; this.sessionScopeId = sessionScopeId;
    this.runIdentity = runIdentity; this.modelScopes = new Set(); this.closed = false;
    this.onDiagnostic = onDiagnostic; this.degraded = false; this.diagnosticStages = new Set();
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
          return { reservationId, requestId, attemptScopeId, startedAt: this.controller.now() };
        } catch (error) {
          await this.markDegraded('reservation', error);
          return { degraded: true };
        }
      },
      commit: async (handle, { usage, responseId = null }) => {
        if (handle?.degraded || this.degraded) return false;
        try {
          await ledger.commit({
            scopeId: handle.attemptScopeId, dedupeKey: `commit:${handle.reservationId}`,
            reservationId: handle.reservationId, responseId, resources: tokenUsage(usage),
          });
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

  async observeTool({ turn, toolCallId, name, outcome, startedAt }) {
    if (this.degraded) return;
    const toolScopeId = stableId('tool-call', `${this.runIdentity}:${turn}:${toolCallId}`);
    try { await this.ledger.createScope({
      scopeId: toolScopeId, parentScopeId: this.runScopeId, kind: 'tool_call',
      dedupeKey: `scope:${toolScopeId}`, facts: { name },
    });
    await this.ledger.observe({
      scopeId: toolScopeId, dedupeKey: `tool-observed:${toolScopeId}`,
      resources: { toolCalls: 1, wallMs: Math.max(0, this.controller.now() - startedAt) },
      facts: { outcome },
    });
    await this.ledger.closeScope({
      scopeId: toolScopeId, dedupeKey: `close:${toolScopeId}`, status: outcome,
    }); } catch (error) { await this.markDegraded('tool_observation', error); }
  }

  async close(status) {
    if (this.closed || this.degraded) return;
    try {
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
