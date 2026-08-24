import { makeContextReceipt } from './context-receipt.js';
import {
  reserveProviderAttempt, settleProviderSuccess, settleProviderUnknown,
} from './provider-request-accounting.js';

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

function imageInputs(message) {
  return (message?.modelAttachments ?? []).map((item) => {
    if (item?.type !== 'input_image' || !['auto', 'low', 'high'].includes(item.detail)
      || !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(item.image_url ?? '')) {
      throw new TypeError('invalid model image attachment');
    }
    return { type: 'input_image', detail: item.detail, image_url: item.image_url };
  });
}

function initialInput(messages) {
  const items = [];
  for (const message of messages) {
    if (message?.role === 'user') {
      const images = imageInputs(message);
      items.push({
        role: 'user',
        content: images.length ? [
          { type: 'input_text', text: String(message.content ?? '') }, ...images,
        ] : String(message.content ?? ''),
      });
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
    async respond({
      messages = [], tools = [], toolChoice = null, signal, onContextReceipt, resourceObserver,
      runtimeContext = '',
    } = {}) {
      const requestInstructions = runtimeContext ? `${instructions}\n\n${runtimeContext}` : instructions;
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
        instructions: requestInstructions,
        input: structuredClone(input),
        tools: apiTools(tools),
        ...(toolChoice?.requiredToolName ? { tool_choice: 'required' } : {}),
        reasoning: { effort: reasoningEffort },
        store: false,
      };
      const contextReceipt = makeContextReceipt({
        provider: 'openai', model, instructions: requestInstructions, input: body.input, tools: body.tools,
        sourceMessages: messages, body,
      });
      await onContextReceipt?.(structuredClone(contextReceipt));
      await dump?.({
        body,
        meta: { provider: 'openai', endpoint: new URL(endpoint).origin, model },
      });

      if (signal?.aborted) throw new OpenAIResponsesError('OpenAI request cancelled before dispatch');
      const resourceHandle = await reserveProviderAttempt(resourceObserver, {
        provider: 'openai', model, attempt: 1, contextReceipt,
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
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_transport_unknown');
        throw new OpenAIResponsesError(`OpenAI request failed: ${safeErrorText(error?.message, key)}`);
      }

      const raw = await response.text();
      if (!response.ok) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_http_error', {
          httpStatus: response.status,
        });
        let detail = raw;
        try { detail = JSON.parse(raw)?.error?.message ?? raw; } catch { /* keep raw error */ }
        throw new OpenAIResponsesError(
          `OpenAI response ${response.status}: ${safeErrorText(detail, key)}`,
          { status: response.status },
        );
      }

      let json;
      try { json = JSON.parse(raw); }
      catch {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new OpenAIResponsesError('OpenAI returned invalid JSON', { status: response.status });
      }
      if (!Array.isArray(json.output)) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new OpenAIResponsesError('OpenAI response has no output items', { status: response.status });
      }

      await settleProviderSuccess(resourceObserver, resourceHandle, {
        usage: json.usage ?? null, responseId: json.id ?? null,
      });
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
