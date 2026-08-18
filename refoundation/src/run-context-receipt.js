function finite(value) { return Number.isFinite(value) ? value : null; }

function usageFrom(response) {
  const usage = response?.usage;
  if (!usage) return null;
  return {
    inputTokens: finite(usage.input_tokens),
    outputTokens: finite(usage.output_tokens),
    totalTokens: finite(usage.total_tokens),
  };
}

/** Joins content-free request measurements with provider-reported token truth per model call. */
export function deriveRunContextReport(run) {
  const events = run?.events ?? [];
  const built = new Map(events.filter((event) => (
    event.type === 'model_context_built' && event.payload?.contextReceipt
  )).map((event) => [event.stepId ?? `turn-${event.payload.turn}`, event]));
  const completedKeys = new Set();
  const calls = events.filter((event) => event.type === 'model_completed').flatMap((event) => {
    const key = event.stepId ?? `turn-${event.payload?.turn}`;
    const contextReceipt = event.payload?.response?.contextReceipt ?? built.get(key)?.payload?.contextReceipt;
    if (!contextReceipt) return [];
    completedKeys.add(key);
    return [{
      turn: event.payload.turn,
      stepId: event.stepId ?? null,
      context: structuredClone(contextReceipt),
      providerUsage: usageFrom(event.payload.response),
      completed: true,
    }];
  });
  for (const [key, event] of built) {
    if (completedKeys.has(key)) continue;
    calls.push({
      turn: event.payload.turn,
      stepId: event.stepId ?? null,
      context: structuredClone(event.payload.contextReceipt),
      providerUsage: null,
      completed: false,
    });
  }
  calls.sort((left, right) => (left.turn ?? 0) - (right.turn ?? 0));
  const sum = (read) => calls.reduce((total, call) => total + (finite(read(call)) ?? 0), 0);
  const sumKnown = (read) => {
    const values = calls.map(read).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    runId: run?.runId ?? null,
    status: run?.status ?? 'unknown',
    calls,
    aggregate: {
      calls: calls.length,
      requestBytes: sum((call) => call.context.requestBytes),
      inputBytes: sum((call) => call.context.input?.bytes),
      instructionsBytes: sum((call) => call.context.instructionsBytes),
      toolSchemaBytes: sum((call) => call.context.tools?.bytes),
      providerInputTokens: sumKnown((call) => call.providerUsage?.inputTokens),
    },
  };
}
