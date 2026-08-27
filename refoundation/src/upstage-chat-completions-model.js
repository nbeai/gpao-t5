import { makeContextReceipt } from './context-receipt.js';
import { makeTransmissionReceipt, settleTransmissionReceipt } from './transmission-receipt.js';
import {
  reserveProviderAttempt, settleProviderSuccess, settleProviderUnknown,
} from './provider-request-accounting.js';
import { takeUnseenUserMessages } from './incremental-user-messages.js';

const DEFAULT_ENDPOINT = 'https://api.upstage.ai/v1/chat/completions';
const DEFAULT_MODEL = 'solar-pro4';

export class UpstageChatCompletionsError extends Error {
  constructor(message, { status = null, reason = null, provider = 'upstage', modelId = null } = {}) {
    super(message);
    this.name = 'UpstageChatCompletionsError';
    this.status = status;
    this.reason = reason;
    this.provider = provider;
    this.modelId = modelId;
  }
}

function safeText(value, key) {
  const text = String(value ?? '').slice(0, 2_000);
  return key ? text.split(key).join('[REDACTED]') : text;
}

function toolPart(call) {
  const part = call?.providerPart;
  if (part?.type === 'function' && part.id === call.id
    && part.function?.name === call.name && typeof part.function.arguments === 'string') {
    return structuredClone(part);
  }
  return {
    id: String(call?.id ?? ''), type: 'function', function: {
      name: String(call?.name ?? ''), arguments: JSON.stringify(call?.args ?? {}),
    },
  };
}

function initialMessages(messages = [], instructions = '', model = DEFAULT_MODEL) {
  const out = [];
  if (instructions) out.push({ role: 'system', content: instructions });
  for (const message of messages) {
    if (message?.role === 'user') {
      if ((message.modelAttachments?.length ?? 0) > 0) {
        throw new UpstageChatCompletionsError('Upstage Chat attachment input is not enabled', {
          reason: 'image_input_unsupported', modelId: model,
        });
      }
      out.push({ role: 'user', content: String(message.content ?? '') });
      continue;
    }
    if (message?.role === 'assistant') {
      const item = { role: 'assistant', content: String(message.content ?? '') || null };
      if (message.toolCalls?.length) item.tool_calls = message.toolCalls.map(toolPart);
      out.push(item);
      continue;
    }
    if (message?.role === 'tool' && message.toolCallId) {
      out.push({
        role: 'tool', tool_call_id: String(message.toolCallId),
        content: String(message.content ?? ''),
      });
    }
  }
  return out;
}

function apiTools(tools = []) {
  return tools.map((tool) => ({
    type: 'function', function: {
      name: tool.name, description: tool.description, parameters: tool.parameters,
    },
  }));
}

function resultCalls(message) {
  return (message?.tool_calls ?? []).map((item) => {
    if (!item?.id || item.type !== 'function' || !item.function?.name
      || typeof item.function.arguments !== 'string') {
      throw new UpstageChatCompletionsError('Upstage returned an invalid tool call');
    }
    let args;
    try { args = JSON.parse(item.function.arguments); }
    catch {
      throw new UpstageChatCompletionsError(
        `Upstage returned invalid function arguments for ${item.function.name}`,
      );
    }
    return {
      id: item.id, name: item.function.name, args,
      providerPart: structuredClone(item),
    };
  });
}

function normalizedUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.prompt_tokens);
  const output = Number(usage.completion_tokens);
  const total = Number(usage.total_tokens);
  return {
    ...structuredClone(usage),
    input_tokens: Number.isFinite(input) ? input : null,
    output_tokens: Number.isFinite(output) ? output : null,
    total_tokens: Number.isFinite(total) ? total
      : Number.isFinite(input) && Number.isFinite(output) ? input + output : null,
  };
}

