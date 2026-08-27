import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, win32 } from 'node:path';

const MAX_SECRET_BYTES = 512 * 1024;

function safeName(value) {
  const name = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(name)) throw new TypeError('invalid secret name');
  return name;
}

function trustedHost(program) {
  if (!program || !win32.isAbsolute(program)) throw new Error('trusted Windows credential host is unavailable');
  return program;
}

function runNativeDpapi(program, action, input) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, [action], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap((key) => (
        process.env[key] == null ? [] : [[key, process.env[key]]]
      ))),
    });
    const stdout = []; let bytes = 0; let settled = false;
    const timer = setTimeout(() => {
      if (settled) return; settled = true; child.kill(); reject(new Error('Windows DPAPI operation timed out'));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_SECRET_BYTES * 2) child.kill(); else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on('data', () => {});
    child.once('error', (error) => {
      if (settled) return; settled = true; clearTimeout(timer); reject(error);
    });
    child.once('close', (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0 || bytes > MAX_SECRET_BYTES * 2) {
        reject(new Error('Windows DPAPI operation failed')); return;
      }
      resolveRun(Buffer.concat(stdout).toString('utf8'));
    });
    child.stdin.end(input);
  });
}

export function makeWindowsDpapiSecretStore({
  directory = process.env.LOCALAPPDATA
    ? resolve(process.env.LOCALAPPDATA, 'GPAO-T5', 'credentials') : null,
  program = null,
  protect = null,
  unprotect = null,
} = {}) {
  if (!directory) throw new Error('Windows credential directory is unavailable');
  if ((protect == null) !== (unprotect == null)) throw new Error('Windows credential codec is incomplete');
  const nativeProgram = protect == null ? trustedHost(program) : null;
  const protectValue = protect ?? ((plain) => runNativeDpapi(nativeProgram, '--dpapi-protect', plain));
  const unprotectValue = unprotect ?? ((cipher) => runNativeDpapi(nativeProgram, '--dpapi-unprotect', cipher));
  const root = resolve(directory);
  const pathFor = (name) => resolve(root, `${safeName(name)}.dpapi`);
  return {
    async get(name) {
      const path = pathFor(name); let cipher;
      try { cipher = (await readFile(path, 'utf8')).trim(); }
      catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
      if (!/^[A-Za-z0-9+/=]+$/u.test(cipher) || cipher.length > MAX_SECRET_BYTES * 2) {
        throw new Error('Windows DPAPI credential is invalid');
      }
      const plain = await unprotectValue(cipher);
      try { return JSON.parse(plain); }
      catch { throw new Error('Windows DPAPI credential is invalid'); }
    },
    async set(name, value) {
      const serialized = JSON.stringify(value);
      if (!serialized || Buffer.byteLength(serialized) > MAX_SECRET_BYTES) {
        throw new TypeError('workspace secret is too large');
      }
      await mkdir(root, { recursive: true }); await realpath(root);
      const target = pathFor(name);
      try { if ((await lstat(target)).isSymbolicLink()) throw new Error('credential path is a symlink'); }
      catch (error) { if (error?.code !== 'ENOENT') throw error; }
      const cipher = String(await protectValue(serialized)).trim();
      if (!/^[A-Za-z0-9+/=]+$/u.test(cipher) || cipher.length > MAX_SECRET_BYTES * 2) {
        throw new Error('Windows DPAPI operation failed');
      }
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, cipher, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
      if (JSON.stringify(await this.get(name)) !== serialized) {
        await rm(target, { force: true }); throw new Error('Windows DPAPI verification failed');
      }
      return true;
    },
    async clear(name) { await rm(pathFor(name), { force: true }); return true; },
  };
}
