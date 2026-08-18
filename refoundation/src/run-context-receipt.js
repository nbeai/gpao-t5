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
  const calls = (run?.events ?? []).filter((event) => (
    event.type === 'model_completed' && event.payload?.response?.contextReceipt
  )).map((event) => ({
    turn: event.payload.turn,
    stepId: event.stepId ?? null,
    context: structuredClone(event.payload.response.contextReceipt),
    providerUsage: usageFrom(event.payload.response),
  }));
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
