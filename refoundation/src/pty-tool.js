import pty from 'node-pty';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { discoverComputerEnvironment } from './computer-environment.js';
import { explainShellCommand } from './command-explainer.js';
import { compareEffectObservations, observeDeclaredEffect } from './effect-observation.js';
import { commandWithManagedPath } from './managed-command-path.js';

const EFFECT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['observe', 'local_change', 'external_change', 'destructive', 'external_send', 'payment', 'secret_input'] },
    summary: { type: 'string' },
    targets: { type: 'array', items: { type: 'string' } },
    reversible: { type: 'boolean' },
    backupAvailable: { type: 'boolean' },
    recipientNew: { type: 'boolean' },
    approvalToken: { type: ['string', 'null'] },
    rollbackOfToolCallId: { type: ['string', 'null'], maxLength: 200 },
  },
  required: ['kind', 'summary', 'targets', 'reversible', 'backupAvailable', 'recipientNew', 'approvalToken'],
  additionalProperties: false,
};

function ptyEnv(defaultDirectory, runtime, additions = {}) {
  const keep = ['PATH', 'Path', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TMP', 'TEMP', ...(runtime.environmentKeys ?? [])];
  const env = Object.fromEntries(keep.flatMap((name) => process.env[name] == null ? [] : [[name, process.env[name]]]));
  return { ...env, HOME: process.env.T5_REFOUNDATION_HOME ?? defaultDirectory, USERPROFILE: process.env.T5_REFOUNDATION_HOME ?? defaultDirectory, ...additions };
}

export function makePtyStartTool({
  workingDirectory, workspace, computer, processRegistry, ownerId = 'default',
  yieldMs = 1000, originRunId, effectPreflight, env = {}, pathPrepend, capabilityAttribution,
  terminalPlatformAdapter,
} = {}) {
  const defaultDirectory = workingDirectory ?? workspace;
  if (!defaultDirectory || !isAbsolute(defaultDirectory)) throw new TypeError('absolute workingDirectory is required');
  if (!processRegistry) throw new TypeError('processRegistry is required');
  const detected = computer ?? discoverComputerEnvironment({ userHome: defaultDirectory });
  const runtime = detected.commandRuntime;
  const tool = {
    name: 'pty_start',
    description: 'Start a command in a real pseudo-terminal for TTY-only CLIs and TUIs. Returns a processId controlled by process_control.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: ['string', 'null'] },
        effect: EFFECT_SCHEMA,
        cols: { type: 'integer', minimum: 20, maximum: 500 },
        rows: { type: 'integer', minimum: 5, maximum: 200 },
      },
      required: ['command', 'cwd', 'effect', 'cols', 'rows'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) throw new TypeError('command is required');
      const root = await realpath(defaultDirectory);
      const candidate = args.cwd ? (isAbsolute(args.cwd) ? args.cwd : resolve(root, args.cwd)) : root;
      const cwd = await realpath(candidate);
      const effectBefore = await observeDeclaredEffect(args.effect, cwd);
      const explanation = await explainShellCommand(command).catch((error) => ({ ok: false, error: error.message }));
      let capabilitiesUsed = [];
      if (typeof capabilityAttribution === 'function') {
        try { capabilitiesUsed = await capabilityAttribution({ command, commandExplanation: explanation, ownerId }); }
        catch { capabilitiesUsed = []; }
      }
      const launch = terminalPlatformAdapter?.prepare ? await terminalPlatformAdapter.prepare({
        program: runtime.program,
        args: runtime.argsFor(commandWithManagedPath(command, pathPrepend, runtime.family)),
        cwd, env: ptyEnv(root, runtime, env),
      }) : {
        program: runtime.program,
        args: runtime.argsFor(commandWithManagedPath(command, pathPrepend, runtime.family)),
        cwd, env: ptyEnv(root, runtime, env), confinement: null,
      };
      const ptyProcess = pty.spawn(launch.program, launch.args, {
        cwd, env: launch.env, name: 'xterm-256color',
        cols: args.cols, rows: args.rows,
      });
      let result = await processRegistry.startPty({
        ptyProcess, command, cwd, ownerId, waitMs: yieldMs,
        metadata: {
          kind: 'managed', pty: true, originRunId,
          declaredEffect: structuredClone(args.effect), effectBefore, effectCwd: cwd,
          ...(capabilitiesUsed.length ? { capabilitiesUsed: structuredClone(capabilitiesUsed) } : {}),
        },
      });
      if (context.signal?.aborted && result.state === 'running') {
        result = await processRegistry.stop({ processId: result.processId, ownerId, reason: 'aborted', cursor: result.cursor });
      }
      if (!['running', 'stop_requested'].includes(result.state)) {
        processRegistry.markTerminalObserved(result.processId, ownerId);
      }
      const after = ['completed', 'failed', 'stopped'].includes(result.state)
        ? await observeDeclaredEffect(args.effect, cwd) : null;
      return {
        ...result, commandExplanation: explanation,
        ...(launch.confinement ? { confinement: launch.confinement } : {}),
        ...(capabilitiesUsed.length ? { capabilitiesUsed: structuredClone(capabilitiesUsed) } : {}),
        effectObservation: compareEffectObservations(args.effect, effectBefore, after),
      };
    },
  };
  if (typeof effectPreflight === 'function') {
    tool.preflight = (args, context) => effectPreflight({
      toolName: tool.name, args: structuredClone(args), ownerId, context,
    });
  }
  return tool;
}
