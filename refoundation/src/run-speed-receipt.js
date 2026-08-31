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

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function eventDuration(start, end) {
  const startMs = timestamp(start?.recordedAt); const endMs = timestamp(end?.recordedAt);
  return startMs == null || endMs == null ? null : Math.max(0, endMs - startMs);
}

function receiptBytes(receipt) {
  try { return Buffer.byteLength(JSON.stringify(receipt ?? null), 'utf8'); }
  catch { return null; }
}

/**
 * Content-free performance projection over the existing Run ledger. It creates no new
 * accounting truth: unavailable phase boundaries remain explicit gaps.
 */
export function deriveRunPerformanceTimeline(run) {
  const events = Array.isArray(run?.events) ? run.events : [];
  const starts = new Map(events.filter((event) => event.type === 'model_started')
    .map((event) => [event.stepId, event]));
  const models = events.filter((event) => event.type === 'model_completed').map((event) => {
    const response = event.payload?.response ?? {}; const context = response.contextReceipt ?? {};
    const usage = response.usage ?? {};
    return {
      turn: Number.isInteger(event.payload?.turn) ? event.payload.turn : null,
      durationMs: eventDuration(starts.get(event.stepId), event),
      toolCallsRequested: Array.isArray(response.toolCalls) ? response.toolCalls.length : null,
      requestBytes: finite(context.requestBytes),
      inputBytes: finite(context.input?.bytes),
      instructionBytes: finite(context.instructionsBytes),
      toolSchemaBytes: finite(context.tools?.bytes),
      functionOutputBytes: finite(context.input?.byKind?.function_call_output?.bytes),
      inputTokens: finite(usage.input_tokens ?? usage.prompt_tokens),
      cachedInputTokens: finite(
        usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
      ),
      cacheWriteInputTokens: finite(
        usage.input_tokens_details?.cache_write_tokens
        ?? usage.prompt_tokens_details?.cache_write_tokens,
      ),
      outputTokens: finite(usage.output_tokens ?? usage.completion_tokens),
    };
  });
  const toolStarts = new Map(events.filter((event) => event.type === 'tool_started')
    .map((event) => [event.stepId, event]));
  const modelStartEvents = events.filter((event) => event.type === 'model_started');
  const tools = events.filter((event) => event.type === 'tool_completed').map((event) => {
    const receipt = event.payload?.receipt ?? {}; const result = receipt.result ?? {};
    const endedAt = timestamp(event.recordedAt);
    const nextModel = modelStartEvents.find((candidate) => {
      const candidateAt = timestamp(candidate.recordedAt);
      return endedAt != null && candidateAt != null && candidateAt >= endedAt;
    });
    return {
      turn: Number.isInteger(event.payload?.turn) ? event.payload.turn : null,
      name: receipt.actualCall?.name ?? receipt.requestedCall?.name ?? null,
      outcome: receipt.outcome ?? 'unknown',
      wallMs: eventDuration(toolStarts.get(event.stepId), event),
      reportedExecutionMs: finite(result.durationMs),
      receiptBytes: receiptBytes(receipt),
      stdoutChars: String(result.stdout ?? '').length,
      stderrChars: String(result.stderr ?? '').length,
      omittedChars: finite(result.omittedChars),
      nextModelStartMs: nextModel ? eventDuration(event, nextModel) : null,
    };
  });
  const sumKnown = (items, key) => {
    const values = items.map((item) => item[key]).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    schema: 't5.run-performance-timeline.v1',
    runId: run?.runId ?? null,
    status: run?.status ?? 'unknown',
    models,
    tools,
    totals: {
      modelCalls: models.length,
      toolCalls: tools.length,
      modelWallMs: sumKnown(models, 'durationMs'),
      toolWallMs: sumKnown(tools, 'wallMs'),
      requestBytes: sumKnown(models, 'requestBytes'),
      instructionBytes: sumKnown(models, 'instructionBytes'),
      toolSchemaBytes: sumKnown(models, 'toolSchemaBytes'),
      functionOutputBytes: sumKnown(models, 'functionOutputBytes'),
      inputTokens: sumKnown(models, 'inputTokens'),
      cachedInputTokens: sumKnown(models, 'cachedInputTokens'),
      cacheWriteInputTokens: sumKnown(models, 'cacheWriteInputTokens'),
      outputTokens: sumKnown(models, 'outputTokens'),
      canonicalReceiptBytes: sumKnown(tools, 'receiptBytes'),
    },
    unavailableFacts: [
      'provider_tool_call_ttft',
      'tool_preflight_duration',
      'tool_post_observation_duration',
      'projected_tool_result_bytes_per_call',
      'purpose_relevance_of_evidence',
    ],
  };
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
