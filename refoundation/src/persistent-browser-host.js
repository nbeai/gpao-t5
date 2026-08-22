import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rm } from 'node:fs/promises';
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
    execFile(file, args, { encoding: 'utf8', timeout: 8_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolveResult({ ok: !error, stdout: String(stdout ?? '').trim() });
    });
  });
}

export async function managedBrowserProcessForProfile(profileDirectory) {
  const listed = await macCommand('/bin/ps', ['-axo', 'pid=,command=']);
  if (!listed.ok) return null;
  const marker = `--user-data-dir=${profileDirectory}`;
  for (const line of listed.stdout.split('\n')) {
    if (!line.includes(marker) || line.includes(' --type=')) continue;
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const application = match[2].includes('Google Chrome') ? 'Google Chrome'
      : match[2].includes('Chromium') ? 'Chromium'
        : match[2].includes('Brave Browser') ? 'Brave Browser' : 'T5 Browser';
    return { processId: Number(match[1]), application };
  }
  return null;
}

async function macFrontApplicationPid() {
  const front = await macCommand('/usr/bin/lsappinfo', ['front']);
  const asn = /ASN:[^\s]+/u.exec(front.stdout)?.[0];
  if (!front.ok || !asn) return null;
  const info = await macCommand('/usr/bin/lsappinfo', ['info', '-only', 'pid', asn]);
  const value = /"pid"=(\d+)/u.exec(info.stdout)?.[1] ?? /pid=(\d+)/u.exec(info.stdout)?.[1];
  return value ? Number(value) : null;
}

async function macActivateWindow({ profileDirectory } = {}) {
  let managed = null;
  for (let attempt = 0; attempt < 40 && !managed; attempt += 1) {
    managed = await managedBrowserProcessForProfile(profileDirectory);
    if (!managed) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (!managed) return { visible: false, application: null, processId: null };
  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${managed.processId} to true`;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const activated = await macCommand('/usr/bin/osascript', ['-e', script]);
    if (activated.ok) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 60));
      if (await macFrontApplicationPid() === managed.processId) return { visible: true, ...managed };
    } else await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return { visible: false, ...managed };
}

async function macManagedChromeConnection(profileDirectory) {
  const activePortFile = join(profileDirectory, 'DevToolsActivePort');
  const existing = await managedBrowserProcessForProfile(profileDirectory);
  if (!existing) {
    await rm(activePortFile, { force: true });
    const launched = await macCommand('/usr/bin/open', [
      '-n', '-a', 'Google Chrome', '--args',
      '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
      '--disable-popup-blocking', '--disable-prompt-on-repost', '--disable-sync',
      '--disable-features=Translate', '--password-store=basic', '--use-mock-keychain',
      `--user-data-dir=${profileDirectory}`,
    ]);
    if (!launched.ok) throw new Error('T5 managed Chrome could not be opened');
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [portLine, pathLine] = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/u);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && /^\/devtools\/browser\/[A-Za-z0-9-]+$/u.test(pathLine)) {
        return { cdpUrl: `ws://127.0.0.1:${port}${pathLine}` };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('T5 managed Chrome did not publish its local control address');
}

async function closeManagedChrome(cdpUrl, profileDirectory) {
  const managed = await managedBrowserProcessForProfile(profileDirectory);
  await new Promise((resolveClose) => {
    const socket = new WebSocket(cdpUrl);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { socket.close(); } catch { /* browser already closed */ }
      resolveClose();
    };
    const timer = setTimeout(finish, 2_000);
    timer.unref?.();
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    }, { once: true });
    socket.addEventListener('message', finish, { once: true });
    socket.addEventListener('close', finish, { once: true });
    socket.addEventListener('error', finish, { once: true });
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!await managedBrowserProcessForProfile(profileDirectory)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (managed?.processId) {
    try { process.kill(managed.processId, 'SIGTERM'); } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!await managedBrowserProcessForProfile(profileDirectory)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (managed?.processId) {
    try { process.kill(managed.processId, 'SIGKILL'); } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!await managedBrowserProcessForProfile(profileDirectory)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('T5 managed Chrome did not finish closing');
}

async function defaultActivateWindow(input) {
  if (process.platform === 'darwin') return macActivateWindow(input);
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
  const clientSocketDirectory = join(
    process.platform === 'darwin' ? '/private/tmp' : tmpdir(), `t5-ab-${uid}`,
  );
  const environment = {
    HOME: identityRoot, USERPROFILE: identityRoot,
    AGENT_BROWSER_SOCKET_DIR: socketDirectory,
    AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: DEFAULT_AUTOSAVE_MS,
  };
  const clientNamespace = `t5c-${createHash('sha256').update(namespace).digest('hex').slice(0, 8)}`;
  const clientEnvironment = { ...environment, AGENT_BROWSER_SOCKET_DIR: clientSocketDirectory };
  const execute = run ?? ((args, options) => execFileResult(binary, args, options));
  const usesManagedMacLaunch = run == null && process.platform === 'darwin';
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
    await mkdir(clientSocketDirectory, { recursive: true, mode: 0o700 });
    await Promise.all([
      chmod(identityDirectory, 0o700), chmod(identityRoot, 0o700),
      chmod(profileDirectory, 0o700), chmod(socketDirectory, 0o700),
      chmod(clientSocketDirectory, 0o700),
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
    if (usesManagedMacLaunch) {
      const connected = await macManagedChromeConnection(profileDirectory);
      cdpUrl = connected.cdpUrl;
      return connected;
    }
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
    clientNamespace,
    clientSocketDirectory,
    async connection(options = {}) {
      if (cdpUrl) return { cdpUrl };
      return serialize(() => connect(options));
    },
    invalidate() { cdpUrl = null; },
    async activate() {
      await this.connection();
      try {
        const result = await activateWindow({ profileDirectory });
        return {
          visible: result?.visible === true,
          application: result?.application ? String(result.application) : null,
          processId: Number.isInteger(result?.processId) ? result.processId : null,
        };
      } catch {
        return { visible: false, application: null, processId: null };
      }
    },
    async close({ signal } = {}) {
      if (!cdpUrl) return { closed: false };
      return serialize(async () => {
        await prepare();
        if (usesManagedMacLaunch) {
          await execute([
            '--namespace', clientNamespace, '--cdp', cdpUrl,
            '--idle-timeout', '0', '--json', 'close', '--all',
          ], { signal, environment: clientEnvironment }).catch(() => {});
          await closeManagedChrome(cdpUrl, profileDirectory);
          cdpUrl = null;
          return { closed: true };
        }
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
