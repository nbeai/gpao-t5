import { makeContextReceipt } from './context-receipt.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.6-flash';

export class GeminiGenerateContentError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = 'GeminiGenerateContentError';
    this.status = status;
  }
}

function safeText(value, key) {
  const text = String(value ?? '').slice(0, 2_000);
  return key ? text.split(key).join('[REDACTED]') : text;
}

function imagePart(item) {
  const match = String(item?.image_url ?? '').match(
    /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/,
  );
  if (item?.type !== 'input_image' || !match) throw new TypeError('invalid model image attachment');
  return { inlineData: { mimeType: `image/${match[1]}`, data: match[2] } };
}

function userParts(message) {
  const parts = [{ text: String(message?.content ?? '') }];
  for (const item of message?.modelAttachments ?? []) parts.push(imagePart(item));
  return parts;
}

function functionPart(call) {
  const part = call?.providerPart;
  if (part?.functionCall?.id === call.id && part.functionCall.name === call.name) {
    return structuredClone(part);
  }
  return {
    functionCall: {
      id: String(call?.id ?? ''), name: String(call?.name ?? ''),
      args: structuredClone(call?.args ?? {}),
    },
  };
}

function initialContents(messages = []) {
  const contents = [];
  for (const message of messages) {
    if (message?.role === 'user') {
      contents.push({ role: 'user', parts: userParts(message) });
      continue;
    }
    if (message?.role === 'assistant') {
      const parts = [];
      if (String(message.content ?? '')) parts.push({ text: String(message.content) });
      for (const call of message.toolCalls ?? []) parts.push(functionPart(call));
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    if (message?.role === 'tool' && message.toolCallId) {
      const part = { functionResponse: {
        id: String(message.toolCallId), name: String(message.name ?? ''),
        response: { result: String(message.content ?? '') },
      } };
      const previous = contents.at(-1);
      if (previous?.role === 'user' && previous.parts.every((item) => item.functionResponse)) {
        previous.parts.push(part);
      } else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}

function apiTools(tools = []) {
  if (!tools.length) return [];
  return [{ functionDeclarations: tools.map((tool) => ({
    name: tool.name, description: tool.description, parameters: geminiSchema(tool.parameters),
  })) }];
}

function geminiSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out = {};
  let type = value.type;
  if (Array.isArray(type)) {
    const concrete = type.filter((item) => item !== 'null');
    if (concrete.length === 1 && concrete.length !== type.length) out.nullable = true;
    type = concrete.length === 1 ? concrete[0] : undefined;
  }
  if (typeof type === 'string') out.type = type;
  for (const key of ['description', 'format', 'minimum', 'maximum', 'minItems', 'maxItems']) {
    if (value[key] != null) out[key] = value[key];
  }
  if (value.nullable === true) out.nullable = true;
  if (Array.isArray(value.enum)) out.enum = value.enum.filter((item) => item != null);
  if (Array.isArray(value.required)) out.required = [...value.required];
  if (value.items) out.items = geminiSchema(value.items);
  if (value.properties && typeof value.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(value.properties).map(
      ([name, schema]) => [name, geminiSchema(schema)],
    ));
  }
  return out;
}

function outputText(parts = []) {
  return parts.filter((part) => typeof part?.text === 'string').map((part) => part.text).join('');
}

function outputCalls(parts = []) {
  return parts.filter((part) => part?.functionCall).map((part) => {
    const call = part.functionCall;
    if (!call.id || !call.name || !call.args || typeof call.args !== 'object') {
      throw new GeminiGenerateContentError('Gemini returned an invalid function call');
    }
    return {
      id: call.id, name: call.name, args: structuredClone(call.args),
      providerPart: structuredClone(part),
    };
  });
}

function normalizedUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.promptTokenCount);
  const output = Number(usage.candidatesTokenCount);
  const reportedTotal = Number(usage.totalTokenCount);
  return {
    ...structuredClone(usage),
    input_tokens: Number.isFinite(input) ? input : null,
    output_tokens: Number.isFinite(output) ? output : null,
    total_tokens: Number.isFinite(reportedTotal) ? reportedTotal
      : Number.isFinite(input) && Number.isFinite(output) ? input + output : null,
  };
}

export function makeGeminiGenerateContentModel({
  apiKey, model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL, instructions = '',
  maxOutputTokens = 8_192, fetchImpl = globalThis.fetch, dump,
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new TypeError('Gemini API key is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const key = apiKey.trim();
  const contents = [];
  const returnedResults = new Set();
  let started = false;
  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/models/${encodeURIComponent(
    String(model).replace(/^models\//, ''),
  )}:generateContent`;

  return {
    id: model,
    async respond({ messages = [], tools = [], toolChoice = null, signal, onContextReceipt } = {}) {
      if (!started) {
        contents.push(...initialContents(messages));
        for (const message of messages) {
          if (message?.role === 'tool' && message.toolCallId) returnedResults.add(message.toolCallId);
        }
        started = true;
      }
      const resultParts = [];
      for (const message of messages) {
        if (message?.role !== 'tool' || !message.toolCallId || returnedResults.has(message.toolCallId)) continue;
        resultParts.push({ functionResponse: {
          id: String(message.toolCallId), name: String(message.name ?? ''),
          response: { result: String(message.content ?? '') },
        } });
        returnedResults.add(message.toolCallId);
      }
      if (resultParts.length) contents.push({ role: 'user', parts: resultParts });
      const providerTools = apiTools(tools);
      const body = {
        contents: structuredClone(contents),
        systemInstruction: { parts: [{ text: instructions }] },
        tools: providerTools,
        ...(toolChoice?.requiredToolName ? { toolConfig: { functionCallingConfig: {
          mode: 'ANY', allowedFunctionNames: [toolChoice.requiredToolName],
        } } } : {}),
        generationConfig: { maxOutputTokens },
      };
      const contextReceipt = makeContextReceipt({
        provider: 'gemini', model, instructions, input: body.contents, tools: body.tools,
        sourceMessages: messages, body,
      });
      await onContextReceipt?.(structuredClone(contextReceipt));
      await dump?.({ body, meta: { provider: 'gemini', endpoint: new URL(endpoint).origin, model } });
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new GeminiGenerateContentError(`Gemini request failed: ${safeText(error?.message, key)}`);
      }
      const raw = await response.text();
      if (!response.ok) {
        let detail = raw;
        try { detail = JSON.parse(raw)?.error?.message ?? raw; } catch { /* use bounded raw */ }
        throw new GeminiGenerateContentError(
          `Gemini response ${response.status}: ${safeText(detail, key)}`, { status: response.status },
        );
      }
      let json;
      try { json = JSON.parse(raw); }
      catch { throw new GeminiGenerateContentError('Gemini returned invalid JSON', { status: response.status }); }
      const content = json?.candidates?.[0]?.content;
      if (!content || !Array.isArray(content.parts)) {
        throw new GeminiGenerateContentError('Gemini response has no candidate content', { status: response.status });
      }
      contents.push(structuredClone(content));
      return {
        text: outputText(content.parts), toolCalls: outputCalls(content.parts),
        responseId: json.responseId ?? null, responseModel: json.modelVersion ?? model,
        usage: normalizedUsage(json.usageMetadata), contextReceipt,
      };
    },
  };
}
