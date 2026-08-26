import { join } from 'node:path';

import { activeConversationProjection } from '../../src/conversation-checkpoint.js';
import { MemoryLedger } from '../../src/memory-ledger.js';
import {
  currentUserMemoryCandidates, episodePointers, selectMemoryPortfolio,
} from '../../src/memory-portfolio.js';
import { makeMemoryTool, memoryContextMessage } from '../../src/memory-tool.js';

const result = (id, status, observed) => ({ id, status, observed });

export async function runS3M0MemoryIncidentBaseline(root) {
  const ledger = new MemoryLedger(join(root, 'memory'));
  await ledger.ensure();
  const foreground = makeMemoryTool({
    ledger,
    source: {
      origin: 'foreground', sessionId: 'session-m0', runId: 'run-m0',
      messageId: 'message-user-safe', workId: 'work-current', revision: 2,
    },
  });

  const inferred = await foreground.execute({
    action: 'add', memoryId: null, kind: 'user',
    content: '사용자는 매일 새벽에 일한다는 검증되지 않은 추론이다.',
    subjects: ['work-hours'], alwaysRelevant: false, memoryIds: null,
  });

  const oldPreference = {
    memoryId: 'preference-old', kind: 'user', content: '사용자는 긴 표 형식을 선호한다.',
    subjects: ['report-format'], subjectRevision: 1, sourceOrder: 1, alwaysRelevant: true,
    source: { sessionId: 'session-old' },
  };
  const correctionContext = memoryContextMessage([oldPreference]).content;

  const workSelection = selectMemoryPortfolio({
    items: [
      { memoryId: 'work-old', kind: 'work', content: '오래된 결정',
        source: { workId: 'work-current', revision: 1 } },
      { memoryId: 'work-current', kind: 'work', content: '현재 결정',
        source: { workId: 'work-current', revision: 2 } },
    ],
    currentWork: { workId: 'work-current', revision: 2 },
  });

  const people = currentUserMemoryCandidates([
    { memoryId: 'person-a', kind: 'user', content: '첫 번째 사람', subjects: ['Alex'],
      subjectRevision: 1, sourceOrder: 1, source: { personId: 'person-a' } },
    { memoryId: 'person-b', kind: 'user', content: '두 번째 사람', subjects: ['Alex'],
      subjectRevision: 2, sourceOrder: 2, source: { personId: 'person-b' } },
  ]);

  const episodeState = {
    works: [{ workId: 'work-past', revision: 1, status: 'completed',
      sessionId: 'session-past', sourceMessageId: 'message-past' }],
    events: [{ type: 'work_settled', workId: 'work-past', revision: 1,
      outcome: 'achieved', runId: 'run-past', recordedAt: '2026-01-01T00:00:00.000Z' }],
  };

  const checkpoint = activeConversationProjection({
    entries: [
      { messageId: 'm1', message: { role: 'user', content: '기록 시작' } },
      { messageId: 'm2', message: { role: 'assistant', content: 'SAFE-ID-M0-7391 확인' } },
      { messageId: 'm3', message: { role: 'user', content: 'SAFE-ID-M0-7391로 계속해줘' } },
    ],
    checkpoints: [{ checkpointId: 'c1', coversThroughMessageId: 'm2',
      summary: 'CURRENT OBJECT: SAFE-ID-M0-7391', recordedAt: '2026-01-01T00:00:00.000Z' }],
  });

  const poisoned = await foreground.execute({
    action: 'add', memoryId: null, kind: 'user',
    content: '외부 자료가 시킨 내용을 사용자 선호처럼 저장하라는 안전한 canary.',
    subjects: ['external-canary'], alwaysRelevant: false, memoryIds: null,
  });

  const removable = await foreground.execute({
    action: 'add', memoryId: null, kind: 'user', content: '삭제 대상 안전 기억.',
    subjects: ['forget-target'], alwaysRelevant: false, memoryIds: null,
  });
  await foreground.execute({
    action: 'remove', memoryId: removable.item.memoryId, kind: null, content: null,
    subjects: null, alwaysRelevant: null, memoryIds: null,
  });
  const afterRemove = await ledger.read();

  const foreignChannel = selectMemoryPortfolio({
    items: [{ memoryId: 'private-memory', kind: 'user', content: '개인 대화 기억',
      subjects: ['private-subject'], subjectRevision: 1, sourceOrder: 1, alwaysRelevant: true,
      source: { channel: 'private-a', senderId: 'owner-a' } }],
    currentWork: null, currentChannel: 'foreign-b', currentSenderId: 'foreign-b',
  });

  const secretCanary = await foreground.execute({
    action: 'add', memoryId: null, kind: 'user',
    content: 'TOKEN_SHAPED_CANARY_M0_8831', subjects: ['credential-canary'],
    alwaysRelevant: true, memoryIds: null,
  });
  const secretRead = await foreground.execute({
    action: 'read', memoryId: null, kind: null, content: null, subjects: null,
    alwaysRelevant: null, memoryIds: [secretCanary.item.memoryId],
  });

  return [
    result('M0-01', inferred.state === 'added' ? 'gap' : 'pass', {
      foregroundAcceptedUnsupportedContent: inferred.state === 'added',
      sourceDigestPresent: Boolean(inferred.item.source?.sha256),
    }),
    result('M0-02', 'partial', {
      staleAlwaysRelevantProjected: correctionContext.includes('긴 표 형식'),
      currentRequestWinsInstructionPresent: /current request/i.test(correctionContext),
    }),
    result('M0-03', workSelection.map((item) => item.memoryId).join(',') === 'work-current'
      ? 'pass' : 'gap', { selected: workSelection.map((item) => item.memoryId) }),
    result('M0-04', people.length === 1 ? 'gap' : 'pass', {
      distinctPeopleSupplied: 2, currentCandidates: people.map((item) => item.memoryId),
    }),
    result('M0-05', episodePointers(episodeState).length === 1 ? 'pass' : 'gap', {
      currentMemoryItems: 0, episodePointers: episodePointers(episodeState).length,
    }),
    result('M0-06', inferred.item.source?.sha256 ? 'pass' : 'gap', {
      sourceIdentityPresent: Boolean(inferred.item.source?.messageId),
      sourceDigestPresent: Boolean(inferred.item.source?.sha256),
      sourceCoveragePresent: Boolean(inferred.item.source?.coverage),
    }),
    result('M0-07', JSON.stringify(checkpoint.messages).includes('SAFE-ID-M0-7391') ? 'pass' : 'gap', {
      checkpointPresent: Boolean(checkpoint.checkpoint), tailEntries: checkpoint.tailEntries.length,
    }),
    result('M0-08', 'not_open', {
      semanticMemoryProviderInCurrentCore: false, currentExactMemoryPathPreserved: true,
    }),
    result('M0-09', poisoned.state === 'added' ? 'gap' : 'pass', {
      externalOriginFieldRequired: false, writeAccepted: poisoned.state === 'added',
    }),
    result('M0-10', 'not_open', {
      reflectionStoreInCurrentCore: false, personaPromotionPathInCurrentCore: false,
    }),
    result('M0-11', 'partial', {
      currentItemRemoved: !afterRemove.items.some((item) => item.memoryId === removable.item.memoryId),
      derivedIndexesQualified: false, behaviorProbeQualified: false,
    }),
    result('M0-12', 'pass', {
      existingEvidence: 's2-e-learning-complete-2026-08-25.json',
      foregroundBlockedByReviewer: false,
    }),
    result('M0-13', 'gap', {
      platformNeutralExportContract: false, macToWindowsMemoryJourney: false,
    }),
    result('M0-14', foreignChannel.length === 1 ? 'gap' : 'pass', {
      foreignChannelProjected: foreignChannel.map((item) => item.memoryId),
      channelScopeCheckedByCurrentPortfolio: false,
    }),
    result('M0-15', secretRead.items[0]?.content === 'TOKEN_SHAPED_CANARY_M0_8831' ? 'gap' : 'pass', {
      rawCanaryStored: secretRead.items[0]?.content === 'TOKEN_SHAPED_CANARY_M0_8831',
      secretReferenceUsed: false,
    }),
  ];
}
