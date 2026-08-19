import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BINARY = resolve(here, '..', 'node_modules', '.bin', 'agent-browser');
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
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
} = {}) {
  if (!ownerId) throw new TypeError('browser ownerId is required');
  if (!outputDirectory) throw new TypeError('browser output directory is required');
  const session = sessionNameForOwner(ownerId);
  const sessionRoot = dirname(resolve(outputDirectory));
  const profileDirectory = join(sessionRoot, 'profile');
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
      '--pin-tab', '--json',
    ];
  }

  async function ensureRuntimeRoot() {
    if (usesDefaultRun && !runtimeRootReady) {
      await Promise.all([
        mkdir(sessionRoot, { recursive: true, mode: 0o700 }),
        mkdir(socketDirectory, { recursive: true, mode: 0o700 }),
      ]);
      await Promise.all([chmod(sessionRoot, 0o700), chmod(socketDirectory, 0o700)]);
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
    return tab;
  }

  async function selectTab(tabId, options = {}) {
    if (tabId && tabId !== activeTabId) {
      const selected = normalizeTab(await command(['tab', String(tabId)], options));
      activeTabId = selected.tabId ?? String(tabId);
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
      activeTabId = tabs.find((tab) => tab.active)?.tabId ?? activeTabId;
      return { tabs };
    },
    elementFacts,
    submitFacts,
    async beginUserLogin(url, { signal } = {}) {
      await command(['close'], { signal });
      activeTabId = null;
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
      headedMode = false;
      userControl = false;
      return {
        state: 'user_control_cancelled', pageObserved: false, secretValuesObserved: false,
      };
    },
    async navigate(url, { signal } = {}) {
      const opened = await command(['open', String(url)], { signal });
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
      userControl = false;
    },
  };
}
