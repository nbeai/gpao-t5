import { delimiter, resolve } from 'node:path';

export function resolveConsoleWorkspace(env = process.env, userHome) {
  if (!userHome) throw new TypeError('userHome is required');
  return resolve(env.T5_REFOUNDATION_WORKSPACE ?? userHome);
}

export function sanitizeTerminalPath(value, separator = delimiter) {
  const seen = new Set(); const safe = [];
  for (const entry of String(value ?? '').split(separator).filter(Boolean)) {
    const normalized = entry.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
    if (normalized.endsWith('/refoundation/node_modules/.bin')) continue;
    if (seen.has(entry)) continue;
    seen.add(entry); safe.push(entry);
  }
  return safe.join(separator);
}
