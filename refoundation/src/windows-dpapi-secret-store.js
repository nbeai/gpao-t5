import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, win32 } from 'node:path';

const MAX_SECRET_BYTES = 512 * 1024;
const PROTECT = [
  "$ErrorActionPreference='Stop'",
  '[Console]::InputEncoding=(New-Object System.Text.UTF8Encoding($false))',
  '[Console]::OutputEncoding=(New-Object System.Text.UTF8Encoding($false))',
  'Add-Type -AssemblyName System.Security',
  '$plain=[string]::Join([Environment]::NewLine,@($input))',
  '$bytes=[Text.Encoding]::UTF8.GetBytes($plain)',
  '$cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($cipher))',
].join(';');
const UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  '[Console]::InputEncoding=(New-Object System.Text.UTF8Encoding($false))',
  '[Console]::OutputEncoding=(New-Object System.Text.UTF8Encoding($false))',
  'Add-Type -AssemblyName System.Security',
  '$encoded=[string]::Join([Environment]::NewLine,@($input))',
  '$cipher=[Convert]::FromBase64String($encoded)',
  '$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))',
].join(';');

function safeName(value) {
  const name = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(name)) throw new TypeError('invalid secret name');
  return name;
}

function trustedPowerShell(env = process.env) {
  const root = env.SystemRoot ?? env.WINDIR;
  if (!root || !win32.isAbsolute(root)) throw new Error('trusted Windows SystemRoot is unavailable');
  return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function encodedPowerShell(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShell(program, script, input, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(program, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      encodedPowerShell(script)], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap((key) => (
        env[key] == null ? [] : [[key, env[key]]]
      ))),
    });
    const stdout = []; const stderr = []; let bytes = 0; let settled = false;
    const timer = setTimeout(() => {
      if (settled) return; settled = true; child.kill(); reject(new Error('Windows DPAPI operation timed out'));
    }, 10_000);
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_SECRET_BYTES * 2) child.kill();
      else target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
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
  program = process.platform === 'win32' ? trustedPowerShell() : null,
  protect = (plain) => runPowerShell(program, PROTECT, plain),
  unprotect = (cipher) => runPowerShell(program, UNPROTECT, cipher),
} = {}) {
  if (!directory) throw new Error('Windows credential directory is unavailable');
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
      const plain = await unprotect(cipher);
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
      const cipher = String(await protect(serialized)).trim();
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
