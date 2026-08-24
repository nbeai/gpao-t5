import { makeContextReceipt } from './context-receipt.js';
import {
  reserveProviderAttempt, settleProviderSuccess, settleProviderUnknown,
} from './provider-request-accounting.js';
import { takeUnseenUserMessages } from './incremental-user-messages.js';

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-5';

export class AnthropicMessagesError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'AnthropicMessagesError';
    this.status = status;
  }
}

function safeText(value, key) {
  const text = String(value ?? '').slice(0, 2_000);
  return key ? text.split(key).join('[REDACTED]') : text;
}

function imageBlock(item) {
  const match = String(item?.image_url ?? '').match(
    /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (item?.type !== 'input_image' || !match) throw new TypeError('invalid model image attachment');
  return {
    type: 'image', source: { type: 'base64', media_type: `image/${match[1]}`, data: match[2] },
  };
}

function userContent(message) {
  const content = [{ type: 'text', text: String(message?.content ?? '') }];
  for (const item of message?.modelAttachments ?? []) content.push(imageBlock(item));
  return content;
}

function toolUsePart(call) {
  const part = call?.providerPart;
  if (part?.type === 'tool_use' && part.id === call.id && part.name === call.name) {
    return structuredClone(part);
  }
  return {
    type: 'tool_use', id: String(call?.id ?? ''), name: String(call?.name ?? ''),
    input: structuredClone(call?.args ?? {}),
  };
}

function initialMessages(messages = []) {
  const out = [];
  for (const message of messages) {
    if (message?.role === 'user') {
      out.push({ role: 'user', content: userContent(message) });
      continue;
    }
    if (message?.role === 'assistant') {
      const content = [];
      if (String(message.content ?? '')) content.push({ type: 'text', text: String(message.content) });
      for (const call of message.toolCalls ?? []) content.push(toolUsePart(call));
      if (content.length) out.push({ role: 'assistant', content });
      continue;
    }
    if (message?.role === 'tool' && message.toolCallId) {
      const block = {
        type: 'tool_result', tool_use_id: String(message.toolCallId),
        content: String(message.content ?? ''),
      };
      const previous = out.at(-1);
      if (previous?.role === 'user' && previous.content.every((item) => item.type === 'tool_result')) {
        previous.content.push(block);
      } else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

function apiTools(tools = []) {
  return tools.map((tool) => ({
    name: tool.name, description: tool.description, input_schema: tool.parameters, strict: true,
  }));
}

function resultText(content = []) {
  return content.filter((item) => item?.type === 'text').map((item) => item.text ?? '').join('');
}

function resultCalls(content = []) {
  return content.filter((item) => item?.type === 'tool_use').map((item) => {
    if (!item.id || !item.name || !item.input || typeof item.input !== 'object') {
      throw new AnthropicMessagesError('Anthropic returned an invalid tool call');
    }
    return {
      id: item.id, name: item.name, args: structuredClone(item.input),
      providerPart: structuredClone(item),
    };
  });
}

function normalizedUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  return {
    ...structuredClone(usage),
    input_tokens: Number.isFinite(input) ? input : null,
    output_tokens: Number.isFinite(output) ? output : null,
    total_tokens: Number.isFinite(input) && Number.isFinite(output) ? input + output : null,
  };
}

export function makeAnthropicMessagesModel({
  apiKey, model = DEFAULT_MODEL, endpoint = DEFAULT_ENDPOINT, instructions = '',
  maxTokens = 8_192, fetchImpl = globalThis.fetch, dump,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Anthropic API key is required');
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
      messages = [], tools = [], toolChoice = null, signal, onContextReceipt, resourceObserver,
      runtimeContext = '',
    } = {}) {
      const requestInstructions = runtimeContext ? `${instructions}\n\n${runtimeContext}` : instructions;
      if (!started) {
        history.push(...initialMessages(messages));
        takeUnseenUserMessages(messages, seenUsers);
        for (const message of messages) {
          if (message?.role === 'tool' && message.toolCallId) returnedResults.add(message.toolCallId);
        }
        started = true;
      } else {
        history.push(...initialMessages(takeUnseenUserMessages(messages, seenUsers)));
      }
      const newResults = [];
      for (const message of messages) {
        if (message?.role !== 'tool' || !message.toolCallId || returnedResults.has(message.toolCallId)) continue;
        newResults.push({
          type: 'tool_result', tool_use_id: String(message.toolCallId),
          content: String(message.content ?? ''),
        });
        returnedResults.add(message.toolCallId);
      }
      if (newResults.length) history.push({ role: 'user', content: newResults });

      const body = {
        model, max_tokens: maxTokens, system: requestInstructions,
        messages: structuredClone(history), tools: apiTools(tools),
        ...(toolChoice?.requiredToolName ? {
          tool_choice: { type: 'tool', name: toolChoice.requiredToolName },
        } : {}),
      };
      const contextReceipt = makeContextReceipt({
        provider: 'anthropic', model, instructions: requestInstructions, input: body.messages, tools: body.tools,
        sourceMessages: messages, body,
      });
      await onContextReceipt?.(structuredClone(contextReceipt));
      await dump?.({ body, meta: { provider: 'anthropic', endpoint: new URL(endpoint).origin, model } });
      if (signal?.aborted) throw new AnthropicMessagesError('Anthropic request cancelled before dispatch');
      const resourceHandle = await reserveProviderAttempt(resourceObserver, {
        provider: 'anthropic', model, attempt: 1, contextReceipt,
      });
      let response; const responseStart = history.length;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', signal,
          headers: {
            'content-type': 'application/json', 'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_transport_unknown');
        throw new AnthropicMessagesError(`Anthropic request failed: ${safeText(error?.message, key)}`);
      }
      const raw = await response.text();
      if (!response.ok) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_http_error', {
          httpStatus: response.status,
        });
        let detail = raw;
        try { detail = JSON.parse(raw)?.error?.message ?? raw; } catch { /* use bounded raw */ }
        throw new AnthropicMessagesError(
          `Anthropic response ${response.status}: ${safeText(detail, key)}`, { status: response.status },
        );
      }
      let json;
      try { json = JSON.parse(raw); }
      catch {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new AnthropicMessagesError('Anthropic returned invalid JSON', { status: response.status });
      }
      if (!Array.isArray(json.content)) {
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_response_invalid');
        throw new AnthropicMessagesError('Anthropic response has no content blocks', { status: response.status });
      }
      await settleProviderSuccess(resourceObserver, resourceHandle, {
        usage: normalizedUsage(json.usage), responseId: json.id ?? null,
      });
      history.push({ role: 'assistant', content: structuredClone(json.content) }); lastResponseStart = responseStart;
      return {
        text: resultText(json.content), toolCalls: resultCalls(json.content),
        responseId: json.id ?? null, responseModel: json.model ?? model,
        usage: normalizedUsage(json.usage), contextReceipt,
      };
    },
    supersedeLastResponse() {
      if (lastResponseStart == null) return false;
      history.splice(lastResponseStart); lastResponseStart = null; return true;
    },
  };
}
