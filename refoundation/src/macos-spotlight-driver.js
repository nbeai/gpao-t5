import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HELPER = resolve(here, '../../../runtime/bin/t5-memory-spotlight');

async function invokeHelper(helper, payload, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'], shell: false,
      env: { PATH: '/usr/bin:/bin' } });
    const stdout = []; const stderr = []; let settled = false;
    const timer = setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => { clearTimeout(timer); settled = true; reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer); settled = true;
      const output = Buffer.concat(stdout).toString('utf8');
      if (code !== 0) return reject(Object.assign(new Error('Spotlight helper failed'), {
        code: 'T5_SPOTLIGHT_HELPER', helperExitCode: code,
        helperErrorKind: Buffer.concat(stderr).toString('utf8').slice(0, 256),
      }));
      try { resolvePromise(JSON.parse(output)); }
      catch { reject(Object.assign(new Error('Spotlight helper returned invalid JSON'),
        { code: 'T5_SPOTLIGHT_PROTOCOL' })); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function identity(value, label) {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9._:-]{1,512}$/u.test(text)) throw new TypeError(`${label} is invalid`);
  return text;
}

export function makeMacOSSpotlightDriver({
  helper = DEFAULT_HELPER, indexName = 'T5LifeContinuity', invoke = null,
} = {}) {
  const call = invoke ?? ((payload) => invokeHelper(helper, payload));
  const name = identity(indexName, 'indexName');
  async function operation(input) {
    const result = await call({ indexName: name, ...input });
    if (!result || result.ok !== true) throw Object.assign(new Error('Spotlight operation failed'),
      { code: 'T5_SPOTLIGHT_OPERATION', errorKind: result?.errorKind ?? 'unknown' });
    return result;
  }
  return {
    async available() {
      try { return (await operation({ operation: 'available', domain: 't5.life-continuity.memory' })).available === true; }
      catch { return false; }
    },
    async list({ domain }) {
      return (await operation({ operation: 'list', domain: identity(domain, 'domain') })).items ?? [];
    },
    async index(items, { domain }) {
      await operation({ operation: 'index', domain: identity(domain, 'domain'), items });
    },
    async delete(identifiers, { domain }) {
      await operation({ operation: 'delete', domain: identity(domain, 'domain'),
        identifiers: identifiers.map((item) => identity(item, 'identifier')) });
    },
  };
}

export const MACOS_SPOTLIGHT_HELPER = DEFAULT_HELPER;
