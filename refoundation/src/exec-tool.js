import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { explainShellCommand } from './command-explainer.js';
import { discoverComputerEnvironment } from './computer-environment.js';
import { ManagedProcessRegistry } from './managed-process.js';
import { compareEffectObservations, observeDeclaredEffect } from './effect-observation.js';
import { makePtyStartTool } from './pty-tool.js';
import { commandWithManagedPath } from './managed-command-path.js';
import { redactBrokeredTerminalResult } from './terminal-credential-broker.js';
import { settleCapabilityUse } from './capability-use-receipt.js';
import { makeTerminalOutputTool } from './terminal-output-store.js';
import { makeTerminalSessionTool } from './terminal-session-tool.js';

const DEFAULT_YIELD_MS = 1000;
const DEFAULT_OUTPUT_LIMIT = 64_000;
const STORED_OUTPUT_PREVIEW_CHARS = 8_000;

function compactStoredOutput(text) {
  const value = String(text ?? '');
  if (value.length <= STORED_OUTPUT_PREVIEW_CHARS) return value;
  const half = STORED_OUTPUT_PREVIEW_CHARS / 2;
  return `${value.slice(0, half)}\n…(${value.length - STORED_OUTPUT_PREVIEW_CHARS} stored characters omitted; use terminal_session read_output)…\n${value.slice(-half)}`;
}

function withStoredOutputPreview(result) {
  return { ...result, stdout: compactStoredOutput(result.stdout), stderr: compactStoredOutput(result.stderr) };
}

export const EFFECT_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['observe', 'local_change', 'external_change', 'destructive', 'external_send', 'payment', 'secret_input'],
    },
    targets: { type: 'array', items: { type: 'string' } },
    confirmation: {
      type: 'string',
      enum: ['not_applicable', 'backup_available', 'backup_unavailable', 'known_recipient', 'new_recipient'],
      description: 'Use backup_* only for destructive work and *_recipient only for external_send. Otherwise use not_applicable.',
    },
    rollbackOfToolCallId: { type: ['string', 'null'], maxLength: 200,
      description: 'Use only when this exact effect is intended to restore a prior tool effect.' },
  },
  required: ['kind', 'targets', 'confirmation', 'rollbackOfToolCallId'],
  additionalProperties: false,
};

