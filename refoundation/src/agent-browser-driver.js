import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BINARY = resolve(here, '..', 'node_modules', '.bin', 'agent-browser');
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_DOWNLOAD_POLL_MS = 100;
const DEFAULT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const DEFAULT_UPLOAD_SETTLE_MS = 300;
export const BROWSER_NAMESPACE = 't5-refoundation-v2';
const SECRET_FIELD_SELECTOR = [
  'input[type="password"]',
  'input[autocomplete~="current-password"]', 'input[autocomplete~="new-password"]',
  'input[autocomplete~="one-time-code"]', '[name*="otp" i]', '[id*="otp" i]',
  '[name*="verification" i]', '[id*="verification" i]',
  'input[autocomplete~="cc-name"]', 'input[autocomplete~="cc-number"]',
  'input[autocomplete~="cc-csc"]', 'input[autocomplete~="cc-exp"]',
  'input[autocomplete~="cc-exp-month"]', 'input[autocomplete~="cc-exp-year"]',
].join(', ');

export function sessionNameForOwner(ownerId) {
  const digest = createHash('sha256').update(String(ownerId ?? '')).digest('hex').slice(0, 20);
  return `t5-${digest}`;
}

function defaultRun(binary, {
  timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = DEFAULT_MAX_BUFFER, environment = {},
} = {}) {
  return (args, { signal } = {}) => new Promise((resolveRun, reject) => {
    execFile(binary, args, {
      encoding: 'utf8', timeout: timeoutMs, maxBuffer, signal,
      env: { ...process.env, ...environment, NO_COLOR: '1' },
    }, (error, stdout, stderr) => {
      if (error && error.code === 'ENOENT') {
        reject(Object.assign(new Error('agent-browser binary is missing'), { code: 'BINARY_MISSING' }));
        return;
      }
      resolveRun({ exitCode: Number.isInteger(error?.code) ? error.code : error ? 1 : 0, stdout, stderr });
    });
  });
}

