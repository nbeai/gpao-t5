import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgent } from './agent-loop.js';
import { ConsoleSessionStore } from './console-session-store.js';
import { makeTerminalHand } from './exec-tool.js';
import { discoverComputerEnvironment, publicComputerFacts } from './computer-environment.js';
import { makePathRevealer } from './path-revealer.js';
import { ManagedProcessRegistry } from './managed-process.js';
import { RunLedger } from './run-ledger.js';
import { deriveRunSpeedReceipt } from './run-speed-receipt.js';
import { deriveRunContextReport } from './run-context-receipt.js';
import { AuthorityStore, boundaryForEffect, effectDeclarationMismatch } from './effect-authority.js';
import { compareEffectObservations, observeDeclaredEffect } from './effect-observation.js';
import { loadSkillSnapshot, makeSkillTool, mergeSkillSnapshots } from './skill-runtime.js';
import { ManagedSkillStore, makeSkillAcquisitionTool } from './managed-skill-store.js';
import { loadCliCatalog, ManagedCliStore, makeCliAcquisitionTool } from './managed-cli-store.js';
import { makeCapabilityEvidenceTool } from './capability-outcome-evidence.js';
import { loadSkillPolicyCatalog } from './skill-policy-catalog.js';
import { ConversationLedger } from './conversation-ledger.js';
import { projectHistoricalConversationEntries } from './conversation-projection.js';
import { makeConversationRecallTool } from './conversation-recall-tool.js';
import {
  activeConversationProjection,
  CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS,
  planConversationCheckpoint,
  summarizeConversationCheckpoint,
} from './conversation-checkpoint.js';
import { MemoryLedger } from './memory-ledger.js';
import {
  makeMemoryTool, memoryContextMessage, memoryFlushRequest, MEMORY_FLUSH_SYSTEM_INSTRUCTIONS,
} from './memory-tool.js';
import { makeSessionSearchTool } from './session-search-tool.js';
import { makeWebSearchTool } from './web-search-tool.js';
import { makeWebReadTool } from './web-read-tool.js';
import { makeBrowserObservationTool } from './browser-observation-tool.js';
import { makeBrowserObservationRegistry } from './browser-action-state.js';
import { AttachmentStore } from './attachment-store.js';
import {
  attachmentContext, makeAttachmentTool, modelImageInputs,
} from './attachment-hand.js';
import { MessengerCredentialStore } from './messenger-credential-store.js';
import { makeMessengerGateway, MessengerStateStore } from './messenger-gateway.js';
import {
  modelProgressText, safeProgressText, toolCompletedProgressText, toolProgressText,
} from './progress-language.js';
import { SessionActivityStore } from './session-activity-store.js';
import { userSafeTurnFailure } from './turn-failure.js';
import {
  recoveryEvidenceForTurn, repeatedNoProgressSignal,
} from './conversation-recovery.js';
import { makeConnectionDoctor } from './connection-truth.js';
import { makeConnectionTool } from './connection-tool.js';
import { CapabilityHandoffLedger } from './capability-handoff-ledger.js';
import { makeCapabilityHandoffCoordinator } from './capability-handoff-coordinator.js';
import { loadCapabilityCatalog, makeCapabilityCatalogTool } from './capability-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..');
const legacyUiRoot = resolve(repositoryRoot, 'src', 'surface', 'web');
const bundledSkillsRoot = resolve(repositoryRoot, 'refoundation', 'skills');
const bundledSkillPackagesRoot = resolve(repositoryRoot, 'refoundation', 'skill-packages');
const bundledSkillCatalogFile = resolve(repositoryRoot, 'refoundation', 'config', 'skill-catalog.json');
const bundledCliCatalogFile = resolve(repositoryRoot, 'refoundation', 'config', 'cli-catalog.json');
const bundledCapabilitiesRoot = resolve(repositoryRoot, 'refoundation', 'capabilities');
const bundledDocumentCli = resolve(repositoryRoot, 'refoundation', 'bin', 't5-document.mjs');
const founderManifestoPath = resolve(
  repositoryRoot, 'docs', '00-product', 'GPAO-T5-FOUNDER-MANIFESTO-ko.md',
);
function attachmentSurface(record) {
  return {
    attachmentId: record.attachmentId,
    direction: record.direction,
    originalName: record.originalName,
    mimeType: record.mimeType,
    kind: record.kind,
    bytes: record.bytes,
    sha256: record.sha256,
    downloadUrl: record.downloadUrl,
    ...(record.previewUrl ? { previewUrl: record.previewUrl } : {}),
  };
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function httpErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

export function requestContainsExactPath(request, candidate) {
  const text = String(request ?? '');
  const path = String(candidate ?? '');
  if (!path || !isAbsolute(path)) return false;
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(path, from);
    if (index < 0) return false;
    const before = index === 0 ? '' : text[index - 1];
    const afterIndex = index + path.length;
    const after = afterIndex >= text.length ? '' : text[afterIndex];
    const beforeOk = !before || /[\s"'`([{:=]/u.test(before);
    let afterOk = !after || /[\s"'`,.;:!?)}\]]/u.test(after);
    if (after === '.' && /[\p{L}\p{N}_-]/u.test(text[afterIndex + 1] ?? '')) afterOk = false;
    if (beforeOk && afterOk) return true;
    from = index + 1;
  }
  return false;
}

async function body(req, limit = 1024 * 1024) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error('request body too large');
  }
  return text ? JSON.parse(text) : {};
}

function historyFrom(session) {
  return (session.transcript ?? []).flatMap((entry) => {
    if (entry.role === 'user' && typeof entry.text === 'string') return [{ role: 'user', content: entry.text }];
    if (entry.role === 'assistant' && typeof entry.result?.reply === 'string') {
      return [{ role: 'assistant', content: entry.result.reply }];
    }
    return [];
  });
}

function activeSessionRecoveryIds(session) {
  const resolved = new Set((session?.transcript ?? []).flatMap((entry) => (
    entry?.role === 'system_event' && entry.event?.kind === 'session_recovered'
      ? (entry.event.recoveryIds ?? []).map(String) : []
  )));
  return (session?.transcript ?? []).flatMap((entry) => {
    const id = entry?.role === 'assistant' ? entry.result?.recovery?.recoveryId : null;
    return id && !resolved.has(String(id)) ? [String(id)] : [];
  });
}

function activeSessionConnectionHandoffIds(session) {
  const completed = new Set((session?.transcript ?? []).flatMap((entry) => (
    entry?.role === 'system_event' && [
      'connection_completed', 'connection_cancelled', 'connection_wait_expired',
    ].includes(entry.event?.kind)
      ? [String(entry.event.handoffId ?? '')]
      : entry?.role === 'system_event' && entry.event?.kind === 'session_recovered'
        ? (entry.event.connectionHandoffIds ?? []).map(String) : []
  )));
  return (session?.transcript ?? []).flatMap((entry) => {
    const id = entry?.role === 'assistant' ? entry.result?.connectionHandoff?.handoffId : null;
    return id && !completed.has(String(id)) ? [String(id)] : [];
  });
}

function selfState(status, workspace, browserReady = false) {
  const searchReady = (status?.connections ?? []).some((connection) => connection.kind === 'api_key');
  return {
    model: status?.modelId ?? '연결 필요',
    modelAuthState: status?.connected ? 'usable' : 'needs_connection',
    modelHealthState: status?.connected ? 'usable' : null,
    ready: ['터미널', 'URL 읽기', ...(searchReady ? ['웹 검색'] : []), ...(browserReady ? ['브라우저'] : [])],
    limits: [`기본 터미널 위치: ${workspace}`],
  };
}

