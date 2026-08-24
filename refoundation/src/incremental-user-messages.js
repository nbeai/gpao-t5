function key(message) {
  return JSON.stringify({ content: String(message?.content ?? ''),
    attachments: message?.modelAttachments ?? [] });
}

export function takeUnseenUserMessages(messages = [], seen = new Map()) {
  const occurrences = new Map(); const unseen = [];
  for (const message of messages) {
    if (message?.role !== 'user') continue;
    const base = key(message); const ordinal = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, ordinal);
    if (ordinal > (seen.get(base) ?? 0)) unseen.push(message);
  }
  for (const [base, count] of occurrences) seen.set(base, Math.max(seen.get(base) ?? 0, count));
  return unseen;
}
