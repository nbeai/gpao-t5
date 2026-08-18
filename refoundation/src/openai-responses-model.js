import { makeContextReceipt } from './context-receipt.js';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-terra';

export class OpenAIResponsesError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'OpenAIResponsesError';
    this.status = status;
  }
}

function safeErrorText(text, apiKey) {
  const limited = String(text ?? '').slice(0, 2_000);
  return apiKey ? limited.split(apiKey).join('[REDACTED]') : limited;
}

function outputText(output = []) {
  const parts = [];
  for (const item of output) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
      else if (content?.type === 'refusal' && typeof content.refusal === 'string') parts.push(content.refusal);
    }
  }
  return parts.join('');
}

function functionCalls(output = []) {
  return output.filter((item) => item?.type === 'function_call').map((item) => {
    let args;
    try { args = JSON.parse(item.arguments); }
    catch { throw new OpenAIResponsesError(`Invalid function arguments for ${item.name}`); }
    return { id: item.call_id, name: item.name, args };
  });
}

function apiTools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    strict: true,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function initialInput(messages) {
  const items = [];
  for (const message of messages) {
    if (message?.role === 'user') {
      items.push({ role: 'user', content: String(message.content ?? '') });
      continue;
    }
    if (message?.role === 'assistant') {
      const content = String(message.content ?? '');
      if (content || !Array.isArray(message.toolCalls) || message.toolCalls.length === 0) {
        items.push({ role: 'assistant', content });
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: 'function_call', call_id: String(call.id ?? ''), name: String(call.name ?? ''),
          arguments: JSON.stringify(call.args ?? {}),
        });
      }
      continue;
    }
    if (message?.role === 'tool' && message.toolCallId) {
      items.push({
        type: 'function_call_output', call_id: String(message.toolCallId),
        output: String(message.content ?? ''),
      });
    }
  }
  return items;
}

/**
 * OpenAI Responses API adapter using manual history so `store:false` can be preserved.
 * The adapter retains every response output item, including opaque reasoning items, and appends
 * tool observations with the exact function `call_id` on the following request.
 */
export function makeOpenAIResponsesModel({
  apiKey,
  model = DEFAULT_MODEL,
  endpoint = DEFAULT_ENDPOINT,
  instructions = '',
  reasoningEffort = 'medium',
  fetchImpl = globalThis.fetch,
  dump,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('OpenAI API key is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  const key = apiKey.trim();
  const input = [];
  const returnedToolCalls = new Set();
  let started = false;

  return {
    id: model,
    async respond({ messages = [], tools = [], signal, onContextReceipt } = {}) {
      if (!started) {
        input.push(...initialInput(messages));
        for (const message of messages) {
          if (message?.role === 'tool' && message.toolCallId) returnedToolCalls.add(message.toolCallId);
        }
        started = true;
      }

      for (const message of messages) {
        if (message?.role !== 'tool' || !message.toolCallId || returnedToolCalls.has(message.toolCallId)) continue;
        input.push({
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: String(message.content ?? ''),
        });
        returnedToolCalls.add(message.toolCallId);
      }

      const body = {
        model,
        instructions,
        input: structuredClone(input),
        tools: apiTools(tools),
        reasoning: { effort: reasoningEffort },
        store: false,
      };
      const contextReceipt = makeContextReceipt({
        provider: 'openai', model, instructions, input: body.input, tools: body.tools,
        sourceMessages: messages, body,
      });
      await onContextReceipt?.(structuredClone(contextReceipt));
      await dump?.({
        body,
        meta: { provider: 'openai', endpoint: new URL(endpoint).origin, model },
      });

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        throw new OpenAIResponsesError(`OpenAI request failed: ${safeErrorText(error?.message, key)}`);
      }

      const raw = await response.text();
      if (!response.ok) {
        let detail = raw;
        try { detail = JSON.parse(raw)?.error?.message ?? raw; } catch { /* keep raw error */ }
        throw new OpenAIResponsesError(
          `OpenAI response ${response.status}: ${safeErrorText(detail, key)}`,
          { status: response.status },
        );
      }

      let json;
      try { json = JSON.parse(raw); }
      catch { throw new OpenAIResponsesError('OpenAI returned invalid JSON', { status: response.status }); }
      if (!Array.isArray(json.output)) {
        throw new OpenAIResponsesError('OpenAI response has no output items', { status: response.status });
      }

      input.push(...structuredClone(json.output));
      return {
        text: outputText(json.output),
        toolCalls: functionCalls(json.output),
        responseId: json.id ?? null,
        responseModel: json.model ?? model,
        usage: json.usage ?? null,
        contextReceipt,
      };
    },
  };
}