export function makeUpstageChatCompletionsModel({
  apiKey, model = DEFAULT_MODEL, endpoint = DEFAULT_ENDPOINT, instructions = '',
  reasoningEffort = 'medium', fetchImpl = globalThis.fetch, dump,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Upstage API key is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const key = apiKey.trim();
  const history = [];
  const returnedResults = new Set();
  const seenUsers = new Map();
  let started = false;
  let lastResponseStart = null;

  return {
    id: model,
    async respond({
      messages = [], tools = [], toolChoice = null, signal, onContextReceipt, onTransmissionReceipt, resourceObserver,
      runtimeContext = '',
    } = {}) {
      const requestInstructions = runtimeContext ? `${instructions}\n\n${runtimeContext}` : instructions;
      if (!started) {
        history.push(...initialMessages(messages, '', model));
        takeUnseenUserMessages(messages, seenUsers);
        for (const message of messages) {
          if (message?.role === 'tool' && message.toolCallId) returnedResults.add(message.toolCallId);
        }
        started = true;
      } else {
        history.push(...initialMessages(takeUnseenUserMessages(messages, seenUsers), '', model));
      }
      for (const message of messages) {
        if (message?.role !== 'tool' || !message.toolCallId || returnedResults.has(message.toolCallId)) continue;
        history.push({
          role: 'tool', tool_call_id: String(message.toolCallId),
          content: String(message.content ?? ''),
        });
        returnedResults.add(message.toolCallId);
      }

      const convertedTools = apiTools(tools);
      const requestMessages = requestInstructions
        ? [{ role: 'system', content: requestInstructions }, ...structuredClone(history)]
        : structuredClone(history);
      const body = {
        model, messages: requestMessages, reasoning_effort: reasoningEffort,
        ...(convertedTools.length ? { tools: convertedTools,
          tool_choice: toolChoice?.requiredToolName
            ? { type: 'function', function: { name: toolChoice.requiredToolName } } : 'auto' } : {}),
      };
      const serializedBody = JSON.stringify(body);
      const contextReceipt = makeContextReceipt({
        provider: 'upstage', model, instructions: requestInstructions, input: body.messages,
        tools: body.tools ?? [], sourceMessages: messages, body, serializedBody,
      });
      await onContextReceipt?.(structuredClone(contextReceipt));
      await dump?.({ body, meta: { provider: 'upstage', endpoint: new URL(endpoint).origin, model } });

      if (signal?.aborted) throw new UpstageChatCompletionsError('Upstage request cancelled before dispatch');
      const resourceHandle = await reserveProviderAttempt(resourceObserver, {
        provider: 'upstage', model, attempt: 1, contextReceipt,
      });
      const transmissionReceipt = makeTransmissionReceipt({ provider: 'upstage', model,
        endpoint, serializedBody });
      await onTransmissionReceipt?.(structuredClone(transmissionReceipt));
      let response; const responseStart = history.length;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: serializedBody,
        });
        await onTransmissionReceipt?.(settleTransmissionReceipt(transmissionReceipt, 'response_received'));
      } catch (error) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_transport_unknown');
        throw new UpstageChatCompletionsError(
          `Upstage request failed: ${safeText(error?.message, key)}`,
        );
      }
      const raw = await response.text();
      if (!response.ok) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_http_error', {
          httpStatus: response.status,
        });
        let detail = raw;
        try { detail = JSON.parse(raw)?.error?.message ?? raw; } catch { /* use bounded raw */ }
        throw new UpstageChatCompletionsError(
          `Upstage response ${response.status}: ${safeText(detail, key)}`,
          { status: response.status },
        );
      }
      let json;
      try { json = JSON.parse(raw); }
      catch {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new UpstageChatCompletionsError('Upstage returned invalid JSON', {
          status: response.status,
        });
      }
      const message = json?.choices?.[0]?.message;
      if (!message || (!('content' in message) && !Array.isArray(message.tool_calls))) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new UpstageChatCompletionsError('Upstage response has no assistant message', {
          status: response.status,
        });
      }
      const assistant = {
        role: 'assistant', content: typeof message.content === 'string' ? message.content : null,
        ...(typeof message.reasoning === 'string' ? { reasoning: message.reasoning } : {}),
        ...(message.tool_calls?.length ? { tool_calls: structuredClone(message.tool_calls) } : {}),
      };
      await settleProviderSuccess(resourceObserver, resourceHandle, {
        usage: normalizedUsage(json.usage), responseId: json.id ?? null,
      });
      history.push(assistant); lastResponseStart = responseStart;
      return {
        text: typeof message.content === 'string' ? message.content : '',
        toolCalls: resultCalls(message), responseId: json.id ?? null,
        responseModel: json.model ?? model, usage: normalizedUsage(json.usage), contextReceipt,
        transmissionReceipt: settleTransmissionReceipt(transmissionReceipt, 'response_received'),
      };
    },
    supersedeLastResponse() {
      if (lastResponseStart == null) return false;
      history.splice(lastResponseStart); lastResponseStart = null; return true;
    },
  };
}
