import { spawn } from 'node:child_process';

const APP_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/u;
const MAX_OUTPUT = 256 * 1024;

function runHelper({ program, args, signal, timeoutMs = 5_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, windowsHide: true });
    let stdout = ''; let stderr = ''; let bytes = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const collect = (kind) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) { child.kill(); finish(new Error('accessibility helper output is too large')); return; }
      if (kind === 'stdout') stdout += chunk; else stderr += chunk;
    };
    const abort = () => { child.kill(); finish(new Error('accessibility observation cancelled')); };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.once('error', finish); child.once('close', (code) => {
      if (code !== 0) finish(new Error(`accessibility helper failed: ${stderr.trim().slice(0, 200)}`));
      else { try { finish(null, JSON.parse(stdout)); }
        catch { finish(new Error('accessibility helper returned invalid JSON')); } }
    });
    const timer = setTimeout(() => { child.kill(); finish(new Error('accessibility observation timed out')); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function makeScopedComputerObserver({ program, run = runHelper } = {}) {
  if (!program) throw new TypeError('accessibility helper program is required');
  return { async observe({ allowedAppId, maxNodes = 120, maxDepth = 6, signal } = {}) {
    const appId = String(allowedAppId ?? '');
    if (!APP_ID.test(appId) || !Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 200
      || !Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) {
      throw new TypeError('scoped accessibility request is invalid');
    }
    const result = await run({ program, args: ['--allow-app-id', appId, '--max-nodes', String(maxNodes),
      '--max-depth', String(maxDepth)], signal });
    if (result?.state === 'needs_accessibility_permission') return result;
    if (result?.state !== 'observed') return { state: result?.state ?? 'unavailable' };
    if (result.appId !== appId || !Array.isArray(result.elements)
      || result.elements.length > maxNodes || result.coverage?.maximumNodes !== maxNodes
      || result.coverage?.maximumDepth !== maxDepth) throw new Error('accessibility observation scope mismatch');
    for (const element of result.elements) {
      if (!element || typeof element.role !== 'string' || !Number.isInteger(element.depth)
        || element.depth < 0 || element.depth > maxDepth || typeof element.secret !== 'boolean'
        || (element.secret && typeof element.text === 'string')) {
        throw new Error('accessibility observation contains an invalid element');
      }
    }
    return { state: 'observed', appId, window: { focused: true }, coverage: structuredClone(result.coverage),
      elements: structuredClone(result.elements) };
  } };
}
