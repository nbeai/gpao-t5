import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { explainShellCommand } from './command-explainer.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 64_000;

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isolatedEnv(workspace, additions = {}) {
  const keep = ['PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP'];
  const env = Object.fromEntries(keep.flatMap((name) => (
    process.env[name] == null ? [] : [[name, process.env[name]]]
  )));
  return {
    ...env,
    HOME: process.env.T5_REFOUNDATION_HOME ?? workspace,
    T5_REFOUNDATION_WORKSPACE: workspace,
    ...additions,
  };
}

function limited(text, limit) {
  if (text.length <= limit) return { text, truncated: false };
  const head = Math.floor(limit / 2);
  const tail = limit - head;
  return {
    text: `${text.slice(0, head)}\n…(${text.length - limit} characters omitted)…\n${text.slice(-tail)}`,
    truncated: true,
    omittedChars: text.length - limit,
  };
}

async function resolveWorkingDirectory(workspace, requested) {
  const candidate = requested
    ? (isAbsolute(requested) ? requested : resolve(workspace, requested))
    : workspace;
  const actual = await realpath(candidate);
  if (!inside(workspace, actual)) throw new Error('cwd is outside the isolated workspace');
  return actual;
}

/** Create the R1 shell hand. It exposes the shell, not a command allowlist. */
export function makeExecTool({
  workspace,
  shell = '/bin/sh',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
  env = {},
  explainCommand = explainShellCommand,
} = {}) {
  if (!workspace || !isAbsolute(workspace)) throw new TypeError('absolute workspace is required');

  return {
    name: 'exec',
    description: 'Run a shell command inside the isolated working directory and return stdout, stderr, and exit status.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Complete shell command to run.' },
        cwd: {
          type: ['string', 'null'],
          description: 'Directory inside the isolated workspace, or null to use the workspace root.',
        },
      },
      required: ['command', 'cwd'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) throw new TypeError('command is required');
      const root = await realpath(workspace);
      const cwd = await resolveWorkingDirectory(root, args.cwd);
      const startedAt = Date.now();
      let commandExplanation;
      try { commandExplanation = await explainCommand(command); }
      catch (error) { commandExplanation = { ok: false, error: error?.message ?? String(error) }; }

      return new Promise((done) => {
        const child = spawn(shell, ['-lc', command], {
          cwd,
          env: isolatedEnv(root, env),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let stopped = null;
        let settled = false;

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        const stop = (reason) => {
          if (stopped) return;
          stopped = reason;
          child.kill('SIGTERM');
        };
        const onAbort = () => stop('aborted');
        context.signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => stop('timeout'), timeoutMs);

        const finish = (exitCode, spawnError) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          context.signal?.removeEventListener('abort', onAbort);
          if (spawnError) stderr += `${stderr ? '\n' : ''}${spawnError.message}`;
          const out = limited(stdout, outputLimit);
          const err = limited(stderr, outputLimit);
          done({
            command,
            cwd,
            exitCode: exitCode ?? -1,
            stdout: out.text,
            stderr: err.text,
            durationMs: Date.now() - startedAt,
            truncated: out.truncated || err.truncated,
            omittedChars: (out.omittedChars ?? 0) + (err.omittedChars ?? 0),
            commandExplanation,
            ...(stopped ? { stopped } : {}),
          });
        };

        child.once('error', (error) => finish(-1, error));
        child.once('close', (code) => finish(code));
      });
    },
  };
}
