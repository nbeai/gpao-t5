const DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

function toolDefinitions(tools) {
  return tools.map((tool) => ({
    type: 'function', strict: true, name: tool.name,
    description: tool.description, parameters: tool.parameters,
  }));
}

function initialInput(messages) {
  return messages.filter((message) => message?.role === 'user').map((message) => ({
    type: 'message', role: 'user',
    content: [{ type: 'input_text', text: String(message.content ?? '') }],
  }));
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
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') deltas.push(event.delta);
    else if (event.type === 'response.output_item.done' && event.item) items.push(event.item);
    else if (event.type === 'response.completed' && event.response) completed = event.response;
  }
  const output = Array.isArray(completed?.output) && completed.output.length ? completed.output : items;
  return {
    id: completed?.id ?? null,
    model: completed?.model ?? null,
    output,
    text: deltas.length ? deltas.join('') : textFromOutput(output),
    usage: completed?.usage ?? null,
  };
}

function scrub(text, access) {
  return access ? String(text).split(access).join('[REDACTED]') : String(text);
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
} = {}) {
  if (!credentials || typeof credentials.get !== 'function') throw new TypeError('OAuth credentials source is required');
  const input = [];
  const returned = new Set();
  let started = false;

  return {
    async respond({ messages = [], tools = [], signal } = {}) {
      const credential = await credentials.get();
      const requestModel = model ?? credential.modelId;
      if (!requestModel) throw new Error('ChatGPT OAuth connection has no model id');
      if (!started) {
        input.push(...initialInput(messages));
        started = true;
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
        instructions,
        input: structuredClone(input),
        tools: toolDefinitions(tools),
        stream: true,
        store: false,
      };
      await dump?.({
        body,
        meta: { provider: 'chatgpt_oauth', endpoint: new URL(endpoint).origin, model: requestModel },
      });

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${credential.access}`,
            ...(credential.accountId ? { 'chatgpt-account-id': credential.accountId } : {}),
            accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        throw new Error(`ChatGPT OAuth request failed: ${scrub(error?.message ?? error, credential.access)}`);
      }
      if (!response.ok) {
        const detail = scrub((await response.text()).slice(0, 2_000), credential.access);
        throw Object.assign(new Error(`ChatGPT OAuth response ${response.status}: ${detail}`), { status: response.status });
      }

      const raw = await response.text();
      await observeResponse?.({ status: response.status, raw });
      const parsed = readSse(raw);
      input.push(...structuredClone(parsed.output));
      return {
        text: parsed.text,
        toolCalls: callsFromOutput(parsed.output),
        responseId: parsed.id,
        responseModel: parsed.model,
        usage: parsed.usage,
      };
    },
  };
}
