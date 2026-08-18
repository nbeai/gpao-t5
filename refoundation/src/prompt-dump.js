import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|credential|cookie)/i;

function redactString(value, sensitiveValues) {
  let out = value;
  for (const sensitive of sensitiveValues) {
    if (typeof sensitive === 'string' && sensitive) out = out.split(sensitive).join('[REDACTED]');
  }
  return out;
}

function redact(value, sensitiveValues, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value, sensitiveValues);
  if (Array.isArray(value)) return value.map((item) => redact(item, sensitiveValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => (
      [name, redact(item, sensitiveValues, name)]
    )));
  }
  return value;
}

export function makePromptDumper({ directory, sensitiveValues = [] } = {}) {
  if (!directory) throw new TypeError('prompt dump directory is required');
  let sequence = 0;
  return async function dump({ body, meta = {} }) {
    sequence += 1;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const record = redact({ meta, body }, sensitiveValues);
    const file = join(directory, `${String(sequence).padStart(4, '0')}.json`);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return file;
  };
}
