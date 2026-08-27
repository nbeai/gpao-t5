import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { delimiter, isAbsolute, join, posix, win32 } from 'node:path';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const MAX_PROBE_OUTPUT = 64 * 1024;

const READ_ACTIONS = new Map([
  ['auth', new Set(['status'])],
  ['repo', new Set(['list', 'view'])],
  ['pr', new Set(['list', 'view', 'status', 'checks', 'diff'])],
  ['issue', new Set(['list', 'view', 'status'])],
  ['run', new Set(['list', 'view'])],
  ['workflow', new Set(['list', 'view'])],
  ['release', new Set(['list', 'view'])],
  ['search', new Set(['code', 'commits', 'issues', 'prs', 'repos'])],
]);

function hostIsBound(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--hostname') {
      if (args[index + 1] !== 'github.com') return false;
      index += 1;
    } else if (String(args[index]).startsWith('--hostname=')) {
      if (args[index] !== '--hostname=github.com') return false;
    }
  }
  return true;
}

function apiIsReadOnly(args) {
  if (!args[1] || args[1] === 'graphql'
    || !/^\/?[A-Za-z0-9_.{}-]+(?:\/[A-Za-z0-9_.{}-]+)*$/u.test(args[1])) return false;
  let method = 'GET';
  for (let index = 2; index < args.length; index += 1) {
    const value = args[index];
    if (['-f', '-F', '--field', '--raw-field', '--input'].includes(value)
      || /^--(?:field|raw-field|input)=/u.test(value)) return false;
    if (value === '-X' || value === '--method') method = String(args[index += 1] ?? '').toUpperCase();
    else if (/^--method=/u.test(value)) method = value.slice('--method='.length).toUpperCase();
  }
  return method === 'GET';
}

export function githubReadAction(args = []) {
  if (!hostIsBound(args)
    || args.some((value) => value === '--show-token' || value === '--web')) return null;
  if (args[0] === 'api') return apiIsReadOnly(args) ? 'api_get' : null;
  return READ_ACTIONS.get(args[0])?.has(args[1]) ? `${args[0]}_${args[1]}` : null;
}

export async function findExecutable(name, pathValue = '') {
  for (const root of String(pathValue).split(delimiter).filter(isAbsolute)) {
    const candidate = join(root, name);
    try { await access(candidate, constants.X_OK); return await realpath(candidate); }
    catch { /* continue through bounded PATH candidates */ }
  }
  return null;
}

export function githubCliCredentialRoots({
  platform = process.platform, home, env = process.env,
} = {}) {
  const api = platform === 'win32' ? win32 : posix;
  const candidates = [env.GH_CONFIG_DIR];
  if (env.XDG_CONFIG_HOME) candidates.push(api.join(env.XDG_CONFIG_HOME, 'gh'));
  if (platform === 'win32') {
    if (env.APPDATA) candidates.push(api.join(env.APPDATA, 'GitHub CLI'));
    if (env.USERPROFILE) candidates.push(api.join(env.USERPROFILE, 'AppData', 'Roaming', 'GitHub CLI'));
  } else if (home) {
    candidates.push(api.join(home, '.config', 'gh'));
    if (platform === 'darwin') candidates.push(api.join(home, 'Library', 'Application Support', 'GitHub CLI'));
  }
  return [...new Set(candidates.map(String).filter(api.isAbsolute))];
}

async function runGitHubCli(program, args, env) {
  try {
    const result = await executeFile(program, args, {
      env: { ...env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' },
      timeout: 8_000, maxBuffer: MAX_PROBE_OUTPUT, encoding: 'utf8', windowsHide: true,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: Number.isInteger(error?.code) ? error.code : null,
      stdout: String(error?.stdout ?? ''), stderr: String(error?.stderr ?? ''),
    };
  }
}

function accountRows(value, rows = []) {
  if (Array.isArray(value)) for (const item of value) accountRows(item, rows);
  else if (value && typeof value === 'object') {
    if (typeof value.login === 'string') rows.push(value);
    for (const child of Object.values(value)) accountRows(child, rows);
  }
  return rows;
}

function parseGitHubIdentity(apiResult, statusResult) {
  if (apiResult?.code !== 0) return null;
  let user;
  try { user = JSON.parse(String(apiResult.stdout ?? '')); } catch { return null; }
  const accountId = Number(user?.id); const login = String(user?.login ?? '').trim();
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)) {
    return null;
  }
  let rows = [];
  try { rows = accountRows(JSON.parse(String(statusResult?.stdout ?? ''))); } catch { /* scopes remain unknown */ }
  const row = rows.find((candidate) => candidate.login === login && candidate.active !== false)
    ?? rows.find((candidate) => candidate.login === login) ?? null;
  const reportedScopes = Array.isArray(row?.scopes) ? row.scopes
    : typeof row?.scopes === 'string' ? row.scopes.split(',').map((scope) => scope.trim()) : [];
  const scopes = [...new Set(reportedScopes.map(String)
    .filter((scope) => /^[A-Za-z0-9:_-]{1,120}$/u.test(scope)))].slice(0, 64);
  return { accountId: String(accountId), login, scopes };
}

export function makeGitHubCliRegistration(program, {
  execute = runGitHubCli, env = process.env, now = Date.now, ttlMs = 30_000,
} = {}) {
  if (!isAbsolute(program)) throw new TypeError('absolute GitHub CLI program is required');
  let cached = null; let pending = null;
  const inspect = async () => {
    if (cached && now() - cached.checkedAt < ttlMs) return structuredClone(cached.value);
    if (pending) return structuredClone(await pending);
    pending = (async () => {
      const childEnv = { ...env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' };
      const [api, status] = await Promise.all([
        execute(program, ['api', 'user', '--jq', '{id: .id, login: .login}'], childEnv),
        execute(program, ['auth', 'status', '--active', '--json', 'hosts'], childEnv),
      ]);
      const identity = parseGitHubIdentity(api, status);
      const value = identity ? {
        state: 'ready', reason: 'github_cli_account_observed',
        identity: {
          ownerApplication: 'GitHub CLI', transport: 'authenticated_local_cli',
          accountId: identity.accountId, accountLabel: identity.login,
          permissions: identity.scopes, resources: [], observed: true,
        },
        authority: {
          state: 'observed', accountId: identity.accountId, accountLabel: identity.login,
          permissions: identity.scopes,
        },
        credential: { owner: 'GitHub CLI', storage: 'github_cli_owned' },
      } : {
        state: 'needs_connection', reason: 'github_cli_account_unavailable',
        identity: null, authority: { state: 'unknown', permissions: [] },
        credential: { owner: 'GitHub CLI', storage: 'github_cli_owned' },
      };
      cached = { checkedAt: now(), value }; return value;
    })();
    try { return structuredClone(await pending); } finally { pending = null; }
  };
  return {
    id: 'github-cli-read', label: 'GitHub CLI', executable: 'gh', program, inspect,
    actions: [{
      id: 'read',
      matches(args) { return githubReadAction(args) != null; },
      prepare(args) {
        const action = githubReadAction(args);
        if (!action) throw new Error('GitHub CLI action is not read-only');
        return {
          args,
          env: { GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', PAGER: 'cat', NO_COLOR: '1' },
          sensitiveValues: [], action,
        };
      },
    }],
  };
}