export function normalizeTerminalEffect(effect) {
  const source = effect && typeof effect === 'object' ? effect : { kind: 'observe', targets: [] };
  const kind = String(source.kind ?? 'observe');
  const confirmation = source.confirmation ?? (
    kind === 'destructive'
      ? (source.backupAvailable === true ? 'backup_available' : 'backup_unavailable')
      : kind === 'external_send'
        ? (source.recipientNew === true ? 'new_recipient' : 'known_recipient')
        : 'not_applicable'
  );
  const valid = (
    (kind === 'destructive' && ['backup_available', 'backup_unavailable'].includes(confirmation))
    || (kind === 'external_send' && ['known_recipient', 'new_recipient'].includes(confirmation))
    || (!['destructive', 'external_send'].includes(kind) && confirmation === 'not_applicable')
  );
  if (!valid) throw Object.assign(new Error('effect confirmation does not match effect kind'), {
    code: 'T5_EFFECT_CONFIRMATION_MISMATCH',
  });
  return {
    kind,
    summary: typeof source.summary === 'string' && source.summary.trim()
      ? source.summary.trim() : kind,
    targets: Array.isArray(source.targets) ? source.targets.map(String) : [],
    reversible: ['observe', 'local_change', 'external_change'].includes(kind)
      || confirmation === 'backup_available',
    backupAvailable: confirmation === 'backup_available',
    recipientNew: confirmation === 'new_recipient',
    approvalToken: source.approvalToken ?? null,
    rollbackOfToolCallId: source.rollbackOfToolCallId == null ? null : String(source.rollbackOfToolCallId),
    confirmation,
  };
}

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
    pathPrepend,
    capabilityAttribution,
    explainCommand,
    effectPreflight,
    terminalPlatformAdapter,
    terminalCredentialBroker,
    terminalOutputStore,
    protectedBrowserRoots = [],
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
  const registeredCli = managed ? [] : (terminalCredentialBroker?.capabilities ?? []);
  const registeredCliDescription = registeredCli.length
    ? ` Registered direct read CLI: ${registeredCli.map((item) => item.executable).join(', ')}; call it directly, without a command -v wrapper.`
    : '';

  const tool = {
    name: managed ? 'process_start' : 'exec',
    description: managed
      ? 'Start a command that should continue as a managed process. Returns running processId when still active; use process_control afterward.'
      : `Run a foreground command to completion and return its complete observed stdout, stderr, and exit status in one result.${registeredCliDescription}`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Complete shell command to run.' },
        cwd: {
          type: ['string', 'null'],
          description: 'Accessible directory to run in, or null to use the default working directory.',
        },
        effect: managed ? EFFECT_SCHEMA : { ...EFFECT_SCHEMA, type: ['object', 'null'] },
      },
      required: ['command', 'cwd', 'effect'],
      additionalProperties: false,
    },
    async execute(args = {}, context = {}) {
      const command = String(args.command ?? '').trim();
      if (!command) throw new TypeError('command is required');
      const declaredEffect = normalizeTerminalEffect(args.effect);
      if (declaredEffect.kind === 'local_change'
        && !declaredEffect.targets.some((target) => String(target ?? '').trim())) {
        throw Object.assign(new Error('local_change requires at least one exact effect target'), {
          code: 'T5_EFFECT_TARGET_REQUIRED',
        });
      }
      const browserControlSignature = /DevToolsActivePort|\/devtools\/browser\/|Runtime\.evaluate|Input\.(?:insertText|dispatchMouseEvent)|Page\.bringToFront|--remote-debugging-port/iu;
      const protectedRootMentioned = protectedBrowserRoots.some((root) => (
        String(root ?? '').trim() && command.includes(String(root))
      ));
      if (protectedRootMentioned || browserControlSignature.test(command)) {
        throw Object.assign(new Error('T5 managed browser control requires the Browser Hand'), {
          code: 'T5_BROWSER_HAND_REQUIRED',
        });
      }
      const root = await realpath(defaultDirectory);
      const cwd = await resolveWorkingDirectory(root, args.cwd);
      let commandExplanation;
      try { commandExplanation = await explain(command); }
      catch (error) { commandExplanation = { ok: false, error: error?.message ?? String(error) }; }
      let attributedCapabilities = [];
      if (typeof capabilityAttribution === 'function') {
        try { attributedCapabilities = await capabilityAttribution({
          command, commandExplanation, ownerId, cwd, declaredEffect,
        }); }
        catch { attributedCapabilities = []; }
      }
      const capabilityAdmissions = attributedCapabilities
        .map((item) => item?.capabilityAdmission).filter(Boolean);
      const capabilitiesUsed = attributedCapabilities.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const { capabilityAdmission: _internalAdmission, ...publicAttribution } = item;
        return publicAttribution;
      });

      const onAbort = () => { registry.stopOwner(ownerId, 'aborted').catch(() => {}); };
      context.signal?.addEventListener('abort', onAbort, { once: true });
      let launch;
      try {
        const effectBefore = await observeDeclaredEffect(declaredEffect, cwd);
        const normalLaunch = {
          program: runtime.program,
          args: runtime.argsFor(commandWithManagedPath(command, pathPrepend, runtime.family)),
          cwd, env: isolatedEnv(root, env, runtime), confinement: null,
        };
        const brokered = await terminalCredentialBroker?.prepare?.({ commandExplanation, managed })
          ?? { matched: false };
        if (brokered.matched && !brokered.allowed) {
          throw Object.assign(new Error(brokered.reason), { code: 'T5_REGISTERED_CLI_ACTION_REQUIRED' });
        }
        const observationProbe = !managed && declaredEffect.kind === 'observe' && !brokered.allowed
          && typeof terminalPlatformAdapter?.prepareObservationProbe === 'function';
        launch = brokered.allowed ? {
          ...normalLaunch, program: brokered.launch.program, args: brokered.launch.args,
          env: { ...normalLaunch.env, ...brokered.launch.env },
          confinement: { kind: 'registered_cli_broker', qualified: true },
        } : observationProbe
          ? await terminalPlatformAdapter.prepareObservationProbe(normalLaunch)
          : terminalPlatformAdapter?.prepare ? await terminalPlatformAdapter.prepare(normalLaunch) : normalLaunch;
        let result = await registry.start({
          program: launch.program,
          args: launch.args,
          command,
          cwd,
          env: launch.env,
          ownerId,
          waitMs: managed ? yieldMs : null,
          spoolLimit: managed ? undefined : Number.POSITIVE_INFINITY,
          metadata: {
            kind: managed ? 'managed' : 'foreground',
            ...(options.originRunId ? { originRunId: options.originRunId } : {}),
            declaredEffect: structuredClone(declaredEffect),
            effectBefore: structuredClone(effectBefore),
            effectCwd: cwd,
            ...(capabilitiesUsed.length ? { capabilitiesUsed: structuredClone(capabilitiesUsed) } : {}),
          },
          onActivity: context.onActivity,
        });
        if (context.signal?.aborted && (result.state === 'running' || result.state === 'stop_requested')) {
          result = await registry.stop({
            processId: result.processId, ownerId, reason: 'aborted', cursor: result.cursor,
          });
        }
        if (managed && result.state !== 'running' && result.state !== 'stop_requested') {
          registry.markTerminalObserved(result.processId, ownerId);
        }
        const effectAfter = result.state === 'running' || result.state === 'stop_requested'
          ? null : await observeDeclaredEffect(declaredEffect, cwd);
        result = {
          ...result,
          ...(launch.confinement ? { confinement: launch.confinement } : {}),
          ...(capabilitiesUsed.length ? { capabilitiesUsed: structuredClone(capabilitiesUsed) } : {}),
          effectObservation: compareEffectObservations(
            declaredEffect, effectBefore, effectAfter,
          ),
        };
        if (capabilityAdmissions.length) result.capabilityReceipts = capabilityAdmissions.map((admission) => (
          settleCapabilityUse({ admission, result, effectObservation: result.effectObservation })
        ));
        const observationBoundary = launch.assess?.(result);
        if (observationBoundary?.blocked) result = {
          ...result,
          originalExitCode: result.exitCode,
          exitCode: 77,
          state: observationBoundary.state,
          reason: observationBoundary.reason,
          probeChangedNothing: true,
        };
        if (brokered.allowed) result = {
          ...redactBrokeredTerminalResult(result, brokered.launch.sensitiveValues),
          credentialBroker: {
            kind: 'registered_cli', capabilityId: brokered.capabilityAdmission.capabilityId,
            action: brokered.capabilityAdmission.action,
          },
          capabilityReceipts: [
            ...(result.capabilityReceipts ?? []),
            settleCapabilityUse({ admission: brokered.capabilityAdmission, result,
              effectObservation: result.effectObservation }),
          ],
        };
        if (!managed && result.state !== 'running' && result.state !== 'stop_requested') {
          if (result.truncated && terminalOutputStore && options.originRunId) {
            const full = registry.fullOutput(result.processId, ownerId);
            const stored = await terminalOutputStore.save({ sessionId: ownerId, runId: options.originRunId,
              stdout: full.stdout.text, stderr: full.stderr.text });
            result.outputRecall = { handle: stored.handle, streams: stored.streams };
            result.activatedTools = [options.outputRecallToolName ?? 'terminal_output'];
            result = withStoredOutputPreview(result);
          }
          registry.forget(result.processId, ownerId);
          const { processId: ignoredProcessId, cursor: ignoredCursor, ...foreground } = result;
          return { ...foreground, commandExplanation };
        }
        return { ...result, commandExplanation };
      } finally {
        await launch?.cleanup?.().catch(() => {});
        context.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
  if (typeof effectPreflight === 'function') {
    tool.preflight = async (args, context) => {
      if (!managed) {
        let explained;
        try { explained = await explain(String(args?.command ?? '')); } catch { explained = null; }
        const delayed = explained?.steps?.find((step) => step.executable === 'sleep' && step.argv?.[1]);
        if (delayed) {
          const match = /^(\d+(?:\.\d+)?)([smhd]?)$/iu.exec(String(delayed.argv[1]));
          const seconds = match ? Number(match[1]) * ({ '': 1, s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()]) : 0;
          if (seconds > 10) return {
            allowed: false, outcome: 'not_executed', result: {
              state: 'future_schedule_required', delaySeconds: seconds,
              reason: 'Foreground terminal waiting is not a durable future action. Use automation.',
            },
          };
        }
      }
      if (!managed && args?.effect == null) {
        if (terminalPlatformAdapter?.observationProbeQualified !== true) return {
          allowed: false, outcome: 'not_executed', result: {
            state: 'effect_declaration_required', reason: 'observation_probe_unavailable',
          },
        };
        return { allowed: true };
      }
      const normalizedArgs = { ...structuredClone(args), effect: normalizeTerminalEffect(args?.effect) };
      return effectPreflight({
        toolName: tool.name, args: normalizedArgs, ownerId, context,
      });
    };
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

function processResourceSemantics(args, result) {
  if (args?.action !== 'poll') return {};
  if (result?.state === 'running' || result?.state === 'stop_requested') return { pending: true };
  if (result?.state === 'completed' || result?.state === 'failed' || result?.state === 'stopped') {
    return { terminal: true };
  }
  return {};
}

async function withTerminalEffect(result, processRegistry, processId, ownerId) {
  const observation = controlObservation(result);
  const metadata = processRegistry.metadata(processId, ownerId);
  if (metadata?.capabilitiesUsed?.length) observation.capabilitiesUsed = structuredClone(metadata.capabilitiesUsed);
  if (!['completed', 'failed', 'stopped'].includes(result?.state)) return observation;
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
    resourceSemantics: processResourceSemantics,
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
  const exec = makeExecTool({ ...options, processRegistry, outputRecallToolName: 'terminal_session' });
  const start = makeProcessStartTool({ ...options, processRegistry });
  const ptyStart = makePtyStartTool({ ...options, processRegistry });
  const control = makeProcessControlTool({ processRegistry, ownerId: options.ownerId });
  const output = options.terminalOutputStore && options.ownerId
    ? makeTerminalOutputTool({ store: options.terminalOutputStore, sessionId: options.ownerId }) : null;
  const managedRecall = new Map();
  const decorateManagedResult = async (result) => {
    if (!result?.truncated || !['completed', 'failed', 'stopped'].includes(result.state)
      || !options.terminalOutputStore || !options.ownerId || !options.originRunId) return result;
    let stored = managedRecall.get(result.processId);
    if (!stored) {
      const full = processRegistry.fullOutput(result.processId, options.ownerId);
      if (full.stdout.omittedChars > 0 || full.stderr.omittedChars > 0) return {
        ...result, exactOutputRecallUnavailable: true,
      };
      stored = await options.terminalOutputStore.save({
        sessionId: options.ownerId, runId: options.originRunId,
        stdout: full.stdout.text, stderr: full.stderr.text,
      });
      managedRecall.set(result.processId, stored);
    }
    return withStoredOutputPreview({
      ...result, outputRecall: { handle: stored.handle, streams: stored.streams },
    });
  };
  const session = makeTerminalSessionTool({
    start, ptyStart, control, output, effectSchema: EFFECT_SCHEMA,
    normalizeEffect: normalizeTerminalEffect,
    decorateResult: decorateManagedResult,
  });
  session.searchTerms = [
    'long running background command managed process interactive terminal tty tui stdin prompt exact output',
    '오래 걸리는 백그라운드 작업 대화형 터미널 입력 정확한 출력',
  ];
  return { processRegistry, tools: [exec, session] };
}
