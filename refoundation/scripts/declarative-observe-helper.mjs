#!/usr/bin/env node

const MAX_INPUT = 64 * 1024; const MAX_OUTPUT = 256 * 1024;
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > MAX_INPUT) throw new Error('input_too_large');
}
const request = JSON.parse(input); const url = new URL(String(request.url ?? ''));
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
if (url.username || url.password || (url.protocol !== 'https:'
  && !(request.allowLoopbackHttp === true && url.protocol === 'http:' && loopback))) {
  throw new Error('endpoint_not_allowed');
}
const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8_000);
let response;
try {
  response = await fetch(url, { method: 'GET', redirect: 'error', signal: controller.signal,
    headers: { accept: 'application/json', 'user-agent': 'GPAO-T5-declarative-observer/1' } });
} finally { clearTimeout(timer); }
const type = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
if (!response.ok || type !== 'application/json') throw new Error('response_not_json_success');
const reader = response.body?.getReader(); const chunks = []; let total = 0;
if (!reader) throw new Error('response_body_unavailable');
for (;;) {
  const { done, value } = await reader.read(); if (done) break; total += value.byteLength;
  if (total > MAX_OUTPUT) { await reader.cancel(); throw new Error('response_too_large'); }
  chunks.push(Buffer.from(value));
}
const body = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
if (!body || typeof body !== 'object') throw new Error('response_shape_invalid');
process.stdout.write(JSON.stringify({ url: url.href, status: response.status, contentType: type, body }));
