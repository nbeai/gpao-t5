import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_NAMESPACE = 't5-persistent-browser-v1';
const DEFAULT_SESSION = 't5-browser-host';
const DEFAULT_AUTOSAVE_MS = '30000';

function execFileResult(binary, args, { signal, environment } = {}) {
  return new Promise((resolveRun, reject) => {
    execFile(binary, args, {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000, signal,
      env: { ...process.env, ...environment, NO_COLOR: '1' },
    }, (error, stdout, stderr) => {
      if (error?.code === 'ENOENT') {
        reject(Object.assign(new Error('agent-browser binary is missing'), { code: 'BINARY_MISSING' }));
        return;
      }
      resolveRun({
        exitCode: Number.isInteger(error?.code) ? error.code : error ? 1 : 0,
        stdout, stderr,
      });
    });
  });
}

function jsonData(result, action) {
  if (result.exitCode !== 0) throw new Error(String(result.stderr || result.stdout || `${action} failed`).trim());
  let parsed;
  try { parsed = JSON.parse(String(result.stdout ?? '').trim()); }
  catch { throw new Error(`agent-browser ${action} returned invalid JSON`); }
  if (parsed?.success === false) throw new Error(parsed.error ?? `agent-browser ${action} failed`);
  return parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
}

function macCommand(file, args) {
  return new Promise((resolveResult) => {
    execFile(file, args, { encoding: 'utf8', timeout: 8_000 }, (error, stdout) => {
      resolveResult({ ok: !error, stdout: String(stdout ?? '').trim() });
    });
  });
}

async function macFrontApplicationName() {
  const front = await macCommand('/usr/bin/lsappinfo', ['front']);
  const asn = /ASN:[^\s]+/u.exec(front.stdout)?.[0];
  if (!front.ok || !asn) return null;
  const info = await macCommand('/usr/bin/lsappinfo', ['info', '-only', 'name', asn]);
  return /"LSDisplayName"="([^"]+)"/u.exec(info.stdout)?.[1] ?? null;
}

async function macActivateWindow() {
  for (const application of ['Google Chrome for Testing', 'Google Chrome', 'Brave Browser', 'Chromium']) {
    const opened = await macCommand('/usr/bin/open', ['-a', application]);
    if (!opened.ok) continue;
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
    const front = await macFrontApplicationName();
    if (front === application) return { visible: true, application };
  }
  return { visible: false, application: null };
}

async function defaultActivateWindow() {
  if (process.platform === 'darwin') return macActivateWindow();
  return { visible: false, application: null };
}

export function makePersistentBrowserHost({
  root, binary, run, activateWindow = defaultActivateWindow,
  namespace = DEFAULT_NAMESPACE, session = DEFAULT_SESSION, headed = true,
} = {}) {
  if (!root) throw new TypeError('persistent browser root is required');
  if (!binary && !run) throw new TypeError('agent-browser binary or run implementation is required');
  const managedRoot = resolve(root);
  const identityDirectory = join(managedRoot, 'identity');
  const identityRoot = join(identityDirectory, 'default');
  const profileDirectory = join(identityRoot, 'profile');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const socketDirectory = join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), `t5-bh-${uid}`);
  const environment = {
    HOME: identityRoot, USERPROFILE: identityRoot,
    AGENT_BROWSER_SOCKET_DIR: socketDirectory,
    AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: DEFAULT_AUTOSAVE_MS,
  };
  const execute = run ?? ((args, options) => execFileResult(binary, args, options));
  let cdpUrl = null;
  let queue = Promise.resolve();

  function serialize(work) {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  }

  async function rejectSymlink(path) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('managed browser root contains a symlink');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async function prepare() {
    await mkdir(managedRoot, { recursive: true, mode: 0o700 });
    await rejectSymlink(managedRoot);
    await rejectSymlink(identityDirectory);
    await mkdir(identityDirectory, { recursive: true, mode: 0o700 });
    await rejectSymlink(identityDirectory);
    await rejectSymlink(identityRoot);
    await mkdir(identityRoot, { recursive: true, mode: 0o700 });
    await rejectSymlink(identityRoot);
    await rejectSymlink(profileDirectory);
    await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
    await rejectSymlink(profileDirectory);
    await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
    await Promise.all([
      chmod(identityDirectory, 0o700), chmod(identityRoot, 0o700),
      chmod(profileDirectory, 0o700), chmod(socketDirectory, 0o700),
    ]);
  }

  function commonArgs() {
    return [
      '--namespace', namespace,
      '--session', session,
      '--profile', profileDirectory,
      '--headed', String(headed),
      '--idle-timeout', '0',
      '--restore',
      '--restore-save', 'always',
      '--no-auto-dialog',
      '--json',
    ];
  }

  async function connect({ signal } = {}) {
    await prepare();
    const result = await execute([...commonArgs(), 'get', 'cdp-url'], { signal, environment });
    const data = jsonData(result, 'get cdp-url');
    if (!/^wss?:\/\/127\.0\.0\.1:\d+\/devtools\/browser\//u.test(String(data.cdpUrl ?? ''))) {
      throw new Error('persistent browser host returned an invalid local CDP URL');
    }
    cdpUrl = String(data.cdpUrl);
    return { cdpUrl };
  }

  return {
    profile: Object.freeze({ id: 'default', kind: 'managed_persistent', selected: true }),
    identityRoot,
    profileDirectory,
    namespace,
    clientNamespace: `t5c-${createHash('sha256').update(namespace).digest('hex').slice(0, 8)}`,
    async connection(options = {}) {
      if (cdpUrl) return { cdpUrl };
      return serialize(() => connect(options));
    },
    invalidate() { cdpUrl = null; },
    async activate() {
      await this.connection();
      try {
        const result = await activateWindow();
        return {
          visible: result?.visible === true,
          application: result?.application ? String(result.application) : null,
        };
      } catch {
        return { visible: false, application: null };
      }
    },
    async close({ signal } = {}) {
      if (!cdpUrl) return { closed: false };
      return serialize(async () => {
        await prepare();
        const result = await execute([...commonArgs(), 'close'], { signal, environment });
        jsonData(result, 'close');
        cdpUrl = null;
        return { closed: true };
      });
    },
    async reset({ confirmation } = {}) {
      if (confirmation !== 'RESET_T5_BROWSER') {
        throw new Error('persistent browser reset confirmation is required');
      }
      await this.close().catch(() => {});
      await prepare();
      await rm(identityRoot, { recursive: true, force: true });
      cdpUrl = null;
      return { reset: true };
    },
  };
}
