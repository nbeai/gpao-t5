import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import pty from 'node-pty';

const KEYCHAIN_SERVICE = 'kr.co.gpao.t5.workspace';

function runSecurity(file, args, { input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { child.kill('SIGTERM'); return; }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', reject);
    child.once('close', (code) => resolve({
      exitCode: Number(code ?? 1),
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
    child.stdin.end(input);
  });
}

const CHUNK_SCHEMA = 't5.keychain.chunks.v1';
const CHUNK_CHARS = 512;

function runSecurityCommands(commands, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(commands) || !commands.length || commands.some((command) => (
      typeof command !== 'string' || command.length > 900 || /[\r\n]/u.test(command)
    ))) { reject(new TypeError('invalid Keychain command batch')); return; }
    const terminal = pty.spawn('/usr/bin/security', ['-i'], {
      name: 'xterm-256color', cols: 80, rows: 24, env: { PATH: '/usr/bin:/bin' },
    });
    let tail = '';
    let index = 0;
    let completed = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; terminal.kill(); }, timeoutMs);
    terminal.onData((chunk) => {
      tail = `${tail}${String(chunk)}`.slice(-64);
      if (!tail.includes('security>')) return;
      tail = '';
      if (index < commands.length) terminal.write(`${commands[index++]}\r`);
      else { completed = true; terminal.kill(); }
    });
    terminal.onExit(() => {
      clearTimeout(timer);
      if (timedOut || !completed) reject(new Error('Keychain command batch timed out'));
      else resolve(true);
    });
  });
}

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function chunkAccount(account, generation, index) {
  return safeName(`${account}-${generation}-${String(index).padStart(4, '0')}`);
}
function manifestFrom(raw) {
  const value = String(raw ?? '').trim();
  try {
    const direct = JSON.parse(value);
    if (direct && typeof direct === 'object' && direct.schema !== CHUNK_SCHEMA) return { legacy: direct };
  } catch { /* try chunk manifest */ }
  try {
    const manifest = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (manifest?.schema === CHUNK_SCHEMA
      && /^[0-9a-f]{12}$/u.test(manifest.generation ?? '')
      && Number.isInteger(manifest.count) && manifest.count > 0 && manifest.count <= 2_000
      && /^[0-9a-f]{64}$/u.test(manifest.sha256 ?? '')) return { manifest };
  } catch { /* invalid below */ }
  return null;
}

async function readItem(run, account) {
  const result = await run('/usr/bin/security', [
    'find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w',
  ]);
  if (result.exitCode === 44) return null;
  if (result.exitCode !== 0) throw new Error('macOS Keychain에서 연결 자격을 읽지 못했어요.');
  return result.stdout.trim();
}

async function deleteItem(run, account) {
  const result = await run('/usr/bin/security', [
    'delete-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE,
  ]);
  if (result.exitCode !== 0 && result.exitCode !== 44) {
    throw new Error('macOS Keychain의 연결 자격을 지우지 못했어요.');
  }
}

async function deleteChunks(run, account, manifest) {
  if (!manifest) return;
  await Promise.all(Array.from({ length: manifest.count }, (_, index) => (
    deleteItem(run, chunkAccount(account, manifest.generation, index))
  )));
}

async function defaultWriteSecret({ run, account, serialized }) {
  const encoded = Buffer.from(serialized, 'utf8').toString('base64');
  const chunks = encoded.match(new RegExp(`.{1,${CHUNK_CHARS}}`, 'gu')) ?? [];
  const generation = randomBytes(6).toString('hex');
  const items = chunks.map((value, index) => ({
    account: chunkAccount(account, generation, index), value,
  }));
  const commands = items.map((item) => (
    `add-generic-password -a ${item.account} -s ${KEYCHAIN_SERVICE} -l GPAO-T5-${item.account} -U -w ${item.value}`
  ));
  await runSecurityCommands(commands, { timeoutMs: Math.max(10_000, commands.length * 2_000) });
  try {
    for (const item of items) {
      if (await readItem(run, item.account) !== item.value) throw new Error('Keychain chunk verification failed');
    }
    const manifest = {
      schema: CHUNK_SCHEMA, generation, count: items.length,
      sha256: hash(serialized), bytes: Buffer.byteLength(serialized),
    };
    const manifestValue = Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64');
    await runSecurityCommands([
      `add-generic-password -a ${account} -s ${KEYCHAIN_SERVICE} -l GPAO-T5-${account} -U -w ${manifestValue}`,
    ]);
    if (await readItem(run, account) !== manifestValue) throw new Error('Keychain manifest verification failed');
    return manifest;
  } catch (error) {
    await deleteChunks(run, account, { generation, count: items.length }).catch(() => {});
    throw error;
  }
}

function safeName(value) {
  const name = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(name)) throw new TypeError('invalid secret name');
  return name;
}

export function makePlatformSecretStore({
  platform = process.platform, run = runSecurity, writeSecret = null,
} = {}) {
  if (platform !== 'darwin') throw new Error('secure credential store is not implemented for this platform');
  return {
    async get(name) {
      const account = safeName(name);
      const raw = await readItem(run, account);
      if (raw == null) return null;
      const decoded = manifestFrom(raw);
      if (decoded?.legacy) return decoded.legacy;
      if (!decoded?.manifest) throw new Error('macOS Keychain의 연결 자격 형식을 읽지 못했어요.');
      const chunks = [];
      for (let index = 0; index < decoded.manifest.count; index += 1) {
        const chunk = await readItem(run, chunkAccount(account, decoded.manifest.generation, index));
        if (chunk == null) throw new Error('macOS Keychain의 연결 자격 일부를 읽지 못했어요.');
        chunks.push(chunk);
      }
      const serialized = Buffer.from(chunks.join(''), 'base64').toString('utf8');
      if (Buffer.byteLength(serialized) !== decoded.manifest.bytes
        || hash(serialized) !== decoded.manifest.sha256) {
        throw new Error('macOS Keychain의 연결 자격 무결성을 확인하지 못했어요.');
      }
      try { return JSON.parse(serialized); }
      catch { throw new Error('macOS Keychain의 연결 자격 형식을 읽지 못했어요.'); }
    },
    async set(name, value) {
      const account = safeName(name);
      const serialized = JSON.stringify(value);
      if (!serialized || Buffer.byteLength(serialized) > 512 * 1024) throw new TypeError('workspace secret is too large');
      const previousRaw = await readItem(run, account);
      const previous = manifestFrom(previousRaw)?.manifest ?? null;
      await (writeSecret ?? defaultWriteSecret)({ run, account, serialized });
      await deleteChunks(run, account, previous).catch(() => {});
      return true;
    },
    async clear(name) {
      const account = safeName(name);
      const raw = await readItem(run, account);
      const manifest = manifestFrom(raw)?.manifest ?? null;
      await deleteItem(run, account);
      await deleteChunks(run, account, manifest);
      return true;
    },
  };
}
