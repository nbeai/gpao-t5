import { spawn } from 'node:child_process';

const KEYCHAIN_SERVICE = 'kr.co.gpao.t5.workspace';

function runSecurity(file, args, { input = '' } = {}) {
  return new Promise((resolve, reject) => {
    // `security ... -w` opens /dev/tty when it shares the console process session, even with a
    // piped stdin. A separate session makes it consume the pipe, keeping the secret out of argv
    // and preventing a desktop connection flow from waiting forever on an invisible prompt.
    const child = spawn(file, args, {
      stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' }, detached: true,
    });
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

function safeName(value) {
  const name = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(name)) throw new TypeError('invalid secret name');
  return name;
}

export function makePlatformSecretStore({ platform = process.platform, run = runSecurity } = {}) {
  if (platform !== 'darwin') throw new Error('secure credential store is not implemented for this platform');
  const command = async (args, options) => run('/usr/bin/security', args, options);
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
      const result = await command([
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
