import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { activeConversationProjection } from '../../src/conversation-checkpoint.js';
import { ConversationLedger } from '../../src/conversation-ledger.js';
import { projectHistoricalConversationEntries } from '../../src/conversation-projection.js';
import { consoleInstructions } from '../../src/console-model-factory.js';
import { makeContextReceipt } from '../../src/context-receipt.js';
import {
  historicalInformation, projectConversationEntriesForCurrentPurpose,
} from '../../src/information-context.js';
import { MemoryLedger } from '../../src/memory-ledger.js';
import { memoryContextMessage } from '../../src/memory-tool.js';
import { selectMemoryPortfolio } from '../../src/memory-portfolio.js';
import { WorkStore } from '../../src/work-store.js';

import { makeS3aPerformanceObserver } from './s3a-performance-observer.js';

const CONVERSATION_SCHEMA = 't5.conversation-event.v1';
const WORK_SCHEMA = 't5.work-event.v1';
const MEMORY_SCHEMA = 't5.memory-event.v1';
const RECORDED_AT = '2026-08-26T00:00:00.000Z';
export const CURRENT_REQUEST = 'PROJECT-S6의 최신 마감일과 UNKNOWN-COST-771 상태, 다음 행동을 알려줘.';
export const ORACLE_MARKERS = [
  'PROJECT-S6', 'DEADLINE-2026-09-30', 'UNKNOWN-COST-771', 'LATEST-CORRECTION-S6',
];

const ids = {
  short_session: '11111111-1111-4111-8111-111111111111',
  long_session: '22222222-2222-4222-8222-222222222222',
};

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function messageContent(index, count) {
  if (index === count) {
    return 'LATEST-CORRECTION-S6: PROJECT-S6 마감일은 DEADLINE-2026-09-30이며 UNKNOWN-COST-771은 아직 확인되지 않았다.';
  }
  const filler = `history-${String(index).padStart(4, '0')}-` + 'x'.repeat(480);
  if (index % 2 === 1) return `사용자 기록 ${filler}`;
  return `도우미 기록 ${filler}`;
}

function conversationEvents(sessionId, sessionClass) {
  const count = sessionClass === 'long_session' ? 1000 : 8;
  const events = [{
    schema: CONVERSATION_SCHEMA, sessionId, sequence: 1, recordedAt: RECORDED_AT,
    type: 'conversation_started', payload: { importedLegacyMessages: 0 },
  }];
  for (let index = 1; index <= count; index += 1) {
    events.push({
      schema: CONVERSATION_SCHEMA, sessionId, sequence: events.length + 1,
      recordedAt: RECORDED_AT, type: 'message', messageId: `m-${String(index).padStart(4, '0')}`,
      runId: null, turn: index,
      message: { role: index % 2 === 1 ? 'user' : 'assistant', content: messageContent(index, count) },
    });
  }
  if (sessionClass === 'long_session') {
    events.push({
      schema: CONVERSATION_SCHEMA, sessionId, sequence: events.length + 1,
      recordedAt: RECORDED_AT, type: 'checkpoint', checkpointId: 'checkpoint-s6-0950',
      coversThroughMessageId: 'm-0950',
      summary: [
        'CURRENT OBJECT/OUTPUT: PROJECT-S6 현재 상태와 다음 행동.',
        'ACCEPTED DECISIONS/BOUNDARIES: 마감일 DEADLINE-2026-09-30.',
        'OPEN WORK: UNKNOWN-COST-771은 아직 확인되지 않음.',
        'LATEST CORRECTION: LATEST-CORRECTION-S6.',
      ].join('\n'),
      sourceMessageCount: 950, sourceBytes: 600000, tailMessageCount: 50,
    });
  }
  return events;
}

export async function createS6Fixture(root, sessionClass) {
  if (!ids[sessionClass]) throw new TypeError('invalid S6 session class');
  const sessionId = ids[sessionClass];
  for (const directory of ['conversation', 'work', 'memory']) {
    await mkdir(join(root, directory), { recursive: true, mode: 0o700 });
    await chmod(join(root, directory), 0o700);
  }
  const conversation = conversationEvents(sessionId, sessionClass);
  const work = [{
    schema: WORK_SCHEMA, sequence: 1, recordedAt: RECORDED_AT, type: 'work_created',
    workId: '33333333-3333-4333-8333-333333333333', sessionId, sourceMessageId: 'm-0001',
  }];
  const memory = [
    { schema: MEMORY_SCHEMA, sequence: 1, recordedAt: RECORDED_AT, type: 'memory_started' },
    {
      schema: MEMORY_SCHEMA, sequence: 2, recordedAt: RECORDED_AT, type: 'memory_added',
      memoryId: '44444444-4444-4444-8444-444444444444', kind: 'user',
      content: '사용자는 상태를 짧게 보고받는 것을 선호한다.', subjects: ['report-format'],
      alwaysRelevant: true, subjectRevision: 1, sourceOrder: 2,
      source: { sessionId, messageId: 'm-0001' },
    },
  ];
  const files = {
    conversation: join(root, 'conversation', `${sessionId}.jsonl`),
    work: join(root, 'work', 'events.jsonl'),
    memory: join(root, 'memory', 'memory.jsonl'),
  };
  await writeFile(files.conversation, `${conversation.map(JSON.stringify).join('\n')}\n`, { mode: 0o600 });
  await writeFile(files.work, `${work.map(JSON.stringify).join('\n')}\n`, { mode: 0o600 });
  await writeFile(files.memory, `${memory.map(JSON.stringify).join('\n')}\n`, { mode: 0o600 });
  return {
    root, sessionClass, sessionId, messageCount: sessionClass === 'long_session' ? 1000 : 8,
    checkpointCount: sessionClass === 'long_session' ? 1 : 0, files,
  };
}

