import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { explainShellCommand } from './command-explainer.js';
import { discoverComputerEnvironment } from './computer-environment.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 64_000;

function isolatedEnv(defaultDirectory, additions = {}, runtime = {}) {
  const keep = [
    'PATH', 'Path', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP',
    ...(runtime.environmentKeys ?? []),
  ];
  const env = Object.fromEntries(keep.flatMap((name) => (
    process.env[name] == null ? [] : [[name, process.env[name]]]
  )));
  return {
    ...env,
    HOME: process.env.T5_REFOUNDATION_HOME ?? defaultDirectory,
    USERPROFILE: process.env.T5_REFOUNDATION_HOME ?? defaultDirectory,
    T5_REFOUNDATION_WORKING_DIRECTORY: defaultDirectory,
    T5_REFOUNDATION_WORKSPACE: defaultDirectory,
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

async function resolveWorkingDirectory(defaultDirectory, requested) {
  const candidate = requested
    ? (isAbsolute(requested) ? requested : resolve(defaultDirectory, requested))
    : defaultDirectory;
  return realpath(candidate);
}

/** Create the R1 shell hand. It exposes the shell, not a command allowlist. */
export function makeExecTool({
  workingDirectory,
  workspace,
  computer,
  shell,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
  env = {},
  explainCommand,
} = {}) {
  const defaultDirectory = workingDirectory ?? workspace;
  if (!defaultDirectory || !isAbsolute(defaultDirectory)) throw new TypeError('absolute workingDirectory is required');
  const detected = computer ?? discoverComputerEnvironment({ userHome: defaultDirectory });
  const runtime = shell
    ? { family: 'posix', program: shell, environmentKeys: [], argsFor: (command) => ['-lc', command] }
    : detected.commandRuntime;
  const explain = explainCommand ?? (runtime.family === 'posix'
    ? explainShellCommand
    : async () => ({ ok: false, parser: 'unavailable', commandFamily: runtime.family }));

  return {
    name: 'exec',
    description: 'Run a command on the current computer and return stdout, stderr, and exit status.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Complete shell command to run.' },
        cwd: {
          type: ['string', 'null'],
          description: 'Accessible directory to run in, or null to use the default working directory.',
        },
      },
      required: ['command', 'cwd'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) throw new TypeError('command is required');
      const root = await realpath(defaultDirectory);
      const cwd = await resolveWorkingDirectory(root, args.cwd);
      const startedAt = Date.now();
      let commandExplanation;
      try { commandExplanation = await explain(command); }
      catch (error) { commandExplanation = { ok: false, error: error?.message ?? String(error) }; }

      return new Promise((done) => {
        const child = spawn(runtime.program, runtime.argsFor(command), {
          cwd,
          env: isolatedEnv(root, env, runtime),
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
