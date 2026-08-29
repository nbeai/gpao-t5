import { makeContextReceipt } from './context-receipt.js';
import { makeTransmissionReceipt, settleTransmissionReceipt } from './transmission-receipt.js';
import {
  reserveProviderAttempt, settleProviderSuccess, settleProviderUnknown,
} from './provider-request-accounting.js';
import { takeUnseenUserMessages } from './incremental-user-messages.js';

const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
const TRANSIENT_CODES = new Set(['server_is_overloaded', 'server_error', 'rate_limit_exceeded', 'empty_response']);

class ChatGptTransportError extends Error {
  constructor(message, { code = null, status = null, retriable = false } = {}) {
    super(message);
    this.name = 'ChatGptTransportError';
    this.code = code;
    this.status = status;
    this.retriable = retriable;
  }
}

function toolDefinitions(tools) {
  return tools.map((tool) => ({
    type: 'function', strict: true, name: tool.name,
    description: tool.description, parameters: tool.parameters,
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
    if (message?.role === 'user' || message?.role === 'assistant') {
      const content = String(message.content ?? '');
      if (message.role === 'user' || content || !Array.isArray(message.toolCalls) || message.toolCalls.length === 0) {
        const images = message.role === 'user' ? imageInputs(message) : [];
        items.push({
          type: 'message', role: message.role,
          content: [{
            type: message.role === 'assistant' ? 'output_text' : 'input_text', text: content,
          }, ...images],
        });
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

function textFromOutput(output) {
  return output.filter((item) => item?.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((content) => content?.type === 'output_text')
    .map((content) => content.text ?? '')
    .join('');
}

function callsFromOutput(output) {
  return output.filter((item) => item?.type === 'function_call').map((item) => {
    let args;
    try { args = JSON.parse(item.arguments ?? '{}'); }
    catch { throw new Error(`Invalid function arguments for ${item.name}`); }
    return { id: item.call_id, name: item.name, args };
  });
}

function readSse(raw) {
  const items = [];
  const deltas = [];
  let completed = null;
  let failure = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') deltas.push(event.delta);
    else if (event.type === 'response.output_item.done' && event.item) items.push(event.item);
    else if (event.type === 'response.completed' && event.response) completed = event.response;
    else if (event.type === 'response.failed') failure = event.response?.error ?? event.error ?? { code: 'response_failed' };
    else if (event.type === 'error') failure ??= event.error ?? { code: 'response_error' };
  }
  const output = Array.isArray(completed?.output) && completed.output.length ? completed.output : items;
  return {
    id: completed?.id ?? null,
    model: completed?.model ?? null,
    output,
    text: deltas.length ? deltas.join('') : textFromOutput(output),
    usage: completed?.usage ?? null,
    failure,
  };
}

function scrub(text, access) {
  return access ? String(text).split(access).join('[REDACTED]') : String(text);
}

function unsupportedInternalCacheHint(status, detail) {
  return status === 400
    && /prompt_cache_retention is not supported on this model/i.test(String(detail ?? ''));
}

/** ChatGPT/Codex account transport. This is an unofficial account backend, not the public API contract. */
export function makeChatGptResponsesModel({
  credentials,
  model,
  endpoint = DEFAULT_ENDPOINT,
  instructions = '',
  fetchImpl = globalThis.fetch,
  dump,
  observeResponse,
  maxAttempts = 3,
  retryDelayMs = 250,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  wireContextMode = 'append-continuation',
} = {}) {
  if (!credentials || typeof credentials.get !== 'function') throw new TypeError('OAuth credentials source is required');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError('maxAttempts must be positive');
  if (!['append-continuation', 'canonical-rebuild'].includes(wireContextMode)) {
    throw new TypeError('unsupported ChatGPT OAuth wire context mode');
  }
  const input = [];
  const returned = new Set();
  const seenUsers = new Map();
  let started = false;
  let lastResponseStart = null;

  return {
    async respond({
      messages = [], tools = [], toolChoice = null, signal, onContextReceipt, onTransmissionReceipt, resourceObserver,
      runtimeContext = '',
    } = {}) {
      const requestInstructions = runtimeContext ? `${instructions}\n\n${runtimeContext}` : instructions;
      const credential = await credentials.get();
      const requestModel = model ?? credential.modelId;
      if (!requestModel) throw new Error('ChatGPT OAuth connection has no model id');
      if (wireContextMode === 'canonical-rebuild') {
        input.splice(0, input.length, ...initialInput(messages));
        returned.clear();
        for (const message of messages) {
          if (message?.role === 'tool' && message.toolCallId) returned.add(message.toolCallId);
        }
        takeUnseenUserMessages(messages, seenUsers); started = true;
      } else if (!started) {
        input.push(...initialInput(messages));
        takeUnseenUserMessages(messages, seenUsers);
        for (const message of messages) {
          if (message?.role === 'tool' && message.toolCallId) returned.add(message.toolCallId);
        }
        started = true;
      } else {
        input.push(...initialInput(takeUnseenUserMessages(messages, seenUsers)));
      }
      for (const message of messages) {
        if (message?.role !== 'tool' || !message.toolCallId || returned.has(message.toolCallId)) continue;
        input.push({
          type: 'function_call_output', call_id: message.toolCallId,
          output: String(message.content ?? ''),
        });
        returned.add(message.toolCallId);
      }
      const body = {
        model: requestModel,
          instructions: requestInstructions,
        input: structuredClone(input),
        tools: toolDefinitions(tools),
        ...(toolChoice?.requiredToolName ? { tool_choice: 'required' } : {}),
        stream: true,
        store: false,
      };
      const serializedBody = JSON.stringify(body);
      const contextReceipt = makeContextReceipt({
          provider: 'chatgpt_oauth', model: requestModel, instructions: requestInstructions,
        input: body.input, tools: body.tools, sourceMessages: messages, body, serializedBody,
      });
      await onContextReceipt?.(structuredClone(contextReceipt));
      const responseStart = input.length;
      const transmissionReceipt = makeTransmissionReceipt({ provider: 'chatgpt_oauth', model: requestModel,
        endpoint, serializedBody });
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await dump?.({
          body,
          meta: {
            provider: 'chatgpt_oauth', endpoint: new URL(endpoint).origin,
            model: requestModel, attempt,
          },
        });

        if (signal?.aborted) throw new ChatGptTransportError('ChatGPT OAuth request cancelled before dispatch');
        const resourceHandle = await reserveProviderAttempt(resourceObserver, {
          provider: 'chatgpt_oauth', model: requestModel, attempt, contextReceipt,
        });
        await onTransmissionReceipt?.({ ...structuredClone(transmissionReceipt), attempt });
        let parsed;
        let transportError;
        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${credential.access}`,
              ...(credential.accountId ? { 'chatgpt-account-id': credential.accountId } : {}),
              accept: 'text/event-stream',
            },
            body: serializedBody,
            signal,
          });
          await onTransmissionReceipt?.({ ...settleTransmissionReceipt(transmissionReceipt, 'response_received'), attempt });
          const raw = await response.text();
          await observeResponse?.({ status: response.status, raw, attempt });
          if (!response.ok) {
            const detail = scrub(raw.slice(0, 2_000), credential.access);
            const cacheHintRejected = unsupportedInternalCacheHint(response.status, detail);
            transportError = new ChatGptTransportError(`ChatGPT OAuth response ${response.status}: ${detail}`, {
              code: cacheHintRejected ? 'unsupported_prompt_cache_retention' : `http_${response.status}`,
              status: response.status,
              retriable: cacheHintRejected || response.status === 429 || response.status >= 500,
            });
          } else {
            parsed = readSse(raw);
            if (parsed.failure) {
              const code = parsed.failure.code ?? parsed.failure.type ?? 'response_failed';
              transportError = new ChatGptTransportError(parsed.failure.message ?? code, {
                code, status: response.status, retriable: TRANSIENT_CODES.has(code),
              });
            } else if (!parsed.text && !parsed.output.length) {
              transportError = new ChatGptTransportError('ChatGPT OAuth returned an empty response', {
                code: 'empty_response', status: response.status, retriable: true,
              });
            }
          }
        } catch (error) {
          if (signal?.aborted) {
            await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_cancelled_unknown');
            throw error;
          }
          transportError = error instanceof ChatGptTransportError ? error : new ChatGptTransportError(
            `ChatGPT OAuth request failed: ${scrub(error?.message ?? error, credential.access)}`,
            { code: 'network_error', retriable: true },
          );
        }

        if (!transportError) {
          await settleProviderSuccess(resourceObserver, resourceHandle, {
            usage: parsed.usage ?? null, responseId: parsed.id ?? null,
          });
          if (wireContextMode === 'append-continuation') input.push(...structuredClone(parsed.output));
          lastResponseStart = wireContextMode === 'append-continuation' ? responseStart : null;
          return {
            text: parsed.text,
            toolCalls: callsFromOutput(parsed.output),
            responseId: parsed.id,
            responseModel: parsed.model,
            usage: parsed.usage,
            contextReceipt,
            transmissionReceipt: settleTransmissionReceipt(transmissionReceipt, 'response_received'),
            wireContextMode,
          };
        }
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_attempt_failed', {
          httpStatus: transportError.status ?? null,
          retryable: transportError.retriable === true,
        });
        if (!transportError.retriable || attempt === maxAttempts) throw transportError;
        await wait(retryDelayMs * attempt);
      }
      throw new ChatGptTransportError('ChatGPT OAuth attempts exhausted');
    },
    supersedeLastResponse() {
      if (lastResponseStart == null) return false;
      input.splice(lastResponseStart); lastResponseStart = null; return true;
    },
  };
}
