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

  async startRun({ sessionId, runId, trigger = 'user' }) {
    await this.ensureRecovered();
    const sessionScopeId = stableId('session', sessionId);
    const runScopeId = stableId('run', runId);
    await this.ledger.createScope({
      scopeId: sessionScopeId, kind: 'session', dedupeKey: `scope:${sessionScopeId}`,
    });
    await this.ledger.createScope({
      scopeId: runScopeId, parentScopeId: sessionScopeId, kind: 'run',
      dedupeKey: `scope:${runScopeId}`, facts: { trigger },
    });
    return new ResourceRun({
      controller: this, runScopeId, sessionScopeId, runIdentity: String(runId),
    });
  }
}

class ResourceRun {
  constructor({ controller, runScopeId, sessionScopeId, runIdentity }) {
    this.controller = controller; this.ledger = controller.ledger;
    this.runScopeId = runScopeId; this.sessionScopeId = sessionScopeId;
    this.runIdentity = runIdentity; this.modelScopes = new Set(); this.closed = false;
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
        await ensureLogical();
        const requestId = `${logicalScopeId}:request`;
        const attemptScopeId = stableId('model-attempt', `${requestId}:${attempt}`);
        const reservationId = this.controller.makeId();
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
      },
      commit: async (handle, { usage, responseId = null }) => {
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
        } catch { return false; }
      },
      unknown: async (handle, { reason, facts = {} }) => {
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
        } catch { return false; }
      },
      release: async (handle, { reason }) => {
        try {
          await ledger.release({
            scopeId: handle.attemptScopeId, dedupeKey: `release:${handle.reservationId}`,
            reservationId: handle.reservationId, reason,
          });
          await ledger.closeScope({
            scopeId: handle.attemptScopeId, dedupeKey: `close:${handle.attemptScopeId}`, status: 'released',
          });
          return true;
        } catch { return false; }
      },
    };
  }

  async observeTool({ turn, toolCallId, name, outcome, startedAt }) {
    const toolScopeId = stableId('tool-call', `${this.runIdentity}:${turn}:${toolCallId}`);
    await this.ledger.createScope({
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
    });
  }

  async close(status) {
    if (this.closed) return;
    for (const scopeId of this.modelScopes) {
      await this.ledger.closeScope({
        scopeId, dedupeKey: `close:${scopeId}`, status,
      });
    }
    await this.ledger.closeScope({
      scopeId: this.runScopeId, dedupeKey: `close:${this.runScopeId}`, status,
    });
    this.closed = true;
  }
}