export function makeConsoleServer({
  stateDir,
  workspace,
  modelFactory,
  modelStatus = () => ({ connected: false, provider: null, modelId: null }),
  uiRoot = legacyUiRoot,
  computerEnvironment,
  revealPath,
  processRegistry,
  skillsRoot = bundledSkillsRoot,
  skillPackagesRoot = bundledSkillPackagesRoot,
  skillCatalogFile = bundledSkillCatalogFile,
  managedSkillsRoot,
  cliCatalogFile = bundledCliCatalogFile,
  managedCliRoot,
  cliFetchImpl,
  cliVerifyExecutable,
  capabilitiesRoot = bundledCapabilitiesRoot,
  skillCatalogMode = 'on-demand',
  conversationProjection = 'historical-tool-receipt-v1',
  largeToolOutputMode = 'recoverable',
  conversationCheckpointMode = 'in-place-v0',
  checkpointTriggerBytes = 750_000,
  checkpointTailBytes = 60_000,
  checkpointChunkBytes = 180_000,
  checkpointSummarizer,
  memoryFlushMode = 'pre-checkpoint-v0',
  memoryFlushMaxModelTurns = 8,
  webSearchProviders = [],
  webReadOptions = {},
  browserDriverFactory,
  browserHost,
  workspaceConnectionInspectors = [],
  workspaceConnectionServices = [],
  connectionPollIntervalMs = 2_000,
  connectionPollTimeoutMs = 10 * 60_000,
  processYieldMs = 1000,
  documentCli = bundledDocumentCli,
  attachmentStore,
  modelConnections,
  messengerProviderFactory,
  onError,
} = {}) {
  if (!stateDir || !workspace) throw new TypeError('stateDir and workspace are required');
  if (typeof modelFactory !== 'function') throw new TypeError('modelFactory is required');
  if (!['full', 'historical-tool-receipt-v1'].includes(conversationProjection)) {
    throw new TypeError('unsupported conversation projection');
  }
  if (!['inline', 'on-demand'].includes(skillCatalogMode)) {
    throw new TypeError('unsupported skill catalog mode');
  }
  if (!['inline', 'recoverable'].includes(largeToolOutputMode)) {
    throw new TypeError('unsupported large tool output mode');
  }
  if (!['off', 'in-place-v0'].includes(conversationCheckpointMode)) {
    throw new TypeError('unsupported conversation checkpoint mode');
  }
  if (!['off', 'pre-checkpoint-v0'].includes(memoryFlushMode)) {
    throw new TypeError('unsupported memory flush mode');
  }
  // A browser tab can outlive this server process during development, an app restart, or a
  // computer restart. Give every process lifetime a public, non-secret identity so the page can
  // distinguish a reconnect from a connection to the same runtime.
  const runtimeInstanceId = randomUUID();
  const sessions = new ConsoleSessionStore(stateDir);
  const conversations = new ConversationLedger(join(stateDir, 'conversations'));
  const memories = new MemoryLedger(join(stateDir, 'memory'));
  const capabilityHandoffs = new CapabilityHandoffLedger(join(stateDir, 'capability-handoffs'));
  const runLedger = new RunLedger(join(stateDir, 'runs'));
  const authority = new AuthorityStore(join(stateDir, 'authority'));
  const attachments = attachmentStore ?? new AttachmentStore(join(stateDir, 'attachments'));
  const computer = computerEnvironment ?? discoverComputerEnvironment({ userHome: workspace });
  const computerFacts = publicComputerFacts(computer);
  const processes = processRegistry ?? new ManagedProcessRegistry({ platform: computer.platform });
  const reveal = revealPath ?? makePathRevealer({
    platform: computer.platform, userHome: computer.userHome,
  });
  const pendingStreams = new Map();
  const running = new Map();
  const pendingProcessWakes = new Map();
  const wakeSubscribers = new Set();
  const measurementRuns = new Map();
  const sessionActivities = new SessionActivityStore();
  const pendingSurfaceMetrics = new Map();
  const webReadTool = makeWebReadTool(webReadOptions);
  const webSearchTool = makeWebSearchTool({ providers: webSearchProviders });
  const browserDrivers = new Map();
  const browserObservations = new Map();
  const browserArtifactRoot = resolve(stateDir, 'browser');
  const messengerDirectory = join(stateDir, 'messenger');
  const messengerCredentials = new MessengerCredentialStore(messengerDirectory);
  const messengerState = new MessengerStateStore(messengerDirectory);
  let onboardingSkipped = false;
  let capabilityCoordinator = null;
  const managedRoot = managedSkillsRoot ?? join(stateDir, 'managed-skills');
  const cliRoot = managedCliRoot ?? join(stateDir, 'managed-cli');
  const skillPackageSnapshotPromise = loadSkillSnapshot({ directory: skillPackagesRoot });
  const skillPolicyCatalogPromise = loadSkillPolicyCatalog(skillCatalogFile);
  const managedSkillStorePromise = Promise.all([skillPackageSnapshotPromise, skillPolicyCatalogPromise])
    .then(([catalogSnapshot, policyCatalog]) => new ManagedSkillStore({ root: managedRoot, catalogSnapshot, policyCatalog }));
  const managedCliStorePromise = loadCliCatalog(cliCatalogFile).then((catalog) => new ManagedCliStore({
    root: cliRoot, catalog, platform: computer.platform, architecture: computer.architecture,
    ...(cliFetchImpl ? { fetchImpl: cliFetchImpl } : {}),
    ...(cliVerifyExecutable ? { verifyExecutable: cliVerifyExecutable } : {}),
  }));

  async function browserDriver(sessionId) {
    if (typeof browserDriverFactory !== 'function') return null;
    if (!browserDrivers.has(sessionId)) {
      browserDrivers.set(sessionId, await browserDriverFactory(sessionId));
    }
    return browserDrivers.get(sessionId);
  }

  async function closeBrowserDrivers() {
    await Promise.all([...browserDrivers.values()].map(async (driver) => {
      try { await driver.close?.(); } catch { /* already closed */ }
    }));
    browserDrivers.clear();
  }

  async function recoverSession({ sessionId, mode, recoveryId = null }) {
    if (!['reset', 'continue'].includes(mode)) {
      throw Object.assign(new Error('지원하지 않는 대화 회복 방식이에요.'), { status: 400 });
    }
    const session = await sessions.load(sessionId);
    if (!session) throw Object.assign(new Error('대화를 찾지 못했어요.'), { status: 404 });
    const activeRecoveryIds = activeSessionRecoveryIds(session);
    if (recoveryId != null && !activeRecoveryIds.includes(String(recoveryId))) {
      throw Object.assign(new Error('이미 정리된 회복 요청이에요.'), { status: 409 });
    }
    const resolvedRecoveryIds = recoveryId == null ? activeRecoveryIds : [String(recoveryId)];
    const recoveryRun = await runLedger.start({
      sessionId, request: 'conversation recovery',
      metadata: { trigger: 'user_recovery', mode },
    });
    try {
      running.get(sessionId)?.abort();
      let discardedStreams = 0;
      for (const [streamId, pending] of pendingStreams) {
        if (pending.sessionId === sessionId) {
          pendingStreams.delete(streamId); discardedStreams += 1;
        }
      }
      for (const [processId, pending] of pendingProcessWakes) {
        if (pending.ownerId === sessionId) pendingProcessWakes.delete(processId);
      }
      await processes.stopOwner(sessionId, 'user_recovered');
      const browser = browserDrivers.get(sessionId);
      let browserHandoffCancelled = false;
      if (typeof browser?.cancelUserLogin === 'function') {
        browserHandoffCancelled = Boolean(await browser.cancelUserLogin().catch(() => null));
      }
      const activeConnectionHandoffIds = activeSessionConnectionHandoffIds(session);
      const activeConnectionHandoffs = (session.transcript ?? []).flatMap((entry) => {
        const handoff = entry?.role === 'assistant' ? entry.result?.connectionHandoff : null;
        return handoff?.active && activeConnectionHandoffIds.includes(String(handoff.handoffId))
          ? [handoff] : [];
      });
      const connectionHandoffsCancelled = await capabilityCoordinator
        .cancelSessionHandoffs(activeConnectionHandoffs);
      const withdrawnApprovalIds = await authority.withdrawActive(sessionId);
      const clearedActivity = sessionActivities.reset(sessionId);
      for (let attempt = 0; attempt < 20 && running.has(sessionId); attempt += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      await sessions.append(sessionId, {
        role: 'system_event', runId: recoveryRun.runId,
        event: {
          kind: 'session_recovered', mode, recoveryIds: resolvedRecoveryIds,
          connectionHandoffIds: activeConnectionHandoffs.map((handoff) => String(handoff.handoffId)),
          previousRunStillStopping: running.has(sessionId),
        },
      });
      let newSession = null;
      if (mode === 'continue') {
        newSession = await sessions.create({ continuationOf: sessionId });
        await sessions.append(newSession.id, {
          role: 'system_event', runId: recoveryRun.runId,
          event: { kind: 'continued_from_session', sourceSessionId: sessionId },
        });
      }
      const facts = {
        mode, discardedStreams, withdrawnApprovals: withdrawnApprovalIds.length,
        connectionHandoffsCancelled,
        activityCleared: Boolean(clearedActivity), browserHandoffCancelled,
        previousRunStillStopping: running.has(sessionId),
        continued: Boolean(newSession),
      };
      await recoveryRun.append({ type: 'conversation_recovered', stepId: 'recovery', payload: facts });
      await recoveryRun.finish('completed', facts);
      return {
        ok: true, ready: !running.has(sessionId), mode,
        ...(newSession ? { newSessionId: newSession.id } : {}),
        userSafeSummary: newSession
          ? '새 대화를 준비했어요. 이전 대화는 그대로 보관했어요.'
          : running.has(sessionId)
            ? '하던 작업을 멈추고 있어요. 새 대화는 바로 사용할 수 있어요.'
            : '이 대화의 진행 상태를 다시 준비했어요.',
      };
    } catch (error) {
      await recoveryRun.finish('failed', { error: error?.message ?? String(error) }).catch(() => {});
      throw error;
    }
  }

  function browserObservationRegistry(sessionId) {
    if (!browserObservations.has(sessionId)) {
      browserObservations.set(sessionId, makeBrowserObservationRegistry());
    }
    return browserObservations.get(sessionId);
  }

  function publishBrowserScreenshot(sessionId, captured) {
    const path = resolve(captured.file.path);
    const parts = relative(browserArtifactRoot, path).split(sep);
    if (parts.length !== 3 || !/^t5-[0-9a-f]{20}$/.test(parts[0]) || parts[1] !== 'artifacts'
      || !/^browser-[0-9a-f-]{36}\.png$/.test(parts[2])) {
      throw new Error('browser screenshot path is outside the managed artifact directory');
    }
    return { url: `/browser-artifacts/${parts[0]}/${parts[2]}` };
  }

  async function status() { return Promise.resolve(modelStatus()); }

  function projectConversation(conversation, memoryItems = []) {
    const active = activeConversationProjection(conversation);
    const projectedTail = conversationProjection === 'historical-tool-receipt-v1'
      ? projectHistoricalConversationEntries(active.tailEntries, { largeOutputMode: largeToolOutputMode })
      : { messages: active.tailEntries.map((entry) => structuredClone(entry.message)), recoverable: [] };
    const messages = active.checkpoint
        ? [structuredClone(active.messages[0]), ...projectedTail.messages]
        : projectedTail.messages;
    const recalledMemory = memoryContextMessage(memoryItems);
    return {
      messages: recalledMemory ? [recalledMemory, ...messages] : messages,
      recoverable: projectedTail.recoverable,
      active,
    };
  }

  async function effectPreflight({ toolName, args, ownerId }) {
    const effect = args?.effect;
    if (!effect?.kind) return {
      allowed: false, outcome: 'not_executed',
      result: { state: 'effect_declaration_required' },
    };
    const boundary = boundaryForEffect(effect);
    if (!boundary) return { allowed: true };
    if (boundary === 'secret_input') return {
      allowed: false, outcome: 'not_executed',
      result: {
        state: 'secret_input_required', effect,
        reason: 'Secret values must come from a user-controlled input surface, not model tool arguments.',
      },
    };
    if (effect.approvalToken) {
      const consumed = await authority.consume(effect.approvalToken, { toolName, args });
      if (consumed.allowed) return { allowed: true };
      return {
        allowed: false, outcome: 'not_executed',
        result: { state: 'authority_invalid', pendingId: effect.approvalToken, reason: consumed.reason },
      };
    }
    const mismatch = effectDeclarationMismatch(args.command, effect);
    if (mismatch) return {
      allowed: false, outcome: 'not_executed',
      result: { state: 'effect_declaration_mismatch', reason: mismatch, declaredEffect: effect },
    };
    let proposal = await authority.findActiveCall(ownerId, toolName, args);
    if (!proposal) proposal = await authority.propose({ sessionId: ownerId, toolName, args });
    return {
      allowed: false, outcome: 'not_executed',
      result: {
        state: 'approval_required', pendingId: proposal.pendingId,
        effect: proposal.args.effect, toolName, command: proposal.args.command, cwd: proposal.args.cwd,
      },
    };
  }

  async function executeTurn(sessionId, text, emit = () => {}, options = {}) {
    if (running.has(sessionId)) throw Object.assign(new Error('session already running'), { status: 409 });
    const session = await sessions.load(sessionId);
    if (!session) throw Object.assign(new Error('session not found'), { status: 404 });
    const attachmentIds = [...new Set((options.attachmentIds ?? []).map(String))];
    if (attachmentIds.length > 10) throw Object.assign(new Error('한 번에 첨부할 수 있는 파일은 10개까지예요.'), { status: 413 });
    const currentAttachments = await Promise.all(attachmentIds.map((attachmentId) => (
      attachments.get({ sessionId, attachmentId })
    )));
    const attachmentProjection = currentAttachments.map(attachmentSurface);
    const attachmentBlock = attachmentContext(currentAttachments);
    const modelRequest = attachmentBlock ? `${text}\n\n${attachmentBlock}` : text;
    const imageInputs = await modelImageInputs({ store: attachments, sessionId, records: currentAttachments });
    const outputCandidates = new Set();
    const outputKey = (path) => resolve(String(path ?? '')).normalize('NFC');
    await conversations.ensure({ sessionId, legacyMessages: historyFrom(session) });
    await memories.ensure();
    const memorySnapshot = await memories.read();
    let canonicalConversation = await conversations.read(sessionId);
    let projection = projectConversation(canonicalConversation, memorySnapshot.items);
    const run = await runLedger.start({ sessionId, request: text, metadata: {
      priorConversationMessages: projection.messages.length,
      conversationProjection,
      skillCatalogMode,
      largeToolOutputMode,
      conversationCheckpointMode,
      memoryFlushMode,
      recoverableHistoricalOutputs: projection.recoverable.length,
      attachmentCount: currentAttachments.length,
      attachmentIds,
      trigger: options.trigger ?? 'user',
      ...(options.metadata ?? {}),
    } });
    const initialActivity = sessionActivities.start({
      sessionId, runId: run.runId, text: modelProgressText(1), phase: 'starting',
    });
    broadcastEvent('session_activity', { ...initialActivity, done: false });
    const publishProgress = (type, value, phase) => {
      const progressText = safeProgressText(value);
      const activity = sessionActivities.update({
        sessionId, runId: run.runId, text: progressText, phase,
      });
      emit(type, { text: progressText });
      if (activity) broadcastEvent('session_activity', { ...activity, done: false });
    };
    const finishActivity = (activityStatus) => {
      const activity = sessionActivities.finish({
        sessionId, runId: run.runId, status: activityStatus,
      });
      if (activity) broadcastEvent('session_activity', { ...activity, done: true });
    };
    if (attachmentIds.length) {
      const messageId = `${run.runId}:user`;
      await attachments.link({ sessionId, attachmentIds, messageId, runId: run.runId });
      await run.append({
        type: 'attachments_linked', stepId: 'attachments', payload: {
          messageId, attachmentIds,
          attachments: currentAttachments.map((record) => ({
            attachmentId: record.attachmentId, originalName: record.originalName,
            kind: record.kind, mimeType: record.mimeType, bytes: record.bytes, sha256: record.sha256,
          })),
        },
      });
    }
    if (options.measurementId) {
      measurementRuns.set(options.measurementId, { run, runId: run.runId });
      const pending = pendingSurfaceMetrics.get(options.measurementId) ?? [];
      pendingSurfaceMetrics.delete(options.measurementId);
      for (const metric of pending) await run.append({ type: 'surface_metric', payload: metric });
    }
    const controller = new AbortController();
    running.set(sessionId, controller);
    let runFinished = false;
    let surfacePersisted = false;
    try {
      if (conversationCheckpointMode === 'in-place-v0') {
        const plan = planConversationCheckpoint({
          conversation: canonicalConversation, currentRequest: text,
          projectedMessages: projection.messages,
          triggerBytes: checkpointTriggerBytes, tailBytes: checkpointTailBytes,
        });
        if (plan.needed) {
          await run.append({
            type: 'checkpoint_started', stepId: 'checkpoint', payload: {
              activeBytes: plan.activeBytes, sourceBytes: plan.sourceBytes,
              sourceMessageCount: plan.summarizeEntries.length,
              tailMessageCount: plan.tailEntries.length,
            },
          });
          let checkpointCall = 0;
          try {
            const summarized = await summarizeConversationCheckpoint(plan, {
              chunkBytes: checkpointChunkBytes,
              summarize: async (input) => {
                checkpointCall += 1;
                if (typeof checkpointSummarizer === 'function') {
                  return checkpointSummarizer({ ...input, sessionId, runId: run.runId });
                }
                const turn = -1000 + checkpointCall;
                const stepId = `checkpoint-model-${checkpointCall}`;
                await run.append({
                  type: 'model_started', stepId,
                  payload: { turn, purpose: 'conversation_checkpoint', phase: input.phase },
                });
                const summaryModel = await modelFactory({
                  sessionId, workspace, computer: computerFacts,
                  instructionsOverride: CONVERSATION_CHECKPOINT_SYSTEM_INSTRUCTIONS,
                  purpose: 'conversation_checkpoint',
                });
                const response = await summaryModel.respond({
                  messages: [{ role: 'user', content: input.prompt }], tools: [], signal: controller.signal,
                  onContextReceipt: async (contextReceipt) => run.append({
                    type: 'model_context_built', stepId,
                    payload: { turn, purpose: 'conversation_checkpoint', contextReceipt },
                  }),
                });
                await run.append({
                  type: 'model_completed', stepId,
                  payload: { turn, purpose: 'conversation_checkpoint', response },
                });
                if (response.toolCalls?.length) throw new Error('checkpoint model requested a tool');
                return response.text;
              },
            });
            const checkpointId = randomUUID();
            if (memoryFlushMode === 'pre-checkpoint-v0') {
              await run.append({
                type: 'memory_flush_started', stepId: 'memory-flush', payload: {
                  checkpointId, coversThroughMessageId: summarized.coversThroughMessageId,
                  currentItems: memorySnapshot.items.length,
                },
              });
              try {
                const memoryModel = await modelFactory({
                  sessionId, workspace, computer: computerFacts,
                  instructionsOverride: MEMORY_FLUSH_SYSTEM_INSTRUCTIONS,
                  purpose: 'memory_flush',
                });
                const memoryTool = makeMemoryTool({
                  ledger: memories,
                  source: {
                    origin: 'pre_checkpoint', sessionId, runId: run.runId,
                    coversThroughMessageId: summarized.coversThroughMessageId,
                  },
                });
                const memoryResult = await runAgent({
                  request: memoryFlushRequest(summarized.summary, memorySnapshot.items),
                  model: memoryModel, tools: [memoryTool], signal: controller.signal,
                  maxModelTurns: memoryFlushMaxModelTurns,
                  onEvent: async (event) => {
                    const memoryTurn = -2000 + Number(event.turn ?? 0);
                    if (event.type === 'model_start') {
                      await run.append({
                        type: 'model_started', stepId: `memory-model-${event.turn}`,
                        payload: { turn: memoryTurn, purpose: 'memory_flush' },
                      });
                    } else if (event.type === 'model_context') {
                      await run.append({
                        type: 'model_context_built', stepId: `memory-model-${event.turn}`,
                        payload: { turn: memoryTurn, purpose: 'memory_flush', contextReceipt: event.contextReceipt },
                      });
                    } else if (event.type === 'model_end') {
                      await run.append({
                        type: 'model_completed', stepId: `memory-model-${event.turn}`,
                        payload: { turn: memoryTurn, purpose: 'memory_flush', response: event.response },
                      });
                    } else if (event.type === 'tool_start') {
                      await run.append({
                        type: 'tool_started', stepId: `memory-tool-${event.toolCallId}`,
                        payload: {
                          turn: memoryTurn, purpose: 'memory_flush', toolCallId: event.toolCallId,
                          name: event.name, args: event.args,
                        },
                      });
                    } else if (event.type === 'tool_end') {
                      await run.append({
                        type: 'tool_completed', stepId: `memory-tool-${event.receipt.toolCallId}`,
                        payload: { turn: memoryTurn, purpose: 'memory_flush', receipt: event.receipt },
                      });
                    }
                  },
                });
                if (memoryResult.status !== 'completed') {
                  throw new Error(`memory flush ended without completion: ${memoryResult.status}`);
                }
                const afterMemory = await memories.read();
                await run.append({
                  type: 'memory_flush_completed', stepId: 'memory-flush', payload: {
                    checkpointId, modelTurns: memoryResult.modelTurns,
                    receiptCount: memoryResult.receipts.length,
                    itemsBefore: memorySnapshot.items.length, itemsAfter: afterMemory.items.length,
                  },
                });
              } catch (error) {
                await run.append({
                  type: 'memory_flush_failed', stepId: 'memory-flush',
                  payload: { checkpointId, error: error?.message ?? String(error) },
                });
              }
            }
            await conversations.appendCheckpoint({
              sessionId, checkpointId,
              coversThroughMessageId: summarized.coversThroughMessageId,
              summary: summarized.summary,
              sourceMessageCount: summarized.sourceMessageCount,
              sourceBytes: summarized.sourceBytes,
              tailMessageCount: summarized.tailMessageCount,
            });
            await run.append({
              type: 'checkpoint_completed', stepId: 'checkpoint', payload: {
                checkpointId, coversThroughMessageId: summarized.coversThroughMessageId,
                sourceMessageCount: summarized.sourceMessageCount,
                sourceBytes: summarized.sourceBytes,
                tailMessageCount: summarized.tailMessageCount,
                chunks: summarized.chunks,
                summaryBytes: Buffer.byteLength(summarized.summary, 'utf8'),
              },
            });
            canonicalConversation = await conversations.read(sessionId);
            projection = projectConversation(canonicalConversation, memorySnapshot.items);
          } catch (error) {
            await run.append({
              type: 'checkpoint_failed', stepId: 'checkpoint',
              payload: { error: error?.message ?? String(error) },
            });
          }
        }
      }
      const history = projection.messages;
      await conversations.appendMessage({
        sessionId, messageId: `${run.runId}:user`, runId: run.runId,
        message: {
          role: 'user', content: modelRequest,
          ...(attachmentProjection.length ? { attachments: attachmentProjection } : {}),
        },
      });
      await sessions.append(sessionId, {
        ...(options.inputEntry ?? {
          role: 'user', text,
          ...(attachmentProjection.length ? { attachments: attachmentProjection } : {}),
        }), runId: run.runId,
      });
      const model = await modelFactory({ sessionId, workspace, computer: computerFacts });
      const managedCliStore = await managedCliStorePromise;
      const terminal = makeTerminalHand({
        workingDirectory: workspace, computer, processRegistry: processes, ownerId: sessionId,
        yieldMs: processYieldMs, originRunId: run.runId, effectPreflight,
        pathPrepend: managedCliStore.bin,
        capabilityAttribution: ({ commandExplanation }) => managedCliStore.attributeCommand(commandExplanation),
        env: { T5_DOCUMENT_CLI: documentCli, PATH: managedCliStore.prependPath(process.env.PATH ?? process.env.Path ?? '') },
      });
      const [bundledSkillSnapshot, managedSkillSnapshot, skillPackageSnapshot, managedSkillStore] = await Promise.all([
        loadSkillSnapshot({ directory: skillsRoot }),
        loadSkillSnapshot({ directory: join(managedRoot, 'active') }),
        skillPackageSnapshotPromise, managedSkillStorePromise,
      ]);
      const skillSnapshot = mergeSkillSnapshots([bundledSkillSnapshot, managedSkillSnapshot]);
      const capabilitySnapshot = await loadCapabilityCatalog({ directory: capabilitiesRoot });
      const offeredTools = [...terminal.tools];
      offeredTools.unshift(makeAttachmentTool({
        store: attachments, sessionId, workspace, runId: run.runId,
        authorizeOutputPath: (candidate) => (
          requestContainsExactPath(text, candidate) || outputCandidates.has(outputKey(candidate))
        ),
      }));
      let browserReady = false;
      const currentBrowser = await browserDriver(sessionId);
      if (currentBrowser) {
        const availability = await currentBrowser.available().catch((error) => ({
          available: false, reason: error?.message ?? String(error),
        }));
        if (availability.available) {
          browserReady = true;
          offeredTools.unshift(makeBrowserObservationTool({
            driver: currentBrowser,
            publishScreenshot: (captured) => publishBrowserScreenshot(sessionId, captured),
            observationRegistry: browserObservationRegistry(sessionId),
            authorizeUploadPath: (candidate) => (
              (!options.trigger || options.trigger === 'user')
              && requestContainsExactPath(text, candidate)
            ),
            authorizeEffect: (args) => effectPreflight({
              toolName: 'browser', args, ownerId: sessionId,
            }),
          }));
        }
      }
      offeredTools.unshift(webReadTool);
      if ((await Promise.all(webSearchProviders.map(async (provider) => {
        try { return (await provider.available())?.available === true; }
        catch { return false; }
      }))).some(Boolean)) offeredTools.unshift(webSearchTool);
      if (projection.recoverable.length) {
        offeredTools.unshift(makeConversationRecallTool({
          ledger: conversations, sessionId, allowedRefs: projection.recoverable,
        }));
      }
      if (skillSnapshot.skills.length) {
        offeredTools.unshift(makeSkillTool({ snapshot: skillSnapshot, catalogMode: skillCatalogMode }));
      }
      if (skillPackageSnapshot.skills.length) {
        offeredTools.unshift(makeSkillAcquisitionTool({
          store: managedSkillStore, catalogSnapshot: skillPackageSnapshot,
          authorizeEffect: (args) => effectPreflight({
            toolName: 'capability_prepare', args, ownerId: sessionId,
          }),
        }));
      }
      offeredTools.unshift(makeCliAcquisitionTool({
        store: managedCliStore,
        authorizeEffect: (args) => effectPreflight({
          toolName: 'cli_prepare', args, ownerId: sessionId,
        }),
      }));
      offeredTools.unshift(makeCapabilityEvidenceTool({ runLedger }));
      if (capabilitySnapshot.entries.length) {
        offeredTools.unshift(makeCapabilityCatalogTool({
          snapshot: capabilitySnapshot, connectionDoctor,
        }));
      }
      for (const service of connectionServices.values()) {
        if (typeof service.makeTool !== 'function') continue;
        const workspaceTool = await service.makeTool({
          attachments, sessionId, runId: run.runId,
          authorizeEffect: (args) => effectPreflight({
            toolName: service.toolName ?? service.id, args, ownerId: sessionId,
          }),
          authorizeUploadPath: (candidate) => (
            (!options.trigger || options.trigger === 'user') && requestContainsExactPath(text, candidate)
          ),
        });
        if (workspaceTool) offeredTools.unshift(workspaceTool);
      }
      offeredTools.unshift(makeMemoryTool({
        ledger: memories,
        source: { origin: 'foreground', sessionId, runId: run.runId },
      }));
      offeredTools.unshift(makeSessionSearchTool({
        ledger: conversations, sessions, currentSessionId: sessionId,
      }));
      offeredTools.unshift(makeConnectionTool({
        doctor: connectionDoctor, startConnection: startConnectionForTool,
        performConnection: (id, actionId) => performConnectionAction(id, actionId, { sessionId }),
      }));
      const result = await runAgent({
        request: modelRequest,
        requestAttachments: imageInputs,
        history,
        model,
        tools: offeredTools,
        signal: controller.signal,
        maxModelTurns: 32,
        onEvent: async (event) => {
          if (event.type === 'model_start') {
            await run.append({
              type: 'model_started', stepId: `model-${event.turn}`, payload: { turn: event.turn },
            });
            publishProgress('trace_status', modelProgressText(event.turn), 'model');
          } else if (event.type === 'model_context') {
            await run.append({
              type: 'model_context_built', stepId: `model-${event.turn}`,
              payload: { turn: event.turn, contextReceipt: event.contextReceipt },
            });
          } else if (event.type === 'model_end') {
            await run.append({
              type: 'model_completed', stepId: `model-${event.turn}`,
              payload: { turn: event.turn, response: event.response },
            });
            await conversations.appendMessage({
              sessionId, messageId: `${run.runId}:assistant:${event.turn}`, runId: run.runId,
              turn: event.turn,
              message: {
                role: 'assistant', content: event.response.text,
                ...(event.response.toolCalls.length
                  ? { toolCalls: structuredClone(event.response.toolCalls) } : {}),
              },
            });
            if (!event.response.toolCalls.length && String(event.response.text ?? '').trim()) {
              publishProgress('trace_status', '이제 거의 다 됐어요', 'finalizing');
            }
          } else if (event.type === 'tool_start') {
            await run.append({
              type: 'tool_started', stepId: `tool-${event.toolCallId || `${event.turn}-${event.name}`}`,
              payload: {
                turn: event.turn, toolCallId: event.toolCallId, name: event.name, args: event.args,
              },
            });
            publishProgress('tool_progress', toolProgressText(event.name, event.args), 'tool');
          } else if (event.type === 'tool_end') {
            if (event.receipt.result?.effectObservation?.changed === true) {
              for (const target of event.receipt.result.effectObservation.declared?.targets ?? []) {
                outputCandidates.add(outputKey(target));
              }
            }
            await run.append({
              type: 'tool_completed', stepId: `tool-${event.receipt.toolCallId}`,
              payload: { turn: event.turn, receipt: event.receipt },
            });
            await conversations.appendMessage({
              sessionId,
              messageId: `${run.runId}:tool:${event.receipt.toolCallId || `${event.turn}:${event.name}`}`,
              runId: run.runId, turn: event.turn,
              message: {
                role: 'tool', toolCallId: event.receipt.toolCallId,
                name: event.receipt.requestedCall.name, content: JSON.stringify(event.receipt),
              },
            });
            publishProgress('trace_status', toolCompletedProgressText(
              event.name, event.receipt?.requestedCall?.args ?? {},
            ), 'reviewing');
          }
        },
      });
      if (result.status === 'cancelled') {
        await run.finish('cancelled', { modelTurns: result.modelTurns, receiptCount: result.receipts.length });
        runFinished = true;
        finishActivity('cancelled');
        return { kind: 'cancelled', result, runId: run.runId };
      }
      if (result.status !== 'completed' || !String(result.answer ?? '').trim()) {
        throw new Error(`agent ended without an answer: ${result.status}`);
      }
      const connection = await status();
      const approvalReceipt = [...result.receipts].reverse().find((receipt) => (
        receipt.result?.state === 'approval_required'
      ));
      const outputArtifacts = result.receipts.filter((receipt) => (
        receipt.outcome === 'succeeded' && receipt.result?.artifact
      )).map((receipt) => attachmentSurface(receipt.result.artifact));
      const browserHandoffReceipt = [...result.receipts].reverse().find((receipt) => (
        receipt.requestedCall?.name === 'browser'
        && receipt.requestedCall?.args?.action === 'login_start'
        && receipt.outcome === 'succeeded'
        && receipt.result?.state === 'user_control_required'
      ));
      const browserHandoff = browserHandoffReceipt ? {
        active: true,
        visible: browserHandoffReceipt.result?.handoff?.visible === true,
        canReveal: browserHandoffReceipt.result?.handoff?.canReveal === true,
        provider: 'browser',
      } : null;
      const connectionHandoffReceipt = [...result.receipts].reverse().find((receipt) => (
        receipt.requestedCall?.name === 'connection'
        && ['start', 'perform'].includes(receipt.requestedCall?.args?.action)
        && receipt.outcome === 'succeeded'
        && ['user_authorization_required', 'user_action_started'].includes(receipt.result?.state)
      ));
      const connectionHandoff = connectionHandoffReceipt ? (() => {
        const mode = connectionHandoffReceipt.result.handoffMode
          ?? (connectionHandoffReceipt.requestedCall.args.action === 'start' ? 'oauth' : 'user_action');
        return {
          active: true, mode, handoffId: run.runId,
          connectionId: connectionHandoffReceipt.result.connection?.id,
          label: connectionHandoffReceipt.result.connection?.label,
          ...(mode === 'oauth' ? {
            authorizeUrl: connectionHandoffReceipt.result.authorizeUrl,
            awaitEndpoint: connectionHandoffReceipt.result.awaitEndpoint,
          } : {
            checkEndpoint: connectionHandoffReceipt.result.checkEndpoint,
            cancelEndpoint: connectionHandoffReceipt.result.cancelEndpoint,
          }),
        };
      })() : null;
      const surfaceResult = approvalReceipt ? (() => {
        const { effect, pendingId, command, toolName } = approvalReceipt.result;
        return {
          kind: 'approval', reply: result.answer, runId: run.runId, pendingId,
          pending: [{
            action: effect.kind, label: effect.summary, tier: 'A3', safetyFloor: true,
            preview: {
              impact: effect.kind, where: effect.targets.join(', '),
              what: command ?? (toolName === 'browser'
                ? `browser ${approvalReceipt.requestedCall?.args?.action ?? 'action'}` : toolName),
              cancel: effect.reversible ? '되돌릴 수 있다고 선언됨' : '되돌리기 어려움',
            },
            reason: {
              why: effect.kind === 'payment' ? '돈이 나가는 일이에요.'
                : effect.kind === 'external_send' ? '새 상대에게 처음 보내는 일이에요.'
                  : '백업 없는 파괴적 변경이에요.',
              reversible: effect.reversible ? '되돌릴 수 있다고 선언됨' : '되돌리기 어려움',
            },
          }],
          selfStateSummary: selfState(connection, workspace, browserReady),
        };
      })() : {
        kind: 'reply',
        reply: result.answer,
        runId: run.runId,
        ...(browserHandoff ? { browserHandoff } : {}),
        ...(connectionHandoff ? { connectionHandoff } : {}),
        ...(outputArtifacts.length ? { artifacts: outputArtifacts } : {}),
        ...(options.trigger && options.trigger !== 'user' ? { trigger: options.trigger } : {}),
        selfStateSummary: selfState(connection, workspace, browserReady),
      };
      const recoveryEvidence = recoveryEvidenceForTurn({
        userText: text, reply: surfaceResult.reply, kind: surfaceResult.kind,
        failureCode: surfaceResult.failureCode ?? null, receipts: result.receipts,
      });
      surfaceResult.recoveryEvidence = recoveryEvidence;
      const recovery = repeatedNoProgressSignal({
        session, currentUserText: text, currentResult: surfaceResult, evidence: recoveryEvidence,
      });
      if (recovery) surfaceResult.recovery = { ...recovery, recoveryId: run.runId };
      await sessions.append(sessionId, { role: 'assistant', result: surfaceResult });
      surfacePersisted = true;
      await run.append({ type: 'surface_persisted', payload: { role: 'assistant' } });
      await run.finish('completed', { modelTurns: result.modelTurns, receiptCount: result.receipts.length });
      runFinished = true;
      finishActivity('completed');
      if (connectionHandoff) {
        await capabilityCoordinator.register({
          handoffId: connectionHandoff.handoffId, sessionId,
          connectionId: connectionHandoff.connectionId, mode: connectionHandoff.mode,
          originRunId: run.runId,
        });
      }
      return { kind: 'reply', surfaceResult, result, runId: run.runId };
    } catch (error) {
      if (controller.signal.aborted) {
        if (!runFinished) {
          await run.finish('cancelled', { reason: 'user_recovered_or_cancelled' }).catch(() => {});
          runFinished = true;
        }
        finishActivity('cancelled');
        return {
          kind: 'cancelled', runId: run.runId,
          result: { status: 'cancelled', answer: null, receipts: [], modelTurns: null },
          surfaceResult: { kind: 'cancelled', runId: run.runId },
        };
      }
      const connection = await Promise.resolve().then(() => status()).catch(() => null);
      const failure = userSafeTurnFailure(error, connection);
      const failureSurface = {
        kind: 'error', reply: failure.text, nextSafeAction: failure.nextSafeAction,
        failureCode: failure.code, runId: run.runId,
      };
      const recoveryEvidence = recoveryEvidenceForTurn({
        userText: text, reply: failureSurface.reply, kind: failureSurface.kind,
        failureCode: failureSurface.failureCode, receipts: [],
      });
      failureSurface.recoveryEvidence = recoveryEvidence;
      const recovery = repeatedNoProgressSignal({
        session, currentUserText: text, currentResult: failureSurface, evidence: recoveryEvidence,
      });
      if (recovery) failureSurface.recovery = { ...recovery, recoveryId: run.runId };
      if (!surfacePersisted) {
        await sessions.append(sessionId, { role: 'assistant', result: failureSurface }).catch(() => {});
        surfacePersisted = true;
        await run.append({
          type: 'surface_persisted', payload: { role: 'assistant', kind: 'error' },
        }).catch(() => {});
      }
      if (!runFinished) {
        await run.finish('failed', { error: error?.message ?? String(error) }).catch(() => {});
        runFinished = true;
      }
      finishActivity('failed');
      if (error && typeof error === 'object') error.surfaceResult = failureSurface;
      throw error;
    } finally {
      running.delete(sessionId);
      for (const [processId, event] of pendingProcessWakes) {
        if (event.ownerId === sessionId) {
          pendingProcessWakes.delete(processId);
          queueMicrotask(() => { attemptProcessWake(event).catch((error) => onError?.(error)); });
        }
      }
    }
  }

  async function recordSurfaceMetric(input = {}) {
    const measurementId = String(input.measurementId ?? '');
    if (!measurementId || !['first_feedback_visible', 'first_grounded_content', 'turn_complete'].includes(input.event)
      || !Number.isFinite(input.elapsedMs)) return false;
    const metric = {
      event: input.event,
      elapsedMs: input.elapsedMs,
      visibilityState: ['visible', 'hidden', 'prerender'].includes(input.visibilityState)
        ? input.visibilityState : 'hidden',
    };
    const bound = measurementRuns.get(measurementId);
    if (bound) {
      await bound.run.append({ type: 'surface_metric', payload: metric });
      if (input.event === 'turn_complete') measurementRuns.delete(measurementId);
    } else {
      const pending = pendingSurfaceMetrics.get(measurementId) ?? [];
      pending.push(metric);
      pendingSurfaceMetrics.set(measurementId, pending);
    }
    return true;
  }

  const messenger = makeMessengerGateway({
    credentialStore: messengerCredentials,
    stateStore: messengerState,
    ...(messengerProviderFactory ? { providerFactory: messengerProviderFactory } : {}),
    createSession: async ({ origin } = {}) => sessions.create({
      origin: origin ? { channel: origin.provider, chatId: origin.chatId } : null,
    }),
    authorizeInbound: async (message) => {
      const allowed = await messengerState.isAllowed(message.provider, message);
      if (!allowed) await messengerState.notePending(message.provider, message);
      return allowed;
    },
    onInbound: async (message, { progress } = {}) => {
      const notify = (type, payload) => {
        if (!['trace_status', 'tool_progress'].includes(type)) return;
        const text = safeProgressText(payload?.text);
        progress?.(text);
        broadcastEvent('messenger_progress', { sessionId: message.sessionId, text, done: false });
      };
      try {
        const completed = await executeTurn(message.sessionId, message.text, notify, {
          trigger: 'messenger',
          metadata: {
            provider: message.provider, chatId: message.chatId, threadId: message.threadId,
            userId: message.userId, username: message.username,
          },
          inputEntry: {
            role: 'user', text: message.text, channel: message.provider,
            channelMeta: {
              chatId: message.chatId, threadId: message.threadId,
              userId: message.userId, username: message.username,
            },
          },
        });
        broadcastEvent('messenger_progress', {
          sessionId: message.sessionId, text: '답변을 준비했어요', done: true,
        });
        return completed.surfaceResult?.reply ?? completed.result?.answer ?? null;
      } catch (error) {
        const failure = error?.surfaceResult;
        broadcastEvent('messenger_progress', {
          sessionId: message.sessionId,
          text: failure?.reply ?? '요청을 처리하는 중 문제가 생겼어요.', done: true,
        });
        throw error;
      }
    },
    log: (...values) => onError?.(new Error(values.map(String).join(' '))),
  });
  const connectionServices = new Map(workspaceConnectionServices.map((service) => {
    if (!service?.id || !service?.label || !service?.category || typeof service.inspect !== 'function') {
      throw new TypeError('invalid workspace connection service');
    }
    return [service.id, service];
  }));
  if (connectionServices.size !== workspaceConnectionServices.length) {
    throw new TypeError('duplicate workspace connection service');
  }
  const connectionDoctor = makeConnectionDoctor({ inspectors: [
    {
      id: 'model', label: 'AI 모델', category: 'core',
      async inspect() {
        const connection = await status();
        return {
          state: connection?.connected ? 'connected' : 'needs_connection',
          reason: connection?.connected ? null : 'model_not_connected',
          userSafeSummary: connection?.connected
            ? `${connection.modelId ?? '선택한 모델'}을 사용하고 있어요.` : '대화에 사용할 모델 연결이 필요해요.',
          capabilities: { conversation: Boolean(connection?.connected) },
          routes: (connection?.connections ?? []).slice(0, 12).map((item) => ({
            kind: item.kind === 'chatgpt_oauth' ? 'account' : 'api_key',
            label: item.kind === 'chatgpt_oauth' ? 'ChatGPT 계정' : `${item.provider} API`,
            state: item.active ? 'connected' : 'ready', canStart: false,
          })),
        };
      },
    },
    {
      id: 'telegram', label: '텔레그램', category: 'messenger',
      async inspect() {
        const current = await messenger.status();
        const connected = current.connections?.telegram?.connected === true;
        return {
          state: connected ? 'connected' : 'needs_connection',
          reason: connected ? null : 'telegram_not_connected',
          userSafeSummary: connected ? '텔레그램 메시지를 주고받을 수 있어요.' : '사용하려면 봇을 연결해 주세요.',
          capabilities: { receive: connected, send: connected },
          routes: [{ kind: 'bot_token', label: '텔레그램 봇', state: connected ? 'connected' : 'needs_connection', canStart: true }],
        };
      },
    },
    {
      id: 't5-browser', label: '웹사이트 계정', category: 'browser',
      async inspect() {
        const available = Boolean(browserHost);
        return {
          state: available ? 'ready' : 'unavailable',
          reason: available ? 'site_login_checked_when_requested' : 'browser_unavailable',
          userSafeSummary: available
            ? 'T5 브라우저에서 사이트별 로그인을 시작하고 계속 사용할 수 있어요.'
            : 'T5 브라우저를 사용할 수 없어요.',
          capabilities: { login: available, read: available, download: available, upload: available },
          routes: available
            ? [{ kind: 'browser', label: 'T5 브라우저', state: 'ready', canStart: true }] : [],
        };
      },
    },
    ...workspaceConnectionServices.map((service) => ({
      id: service.id, label: service.label, category: service.category,
      inspect: (options) => service.inspect(options),
    })),
    ...workspaceConnectionInspectors,
  ] });
  async function startConnectionForTool(id) {
    const service = connectionServices.get(id);
    if (!service || typeof service.start !== 'function') throw new Error('connection start is unavailable');
    const alreadyWaiting = await capabilityCoordinator.hasActiveConnection(id);
    if (alreadyWaiting) return {
      connection: { id: service.id, label: service.label },
      joinedExisting: true, handoffMode: 'user_action',
      checkEndpoint: `/connections/${service.id}/check`,
      cancelEndpoint: `/connections/${service.id}/cancel`,
      userSafeSummary: '이미 같은 연결을 준비하고 있어요. 준비되면 이 대화의 부탁도 이어갈게요.',
    };
    const current = await service.inspect();
    if (!current.actions?.some((action) => action.kind === 'oauth')) {
      throw new Error(current.state === 'connected' ? 'connection is already active' : 'connection start is unavailable');
    }
    const started = await service.start();
    const authorizeUrl = new URL(String(started.authorizeUrl ?? ''));
    if (authorizeUrl.protocol !== 'https:' || authorizeUrl.username || authorizeUrl.password) {
      await service.close?.();
      throw new Error('connection authorization URL is invalid');
    }
    return {
      connection: { id: service.id, label: service.label },
      authorizeUrl: authorizeUrl.href,
      awaitEndpoint: `/connections/${service.id}/await`,
    };
  }
  async function performConnectionAction(id, actionId, { sessionId = null } = {}) {
    const service = connectionServices.get(id);
    if (!service || typeof service.performAction !== 'function') {
      throw new Error('connection action is unavailable');
    }
    const current = await service.inspect();
    const action = current.actions?.find((candidate) => (
      candidate.id === actionId && candidate.kind === 'user_action'
    ));
    if (!action) throw Object.assign(new Error('connection action is no longer available'), { status: 409 });
    const alreadyWaiting = await capabilityCoordinator.hasActiveConnection(id);
    const performed = alreadyWaiting ? {
      performed: false, joinedExisting: true,
      userSafeSummary: sessionId
        ? '이미 같은 연결을 준비하고 있어요. 준비되면 이 대화의 부탁도 이어갈게요.'
        : '이미 같은 연결을 준비하고 있어요.',
    } : await service.performAction(actionId);
    return {
      ...performed,
      connection: { id: service.id, label: service.label },
      checkEndpoint: `/connections/${service.id}/check`,
      cancelEndpoint: `/connections/${service.id}/cancel`,
    };
  }
  queueMicrotask(async () => {
    try {
      for (const binding of await messengerState.listBindings()) {
        await sessions.setOrigin(binding.sessionId, {
          channel: binding.provider, chatId: binding.chatId,
        });
      }
      await messenger.start();
    } catch (error) {
      if (error?.message !== 'messenger_not_connected') onError?.(error);
    }
  });

  function broadcastEvent(type, payload) {
    for (const response of wakeSubscribers) {
      response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }

  function broadcastWake(payload) { broadcastEvent('managed_process_wake', payload); }

  capabilityCoordinator = makeCapabilityHandoffCoordinator({
    ledger: capabilityHandoffs, sessions, runLedger, authority, connectionServices,
    pollIntervalMs: connectionPollIntervalMs, pollTimeoutMs: connectionPollTimeoutMs,
    isSessionRunning: (sessionId) => running.has(sessionId),
    executeResume: async ({ handoff, claimId }) => {
      try {
        const completed = await executeTurn(handoff.sessionId, [
          'capability preparation completed',
          `connectionId: ${handoff.connectionId}`,
          `connectionState: ${handoff.connectionState}`,
          'Continue the unfinished user goal from this conversation now.',
          'Inspect current connection truth before acting and use only capabilities that are actually ready.',
          'Treat every effect and authority boundary as current; never replay an old approval or tool call.',
          'Do not ask the user to repeat the original request.',
        ].join('\n'), () => {}, {
          trigger: 'connection_ready',
          metadata: {
            handoffId: handoff.handoffId, connectionId: handoff.connectionId,
            connectionState: handoff.connectionState, connectionResumeClaimId: claimId,
          },
          inputEntry: { role: 'system_event', event: {
            kind: 'connection_ready', handoffId: handoff.handoffId,
            connectionId: handoff.connectionId, connectionState: handoff.connectionState,
          } },
        });
        return {
          kind: completed.kind, runId: completed.runId,
          reply: completed.surfaceResult?.reply ?? completed.result?.answer ?? null,
        };
      } catch (error) {
        if (error && typeof error === 'object') error.runId = error.surfaceResult?.runId ?? null;
        throw error;
      }
    },
    emitWake: (payload) => broadcastEvent('connection_wake', payload),
    onError: (error) => onError?.(error),
  });
  queueMicrotask(() => capabilityCoordinator.recover().catch((error) => onError?.(error)));

  async function attemptProcessWake(event) {
    if (running.has(event.ownerId)) {
      pendingProcessWakes.set(event.processId, event);
      return;
    }
    const process = processes.claimTerminalWake(event.processId);
    if (!process) return;
    const effectAfter = process.metadata?.declaredEffect
      ? await observeDeclaredEffect(process.metadata.declaredEffect, process.metadata.effectCwd)
      : null;
    const effectObservation = effectAfter ? compareEffectObservations(
      process.metadata.declaredEffect, process.metadata.effectBefore, effectAfter,
    ) : null;
    const wakeText = [
      'managed process terminal event',
      `processId: ${process.processId}`,
      `state: ${process.state}`,
      `processExitCode: ${process.exitCode}`,
      `stdout:\n${process.stdout}`,
      `stderr:\n${process.stderr}`,
      `effectObservation:\n${JSON.stringify(effectObservation)}`,
      'Tell the user naturally that the managed work completed or failed. Use only this observed event.',
    ].join('\n');
    const completed = await executeTurn(event.ownerId, wakeText, () => {}, {
      trigger: 'managed_process_terminal',
      metadata: {
        processId: process.processId,
        originRunId: process.metadata?.originRunId ?? null,
        terminalState: process.state,
      },
      inputEntry: {
        role: 'system_event',
        event: {
          kind: 'managed_process_terminal', processId: process.processId,
          state: process.state, processExitCode: process.exitCode,
          stdout: process.stdout, stderr: process.stderr,
          cursor: process.cursor, originRunId: process.metadata?.originRunId ?? null,
          effectObservation,
        },
      },
    });
    if (completed.kind === 'reply') broadcastWake({
      sessionId: event.ownerId,
      runId: completed.runId,
      processId: process.processId,
      state: process.state,
      reply: completed.result.answer,
    });
  }

  const unsubscribeTerminal = processes.onTerminal((event) => {
    attemptProcessWake(event).catch((error) => onError?.(error));
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const source = await readFile(resolve(uiRoot, 'index.html'), 'utf8');
        const withRuntime = source.replace(
          '</head>',
          `<meta name="t5-runtime-instance" content="${runtimeInstanceId}">\n</head>`,
        );
        const html = withRuntime.replace('</body>', [
          '<script type="module" src="/path-links.js"></script>',
          '<script type="module" src="/wake-events.js"></script>',
          '</body>',
        ].join('\n'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/path-links.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(resolve(here, 'path-links.js'), 'utf8'));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/wake-events.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(resolve(here, 'wake-events.js'), 'utf8'));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/about/manifesto') {
        json(res, 200, {
          kind: 'founder_manifesto', title: '도구와 목적', affectsRuntime: false,
          markdown: await readFile(founderManifestoPath, 'utf8'),
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/attachments') {
        const sessionId = url.searchParams.get('sessionId');
        const session = await sessions.load(sessionId);
        if (!session) { json(res, 404, { error: '세션을 찾지 못했어요.' }); return; }
        const originalName = url.searchParams.get('filename') ?? req.headers['x-file-name'];
        if (!String(originalName ?? '').trim()) { json(res, 400, { error: '파일 이름이 필요해요.' }); return; }
        const record = await attachments.receiveStream({
          sessionId,
          originalName,
          declaredMime: req.headers['content-type'] ?? null,
          stream: req,
        });
        json(res, 201, attachmentSurface(record)); return;
      }
      if (req.method === 'GET' && url.pathname === '/attachments') {
        const sessionId = url.searchParams.get('sessionId');
        const session = await sessions.load(sessionId);
        if (!session) { json(res, 404, { error: '세션을 찾지 못했어요.' }); return; }
        json(res, 200, {
          attachments: (await attachments.list({ sessionId })).map(attachmentSurface),
        }); return;
      }
      const attachmentDiscardMatch = req.method === 'POST' && url.pathname.match(
        /^\/attachments\/([0-9a-f-]{36})\/discard$/i,
      );
      if (attachmentDiscardMatch) {
        const input = await body(req);
        json(res, 200, await attachments.discard({
          sessionId: input.sessionId, attachmentId: attachmentDiscardMatch[1],
        })); return;
      }
      const attachmentContentMatch = req.method === 'GET' && url.pathname.match(
        /^\/attachments\/([0-9a-f-]{36})\/content$/i,
      );
      if (attachmentContentMatch) {
        const sessionId = url.searchParams.get('sessionId');
        const { record, bytes } = await attachments.readContent({
          sessionId, attachmentId: attachmentContentMatch[1],
        });
        const inline = url.searchParams.get('inline') === '1'
          && (record.kind === 'image' || record.kind === 'pdf');
        const fallback = record.originalName.replace(/[^A-Za-z0-9._-]/g, '_') || 'attachment';
        res.writeHead(200, {
          'content-type': record.mimeType,
          'content-length': String(bytes.length),
          'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, max-age=300',
        });
        res.end(bytes); return;
      }
      const browserArtifactMatch = req.method === 'GET' && url.pathname.match(
        /^\/browser-artifacts\/(t5-[0-9a-f]{20})\/(browser-[0-9a-f-]{36}\.png)$/,
      );
      if (browserArtifactMatch) {
        const path = join(browserArtifactRoot, browserArtifactMatch[1], 'artifacts', browserArtifactMatch[2]);
        let bytes;
        try { bytes = await readFile(path); }
        catch (error) {
          if (error?.code === 'ENOENT') { json(res, 404, { error: '브라우저 미리보기를 찾지 못했어요.' }); return; }
          throw error;
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' });
        res.end(bytes); return;
      }
      if (req.method === 'GET' && url.pathname === '/markdown.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(resolve(uiRoot, 'markdown.js'), 'utf8'));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/approval-state.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(resolve(uiRoot, 'approval-state.js'), 'utf8'));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        const connection = await status();
        json(res, 200, {
          ok: true, product: 'gpao-t5-refoundation', runtimeInstanceId,
          model: connection, workspace, computer: computerFacts,
        }); return;
      }
      if (req.method === 'GET' && url.pathname === '/events/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache', connection: 'keep-alive',
        });
        res.write(`event: runtime_ready\ndata: ${JSON.stringify({ runtimeInstanceId })}\n\n`);
        wakeSubscribers.add(res);
        req.once('close', () => wakeSubscribers.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/computer/reveal') {
        if (req.headers['x-t5-console-action'] !== 'reveal') {
          json(res, 403, { error: 'console action header is required' }); return;
        }
        const input = await body(req);
        const opened = await reveal(input.path);
        json(res, 200, { ok: true, ...opened }); return;
      }
      if (req.method === 'POST' && url.pathname === '/browser/login/reveal') {
        const input = await body(req);
        const session = await sessions.load(input.sessionId);
        if (!session) { json(res, 404, { error: '대화를 찾지 못했어요.' }); return; }
        const driver = await browserDriver(input.sessionId);
        if (!driver?.revealUserLogin) {
          json(res, 503, { error: '로그인 창을 다시 보여줄 수 없어요.' }); return;
        }
        const revealed = await driver.revealUserLogin();
        json(res, revealed.visible ? 200 : 409, revealed.visible
          ? { ok: true, ...revealed }
          : { ok: false, ...revealed, error: '현재 열려 있는 로그인 창을 찾지 못했어요.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/browser/identity') {
        json(res, 200, browserHost ? {
          available: true, profile: browserHost.profile,
          userSafeSummary: 'T5 브라우저는 로그인 상태를 여러 대화와 재시작 뒤에도 이어서 사용해요.',
        } : {
          available: false, profile: null,
          userSafeSummary: '지속되는 T5 브라우저를 사용할 수 없어요.',
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/browser/identity/reset') {
        if (!browserHost?.reset) {
          json(res, 503, { error: 'T5 브라우저 로그인을 초기화할 수 없어요.' }); return;
        }
        const input = await body(req);
        if (input.confirmation !== 'RESET_T5_BROWSER') {
          json(res, 400, { error: '로그인 정보를 모두 지울지 다시 확인해 주세요.' }); return;
        }
        await closeBrowserDrivers();
        await browserHost.reset({ confirmation: input.confirmation });
        json(res, 200, { ok: true, userSafeSummary: 'T5 브라우저의 로그인 정보를 모두 지웠어요.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/model/connection') {
        const connection = await status();
        json(res, 200, { ...connection, keyMasked: connection.connected ? '연결됨' : null }); return;
      }
      if (req.method === 'GET' && url.pathname === '/model/connections') {
        const connection = await status();
        json(res, 200, {
          connections: (connection.connections ?? []).map((item) => ({
            ...item,
            label: item.kind === 'chatgpt_oauth' ? 'ChatGPT 계정'
              : item.provider === 'openai' ? 'OpenAI'
                : item.provider === 'anthropic' ? 'Claude'
                  : item.provider === 'gemini' ? 'Gemini'
                    : item.provider === 'upstage' ? 'Upstage' : item.provider,
            keyMasked: item.kind === 'api_key' ? 'API 키 저장됨' : null,
            unofficial: item.kind === 'chatgpt_oauth',
          })),
          activeId: connection.activeId ?? null, roleBindings: {},
        }); return;
      }
      if (req.method === 'GET' && url.pathname === '/model/providers') {
        if (!modelConnections) { json(res, 503, { error: '모델 연결 설정을 준비하지 못했어요.' }); return; }
        json(res, 200, modelConnections.providers()); return;
      }
      if (req.method === 'POST' && url.pathname === '/model/connect') {
        if (!modelConnections) { json(res, 503, { error: '모델 연결 설정을 준비하지 못했어요.' }); return; }
        const input = await body(req);
        const connected = await modelConnections.connect(input);
        onboardingSkipped = false;
        json(res, 200, {
          ...connected,
          report: { userSafeSummary: `${connected.provider} 모델을 연결했어요.` },
        }); return;
      }
      if (req.method === 'POST' && url.pathname === '/model/connections/activate') {
        const input = await body(req);
        json(res, 200, await modelConnections.activate(input.id)); return;
      }
      if (req.method === 'POST' && url.pathname === '/model/connections/remove') {
        const input = await body(req);
        json(res, 200, await modelConnections.remove(input.id)); return;
      }
      if (req.method === 'POST' && url.pathname === '/model/disconnect') {
        const input = await body(req);
        json(res, 200, await modelConnections.disconnect(input.id)); return;
      }
      if (req.method === 'POST' && url.pathname === '/model/chatgpt/login') {
        json(res, 200, await modelConnections.startChatGpt()); return;
      }
      if (req.method === 'POST' && url.pathname === '/model/chatgpt/await') {
        json(res, 200, await modelConnections.awaitChatGpt()); return;
      }
      if (req.method === 'GET' && url.pathname === '/onboarding') {
        const connection = await status();
        json(res, 200, {
          needed: !connection.connected && !onboardingSkipped,
          seenWelcome: true, canConnect: Boolean(modelConnections),
        }); return;
      }
      if (req.method === 'POST' && url.pathname === '/onboarding/skip') {
        onboardingSkipped = true;
        json(res, 200, { skipped: true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/welcome') {
        json(res, 200, { state: 'skipped' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/sessions') {
        const listed = await sessions.list({
          archived: url.searchParams.get('archived') === '1',
          deleted: url.searchParams.get('deleted') === '1',
        });
        json(res, 200, { sessions: listed.map((session) => ({
          ...session, activity: sessionActivities.get(session.id),
        })) }); return;
      }
      if (req.method === 'GET' && url.pathname === '/runs') {
        const runs = await runLedger.list({ sessionId: url.searchParams.get('sessionId') ?? undefined });
        json(res, 200, { runs: runs.map((run) => ({
          runId: run.runId, sessionId: run.sessionId, request: run.request,
          status: run.status, startedAt: run.startedAt, endedAt: run.endedAt,
          eventCount: run.events.length,
        })) }); return;
      }
      const speedMatch = req.method === 'GET' && url.pathname.match(/^\/runs\/([^/]+)\/speed$/);
      if (speedMatch) {
        const run = await runLedger.read(decodeURIComponent(speedMatch[1]));
        json(res, 200, deriveRunSpeedReceipt(run)); return;
      }
      const contextMatch = req.method === 'GET' && url.pathname.match(/^\/runs\/([^/]+)\/context$/);
      if (contextMatch) {
        const run = await runLedger.read(decodeURIComponent(contextMatch[1]));
        json(res, 200, deriveRunContextReport(run)); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/runs/')) {
        json(res, 200, await runLedger.read(decodeURIComponent(url.pathname.slice('/runs/'.length)))); return;
      }
      if (req.method === 'POST' && url.pathname === '/sessions') {
        const session = await sessions.create();
        json(res, 200, { id: session.id, title: session.title }); return;
      }
      if (req.method === 'POST' && url.pathname === '/sessions/recover') {
        const input = await body(req);
        json(res, 200, await recoverSession({
          sessionId: input.sessionId, mode: input.mode, recoveryId: input.recoveryId ?? null,
        })); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/sessions/')) {
        const session = await sessions.load(decodeURIComponent(url.pathname.slice('/sessions/'.length)));
        if (!session) { json(res, 404, { error: '세션을 찾지 못했어요.' }); return; }
        json(res, 200, {
          id: session.id, title: session.title, origin: session.origin ?? null,
          continuationOf: session.continuationOf ?? null,
          transcript: session.transcript,
          activity: sessionActivities.get(session.id),
          activePendingIds: (await authority.listActive(session.id)).map((item) => item.pendingId),
          activeRecoveryIds: activeSessionRecoveryIds(session),
          activeConnectionHandoffIds: activeSessionConnectionHandoffIds(session),
        }); return;
      }
      if (req.method === 'POST' && url.pathname === '/sessions/meta') {
        const input = await body(req);
        const session = await sessions.updateMeta(input.sessionId, input);
        json(res, session ? 200 : 404, session ? { ok: true, ...session } : { error: '세션을 찾지 못했어요.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/sessions/archive') {
        const input = await body(req);
        const session = await sessions.setArchived(input.sessionId, input.archived !== false);
        json(res, session ? 200 : 404, session ? {
          ok: true, id: session.id, archived: Boolean(session.archivedAt),
          userSafeSummary: session.archivedAt ? '목록에서 숨겼어요.' : '목록으로 되돌렸어요.',
        } : { error: '세션을 찾지 못했어요.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/sessions/delete') {
        const input = await body(req);
        const session = await sessions.softDelete(input.sessionId);
        json(res, session ? 200 : 404, session ? {
          ok: true, id: session.id, nextSessionId: (await sessions.list())[0]?.id ?? null,
          userSafeSummary: '대화를 휴지통으로 옮겼어요.',
        } : { error: '세션을 찾지 못했어요.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/sessions/restore') {
        const input = await body(req);
        const session = await sessions.restore(input.sessionId);
        json(res, session ? 200 : 404, session ? { ok: true, id: session.id } : { error: '세션을 찾지 못했어요.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/turn/cancel') {
        const input = await body(req);
        running.get(input.sessionId)?.abort();
        await processes.stopOwner(input.sessionId, 'user_cancelled');
        json(res, 200, { ok: true }); return;
      }
      if (req.method === 'POST' && url.pathname === '/turn/stream-start') {
        const input = await body(req);
        if (!input.sessionId || !String(input.text ?? '').trim()) {
          json(res, 400, { error: '세션과 발화가 필요해요.' }); return;
        }
        const streamId = randomUUID();
        const measurementId = randomUUID();
        pendingStreams.set(streamId, {
          sessionId: input.sessionId, text: input.text,
          attachmentIds: Array.isArray(input.attachmentIds) ? input.attachmentIds.map(String) : [],
          measurementId, expiresAt: Date.now() + 30_000,
        });
        json(res, 200, { streamId, measurementId }); return;
      }
      if (req.method === 'GET' && url.pathname === '/turn/stream') {
        const streamId = url.searchParams.get('streamId');
        const pending = pendingStreams.get(streamId);
        pendingStreams.delete(streamId);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive',
        });
        const emit = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
        if (!pending || pending.expiresAt < Date.now()) {
          emit('recoverable_error', { text: '요청이 만료됐어요.' }); emit('complete', { kind: 'error' }); res.end(); return;
        }
        try {
          emit('trace_status', { text: '요청을 시작했어요' });
          const completed = await executeTurn(pending.sessionId, pending.text, emit, {
            measurementId: pending.measurementId, attachmentIds: pending.attachmentIds,
          });
          if (completed.kind === 'cancelled') emit('recoverable_error', { text: '멈췄어요.' });
          else emit('answer_delta', { text: completed.result.answer });
          emit('complete', { kind: completed.kind });
        } catch (error) {
          onError?.(error);
          const failure = error?.surfaceResult ?? {
            kind: 'error', ...userSafeTurnFailure(
              error, await Promise.resolve().then(() => status()).catch(() => null),
            ),
          };
          emit('recoverable_error', {
            text: failure.reply ?? failure.text,
            nextSafeAction: failure.nextSafeAction,
          });
          emit('complete', { kind: 'error' });
        }
        res.end(); return;
      }
      if (req.method === 'POST' && url.pathname === '/turn') {
        const input = await body(req);
        if (input.approve || input.reject) {
          const pendingId = input.approve ?? input.reject;
          const proposal = await authority.read(pendingId);
          if (proposal.sessionId !== input.sessionId) {
            json(res, 404, { error: '승인 요청을 찾지 못했어요.' }); return;
          }
          if (input.reject) {
            await authority.reject(pendingId);
            const completed = await executeTurn(input.sessionId, [
              'authority rejection event', `pendingId: ${pendingId}`,
              'The user rejected this effect. Do not execute it. Respond naturally and briefly.',
            ].join('\n'), () => {}, {
              trigger: 'authority_rejected', metadata: { pendingId },
              inputEntry: { role: 'system_event', event: { kind: 'authority_rejected', pendingId } },
            });
            json(res, 200, completed.surfaceResult); return;
          }
          await authority.approve(pendingId);
          const approvedArgs = structuredClone(proposal.args);
          approvedArgs.effect.approvalToken = pendingId;
          const completed = await executeTurn(input.sessionId, [
            'authority approval event', `pendingId: ${pendingId}`,
            'The user approved exactly the following tool call once.',
            JSON.stringify({ toolName: proposal.toolName, args: approvedArgs }),
            'Reissue that exact tool call once, then inspect its receipt and answer naturally.',
          ].join('\n'), () => {}, {
            trigger: 'authority_approved', metadata: { pendingId },
            inputEntry: { role: 'system_event', event: { kind: 'authority_approved', pendingId } },
          });
          json(res, 200, completed.surfaceResult); return;
        }
        const completed = await executeTurn(input.sessionId, input.text, () => {}, {
          attachmentIds: Array.isArray(input.attachmentIds) ? input.attachmentIds.map(String) : [],
        });
        json(res, 200, completed.surfaceResult ?? { kind: completed.kind }); return;
      }

      // Existing UI panels outside the refoundation slice receive honest empty projections.
      if (req.method === 'GET' && url.pathname === '/toolbox') {
        json(res, 200, { tools: [
          { id: 'exec', label: '터미널', executable: true },
          ...(typeof browserDriverFactory === 'function'
            ? [{ id: 'browser', label: '브라우저', executable: true }] : []),
        ] }); return;
      }
      if (req.method === 'GET' && url.pathname === '/channels/providers') {
        json(res, 200, { providers: [{
          id: 'telegram', label: '텔레그램', tokenPlaceholder: 'BotFather에서 받은 봇 토큰',
          fields: [], inboundMode: 'long_polling',
        }] }); return;
      }
      if (req.method === 'GET' && url.pathname === '/channels') {
        const messengerStatus = await messenger.status();
        const telegram = messengerStatus.connections.telegram;
        json(res, 200, { channels: [{
          id: 'telegram', provider: 'telegram', label: '텔레그램',
          connected: Boolean(telegram?.connected),
          userSafe: telegram?.connected
            ? `연결됨${telegram.bot?.username ? ` (@${telegram.bot.username})` : ''} · 메시지 받는 중`
            : '연결되지 않음',
          bot: telegram?.bot ?? null,
        }] }); return;
      }
      if (req.method === 'POST' && url.pathname === '/channels/connect') {
        const input = await body(req);
        await messenger.stop();
        const connected = await messenger.connect({ provider: input.provider, token: input.token });
        await messenger.start({ provider: input.provider });
        json(res, 200, { ...connected, userSafeSummary: '텔레그램 봇을 연결했어요.' }); return;
      }
      if (req.method === 'POST' && url.pathname === '/channels/disconnect') {
        const input = await body(req);
        const disconnected = await messenger.disconnect(input.provider);
        json(res, 200, { ...disconnected, userSafeSummary: '메신저 연결을 해제했어요.' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/channels/allowlist') {
        const provider = url.searchParams.get('channel') ?? 'telegram';
        json(res, 200, {
          channel: provider,
          allowed: await messengerState.listAllowed(provider),
          pending: await messengerState.listPending(provider),
        }); return;
      }
      if (req.method === 'POST' && url.pathname === '/channels/allowlist') {
        const input = await body(req);
        const provider = input.channel ?? 'telegram';
        if (input.revoke != null) {
          const allowed = await messengerState.revoke(provider, input.revoke);
          json(res, 200, { allowed, userSafeSummary: '이 사람의 메시지 허용을 해제했어요.' }); return;
        }
        const allowed = await messengerState.allow(provider, input);
        json(res, 200, { allowed, userSafeSummary: '이 사람의 메시지를 받기 시작했어요.' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/skills') { json(res, 200, { skills: [] }); return; }
      if (req.method === 'GET' && url.pathname === '/automation') { json(res, 200, { jobs: [], candidates: [] }); return; }
      if (req.method === 'GET' && url.pathname === '/overview') { json(res, 200, {}); return; }
      if (req.method === 'GET' && url.pathname === '/memory/state') {
        await memories.ensure();
        const memory = await memories.read();
        json(res, 200, { items: memory.items }); return;
      }
      if (req.method === 'GET' && url.pathname === '/memory/ledger') {
        await memories.ensure();
        const memory = await memories.read();
        json(res, 200, { entries: memory.events }); return;
      }
      const workspaceConnectionAction = req.method === 'POST' && url.pathname.match(
        /^\/connections\/([a-z0-9-]+)\/(start|await|action|check|cancel|disconnect)$/u,
      );
      if (workspaceConnectionAction) {
        const [, id, action] = workspaceConnectionAction;
        const service = connectionServices.get(id);
        if (!service) { json(res, 404, { error: '연결 대상을 찾지 못했어요.' }); return; }
        if (action === 'start') {
          if (typeof service.start !== 'function') { json(res, 409, { error: '이 연결은 지금 시작할 수 없어요.' }); return; }
          json(res, 200, await service.start()); return;
        }
        if (action === 'await') {
          if (typeof service.awaitConnection !== 'function') { json(res, 409, { error: '진행 중인 연결이 없어요.' }); return; }
          const input = await body(req);
          let session = null;
          if (input.sessionId != null || input.handoffId != null) {
            session = await sessions.load(input.sessionId);
            if (!session || !activeSessionConnectionHandoffIds(session).includes(String(input.handoffId ?? ''))) {
              json(res, 409, { error: '이미 끝났거나 다른 대화의 연결 요청이에요.' }); return;
            }
          }
          const connected = await service.awaitConnection();
          if (session) {
            const completion = await capabilityCoordinator.verifyAndComplete({
              handoffId: String(input.handoffId), sessionId: session.id, connectionId: id,
            });
            if (!completion?.completed) {
              throw Object.assign(new Error('연결 완료 상태를 다시 확인하지 못했어요.'), { status: 409 });
            }
          }
          json(res, 200, connected); return;
        }
        if (action === 'action') {
          const input = await body(req);
          json(res, 200, await performConnectionAction(id, String(input.actionId ?? ''))); return;
        }
        if (action === 'check') {
          const input = await body(req);
          const session = await sessions.load(input.sessionId);
          if (!session || !activeSessionConnectionHandoffIds(session).includes(String(input.handoffId ?? ''))) {
            json(res, 409, { error: '이미 끝났거나 다른 대화의 준비 요청이에요.' }); return;
          }
          const completion = await capabilityCoordinator.verifyAndComplete({
            handoffId: String(input.handoffId), sessionId: session.id, connectionId: id,
          });
          if (!completion) {
            json(res, 409, { error: '준비 요청의 연결 상태를 확인하지 못했어요.' }); return;
          }
          json(res, 200, {
            completed: completion.completed, state: completion.truth?.state,
            userSafeSummary: completion.truth?.userSafeSummary,
          }); return;
        }
        if (action === 'cancel') {
          const input = await body(req);
          let session = null;
          if (input.sessionId != null || input.handoffId != null) {
            session = await sessions.load(input.sessionId);
            if (!session || !activeSessionConnectionHandoffIds(session).includes(String(input.handoffId ?? ''))) {
              json(res, 409, { error: '이미 끝났거나 다른 대화의 연결 요청이에요.' }); return;
            }
          }
          const cancelled = session
            ? await capabilityCoordinator.cancel({ handoffId: String(input.handoffId) })
            : typeof service.cancelPending === 'function'
              ? await service.cancelPending()
              : { cancelled: false, userSafeSummary: '취소할 연결 준비가 없어요.' };
          json(res, cancelled.cancelled ? 200 : 409, cancelled); return;
        }
        if (typeof service.disconnect !== 'function') { json(res, 409, { error: '이 연결은 해제할 수 없어요.' }); return; }
        json(res, 200, await service.disconnect()); return;
      }
      if (req.method === 'GET' && url.pathname === '/connections/doctor') {
        json(res, 200, await connectionDoctor.inspect()); return;
      }
      if (req.method === 'GET' && url.pathname === '/connectors/truth') {
        const report = await connectionDoctor.inspect();
        json(res, 200, { ...report, connectors: report.connections, invalidDeclared: [] }); return;
      }
      if (req.method === 'POST' && url.pathname === '/turn/metrics/visible') {
        const input = await body(req);
        json(res, 200, { ok: await recordSurfaceMetric(input) }); return;
      }

      json(res, 404, { error: '이 재창립 단계에서는 아직 제공하지 않아요.' });
    } catch (error) {
      onError?.(error);
      json(res, httpErrorStatus(error), { error: error?.message ?? '처리 중 문제가 있었어요.' });
    }
  });
  server.managedProcesses = processes;
  server.conversationLedger = conversations;
  server.memoryLedger = memories;
  server.capabilityHandoffLedger = capabilityHandoffs;
  server.attachmentStore = attachments;
  server.messengerGateway = messenger;
  server.messengerStateStore = messengerState;
  server.messengerCredentialStore = messengerCredentials;
  server.runLedger = runLedger;
  server.authorityStore = authority;
  server.managedCliStore = managedCliStorePromise;
  server.runtimeInstanceId = runtimeInstanceId;
  server.unsubscribeTerminalWake = unsubscribeTerminal;
  server.closeWakeStreams = () => {
    unsubscribeTerminal();
    for (const response of wakeSubscribers) response.end();
    wakeSubscribers.clear();
  };
  server.closeModelConnections = () => modelConnections?.close?.();
  server.closeMessengers = () => messenger.stop();
  server.closeBrowsers = closeBrowserDrivers;
  server.closeWorkspaceConnections = async () => {
    await capabilityCoordinator.close();
    await Promise.all([...connectionServices.values()].map(async (service) => {
      await service.close?.();
    }));
  };
  return server;
}
