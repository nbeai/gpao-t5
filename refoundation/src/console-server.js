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
import { loadSkillSnapshot, makeSkillTool } from './skill-runtime.js';
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

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..');
const legacyUiRoot = resolve(repositoryRoot, 'src', 'surface', 'web');
const bundledSkillsRoot = resolve(repositoryRoot, 'refoundation', 'skills');
const bundledDocumentCli = resolve(repositoryRoot, 'refoundation', 'bin', 't5-document.mjs');

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
  const sessions = new ConsoleSessionStore(stateDir);
  const conversations = new ConversationLedger(join(stateDir, 'conversations'));
  const memories = new MemoryLedger(join(stateDir, 'memory'));
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

  async function browserDriver(sessionId) {
    if (typeof browserDriverFactory !== 'function') return null;
    if (!browserDrivers.has(sessionId)) {
      browserDrivers.set(sessionId, await browserDriverFactory(sessionId));
    }
    return browserDrivers.get(sessionId);
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
      const terminal = makeTerminalHand({
        workingDirectory: workspace, computer, processRegistry: processes, ownerId: sessionId,
        yieldMs: processYieldMs, originRunId: run.runId, effectPreflight,
        env: { T5_DOCUMENT_CLI: documentCli },
      });
      const skillSnapshot = await loadSkillSnapshot({ directory: skillsRoot });
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
      offeredTools.unshift(makeMemoryTool({
        ledger: memories,
        source: { origin: 'foreground', sessionId, runId: run.runId },
      }));
      offeredTools.unshift(makeSessionSearchTool({
        ledger: conversations, sessions, currentSessionId: sessionId,
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
            emit('trace_status', { text: '판단하고 있어요' });
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
          } else if (event.type === 'tool_start') {
            await run.append({
              type: 'tool_started', stepId: `tool-${event.toolCallId || `${event.turn}-${event.name}`}`,
              payload: {
                turn: event.turn, toolCallId: event.toolCallId, name: event.name, args: event.args,
              },
            });
            emit('tool_progress', {
              text: event.name === 'browser' ? '브라우저 화면을 관측하고 있어요'
                : event.name === 'attachment' ? '첨부 파일을 확인하고 있어요'
                : event.name === 'web_search' ? '웹에서 후보를 찾고 있어요'
                : event.name === 'web_read' ? '선택한 페이지를 읽고 있어요'
                : event.name === 'skill' ? '필요한 방법을 확인하고 있어요'
                : event.name === 'conversation_recall' ? '이전 결과를 다시 확인하고 있어요'
                  : event.name === 'memory' ? '기억을 확인하고 있어요'
                    : event.name === 'session_search' ? '이전 대화를 찾고 있어요'
                  : '터미널을 사용하고 있어요',
            });
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
            emit('trace_status', { text: event.name === 'browser' || event.name === 'web_search' || event.name === 'web_read'
              ? '웹 관측 결과를 확인하고 있어요'
              : event.name === 'attachment' ? '첨부 파일 결과를 확인하고 있어요'
                : '터미널 결과를 확인하고 있어요' });
          }
        },
      });
      if (result.status === 'cancelled') {
        await run.finish('cancelled', { modelTurns: result.modelTurns, receiptCount: result.receipts.length });
        runFinished = true;
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
        receipt.requestedCall?.name === 'attachment'
        && receipt.requestedCall?.args?.action === 'register_output'
        && receipt.outcome === 'succeeded'
        && receipt.result?.artifact
      )).map((receipt) => attachmentSurface(receipt.result.artifact));
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
        ...(outputArtifacts.length ? { artifacts: outputArtifacts } : {}),
        ...(options.trigger && options.trigger !== 'user' ? { trigger: options.trigger } : {}),
        selfStateSummary: selfState(connection, workspace, browserReady),
      };
      await sessions.append(sessionId, { role: 'assistant', result: surfaceResult });
      await run.append({ type: 'surface_persisted', payload: { role: 'assistant' } });
      await run.finish('completed', { modelTurns: result.modelTurns, receiptCount: result.receipts.length });
      runFinished = true;
      return { kind: 'reply', surfaceResult, result, runId: run.runId };
    } catch (error) {
      if (!runFinished) {
        await run.finish('failed', { error: error?.message ?? String(error) }).catch(() => {});
        runFinished = true;
      }
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
    onInbound: async (message) => {
      const completed = await executeTurn(message.sessionId, message.text, () => {}, {
        trigger: 'messenger',
        metadata: {
          provider: message.provider, chatId: message.chatId,
          userId: message.userId, username: message.username,
        },
        inputEntry: {
          role: 'user', text: message.text, channel: message.provider,
          channelMeta: { chatId: message.chatId, userId: message.userId, username: message.username },
        },
      });
      return completed.surfaceResult?.reply ?? completed.result?.answer ?? null;
    },
    log: (...values) => onError?.(new Error(values.map(String).join(' '))),
  });
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

  function broadcastWake(payload) {
    for (const response of wakeSubscribers) {
      response.write(`event: managed_process_wake\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  }

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
        const html = source.replace('</body>', [
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
          ok: true, product: 'gpao-t5-refoundation', model: connection, workspace, computer: computerFacts,
        }); return;
      }
      if (req.method === 'GET' && url.pathname === '/events/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache', connection: 'keep-alive',
        });
        res.write(': connected\n\n');
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
                  : item.provider === 'gemini' ? 'Gemini' : item.provider,
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
        json(res, 200, { sessions: await sessions.list({
          archived: url.searchParams.get('archived') === '1',
          deleted: url.searchParams.get('deleted') === '1',
        }) }); return;
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
      if (req.method === 'GET' && url.pathname.startsWith('/sessions/')) {
        const session = await sessions.load(decodeURIComponent(url.pathname.slice('/sessions/'.length)));
        if (!session) { json(res, 404, { error: '세션을 찾지 못했어요.' }); return; }
        json(res, 200, {
          id: session.id, title: session.title, origin: session.origin ?? null,
          transcript: session.transcript,
          activePendingIds: (await authority.listActive(session.id)).map((item) => item.pendingId),
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
          emit('recoverable_error', { text: '모델 또는 터미널 작업을 완료하지 못했어요.' });
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
      if (req.method === 'GET' && url.pathname === '/connectors/truth') { json(res, 200, { connectors: [] }); return; }
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
  server.attachmentStore = attachments;
  server.messengerGateway = messenger;
  server.messengerStateStore = messengerState;
  server.messengerCredentialStore = messengerCredentials;
  server.runLedger = runLedger;
  server.authorityStore = authority;
  server.unsubscribeTerminalWake = unsubscribeTerminal;
  server.closeWakeStreams = () => {
    unsubscribeTerminal();
    for (const response of wakeSubscribers) response.end();
    wakeSubscribers.clear();
  };
  server.closeModelConnections = () => modelConnections?.close?.();
  server.closeMessengers = () => messenger.stop();
  server.closeBrowsers = async () => {
    await Promise.all([...browserDrivers.values()].map(async (driver) => {
      try { await driver.close?.(); } catch { /* already closed */ }
    }));
    browserDrivers.clear();
  };
  return server;
}