function stores(fixture) {
  return {
    conversations: new ConversationLedger(join(fixture.root, 'conversation')),
    works: new WorkStore(join(fixture.root, 'work')),
    memories: new MemoryLedger(join(fixture.root, 'memory')),
  };
}

async function readState(fixture, opened) {
  const [conversation, workState, memoryState] = await Promise.all([
    opened.conversations.read(fixture.sessionId), opened.works.read(), opened.memories.read(),
  ]);
  const currentWork = workState.works.find((work) => (
    work.sessionId === fixture.sessionId && work.status === 'active'
  )) ?? null;
  return { conversation, workState, memoryState, currentWork };
}

function compileContext(fixture, state) {
  const active = activeConversationProjection(state.conversation);
  const relevance = projectConversationEntriesForCurrentPurpose(active.tailEntries, {
    sessionId: fixture.sessionId,
  });
  const historical = projectHistoricalConversationEntries(relevance.entries, {
    largeOutputMode: 'recoverable', preserveBrowserInteractionState: false,
  });
  const selectedMemory = selectMemoryPortfolio({
    items: state.memoryState.items, currentWork: state.currentWork,
  });
  const memoryMessage = memoryContextMessage(selectedMemory);
  const history = active.checkpoint
    ? [structuredClone(active.messages[0]), ...historical.messages] : historical.messages;
  const messages = memoryMessage ? [memoryMessage, ...history] : history;
  const sourceMessages = [...messages, { role: 'user', content: CURRENT_REQUEST }];
  const tools = [{
    name: 'observe_project', description: 'Observe the current isolated project state.',
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  }];
  const instructions = consoleInstructions('/isolated/workspace', {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: 'zsh',
  });
  const input = sourceMessages.map((message) => ({ role: message.role, content: message.content }));
  const body = { model: 'gpt-5.5', instructions, input, tools };
  const receipt = makeContextReceipt({
    provider: 's3a_fixture', model: 'gpt-5.5', instructions, input, tools,
    sourceMessages, body,
  });
  const encoded = JSON.stringify(body);
  return {
    bodyDigest: digest(body), requestBytes: receipt.requestBytes,
    inputItems: receipt.input.items, inputBytes: receipt.input.bytes,
    sourceMessages: receipt.source.messages,
    checkpointPresent: Boolean(active.checkpoint), tailEntries: active.tailEntries.length,
    omittedAssistantToolMessages: relevance.omittedMessages,
    historicalInformation: historicalInformation({
      sessionId: fixture.sessionId, conversationMessages: messages,
      memoryItems: selectedMemory, memoryMessage, checkpoint: active.checkpoint, relevance,
    }),
    oracle: Object.fromEntries(ORACLE_MARKERS.map((marker) => [marker, encoded.includes(marker)])),
  };
}

async function runUnmeasured(fixture, opened) {
  const state = await readState(fixture, opened);
  return compileContext(fixture, state);
}

export async function measureS6Fixture(fixture, {
  resident = false, observerMode = 'O2_full_shadow', nowNs,
} = {}) {
  const opened = stores(fixture);
  if (resident) await runUnmeasured(fixture, opened);
  const observer = makeS3aPerformanceObserver({ mode: observerMode, nowNs, maxSpans: 8 });
  let state;
  let context;
  await observer.measure('state_read_replay', async () => {
    state = await readState(fixture, opened);
  }, { itemCount: state?.conversation?.events?.length ?? null });
  await observer.measure('context_compilation', async () => {
    context = compileContext(fixture, state);
  }, { bytesOut: context?.requestBytes ?? null, itemCount: context?.inputItems ?? null });
  const spans = observer.snapshot().spans;
  return {
    condition: resident ? 'warm_resident' : 'cold_process',
    sessionClass: fixture.sessionClass,
    context,
    stateFacts: {
      conversationEvents: state.conversation.events.length,
      conversationMessages: state.conversation.entries.length,
      workEvents: state.workState.events.length,
      memoryEvents: state.memoryState.events.length,
    },
    phases: Object.fromEntries(spans.map((span) => [span.phase, {
      durationNs: span.durationNs == null ? null : Number(span.durationNs),
      status: span.status,
    }])),
    diagnostics: observer.snapshot().diagnostics,
  };
}
