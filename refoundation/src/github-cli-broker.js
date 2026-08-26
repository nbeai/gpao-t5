import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

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

function apiIsReadOnly(args) {
  if (!args[1] || args[1] === 'graphql') return false;
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
  if (args.some((value) => value === '--show-token' || value === '--web')) return null;
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

export function makeGitHubCliRegistration(program) {
  if (!isAbsolute(program)) throw new TypeError('absolute GitHub CLI program is required');
  return {
    id: 'github-cli-read', executable: 'gh', program,
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
