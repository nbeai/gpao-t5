import { createHash } from 'node:crypto';

const VERSION = 'selectable-markdown-v1';
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function visibleMarkdown(source) {
  return String(source ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/<[^>]*>/gu, '')
    .replace(/(\*\*|__|~~|`)/gu, '')
    .replace(/(?<!\w)[*_]|[*_](?!\w)/gu, '');
}

function validUtf16Boundary(text, offset) {
  if (offset <= 0 || offset >= text.length) return true;
  const previous = text.charCodeAt(offset - 1); const current = text.charCodeAt(offset);
  return !(previous >= 0xD800 && previous <= 0xDBFF && current >= 0xDC00 && current <= 0xDFFF);
}

export function projectSelectableMessage(source) {
  const text = visibleMarkdown(source);
  return { version: VERSION, text, digest: sha256(JSON.stringify({ version: VERSION, text })) };
}

export function buildSelectionAnchor({ canonical, request } = {}) {
  if (!canonical || !['user', 'assistant'].includes(canonical.role)
    || !String(canonical.sessionId ?? '') || !String(canonical.messageId ?? '')
    || !Number.isInteger(canonical.sequence) || canonical.sequence < 1) {
    throw new TypeError('canonical selection source is required');
  }
  const projection = projectSelectableMessage(canonical.content);
  if (request?.projectionVersion !== projection.version
    || request?.projectionDigest !== projection.digest) throw new Error('stale selection projection');
  const startUtf16 = request?.startUtf16; const endUtf16 = request?.endUtf16;
  if (!Number.isInteger(startUtf16) || !Number.isInteger(endUtf16)
    || startUtf16 < 0 || endUtf16 <= startUtf16 || endUtf16 > projection.text.length) {
    throw new RangeError('invalid selection range');
  }
  if (!validUtf16Boundary(projection.text, startUtf16)
    || !validUtf16Boundary(projection.text, endUtf16)) throw new Error('invalid UTF-16 boundary');
  const quote = projection.text.slice(startUtf16, endUtf16);
  const sourceContentDigest = sha256(canonical.content);
  const identity = { sessionId: canonical.sessionId, sourceMessageId: canonical.messageId,
    sourceMessageSequence: canonical.sequence, sourceContentDigest,
    projectionVersion: projection.version, projectionDigest: projection.digest, startUtf16, endUtf16 };
  return { schema: 't5.selection-anchor.v1', anchorId: `selection_${sha256(JSON.stringify(identity)).slice(0, 32)}`,
    ...identity, sourceRole: canonical.role, sourceRunId: canonical.runId ?? null, quote,
    prefix: projection.text.slice(Math.max(0, startUtf16 - 32), startUtf16),
    suffix: projection.text.slice(endUtf16, endUtf16 + 32) };
}
