const SCHEMA = 't5.context-receipt.v1';

function utf8Bytes(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function jsonBytes(value) {
  return utf8Bytes(JSON.stringify(value));
}

function add(group, key, bytes) {
  const entry = group[key] ?? { items: 0, bytes: 0 };
  entry.items += 1;
  entry.bytes += bytes;
  group[key] = entry;
}

function inputKind(item) {
  if (item?.type === 'function_call') return 'function_call';
  if (item?.type === 'function_call_output') return 'function_call_output';
  if (item?.type === 'reasoning') return 'reasoning';
  const role = item?.role;
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'developer') {
    return `${role}_message`;
  }
  return item?.type ? String(item.type) : 'other';
}

/** Content-free size receipt derived from the exact provider request body. */
export function makeContextReceipt({
  provider, model, instructions = '', input = [], tools = [], sourceMessages = [], body, serializedBody = null,
} = {}) {
  if (!provider || !model || !body) throw new TypeError('provider, model, and request body are required');
  const inputKinds = {};
  for (const item of input) add(inputKinds, inputKind(item), jsonBytes(item));
  const toolsByName = {};
  for (const tool of tools) {
    const name = String(tool?.name ?? tool?.type ?? 'other');
    add(toolsByName, name, jsonBytes(tool));
  }
  const sourceRoles = {};
  for (const message of sourceMessages) add(sourceRoles, String(message?.role ?? 'other'), jsonBytes(message));
  const currentUser = [...sourceMessages].reverse().find((message) => message?.role === 'user');
  return {
    schema: SCHEMA,
    provider: String(provider),
    model: String(model),
    requestBytes: serializedBody == null ? jsonBytes(body) : utf8Bytes(serializedBody),
    instructionsBytes: utf8Bytes(instructions),
    input: { items: input.length, bytes: jsonBytes(input), byKind: inputKinds },
    tools: { definitions: tools.length, bytes: jsonBytes(tools), byName: toolsByName },
    source: {
      messages: sourceMessages.length,
      bytes: jsonBytes(sourceMessages),
      currentUserBytes: currentUser ? utf8Bytes(currentUser.content) : 0,
      byRole: sourceRoles,
    },
  };
}
