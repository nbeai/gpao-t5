import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { explainShellCommand } from './command-explainer.js';
import { discoverComputerEnvironment } from './computer-environment.js';
import { ManagedProcessRegistry } from './managed-process.js';
import { compareEffectObservations, observeDeclaredEffect } from './effect-observation.js';
import { makePtyStartTool } from './pty-tool.js';

const DEFAULT_YIELD_MS = 1000;
const DEFAULT_OUTPUT_LIMIT = 64_000;

const EFFECT_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['observe', 'local_change', 'destructive', 'external_send', 'payment', 'secret_input'],
    },
    summary: { type: 'string' },
    targets: { type: 'array', items: { type: 'string' } },
    reversible: { type: 'boolean' },
    backupAvailable: { type: 'boolean' },
    recipientNew: { type: 'boolean' },
    approvalToken: { type: ['string', 'null'] },
  },
  required: [
    'kind', 'summary', 'targets', 'reversible', 'backupAvailable', 'recipientNew', 'approvalToken',
  ],
  additionalProperties: false,
};

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

function makeCommandTool(options = {}, { managed }) {
  const {
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
    effectPreflight,
  } = options;
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
    name: managed ? 'process_start' : 'exec',
    description: managed
      ? 'Start a command that should continue as a managed process. Returns running processId when still active; use process_control afterward.'
      : 'Run a foreground command to completion and return its complete observed stdout, stderr, and exit status in one result.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Complete shell command to run.' },
        cwd: {
          type: ['string', 'null'],
          description: 'Accessible directory to run in, or null to use the default working directory.',
        },
        effect: EFFECT_SCHEMA,
      },
      required: ['command', 'cwd', 'effect'],
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

      const onAbort = () => { registry.stopOwner(ownerId, 'aborted').catch(() => {}); };
      context.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const effectBefore = await observeDeclaredEffect(args.effect ?? { kind: 'observe', targets: [] }, cwd);
        let result = await registry.start({
          program: runtime.program,
          args: runtime.argsFor(command),
          command,
          cwd,
          env: isolatedEnv(root, env, runtime),
          ownerId,
          waitMs: managed ? yieldMs : null,
          spoolLimit: managed ? undefined : Number.POSITIVE_INFINITY,
          metadata: {
            kind: managed ? 'managed' : 'foreground',
            ...(options.originRunId ? { originRunId: options.originRunId } : {}),
            declaredEffect: structuredClone(args.effect ?? { kind: 'observe', targets: [] }),
            effectBefore: structuredClone(effectBefore),
            effectCwd: cwd,
          },
        });
        if (context.signal?.aborted && result.state === 'running') {
          result = await registry.stop({
            processId: result.processId, ownerId, reason: 'aborted', cursor: result.cursor,
          });
        }
        if (managed && result.state !== 'running' && result.state !== 'stop_requested') {
          registry.markTerminalObserved(result.processId, ownerId);
        }
        const effectAfter = result.state === 'running' || result.state === 'stop_requested'
          ? null : await observeDeclaredEffect(args.effect ?? { kind: 'observe', targets: [] }, cwd);
        result = {
          ...result,
          effectObservation: compareEffectObservations(
            args.effect ?? { kind: 'observe', targets: [] }, effectBefore, effectAfter,
          ),
        };
        if (!managed && result.state !== 'running' && result.state !== 'stop_requested') {
          registry.forget(result.processId, ownerId);
          const { processId: ignoredProcessId, cursor: ignoredCursor, ...foreground } = result;
          return { ...foreground, commandExplanation };
        }
        return { ...result, commandExplanation };
      } finally {
        context.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
  if (typeof effectPreflight === 'function') {
    tool.preflight = (args, context) => effectPreflight({
      toolName: tool.name, args: structuredClone(args), ownerId, context,
    });
  }
  tool.processRegistry = registry;
  return tool;
}

/** Foreground shell hand: preserve the original one-command → one-complete-receipt contract. */
export function makeExecTool(options = {}) {
  return makeCommandTool(options, { managed: false });
}

/** Managed shell hand: the model explicitly chooses a process handle and lifecycle controls. */
export function makeProcessStartTool(options = {}) {
  return makeCommandTool(options, { managed: true });
}

function controlObservation(result) {
  if (Array.isArray(result)) return result.map(controlObservation);
  if (!result || typeof result !== 'object') return result;
  const { exitCode, ...rest } = result;
  return { ...rest, processExitCode: exitCode };
}

async function withTerminalEffect(result, processRegistry, processId, ownerId) {
  const observation = controlObservation(result);
  if (!['completed', 'failed', 'stopped'].includes(result?.state)) return observation;
  const metadata = processRegistry.metadata(processId, ownerId);
  if (!metadata?.declaredEffect) return observation;
  const after = await observeDeclaredEffect(metadata.declaredEffect, metadata.effectCwd);
  observation.effectObservation = compareEffectObservations(
    metadata.declaredEffect, metadata.effectBefore, after,
  );
  return observation;
}

export function makeProcessControlTool({ processRegistry, ownerId = 'default' } = {}) {
  if (!processRegistry) throw new TypeError('processRegistry is required');
  return {
    name: 'process_control',
    description: 'List, poll, write to, or stop a managed process returned by process_start. Poll with the last cursor to receive only new output.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'poll', 'write', 'resize', 'stop'] },
        processId: { type: ['string', 'null'] },
        cursor: {
          type: ['object', 'null'],
          properties: { stdout: { type: 'integer' }, stderr: { type: 'integer' } },
          required: ['stdout', 'stderr'],
          additionalProperties: false,
        },
        input: { type: ['string', 'null'] },
        end: { type: ['boolean', 'null'] },
        waitMs: { type: ['integer', 'null'], minimum: 0, maximum: 30000 },
        cols: { type: ['integer', 'null'], minimum: 20, maximum: 500 },
        rows: { type: ['integer', 'null'], minimum: 5, maximum: 200 },
      },
      required: ['action', 'processId', 'cursor', 'input', 'end', 'waitMs', 'cols', 'rows'],
      additionalProperties: false,
    },
    async execute(args = {}) {
      if (args.action === 'list') return { processes: controlObservation(processRegistry.list(ownerId)) };
      if (!args.processId) throw new TypeError('processId is required');
      if (args.action === 'poll') return withTerminalEffect(await processRegistry.poll({
        processId: args.processId, cursor: args.cursor, ownerId, waitMs: args.waitMs ?? 0,
      }), processRegistry, args.processId, ownerId);
      if (args.action === 'write') return processRegistry.write({
        processId: args.processId, input: args.input ?? '', end: Boolean(args.end), ownerId,
      });
      if (args.action === 'resize') return processRegistry.resize({
        processId: args.processId, cols: args.cols, rows: args.rows, ownerId,
      });
      if (args.action === 'stop') return withTerminalEffect(await processRegistry.stop({
        processId: args.processId, cursor: args.cursor, ownerId, reason: 'model_requested',
      }), processRegistry, args.processId, ownerId);
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
  const start = makeProcessStartTool({ ...options, processRegistry });
  const ptyStart = makePtyStartTool({ ...options, processRegistry });
  const control = makeProcessControlTool({ processRegistry, ownerId: options.ownerId });
  return { processRegistry, tools: [exec, start, ptyStart, control] };
}
