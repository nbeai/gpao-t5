const DEFAULT_MAX_MODEL_TURNS = 32;

function toolDefinition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

function normalizeResponse(response) {
  if (typeof response === 'string') return { text: response, toolCalls: [] };
  return {
    text: typeof response?.text === 'string' ? response.text : '',
    toolCalls: Array.isArray(response?.toolCalls) ? response.toolCalls : [],
    responseId: response?.responseId ?? null,
    responseModel: response?.responseModel ?? null,
    usage: response?.usage ?? null,
  };
}

function requestedCall(call) {
  return {
    id: String(call?.id ?? ''),
    name: String(call?.name ?? ''),
    args: call?.args && typeof call.args === 'object' ? structuredClone(call.args) : {},
  };
}

function toolMessage(receipt) {
  return {
    role: 'tool',
    toolCallId: receipt.toolCallId,
    name: receipt.requestedCall.name,
    content: JSON.stringify(receipt),
  };
}

async function executeCall(call, tools, signal) {
  const requested = requestedCall(call);
  const tool = tools.get(requested.name);
  if (!tool) {
    return {
      toolCallId: requested.id,
      requestedCall: requested,
      actualCall: null,
      outcome: 'unavailable',
      result: { error: `Unknown tool: ${requested.name}` },
    };
  }

  if (signal?.aborted) {
    return {
      toolCallId: requested.id,
      requestedCall: requested,
      actualCall: null,
      outcome: 'cancelled',
      result: { stopped: 'aborted' },
    };
  }

  if (typeof tool.preflight === 'function') {
    try {
      const gate = await tool.preflight(requested.args, { signal });
      if (gate?.allowed === false) {
        return {
          toolCallId: requested.id,
          requestedCall: requested,
          actualCall: null,
          outcome: gate.outcome ?? 'not_executed',
          result: structuredClone(gate.result ?? { state: 'not_executed' }),
        };
      }
    } catch (error) {
      return {
        toolCallId: requested.id,
        requestedCall: requested,
        actualCall: null,
        outcome: 'failed',
        result: { error: error?.message ?? String(error), stage: 'preflight' },
      };
    }
  }

  const actualCall = { name: requested.name, args: structuredClone(requested.args) };
  try {
    const result = await tool.execute(requested.args, { signal });
    const outcome = signal?.aborted || result?.stopped === 'aborted'
      ? 'cancelled'
      : (result?.exitCode == null || result.exitCode === 0 ? 'succeeded' : 'failed');
    return { toolCallId: requested.id, requestedCall: requested, actualCall, outcome, result };
  } catch (error) {
    return {
      toolCallId: requested.id,
      requestedCall: requested,
      actualCall,
      outcome: signal?.aborted ? 'cancelled' : 'failed',
      result: {
        error: error?.message ?? String(error),
        ...(signal?.aborted ? { stopped: 'aborted' } : {}),
      },
    };
  }
}

/**
 * Smallest T5 control loop. The model owns judgment and the final answer; the runtime only
 * offers tools, executes requested calls, and returns observations to the model.
 *
 * @param {{
 *   request:string,
 *   history?:Array<{role:'user'|'assistant',content:string}>,
 *   model:{respond:(input:{messages:object[],tools:object[],signal?:AbortSignal})=>Promise<*>},
 *   tools?:Array<{name:string,description:string,parameters:object,execute:Function}>,
 *   signal?:AbortSignal,
 *   maxModelTurns?:number,
 *   onEvent?:(event:object)=>void|Promise<void>,
 * }} input
 */
export async function runAgent({
  request, history = [], model, tools = [], signal, maxModelTurns = DEFAULT_MAX_MODEL_TURNS, onEvent,
}) {
  if (typeof request !== 'string' || !request.trim()) throw new TypeError('request is required');
  if (!model || typeof model.respond !== 'function') throw new TypeError('model.respond is required');
  if (!Number.isInteger(maxModelTurns) || maxModelTurns < 1) throw new TypeError('maxModelTurns must be positive');

  const registry = new Map();
  for (const tool of tools) {
    if (!tool?.name || typeof tool.execute !== 'function') throw new TypeError('tool name and execute are required');
    if (registry.has(tool.name)) throw new TypeError(`duplicate tool: ${tool.name}`);
    registry.set(tool.name, tool);
  }

  const definitions = [...registry.values()].map(toolDefinition);
  const prior = history.filter((message) => (
    (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string'
  )).map((message) => ({ role: message.role, content: message.content }));
  const transcript = [...prior, { role: 'user', content: request }];
  const receipts = [];
  const modelCalls = [];
  let modelTurns = 0;

  while (modelTurns < maxModelTurns) {
    if (signal?.aborted) return { status: 'cancelled', answer: null, transcript, receipts, modelCalls, modelTurns };

    modelTurns += 1;
    await onEvent?.({ type: 'model_start', turn: modelTurns });
    const response = normalizeResponse(await model.respond({
      messages: structuredClone(transcript),
      tools: structuredClone(definitions),
      signal,
    }));
    modelCalls.push({
      turn: modelTurns,
      ...(response.responseId ? { responseId: response.responseId } : {}),
      ...(response.responseModel ? { responseModel: response.responseModel } : {}),
      ...(response.usage ? { usage: structuredClone(response.usage) } : {}),
    });
    await onEvent?.({
      type: 'model_end',
      turn: modelTurns,
      response: {
        text: response.text,
        toolCalls: structuredClone(response.toolCalls),
        responseId: response.responseId,
        responseModel: response.responseModel,
        usage: structuredClone(response.usage),
      },
    });
    transcript.push({
      role: 'assistant',
      content: response.text,
      ...(response.toolCalls.length ? { toolCalls: structuredClone(response.toolCalls) } : {}),
    });

    if (!response.toolCalls.length) {
      return { status: 'completed', answer: response.text, transcript, receipts, modelCalls, modelTurns };
    }

    for (const call of response.toolCalls) {
      if (signal?.aborted) return { status: 'cancelled', answer: null, transcript, receipts, modelCalls, modelTurns };
      await onEvent?.({
        type: 'tool_start', turn: modelTurns, toolCallId: String(call?.id ?? ''),
        name: call?.name, args: structuredClone(call?.args ?? {}),
      });
      const receipt = await executeCall(call, registry, signal);
      receipts.push(receipt);
      transcript.push(toolMessage(receipt));
      await onEvent?.({
        type: 'tool_end', turn: modelTurns, name: call?.name, outcome: receipt.outcome,
        receipt: structuredClone(receipt),
      });
      if (signal?.aborted || receipt.outcome === 'cancelled') {
        return { status: 'cancelled', answer: null, transcript, receipts, modelCalls, modelTurns };
      }
    }
  }

  return { status: 'limit_reached', answer: null, transcript, receipts, modelCalls, modelTurns };
}
