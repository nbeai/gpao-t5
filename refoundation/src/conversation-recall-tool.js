const MAX_READ_CHARS = 16_000;
const DEFAULT_READ_CHARS = 4_000;
const MAX_FIND_MATCHES = 20;
const FIND_EXCERPT_RADIUS = 100;

function allowedKey(messageId, stream) { return `${messageId}\0${stream}`; }

function parseReceipt(entry, stream) {
  if (!entry || entry.message?.role !== 'tool') throw new Error('historical output is not available');
  let receipt;
  try { receipt = JSON.parse(entry.message.content); }
  catch { throw new Error('historical output is not readable'); }
  const text = receipt?.result?.[stream];
  if (typeof text !== 'string') throw new Error(`historical ${stream} is not available`);
  return text;
}

export function makeConversationRecallTool({ ledger, sessionId, allowedRefs = [] } = {}) {
  if (!ledger || !sessionId) throw new TypeError('conversation ledger and session id are required');
  const allowed = new Set(allowedRefs.map((ref) => allowedKey(ref.messageId, ref.stream)));
  async function output(messageId, stream) {
    if (!allowed.has(allowedKey(messageId, stream))) throw new Error('historical output reference is not available');
    const conversation = await ledger.read(sessionId);
    const entry = conversation.entries.find((candidate) => candidate.messageId === messageId);
    return parseReceipt(entry, stream);
  }
  return {
    name: 'conversation_recall',
    description: 'Recover an exact range or find text inside a large historical stdout/stderr referenced by a projected tool result. Use only the provided messageId and stream; this reads the canonical conversation without rerunning the original command.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['find', 'read'] },
        messageId: { type: 'string' },
        stream: { type: 'string', enum: ['stdout', 'stderr'] },
        query: { type: ['string', 'null'] },
        offset: { type: ['integer', 'null'], minimum: 0 },
        limit: { type: ['integer', 'null'], minimum: 1, maximum: MAX_READ_CHARS },
      },
      required: ['action', 'messageId', 'stream', 'query', 'offset', 'limit'],
    },
    async execute({ action, messageId, stream, query, offset, limit }) {
      const text = await output(String(messageId), String(stream));
      if (action === 'read') {
        const start = Number.isInteger(offset) ? Math.min(offset, text.length) : 0;
        const count = Number.isInteger(limit) ? Math.min(limit, MAX_READ_CHARS) : DEFAULT_READ_CHARS;
        const end = Math.min(text.length, start + count);
        return {
          state: 'read', messageId, stream, offset: start, text: text.slice(start, end),
          nextOffset: end < text.length ? end : null, totalChars: text.length,
        };
      }
      if (action !== 'find') throw new Error(`Unknown conversation recall action: ${action}`);
      const needle = String(query ?? '');
      if (!needle || needle.length > 200) throw new TypeError('conversation recall find query is required and must be at most 200 characters');
      const matches = [];
      let cursor = Number.isInteger(offset) ? Math.min(offset, text.length) : 0;
      while (matches.length < MAX_FIND_MATCHES) {
        const found = text.indexOf(needle, cursor);
        if (found < 0) break;
        const excerptStart = Math.max(0, found - FIND_EXCERPT_RADIUS);
        const excerptEnd = Math.min(text.length, found + needle.length + FIND_EXCERPT_RADIUS);
        matches.push({ offset: found, excerptOffset: excerptStart, excerpt: text.slice(excerptStart, excerptEnd) });
        cursor = found + Math.max(1, needle.length);
      }
      return {
        state: 'found', messageId, stream, query: needle, matches,
        totalChars: text.length, matchesTruncated: matches.length === MAX_FIND_MATCHES,
      };
    },
  };
}
