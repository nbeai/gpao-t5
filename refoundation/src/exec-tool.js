import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { explainShellCommand } from './command-explainer.js';
import { discoverComputerEnvironment } from './computer-environment.js';
import { ManagedProcessRegistry } from './managed-process.js';

const DEFAULT_YIELD_MS = 1000;
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
  processRegistry,
  ownerId = 'default',
  yieldMs = DEFAULT_YIELD_MS,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
  env = {},
  explainCommand,
} = {}) {
  const defaultDirectory = workingDirectory ?? workspace;
  if (!defaultDirectory || !isAbsolute(defaultDirectory)) throw new TypeError('absolute workingDirectory is required');
  const detected = computer ?? discoverComputerEnvironment({ userHome: defaultDirectory });
  const registry = processRegistry ?? new ManagedProcessRegistry({
    platform: detected.platform,
    outputLimit,
  });
  const runtime = shell
    ? { family: 'posix', program: shell, environmentKeys: [], argsFor: (command) => ['-lc', command] }
    : detected.commandRuntime;
  const explain = explainCommand ?? (runtime.family === 'posix'
    ? explainShellCommand
    : async () => ({ ok: false, parser: 'unavailable', commandFamily: runtime.family }));

  const tool = {
    name: 'exec',
    description: 'Run a command on the current computer. Short commands return their result; continuing commands return a running processId for process_control.',
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
      let commandExplanation;
      try { commandExplanation = await explain(command); }
      catch (error) { commandExplanation = { ok: false, error: error?.message ?? String(error) }; }

      const result = await registry.start({
        program: runtime.program,
        args: runtime.argsFor(command),
        command,
        cwd,
        env: isolatedEnv(root, env, runtime),
        ownerId,
        waitMs: yieldMs,
      });
      if (context.signal?.aborted && result.state === 'running') {
        return {
          ...await registry.stop({ processId: result.processId, ownerId, reason: 'aborted', cursor: result.cursor }),
          commandExplanation,
        };
      }
      return { ...result, commandExplanation };
    },
  };
  tool.processRegistry = registry;
  return tool;
}

function controlObservation(result) {
  if (Array.isArray(result)) return result.map(controlObservation);
  if (!result || typeof result !== 'object') return result;
  const { exitCode, ...rest } = result;
  return { ...rest, processExitCode: exitCode };
}

export function makeProcessControlTool({ processRegistry, ownerId = 'default' } = {}) {
  if (!processRegistry) throw new TypeError('processRegistry is required');
  return {
    name: 'process_control',
    description: 'List, poll, write to, or stop a managed process returned by exec. Poll with the last cursor to receive only new output.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'poll', 'write', 'stop'] },
        processId: { type: ['string', 'null'] },
        cursor: {
          type: ['object', 'null'],
          properties: { stdout: { type: 'integer' }, stderr: { type: 'integer' } },
          additionalProperties: false,
        },
        input: { type: ['string', 'null'] },
        end: { type: ['boolean', 'null'] },
        waitMs: { type: ['integer', 'null'], minimum: 0, maximum: 30000 },
      },
      required: ['action', 'processId', 'cursor', 'input', 'end', 'waitMs'],
      additionalProperties: false,
    },
    async execute(args = {}) {
      if (args.action === 'list') return { processes: controlObservation(processRegistry.list(ownerId)) };
      if (!args.processId) throw new TypeError('processId is required');
      if (args.action === 'poll') return controlObservation(await processRegistry.poll({
        processId: args.processId, cursor: args.cursor, ownerId, waitMs: args.waitMs ?? 0,
      }));
      if (args.action === 'write') return processRegistry.write({
        processId: args.processId, input: args.input ?? '', end: Boolean(args.end), ownerId,
      });
      if (args.action === 'stop') return controlObservation(await processRegistry.stop({
        processId: args.processId, cursor: args.cursor, ownerId, reason: 'model_requested',
      }));
      throw new TypeError(`unknown process action: ${args.action}`);
    },
  };
}

export function makeTerminalHand(options = {}) {
  const processRegistry = options.processRegistry ?? new ManagedProcessRegistry({
    platform: options.computer?.platform ?? process.platform,
    outputLimit: options.outputLimit ?? DEFAULT_OUTPUT_LIMIT,
  });
  const exec = makeExecTool({ ...options, processRegistry });
  const control = makeProcessControlTool({ processRegistry, ownerId: options.ownerId });
  return { processRegistry, tools: [exec, control] };
}
