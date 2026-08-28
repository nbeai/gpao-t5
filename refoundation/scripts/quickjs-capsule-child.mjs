#!/usr/bin/env node
import { evaluateQuickJsTransform } from '../src/ephemeral-program-quickjs.js';

const MAX_REQUEST_BYTES = 3 * 1024 * 1024;
let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk.toString('utf8');
  if (Buffer.byteLength(raw) > MAX_REQUEST_BYTES) throw new Error('quickjs fixture request too large');
}
let request;
try { request = JSON.parse(raw.trim()); } catch { request = null; }
const fields = ['id', 'input', 'maxOutputBytes', 'maxStackSizeBytes', 'memoryLimitBytes', 'source', 'timeoutMs'];
const valid = request && Object.keys(request).sort().join(',') === fields.sort().join(',')
  && typeof request.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(request.id)
  && typeof request.source === 'string' && typeof request.input === 'string'
  && request.source.length > 0 && request.source.length <= 1024 * 1024
  && request.input.length <= 1024 * 1024;
if (!valid) {
  process.stdout.write(`${JSON.stringify({ id: request?.id ?? null, ok: false, reason: 'invalid_request' })}\n`,
    () => process.exit(1));
} else {
  try {
    const value = await evaluateQuickJsTransform(request);
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, value })}\n`, () => process.exit(0));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: false,
      reason: String(error?.message ?? 'program_error').slice(0, 80) })}\n`, () => process.exit(0));
  }
}
