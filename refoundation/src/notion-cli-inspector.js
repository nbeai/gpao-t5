import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

const MAX_OUTPUT = 64 * 1024;

async function executableOnPath({ env = process.env, platform = process.platform } = {}) {
  const names = platform === 'win32' ? ['ntn.exe', 'ntn.cmd', 'ntn.bat', 'ntn'] : ['ntn'];
  for (const directory of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(directory, name);
      try { await access(candidate, constants.X_OK); return candidate; }
      catch { /* keep looking */ }
    }
  }
  return null;
}

function run(command, args, { env = process.env, timeoutMs = 8_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env, windowsHide: true });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const append = (current, chunk) => Buffer.concat([current, chunk]).subarray(0, MAX_OUTPUT);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('error', () => { clearTimeout(timer); resolve({ code: null, stdout: '', stderr: '' }); });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
    });
  });
}

export async function inspectNotionCli({
  env = process.env, platform = process.platform,
  locate = executableOnPath, execute = run,
} = {}) {
  const command = await locate({ env, platform });
  if (!command) return {
    installed: false, authenticated: false, state: 'unavailable', reason: 'notion_cli_not_installed',
  };
  const result = await execute(command, ['api', 'v1/users/me'], { env, timeoutMs: 8_000 });
  let identity = null;
  try { identity = JSON.parse(String(result.stdout ?? '')); } catch { /* authentication not proven */ }
  const authenticated = result.code === 0 && typeof identity?.id === 'string' && identity.id.length > 0;
  return {
    installed: true,
    authenticated,
    state: authenticated ? 'ready' : 'needs_connection',
    reason: authenticated ? 'notion_cli_authenticated' : 'notion_cli_login_required',
  };
}

export function makeNotionCliInspector({ ttlMs = 30_000, now = Date.now, ...options } = {}) {
  let cached = null;
  return async () => {
    if (cached && now() - cached.checkedAt < ttlMs) return structuredClone(cached.value);
    const value = await inspectNotionCli(options);
    cached = { checkedAt: now(), value };
    return structuredClone(value);
  };
}
