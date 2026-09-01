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
  const items = []; const outputs = new Map(); const callIds = new Set();
  for (const message of messages) {
    if (message?.role === 'assistant') for (const call of message.toolCalls ?? []) {
      const id = String(call.id ?? '');
      if (!id || callIds.has(id)) throw new Error('canonical function call identity is invalid');
      callIds.add(id);
    }
    if (message?.role === 'tool' && message.toolCallId) {
      const id = String(message.toolCallId);
      if (outputs.has(id)) throw new Error('canonical function output identity is duplicated');
      outputs.set(id, message);
    }
  }
  for (const id of outputs.keys()) {
    if (!callIds.has(id)) throw new Error('canonical function output is orphaned');
  }
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
        const callId = String(call.id ?? '');
        items.push({
          type: 'function_call', call_id: callId, name: String(call.name ?? ''),
          arguments: JSON.stringify(call.args ?? {}),
        });
        const output = outputs.get(callId);
        if (output) items.push({
          type: 'function_call_output', call_id: callId,
          output: String(output.content ?? ''),
        });
      }
      continue;
    }
    // Provider protocol requires a function output immediately after its call.
    // Canonical user messages can arrive while a Tool is running, so outputs are
    // paired above without changing the append-only Conversation ordering.
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

function makeSseAccumulator(onTextDelta) {
  const items = []; const deltas = [];
  let completed = null; let failure = null;
  return {
    async accept(block) {
      const payload = String(block).split(/\r?\n/u)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /u, '')).join('\n').trim();
      if (!payload || payload === '[DONE]') return;
      let event;
      try { event = JSON.parse(payload); } catch { return; }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        deltas.push(event.delta);
        await onTextDelta?.({ text: event.delta });
      } else if (event.type === 'response.output_item.done' && event.item) items.push(event.item);
      else if (event.type === 'response.completed' && event.response) completed = event.response;
      else if (event.type === 'response.failed') {
        failure = event.response?.error ?? event.error ?? { code: 'response_failed' };
      } else if (event.type === 'error') failure ??= event.error ?? { code: 'response_error' };
    },
    result() {
      const output = Array.isArray(completed?.output) && completed.output.length ? completed.output : items;
      const streamedText = deltas.join(''); const completedText = textFromOutput(output);
      return {
        id: completed?.id ?? null,
        model: completed?.model ?? null,
        output,
        text: completedText || streamedText,
        streamedText,
        streamTextMatchesFinal: !streamedText || !completedText || streamedText === completedText,
        usage: completed?.usage ?? null,
        failure,
      };
    },
  };
}

async function readSse(raw, onTextDelta) {
  const accumulator = makeSseAccumulator(onTextDelta);
  for (const block of String(raw).split(/\r?\n\r?\n/u)) await accumulator.accept(block);
  return accumulator.result();
}

async function readSseStream(body, onTextDelta) {
  if (!body || typeof body.getReader !== 'function') return null;
  const accumulator = makeSseAccumulator(onTextDelta);
  const decoder = new TextDecoder(); const reader = body.getReader();
  let raw = ''; let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true }); raw += decoded; pending += decoded;
      for (;;) {
        const boundary = /\r?\n\r?\n/u.exec(pending);
        if (!boundary) break;
        const block = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        await accumulator.accept(block);
      }
    }
    const tail = decoder.decode(); raw += tail; pending += tail;
    if (pending.trim()) await accumulator.accept(pending);
    return { raw, parsed: accumulator.result() };
  } finally {
    reader.releaseLock();
  }
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
      runtimeContext = '', onTextDelta, onTextReset,
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
        let attemptStreamed = false;
        const deliverTextDelta = async (event) => {
          attemptStreamed = true; await onTextDelta?.(event);
        };
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
          let raw; let streamed = null;
          if (response.ok) streamed = await readSseStream(response.body, deliverTextDelta);
          raw = streamed?.raw ?? await response.text();
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
            parsed = streamed?.parsed ?? await readSse(raw, deliverTextDelta);
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
            streamedText: parsed.streamedText,
            streamTextMatchesFinal: parsed.streamTextMatchesFinal,
            contextReceipt,
            transmissionReceipt: settleTransmissionReceipt(transmissionReceipt, 'response_received'),
            wireContextMode,
          };
        }
        await settleProviderUnknown(resourceObserver, resourceHandle, 'provider_attempt_failed', {
          httpStatus: transportError.status ?? null,
          retryable: transportError.retriable === true,
        });
        if (attemptStreamed) await onTextReset?.({
          reason: transportError.retriable && attempt < maxAttempts ? 'provider_retry' : 'provider_failed',
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
