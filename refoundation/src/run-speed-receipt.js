function timestamp(value) {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsed(events, name) {
  const values = events.filter((event) => (
    event.type === 'surface_metric' && event.payload?.event === name
      && Number.isFinite(event.payload?.elapsedMs)
  )).map((event) => event.payload.elapsedMs);
  return values.length ? Math.min(...values) : null;
}

export function deriveRunSpeedReceipt(run) {
  const events = Array.isArray(run?.events) ? run.events : [];
  const started = events.find((event) => event.type === 'run_started');
  const terminal = events.find((event) => (
    event.type === 'run_completed' || event.type === 'run_cancelled' || event.type === 'run_failed'
  ));
  const startedMs = timestamp(started?.recordedAt);
  const terminalMs = timestamp(terminal?.recordedAt);

  const modelStarts = new Map(events.filter((event) => event.type === 'model_started')
    .map((event) => [event.stepId, timestamp(event.recordedAt)]));
  const modelCompleted = events.filter((event) => event.type === 'model_completed');
  let modelDurationMs = 0;
  let modelDurationKnown = true;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let usageKnown = false;
  for (const event of modelCompleted) {
    const start = modelStarts.get(event.stepId);
    const end = timestamp(event.recordedAt);
    if (start == null || end == null) modelDurationKnown = false;
    else modelDurationMs += Math.max(0, end - start);
    const usage = event.payload?.response?.usage;
    if (usage && [usage.input_tokens, usage.output_tokens, usage.total_tokens].every(Number.isFinite)) {
      usageKnown = true;
      inputTokens += usage.input_tokens;
      outputTokens += usage.output_tokens;
      totalTokens += usage.total_tokens;
    }
  }

  const toolEvents = events.filter((event) => event.type === 'tool_completed');
  let toolDurationMs = 0;
  let toolDurationKnown = true;
  let outputChars = 0;
  let omittedChars = 0;
  let failedCalls = 0;
  for (const event of toolEvents) {
    const receipt = event.payload?.receipt ?? {};
    const result = receipt.result ?? {};
    if (Number.isFinite(result.durationMs)) toolDurationMs += result.durationMs;
    else toolDurationKnown = false;
    outputChars += String(result.stdout ?? '').length + String(result.stderr ?? '').length;
    omittedChars += Number.isFinite(result.omittedChars) ? result.omittedChars : 0;
    if (receipt.outcome !== 'succeeded') failedCalls += 1;
  }

  const firstAnswerDeltaReceivedMs = elapsed(events, 'first_answer_delta_received');
  const firstAnswerDeltaVisibleMs = elapsed(events, 'first_answer_delta_visible');
  return {
    runId: run?.runId ?? null,
    status: run?.status ?? 'unknown',
    wallMs: startedMs != null && terminalMs != null ? Math.max(0, terminalMs - startedMs) : null,
    model: {
      calls: modelCompleted.length,
      durationMs: modelDurationKnown ? modelDurationMs : null,
      inputTokens: usageKnown ? inputTokens : null,
      outputTokens: usageKnown ? outputTokens : null,
      totalTokens: usageKnown ? totalTokens : null,
    },
    tools: {
      calls: toolEvents.length,
      durationMs: toolDurationKnown ? toolDurationMs : null,
      outputChars,
      omittedChars,
      failedCalls,
    },
    visible: {
      firstFeedbackMs: elapsed(events, 'first_feedback_visible'),
      firstGroundedContentMs: elapsed(events, 'first_grounded_content'),
      firstAnswerDeltaReceivedMs,
      firstAnswerDeltaVisibleMs,
      answerDeltaToVisibleMs: firstAnswerDeltaReceivedMs != null && firstAnswerDeltaVisibleMs != null
        ? Math.max(0, firstAnswerDeltaVisibleMs - firstAnswerDeltaReceivedMs) : null,
      turnCompleteMs: elapsed(events, 'turn_complete'),
    },
  };
}
