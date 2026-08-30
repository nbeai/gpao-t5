import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryLedger } from '../src/memory-ledger.js';
import { ForgettingCoordinator } from '../src/forgetting-coordinator.js';
import { makeRecordReference } from '../src/record-reference.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';
import {
  makeMemoryClaimTool, makeMemoryTool, memoryContextMessage, MEMORY_FLUSH_SYSTEM_INSTRUCTIONS,
} from '../src/memory-tool.js';

test('memory 도구 하나로 자연어 대화가 add·list·replace·remove 현재값을 다룬다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-tool-'));
  try {
    const ledger = new MemoryLedger(room);
    await ledger.ensure();
    const tool = makeMemoryTool({
      ledger, source: { origin: 'explicit', sessionId: 'session-1', runId: 'run-1' },
    });
    const added = await tool.execute({
      action: 'add', memoryId: null, kind: 'user', content: '사용자는 한국어 답변을 선호한다.',
    });
    assert.equal(added.state, 'added');
    const recalled = await tool.execute({ action: 'read', memoryIds: [added.item.memoryId] });
    assert.equal(recalled.items[0].content, '사용자는 한국어 답변을 선호한다.');
    const listed = await tool.execute({ action: 'list', memoryId: null, kind: null, content: null });
    assert.equal(listed.items.length, 1);
    await tool.execute({
      action: 'replace', memoryId: added.item.memoryId, kind: 'user',
      content: '사용자는 간결한 한국어 답변을 선호한다.',
    });
    const context = memoryContextMessage((await ledger.read()).items);
    assert.match(context.content, /PERSISTENT MEMORY/);
    assert.match(context.content, /간결한 한국어/);
    assert.match(context.content, /current request/i);
    await tool.execute({
      action: 'remove', memoryId: added.item.memoryId, kind: null, content: null,
    });
    assert.equal((await ledger.read()).items.length, 0);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('temporal memory read는 모든 source를 reopen한 뒤에만 claim content를 반환한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-source-read-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    const reference = makeRecordReference({
      sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: 'message-1',
      sourceRevision: 1, sha256: createHash('sha256').update('source').digest('hex'),
      occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
      scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
      trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
    });
    await ledger.commitClaim({ claim: makeMemoryClaim({
      memoryId: 'memory-claim', kind: 'preference', subjectKey: 'subject-coffee', value: 'light roast',
      scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
      sources: [reference], recordedAt: '2026-08-26T00:01:00.000Z',
      validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
      subjectRevision: 1, sourceOrder: 2, status: 'active', supersedes: [], conflictsWith: [],
      sensitivity: 'personal', alwaysRelevant: false,
    }) });
    const unavailable = makeMemoryTool({ ledger, sourceReader: {
      reopen: async () => ({ state: 'changed', source: null,
        accounting: { availability: 'changed', recordId: reference.recordId } }),
    } });
    const denied = await unavailable.execute({ action: 'read', memoryIds: ['memory-claim'] });
    assert.equal(denied.state, 'source_unavailable');
    assert.doesNotMatch(JSON.stringify(denied), /light roast/u);

    const available = makeMemoryTool({ ledger, sourceReader: {
      reopen: async () => ({ state: 'reopened', source: { exact: true },
        accounting: { availability: 'available', recordId: reference.recordId } }),
    } });
    const recalled = await available.execute({ action: 'read', memoryIds: ['memory-claim'] });
    assert.equal(recalled.state, 'read');
    assert.equal(recalled.claims[0].value, 'light roast');
    assert.equal(recalled.source.availability, 'available');
    assert.deepEqual(recalled.source.recordIds, [reference.recordId]);
    assert.equal('exact' in recalled.source, false);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('memory_claim 도구는 model meaning만 받고 runtime reality로 commit·correct·retract한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-claim-tool-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    const reference = makeRecordReference({
      sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: 'message-claim',
      sourceRevision: 1, sha256: createHash('sha256').update('claim-source').digest('hex'),
      occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
      scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
      trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
    });
    let phase = 0;
    const coordinator = new ForgettingCoordinator({
      memoryLedger: ledger, makeId: () => 'forget-tool',
      now: () => '2026-08-26T00:04:00.000Z',
      exactRecallProbe: async ({ plan }) => {
        const state = await ledger.read();
        return plan.targets.filter((target) => target.kind === 'memory'
          && state.claims.some((item) => item.memoryId === target.id && item.status === 'active')).length;
      },
      contextProjectionProbe: async ({ plan }) => {
        const state = await ledger.read();
        return plan.targets.filter((target) => state.items.some((item) => item.memoryId === target.id)).length;
      },
    });
    const tool = makeMemoryClaimTool({ ledger, runtimeReality: async (meaning) => {
      phase += 1;
      const state = await ledger.read(); const current = state.claims.find((item) => item.status === 'active');
      return {
        memoryId: `memory-${phase}`, sources: [reference],
        recordedAt: `2026-08-26T00:0${phase}:00.000Z`,
        currentSessionId: 'session-1', currentWorkId: null, currentChannel: 'console',
        verifiedSubjects: current ? { [meaning.subjectHandle]: {
          subjectKey: current.subjectKey, personId: current.scope.personId,
        } } : {},
        defaultSubjectKey: current?.subjectKey ?? 'subject-runtime-1',
        subjectRevision: current ? current.subjectRevision + 1 : 1,
        sourceOrder: state.events.length + 1,
        targetMemoryId: current?.memoryId ?? null,
        conflictingMemoryIds: [], normalPolicyQualified: false,
        channelSensitivity: 'personal', alwaysRelevantQualified: false,
      };
    }, forgettingRuntime: async (candidate) => {
      const forgetPlan = await coordinator.preview({
        memoryIds: [candidate.targetMemoryId], subjectKeys: [], scopeIds: [],
      });
      return coordinator.execute({ plan: forgetPlan, recordRefs: candidate.sources });
    } });
    assert.deepEqual(Object.keys(tool.parameters.properties).sort(), [
      'action', 'kind', 'scopeMeaning', 'subjectHandle', 'validTimeMeaning', 'value',
    ]);
    const meaning = {
      action: 'remember', kind: 'preference', value: 'filter coffee', subjectHandle: null,
      validTimeMeaning: { from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z', certainty: 'explicit' },
      scopeMeaning: 'global',
    };
    const remembered = await tool.execute(meaning);
    assert.equal(remembered.state, 'committed');
    assert.equal((await ledger.read()).claims[0].value, 'filter coffee');
    const corrected = await tool.execute({ ...meaning, action: 'correct', value: 'light roast',
      subjectHandle: 'subject-runtime-1' });
    assert.equal(corrected.state, 'committed');
    assert.deepEqual((await ledger.read()).claims.map((item) => item.status), ['superseded', 'active']);
    const retracted = await tool.execute({ ...meaning, action: 'retract', value: 'remove coffee preference',
      subjectHandle: 'subject-runtime-1' });
    assert.equal(retracted.state, 'retracted');
    assert.equal(retracted.forgetReceipt.searchHitAfter, 0);
    assert.equal(retracted.forgetReceipt.contextProjectionAfter, 0);
    assert.equal(retracted.forgetReceipt.behaviorProbeAfter, 'unknown');
    assert.equal((await ledger.read()).claims.at(-1).status, 'retracted');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('memory_claim 설명은 검증 handle 없는 일반 기준을 global로 두고 거부 상태를 성공으로 말하지 않는다', async () => {
  const tool = makeMemoryClaimTool({ ledger: {}, runtimeReality: async () => ({}) });
  assert.match(tool.description, /Use global for a general user fact/u);
  assert.match(tool.description, /organization scopes require that exact subjectHandle/u);
  assert.match(tool.description, /needs_verified_subject[\s\S]*do not claim it was stored/u);
});

test('foreground memory는 read·list만 열고 legacy add·replace·remove 우회를 막는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-read-only-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    const tool = makeMemoryTool({ ledger, readOnly: true });
    assert.deepEqual(tool.parameters.properties.action.enum, ['read', 'list']);
    for (const action of ['add', 'replace', 'remove']) {
      await assert.rejects(tool.execute({ action, memoryId: null, kind: 'user', content: 'bypass' }),
        /read-only/u);
    }
    assert.equal((await ledger.read()).events.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('memory_claim time 의미가 해석 불가하면 retry 가능한 ISO 형식을 돌려준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-time-retry-'));
  try {
    const ledger = new MemoryLedger(room); await ledger.ensure();
    const tool = makeMemoryClaimTool({ ledger, runtimeReality: async () => ({
      memoryId: 'memory-time', sources: [], recordedAt: '2026-08-26T00:00:00.000Z',
      verifiedSubjects: {}, defaultSubjectKey: 'subject-time', subjectRevision: 1,
      sourceOrder: 2, targetMemoryId: null, conflictingMemoryIds: [],
      normalPolicyQualified: false, channelSensitivity: 'personal', alwaysRelevantQualified: false,
    }) });
    const result = await tool.execute({
      action: 'remember', kind: 'fact', value: 'safe fixture', subjectHandle: null,
      validTimeMeaning: { from: '내년쯤', to: null, certainty: 'explicit' }, scopeMeaning: 'global',
    });
    assert.equal(result.state, 'needs_valid_time');
    assert.equal(result.retryable, true);
    assert.match(result.expectedFormat, /YYYY-MM-DD/u);
    assert.equal((await ledger.read()).events.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('memory 환경은 현재 상태와 과거 이력을 구분해 취소된 work 기억을 모델이 정리하게 한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-current-state-'));
  try {
    const ledger = new MemoryLedger(room);
    await ledger.ensure();
    const added = await ledger.add({
      kind: 'work', content: '매일 오후 4시 스트레칭 알림이 활성화되어 있다.',
      source: { origin: 'explicit', sessionId: 'session-1', runId: 'run-1' },
    });
    const tool = makeMemoryTool({ ledger });
    const context = memoryContextMessage((await ledger.read()).items);

    assert.match(tool.description, /completed or cancelled/i);
    assert.match(tool.description, /conversation history|session search/i);
    assert.match(context.content, /current durable state/i);
    assert.match(context.content, /cancelled or no longer current/i);
    assert.match(MEMORY_FLUSH_SYSTEM_INSTRUCTIONS, /completed or cancelled/i);

    await tool.execute({
      action: 'remove', memoryId: added.memoryId, kind: null, content: null,
    });
    assert.equal((await ledger.read()).items.length, 0);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
