import { spawn } from 'node:child_process';
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

function runSecurityPassword(file, args, { input = '', timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const secret = String(input).replace(/[\r\n]+$/u, '');
    if (!secret) { reject(new Error('Keychain secret input is empty')); return; }
    const terminal = pty.spawn(file, args, {
      name: 'xterm-256color', cols: 80, rows: 24, env: { PATH: '/usr/bin:/bin' },
    });
    let output = '';
    let stage = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; terminal.kill(); }, timeoutMs);
    terminal.onData((chunk) => {
      if (output.length < 64 * 1024) output += String(chunk).slice(0, 64 * 1024 - output.length);
      if (stage === 0 && output.includes('password data for new item')) {
        stage = 1; terminal.write(`${secret}\n`);
      } else if (stage === 1 && output.includes('retype password for new item')) {
        stage = 2; terminal.write(`${secret}\n`);
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut || stage !== 2 ? 1 : Number(exitCode ?? 1),
        stdout: '', stderr: timedOut ? 'keychain prompt timed out' : '',
      });
    });
  });
}

function safeName(value) {
  const name = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(name)) throw new TypeError('invalid secret name');
  return name;
}

export function makePlatformSecretStore({
  platform = process.platform, run = runSecurity, runPassword = null,
} = {}) {
  if (platform !== 'darwin') throw new Error('secure credential store is not implemented for this platform');
  const command = async (args, options) => run('/usr/bin/security', args, options);
  const passwordCommand = async (args, options) => (
    runPassword ?? (run === runSecurity ? runSecurityPassword : run)
  )('/usr/bin/security', args, options);
  return {
    async get(name) {
      const account = safeName(name);
      const result = await command([
        'find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w',
      ]);
      if (result.exitCode === 44) return null;
      if (result.exitCode !== 0) throw new Error('macOS Keychain에서 연결 자격을 읽지 못했어요.');
      try { return JSON.parse(result.stdout.trim()); }
      catch { throw new Error('macOS Keychain의 연결 자격 형식을 읽지 못했어요.'); }
    },
    async set(name, value) {
      const account = safeName(name);
      const serialized = JSON.stringify(value);
      if (!serialized || Buffer.byteLength(serialized) > 512 * 1024) throw new TypeError('workspace secret is too large');
      const result = await passwordCommand([
        'add-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE,
        '-l', `GPAO-T5 ${account}`, '-U', '-w',
      ], { input: `${serialized}\n` });
      if (result.exitCode !== 0) throw new Error('macOS Keychain에 연결 자격을 저장하지 못했어요.');
      return true;
    },
    async clear(name) {
      const account = safeName(name);
      const result = await command([
        'delete-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE,
      ]);
      if (result.exitCode !== 0 && result.exitCode !== 44) {
        throw new Error('macOS Keychain의 연결 자격을 지우지 못했어요.');
      }
      return true;
    },
  };
}
