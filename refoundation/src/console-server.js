import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
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

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..');
const legacyUiRoot = resolve(repositoryRoot, 'src', 'surface', 'web');
const bundledSkillsRoot = resolve(repositoryRoot, 'refoundation', 'skills');

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function httpErrorStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
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

function selfState(status, workspace) {
  return {
    model: status?.modelId ?? '연결 필요',
    modelAuthState: status?.connected ? 'usable' : 'needs_connection',
    modelHealthState: status?.connected ? 'usable' : null,
    ready: ['터미널'],
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
  processYieldMs = 1000,
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
      trigger: options.trigger ?? 'user',
      ...(options.metadata ?? {}),
    } });
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
        message: { role: 'user', content: text },
      });
      await sessions.append(sessionId, {
        ...(options.inputEntry ?? { role: 'user', text }), runId: run.runId,
      });
      const model = await modelFactory({ sessionId, workspace, computer: computerFacts });
      const terminal = makeTerminalHand({
        workingDirectory: workspace, computer, processRegistry: processes, ownerId: sessionId,
        yieldMs: processYieldMs, originRunId: run.runId, effectPreflight,
      });
      const skillSnapshot = await loadSkillSnapshot({ directory: skillsRoot });
      const offeredTools = [...terminal.tools];
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
        request: text,
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
              text: event.name === 'skill' ? '필요한 방법을 확인하고 있어요'
                : event.name === 'conversation_recall' ? '이전 결과를 다시 확인하고 있어요'
                  : event.name === 'memory' ? '기억을 확인하고 있어요'
                    : event.name === 'session_search' ? '이전 대화를 찾고 있어요'
                  : '터미널을 사용하고 있어요',
            });
          } else if (event.type === 'tool_end') {
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
            emit('trace_status', { text: '터미널 결과를 확인하고 있어요' });
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
      const surfaceResult = approvalReceipt ? (() => {
        const { effect, pendingId, command } = approvalReceipt.result;
        return {
          kind: 'approval', reply: result.answer, runId: run.runId, pendingId,
          pending: [{
            action: effect.kind, label: effect.summary, tier: 'A3', safetyFloor: true,
            preview: {
              impact: effect.kind, where: effect.targets.join(', '), what: command,
              cancel: effect.reversible ? '되돌릴 수 있다고 선언됨' : '되돌리기 어려움',
            },
            reason: {
              why: effect.kind === 'payment' ? '돈이 나가는 일이에요.'
                : effect.kind === 'external_send' ? '새 상대에게 처음 보내는 일이에요.'
                  : '백업 없는 파괴적 변경이에요.',
              reversible: effect.reversible ? '되돌릴 수 있다고 선언됨' : '되돌리기 어려움',
            },
          }],
          selfStateSummary: selfState(connection, workspace),
        };
      })() : {
        kind: 'reply',
        reply: result.answer,
        runId: run.runId,
        ...(options.trigger && options.trigger !== 'user' ? { trigger: options.trigger } : {}),
        selfStateSummary: selfState(connection, workspace),
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
          connections: connection.connections ?? [], activeId: connection.activeId ?? null, roleBindings: {},
        }); return;
      }
      if (req.method === 'GET' && url.pathname === '/onboarding') {
        json(res, 200, { needed: false, seenWelcome: true, canConnect: true }); return;
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
          id: session.id, title: session.title, transcript: session.transcript,
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
          sessionId: input.sessionId, text: input.text, measurementId, expiresAt: Date.now() + 30_000,
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
            measurementId: pending.measurementId,
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
        const completed = await executeTurn(input.sessionId, input.text);
        json(res, 200, completed.surfaceResult ?? { kind: completed.kind }); return;
      }

      // Existing UI panels outside the refoundation slice receive honest empty projections.
      if (req.method === 'GET' && url.pathname === '/toolbox') {
        json(res, 200, { tools: [{ id: 'exec', label: '터미널', executable: true }] }); return;
      }
      if (req.method === 'GET' && url.pathname === '/channels') { json(res, 200, { channels: [] }); return; }
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
  server.runLedger = runLedger;
  server.authorityStore = authority;
  server.unsubscribeTerminalWake = unsubscribeTerminal;
  server.closeWakeStreams = () => {
    unsubscribeTerminal();
    for (const response of wakeSubscribers) response.end();
    wakeSubscribers.clear();
  };
  return server;
}