function parseJsonOutput(result, action) {
  if (result.exitCode !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${action} failed`).trim());
  }
  const text = String(result.stdout ?? '').trim();
  if (!text) return {};
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`agent-browser ${action} returned invalid JSON`); }
  if (parsed?.success === false) throw new Error(parsed.error ?? `agent-browser ${action} failed`);
  return parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
}

function normalizeTab(value = {}) {
  return {
    tabId: value.tabId ?? value.tab_id ?? value.id ?? null,
    targetId: value.targetId ?? value.target_id ?? null,
    title: String(value.title ?? ''),
    url: String(value.url ?? ''),
    ...(value.active != null ? { active: Boolean(value.active) } : {}),
  };
}

function normalizeTabs(value) {
  const rows = Array.isArray(value) ? value
    : Array.isArray(value?.tabs) ? value.tabs
      : Array.isArray(value?.pages) ? value.pages : [];
  return rows.map(normalizeTab);
}

function snapshotFacts(value = {}, fallbackTab = {}) {
  const text = String(value.snapshot ?? value.text ?? value.content ?? '');
  return {
    tab: normalizeTab({ ...fallbackTab, ...value }),
    snapshot: {
      text,
      refs: value.refs && typeof value.refs === 'object' ? value.refs : {},
      totalChars: Number.isFinite(value.totalChars) ? value.totalChars : text.length,
      truncated: value.truncated === true,
    },
  };
}

function attrValue(value) {
  const raw = value?.value ?? value?.attribute ?? value?.result ?? null;
  return raw == null ? null : String(raw);
}

function countValue(value) {
  const count = Number(value?.count ?? value?.value ?? value?.result);
  if (!Number.isInteger(count) || count < 0) throw new Error('agent-browser returned an invalid element count');
  return count;
}

function localMimeType(path, bytes) {
  if (bytes.subarray(0, 5).toString('binary') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const extension = extname(path).toLowerCase();
  return ({
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.csv': 'text/csv', '.pdf': 'application/pdf', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.zip': 'application/zip',
  })[extension] ?? 'application/octet-stream';
}

function credentialLikePath(path) {
  const lower = path.toLowerCase();
  const name = basename(lower);
  const parts = lower.split(/[\\/]+/);
  if (name === '.env' || name.startsWith('.env.')
    || ['.npmrc', '.pypirc', 'id_rsa', 'id_ed25519', 'credentials', 'auth.json', 'cookies.json'].includes(name)) return true;
  if (['.pem', '.key', '.p12', '.pfx'].includes(extname(name))) return true;
  return parts.some((part) => ['.ssh', '.gnupg'].includes(part))
    || lower.endsWith('/.aws/credentials') || lower.endsWith('/.kube/config')
    || lower.includes('/.agent-browser/');
}

function cliRef(ref) {
  const value = String(ref ?? '').trim();
  if (!/^e\d+$/.test(value)) throw new TypeError('invalid browser ref');
  return `@${value}`;
}

export function sanitizedNetworkFacts(value = {}, maxRequests = 100) {
  const rows = Array.isArray(value) ? value
    : Array.isArray(value?.requests) ? value.requests
      : Array.isArray(value?.entries) ? value.entries : [];
  const requests = [];
  for (const row of rows.slice(0, maxRequests)) {
    const rawAddress = row?.url ?? row?.address ?? row?.request?.url;
    let parsed;
    try { parsed = new URL(String(rawAddress ?? '')); }
    catch { continue; }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    requests.push({
      method: String(row?.method ?? row?.request?.method ?? 'GET').toUpperCase(),
      address: `${parsed.origin}${parsed.pathname}`,
      ...(parsed.search ? { queryOmitted: true } : {}),
      resourceType: String(row?.resourceType ?? row?.type ?? row?.request?.resourceType ?? ''),
      status: Number.isFinite(Number(row?.status ?? row?.response?.status))
        ? Number(row?.status ?? row?.response?.status) : null,
      mimeType: String(row?.mimeType ?? row?.response?.mimeType ?? ''),
    });
  }
  return {
    totalRequests: rows.length,
    truncated: rows.length > maxRequests,
    requests,
  };
}

function sanitizedSource(rawAddress, baseAddress) {
  let parsed;
  try { parsed = new URL(String(rawAddress ?? ''), baseAddress); }
  catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  return {
    address: `${parsed.origin}${parsed.pathname}`,
    queryOmitted: Boolean(parsed.search),
  };
}

async function downloadEntries(directory) {
  const entries = new Map();
  for (const name of await readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  })) {
    const path = join(directory, name);
    const info = await lstat(path);
    entries.set(name, { path, info });
  }
  return entries;
}

export async function secureBrowserStatePermissions(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  await chmod(root, 0o700);
  for (const entry of entries) {
    const path = join(root, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('browser state must not contain symbolic links');
    if (info.isDirectory()) await secureBrowserStatePermissions(path);
    else await chmod(path, 0o600);
  }
}

export function makeAgentBrowserDriver({
  ownerId,
  outputDirectory,
  binary = DEFAULT_BINARY,
  run,
  downloadTimeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS,
  downloadPollMs = DEFAULT_DOWNLOAD_POLL_MS,
  maxDownloadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
  maxUploadBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
  uploadSettleMs = DEFAULT_UPLOAD_SETTLE_MS,
} = {}) {
  if (!ownerId) throw new TypeError('browser ownerId is required');
  if (!outputDirectory) throw new TypeError('browser output directory is required');
  const session = sessionNameForOwner(ownerId);
  const sessionRoot = dirname(resolve(outputDirectory));
  const profileDirectory = join(sessionRoot, 'profile');
  const downloadDirectory = join(sessionRoot, 'downloads');
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const socketDirectory = join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), `t5-ab-${uid}`);
  const usesDefaultRun = run == null;
  const execute = run ?? defaultRun(binary, {
    environment: {
      HOME: sessionRoot, USERPROFILE: sessionRoot,
      AGENT_BROWSER_SOCKET_DIR: socketDirectory,
      AGENT_BROWSER_AUTOSAVE_INTERVAL_MS: '0',
    },
  });
  const namespace = BROWSER_NAMESPACE;
  let availabilityCache = null;
  let activeTabId = null;
  let activeTabUrl = null;
  let headedMode = false;
  let userControl = false;
  let runtimeRootReady = false;

  function commonArgs() {
    return [
      '--namespace', namespace,
      '--profile', profileDirectory,
      '--headed', String(headedMode),
      '--no-auto-dialog',
      '--idle-timeout', '10m',
      '--session', session,
      '--restore',
      '--download-path', downloadDirectory,
      '--pin-tab', '--json',
    ];
  }

  async function ensureRuntimeRoot() {
    if (usesDefaultRun && !runtimeRootReady) {
      await Promise.all([
        mkdir(sessionRoot, { recursive: true, mode: 0o700 }),
        mkdir(socketDirectory, { recursive: true, mode: 0o700 }),
        mkdir(downloadDirectory, { recursive: true, mode: 0o700 }),
      ]);
      await Promise.all([
        chmod(sessionRoot, 0o700), chmod(socketDirectory, 0o700), chmod(downloadDirectory, 0o700),
      ]);
      runtimeRootReady = true;
    }
  }

  async function command(args, options = {}) {
    await ensureRuntimeRoot();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await execute([...commonArgs(), ...args], options);
        if (usesDefaultRun) {
          await secureBrowserStatePermissions(join(sessionRoot, '.agent-browser'));
        }
        return parseJsonOutput(raw, args[0] ?? 'command');
      } catch (error) {
        const lifecycleRace = /Failed to connect.*No such file|No such file.*Failed to connect/i
          .test(error?.message ?? '');
        if (!lifecycleRace || attempt > 0 || options.signal?.aborted) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
    }
    throw new Error('agent-browser command retry exhausted');
  }

  async function currentTab(options = {}) {
    const data = await command(['tab', 'list'], options);
    const tabs = normalizeTabs(data);
    const tab = tabs.find((item) => item.active) ?? tabs[0] ?? normalizeTab();
    activeTabId = tab.tabId;
    activeTabUrl = tab.url || null;
    return tab;
  }

  async function selectTab(tabId, options = {}) {
    if (tabId && tabId !== activeTabId) {
      const selected = normalizeTab(await command(['tab', String(tabId)], options));
      activeTabId = selected.tabId ?? String(tabId);
      activeTabUrl = selected.url || null;
    }
  }

  async function takeSnapshot({ tabId, full = false, maxChars, signal } = {}) {
    await selectTab(tabId, { signal });
    const args = ['snapshot', ...(full ? [] : ['-i', '-c'])];
    if (Number.isInteger(maxChars)) args.push('--max-output', String(maxChars));
    const data = await command(args, { signal });
    const tab = await currentTab({ signal });
    const observed = snapshotFacts(data, tab);
    activeTabId = observed.tab.tabId;
    activeTabUrl = observed.tab.url || null;
    return observed;
  }

  async function elementFacts({ tabId, ref, signal } = {}) {
    await selectTab(tabId, { signal });
    // agent-browser serializes a browser session; concurrent CLI clients can race its ref map.
    const type = await command(['get', 'attr', cliRef(ref), 'type'], { signal });
    const autocomplete = await command(['get', 'attr', cliRef(ref), 'autocomplete'], { signal });
    const href = await command(['get', 'attr', cliRef(ref), 'href'], { signal });
    const download = await command(['get', 'attr', cliRef(ref), 'download'], { signal });
    return {
      type: attrValue(type), autocomplete: attrValue(autocomplete),
      href: attrValue(href), download: attrValue(download),
    };
  }

  async function submitFacts({ tabId, ref, signal } = {}) {
    const element = await elementFacts({ tabId, ref, signal });
    const secretFieldCount = countValue(await command(['get', 'count', SECRET_FIELD_SELECTOR], { signal }));
    const fileInputCount = countValue(await command(['get', 'count', 'input[type="file"]'], { signal }));
    return { element, secretFieldCount, fileInputCount };
  }

  async function clearNetwork({ signal } = {}) {
    await command(['network', 'requests', '--clear'], { signal });
  }

  async function networkFacts({ signal } = {}) {
    return sanitizedNetworkFacts(await command(['network', 'requests'], { signal }));
  }

  async function cleanupNewDownloads(before) {
    const after = await downloadEntries(downloadDirectory);
    for (const [name, entry] of after) {
      if (!before.has(name)) await rm(entry.path, { force: true, recursive: false });
    }
  }

  async function waitForCompletedDownload(before) {
    const deadline = Date.now() + downloadTimeoutMs;
    let previousSignature = null;
    while (Date.now() <= deadline) {
      const after = await downloadEntries(downloadDirectory);
      const fresh = [...after.entries()].filter(([name]) => !before.has(name));
      const partial = fresh.filter(([name]) => /\.(?:crdownload|part|tmp)$/i.test(name));
      const complete = fresh.filter(([name]) => !/\.(?:crdownload|part|tmp)$/i.test(name));
      const oversized = fresh.find(([, entry]) => entry.info.size > maxDownloadBytes);
      if (oversized) {
        await cleanupNewDownloads(before);
        throw new Error(`download exceeded ${maxDownloadBytes} bytes`);
      }
      if (complete.length > 1) {
        await cleanupNewDownloads(before);
        throw new Error('download produced multiple files');
      }
      if (complete.length === 1 && partial.length === 0) {
        const [name, entry] = complete[0];
        const signature = `${name}:${entry.info.size}:${entry.info.mtimeMs}`;
        if (signature === previousSignature) return entry;
        previousSignature = signature;
      } else {
        previousSignature = null;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, downloadPollMs));
    }
    await cleanupNewDownloads(before);
    throw new Error('download did not complete before timeout');
  }

  async function completedDownloadFact(entry, network, href, pageUrl) {
    const info = await lstat(entry.path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      await rm(entry.path, { force: true, recursive: false });
      throw new Error('downloaded artifact is not a private regular file');
    }
    const root = await realpath(downloadDirectory);
    const actual = await realpath(entry.path);
    const rel = relative(root, actual);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(sep)) {
      await rm(entry.path, { force: true, recursive: false });
      throw new Error('downloaded artifact escaped the managed directory');
    }
    const bytes = await readFile(actual);
    if (bytes.length > maxDownloadBytes) {
      await rm(actual, { force: true, recursive: false });
      throw new Error(`download exceeded ${maxDownloadBytes} bytes`);
    }
    await chmod(actual, 0o600);
    const source = sanitizedSource(href, pageUrl)
      ?? network.requests.find((request) => !request.address.endsWith('/favicon.ico'))
      ?? null;
    const networkMime = network.requests.find((request) => (
      !source || request.address === source.address
    ))?.mimeType;
    const magicMime = bytes.subarray(0, 5).toString('binary') === '%PDF-'
      ? 'application/pdf' : null;
    return {
      file: {
        path: actual, bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        mimeType: networkMime || magicMime || 'application/octet-stream',
        trust: 'untrusted_external',
      },
      source: source ? {
        address: source.address,
        queryOmitted: source.queryOmitted === true,
      } : null,
    };
  }

  async function uploadFileFact(filePath) {
    if (!isAbsolute(String(filePath ?? ''))) throw new TypeError('upload path must be absolute');
    const requested = resolve(String(filePath));
    const requestedInfo = await lstat(requested);
    if (requestedInfo.isSymbolicLink()) throw new Error('upload path must not be symbolic');
    const actual = await realpath(requested);
    if (actual !== requested) throw new Error('upload path must not traverse symbolic directories');
    const info = await lstat(actual);
    if (!info.isFile()) throw new Error('upload path must be a regular file');
    if (info.nlink !== 1) throw new Error('upload path must not be a hardlink');
    if (credentialLikePath(actual)) throw new Error('credential-like files cannot be uploaded');
    if (info.size > maxUploadBytes) throw new Error(`upload exceeded ${maxUploadBytes} bytes`);
    const bytes = await readFile(actual);
    if (bytes.length > maxUploadBytes) throw new Error(`upload exceeded ${maxUploadBytes} bytes`);
    return {
      path: actual, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: localMimeType(actual, bytes), trust: 'user_selected_local',
    };
  }

  async function act(kind, { tabId, ref, text, signal } = {}) {
    await selectTab(tabId, { signal });
    await clearNetwork({ signal });
    await command(kind === 'fill'
      ? ['fill', cliRef(ref), String(text ?? '')]
      : ['click', cliRef(ref)], { signal });
    const observed = await takeSnapshot({ tabId, full: false, signal });
    const network = await networkFacts({ signal });
    return {
      action: kind === 'fill'
        ? { kind, ref: String(ref), textChars: String(text ?? '').length }
        : { kind, ref: String(ref) },
      ...observed, network,
    };
  }

  return {
    profile: { id: 'isolated', kind: 'managed_isolated', selected: true },
    session,
    userControlActive: () => userControl,
    async available() {
      if (availabilityCache) return structuredClone(availabilityCache);
      try {
        const result = await execute(['--version']);
        if (result.exitCode !== 0) {
          availabilityCache = { available: false, reason: String(result.stderr || 'version_failed').trim() };
          return structuredClone(availabilityCache);
        }
        const version = String(result.stdout ?? '').match(/\d+\.\d+\.\d+/)?.[0] ?? null;
        availabilityCache = { available: true, version };
        return structuredClone(availabilityCache);
      } catch (error) {
        availabilityCache = {
          available: false,
          reason: error?.code === 'BINARY_MISSING' ? 'binary_missing' : error?.message ?? String(error),
        };
        return structuredClone(availabilityCache);
      }
    },
    async status({ signal } = {}) {
      const availability = await this.available();
      if (!availability.available) return { state: 'unavailable', session, ...availability };
      let sessions = [];
      try {
        await ensureRuntimeRoot();
        const listed = parseJsonOutput(await execute([
          '--namespace', namespace, '--json', 'session', 'list',
        ], { signal }), 'session list');
        sessions = Array.isArray(listed.sessions) ? listed.sessions : [];
      } catch { /* no daemon sessions */ }
      const active = sessions.find((item) => (
        typeof item === 'string' ? item === session : item?.name === session || item?.session === session
      ));
      return {
        state: 'ready', session, version: availability.version,
        running: Boolean(active),
        tabCount: active && typeof active === 'object'
          ? Number(active.tabCount ?? active.tabs ?? 0) : active ? null : 0,
      };
    },
    async profiles() {
      return { profiles: [{ ...this.profile }] };
    },
    async tabs({ signal } = {}) {
      const tabs = normalizeTabs(await command(['tab', 'list'], { signal }));
      const active = tabs.find((tab) => tab.active);
      activeTabId = active?.tabId ?? activeTabId;
      activeTabUrl = active?.url ?? activeTabUrl;
      return { tabs };
    },
    elementFacts,
    submitFacts,
    uploadFileFacts: uploadFileFact,
    async beginUserLogin(url, { signal } = {}) {
      await command(['close'], { signal });
      activeTabId = null;
      activeTabUrl = null;
      headedMode = true;
      try {
        const opened = await command(['open', String(url)], { signal });
        const tab = await currentTab({ signal });
        userControl = true;
        return {
          state: 'user_control_required', pageObserved: false, secretValuesObserved: false,
          profile: { ...this.profile },
          tab: normalizeTab({ ...opened, ...tab, url: tab.url || opened.url || url }),
          handoff: { visible: true, inputOwner: 'user', modelActionsBlocked: true },
        };
      } catch (error) {
        headedMode = false;
        userControl = false;
        throw error;
      }
    },
    async loginStatus({ tabId, signal } = {}) {
      if (!userControl) return {
        state: 'login_handoff_not_active', pageObserved: false, secretValuesObserved: false,
      };
      await selectTab(tabId, { signal });
      const secretFieldsPresent = countValue(
        await command(['get', 'count', SECRET_FIELD_SELECTOR], { signal }),
      ) > 0;
      const tab = await currentTab({ signal });
      if (secretFieldsPresent) return {
        state: 'user_action_required', pageObserved: false, secretValuesObserved: false,
        secretFieldsPresent: true, tab,
      };
      let currentUrl;
      try {
        const parsed = new URL(tab.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported login result URL');
        currentUrl = parsed.href;
      } catch (error) {
        throw new Error(`cannot resume login result: ${error?.message ?? String(error)}`);
      }
      activeTabId = null;
      activeTabUrl = null;
      await command(['close'], { signal });
      headedMode = false;
      try {
        await command(['open', currentUrl], { signal });
        const resumedSecretFields = countValue(
          await command(['get', 'count', SECRET_FIELD_SELECTOR], { signal }),
        );
        if (resumedSecretFields > 0) {
          const resumedTab = await currentTab({ signal });
          activeTabId = null;
          activeTabUrl = null;
          headedMode = true;
          await command(['open', resumedTab.url || currentUrl], { signal });
          return {
            state: 'user_action_required', pageObserved: false, secretValuesObserved: false,
            secretFieldsPresent: true, continuityEstablished: false,
            tab: await currentTab({ signal }),
          };
        }
        const observed = await takeSnapshot({ full: false, signal });
        userControl = false;
        return {
          state: 'handoff_complete_candidate', secretFieldsPresent: false,
          secretValuesObserved: false, continuityEstablished: true,
          profile: { ...this.profile }, ...observed,
          handoff: { visible: false, inputOwner: 'user', resumedHeadless: true },
        };
      } catch (error) {
        headedMode = true;
        throw error;
      }
    },
    async cancelUserLogin({ signal } = {}) {
      if (!userControl) return {
        state: 'login_handoff_not_active', pageObserved: false, secretValuesObserved: false,
      };
      await command(['close'], { signal });
      activeTabId = null;
      activeTabUrl = null;
      headedMode = false;
      userControl = false;
      return {
        state: 'user_control_cancelled', pageObserved: false, secretValuesObserved: false,
      };
    },
    async navigate(url, { signal } = {}) {
      if (!activeTabUrl) {
        try { await currentTab({ signal }); } catch { /* no active tab yet */ }
      }
      const hadActivePage = Boolean(activeTabUrl);
      const opened = await command(['open', String(url)], { signal });
      if (hadActivePage) await command(['reload'], { signal });
      const observed = await takeSnapshot({ full: false, signal });
      return {
        tab: normalizeTab({ ...opened, ...observed.tab, url: observed.tab.url || opened.url || url }),
        snapshot: observed.snapshot,
      };
    },
    snapshot(options = {}) { return takeSnapshot(options); },
    click(options = {}) { return act('click', options); },
    fill(options = {}) { return act('fill', options); },
    submit(options = {}) { return act('submit', options); },
    async download({ tabId, ref, signal } = {}) {
      await mkdir(downloadDirectory, { recursive: true, mode: 0o700 });
      await chmod(downloadDirectory, 0o700);
      await selectTab(tabId, { signal });
      const pageBefore = await currentTab({ signal });
      const facts = await elementFacts({ tabId, ref, signal });
      const before = await downloadEntries(downloadDirectory);
      await clearNetwork({ signal });
      await command(['click', cliRef(ref)], { signal });
      const entry = await waitForCompletedDownload(before);
      const observed = await takeSnapshot({ tabId, full: false, signal });
      const network = await networkFacts({ signal });
      const artifact = await completedDownloadFact(entry, network, facts.href, pageBefore.url);
      return {
        action: { kind: 'download', ref: String(ref) },
        ...observed, network, ...artifact,
      };
    },
    async upload({ tabId, ref, filePath, expectedSha256, signal } = {}) {
      const before = await uploadFileFact(filePath);
      if (!expectedSha256 || before.sha256 !== expectedSha256) {
        throw new Error('upload source changed before upload');
      }
      await selectTab(tabId, { signal });
      await clearNetwork({ signal });
      await command(['upload', cliRef(ref), before.path], { signal });
      if (uploadSettleMs > 0) {
        await new Promise((resolveWait) => setTimeout(resolveWait, uploadSettleMs));
      }
      const observed = await takeSnapshot({ tabId, full: false, signal });
      const network = await networkFacts({ signal });
      const after = await uploadFileFact(filePath);
      if (after.sha256 !== before.sha256 || after.bytes !== before.bytes) {
        throw new Error('upload source changed during upload');
      }
      return {
        action: { kind: 'upload', ref: String(ref) },
        ...observed, network, file: after,
      };
    },
    async screenshot({ tabId, fullPage = false, signal } = {}) {
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      await selectTab(tabId, { signal });
      const path = resolve(outputDirectory, `browser-${randomUUID()}.png`);
      await command(['screenshot', path, ...(fullPage ? ['--full'] : [])], { signal });
      const [fileStat, bytes, tab] = await Promise.all([
        stat(path), readFile(path), currentTab({ signal }),
      ]);
      return {
        tab,
        file: {
          path, bytes: fileStat.size,
          sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png',
        },
      };
    },
    async close({ signal } = {}) {
      await command(['close'], { signal });
      activeTabId = null;
      activeTabUrl = null;
      userControl = false;
    },
  };
}
