import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'declarative-observe-helper.mjs');
const MAX_HELPER_OUTPUT = 320 * 1024;

function endpoint(value, allowLoopbackHttp) {
  const url = new URL(String(value ?? ''));
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:'
    && !(allowLoopbackHttp && url.protocol === 'http:' && loopback))) {
    throw new Error('declarative observe endpoint must be credential-free HTTPS');
  }
  return url;
}

function validateArguments(schema, args) {
  if (!schema || schema.type !== 'object' || schema.additionalProperties !== false
    || !schema.properties || typeof schema.properties !== 'object'
    || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('declarative observe arguments are invalid');
  }
  const required = new Set(schema.required ?? []); const allowed = new Set(Object.keys(schema.properties));
  if ([...required].some((key) => !(key in args)) || Object.keys(args).some((key) => !allowed.has(key))) {
    throw new TypeError('declarative observe arguments do not match the closed schema');
  }
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key] ?? {}; const type = rule.type;
    const valid = type === 'string' ? typeof value === 'string'
      : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : type === 'integer' ? Number.isInteger(value)
          : type === 'boolean' ? typeof value === 'boolean' : false;
    if (!valid || (Array.isArray(rule.enum) && !rule.enum.includes(value))
      || (typeof value === 'string' && (value.length > Math.min(rule.maxLength ?? 500, 500)
        || /[\u0000-\u001f\u007f]/u.test(value)))) {
      throw new TypeError(`declarative observe argument ${key} is invalid`);
    }
  }
  return structuredClone(args);
}

function runHelper(input, { signal, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      windowsHide: true,
    });
    let stdout = ''; let stderr = ''; let bytes = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const collect = (kind) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_HELPER_OUTPUT) {
        child.kill(); finish(new Error('declarative observe helper output is too large')); return;
      }
      if (kind === 'stdout') stdout += chunk; else stderr += chunk;
    };
    const abort = () => { child.kill(); finish(new Error('declarative observe cancelled')); };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', finish);
    child.once('close', (code) => {
      if (code !== 0) finish(new Error(`declarative observe helper failed: ${stderr.trim().slice(0, 300)}`));
      else {
        try { finish(null, JSON.parse(stdout)); }
        catch { finish(new Error('declarative observe helper returned invalid JSON')); }
      }
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error('declarative observe timed out')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.end(JSON.stringify(input));
  });
}

export function makeDeclarativeObserveExecutor({ store, run = runHelper, allowLoopbackHttp = false } = {}) {
  if (!store?.openActive) throw new TypeError('active capability package store is required');
  return { async execute({ id, actionId, args, signal } = {}) {
    const active = await store.openActive(String(id ?? '')); const manifest = active.package.manifest;
    if (manifest.kind !== 'declarative_http' || manifest.entrypoint.kind !== 'remote_http'
      || manifest.auth.strategy !== 'none') throw new Error('active capability is not a no-secret declarative observer');
    const action = manifest.actions.find((candidate) => candidate.id === String(actionId ?? ''));
    if (!action || action.effect !== 'observe') throw new Error('declarative action is not observe-only');
    const url = endpoint(manifest.entrypoint.value, allowLoopbackHttp);
    if (action.hosts.length !== 1 || action.hosts[0] !== url.hostname) {
      throw new Error('declarative observe host does not match the active manifest');
    }
    const exactArgs = validateArguments(action.inputSchema, args);
    for (const key of Object.keys(exactArgs).sort()) url.searchParams.set(key, String(exactArgs[key]));
    const observed = await run({ url: url.href, allowLoopbackHttp }, { signal });
    if (observed?.url !== url.href || observed?.status < 200 || observed.status >= 300
      || observed?.contentType !== 'application/json' || !observed.body || typeof observed.body !== 'object') {
      throw new Error('declarative observe host verification failed');
    }
    return { state: 'observed', capability: { id: active.id, version: active.version,
      generationId: active.generationId, actionId: action.id }, source: {
      url: url.href, publisherIdentity: active.package.manifest.source.publisherIdentity,
      observedAt: new Date().toISOString(),
    }, result: structuredClone(observed.body) };
  } };
}
