import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WorkEventLedger } from '../src/kernel/l0-evidence/work-event-ledger.js';
import { projectWorkState, workStateFacts } from '../src/kernel/l1-intent/work-state.js';

const SCOPE = Object.freeze({ principalRef: 'principal-owner', projectRef: 'project-main' });
const OTHER_SCOPE = Object.freeze({ principalRef: 'principal-owner', projectRef: 'project-other' });

function ledger() {
  return new WorkEventLedger({ sensitiveGuard: () => false });
}

function appendAgreement(target, {
  eventId,
  type = 'agreement_set',
  statement,
  subjectRef = 'subject-scope',
  scopeRef = SCOPE,
  targetEventId,
  turnSeq = target.records.length + 1,
  workRef = 'work-main',
} = {}) {
  return target.append({
    eventId,
    type,
    workRef,
    subjectRef,
    scopeRef,
    evidence: {
      turnRef: { sessionId: 'session-main', turnSeq },
      statement,
      ...(targetEventId ? { targetEventId } : {}),
    },
  });
}

function appendQuestion(target, {
  eventId,
  type = 'question_opened',
  subjectRef = 'subject-question',
  scopeRef = SCOPE,
  targetEventId,
  turnSeq = target.records.length + 1,
} = {}) {
  return target.append({
    eventId,
    type,
    workRef: 'work-main',
    subjectRef,
    scopeRef,
    evidence: type === 'question_opened'
      ? {
        turnRef: { sessionId: 'session-main', turnSeq },
        question: '최종 납품 형식은 무엇인가요?',
        changesAnswerFor: '최종 산출물 형식',
      }
      : {
        targetEventId,
        turnRef: { sessionId: 'session-main', turnSeq },
      },
  });
}

test('principalRef와 scopeRef가 정확히 같은 사건만 투영한다', () => {
  const l = ledger();
  appendAgreement(l, { eventId: 'main', statement: '메인 프로젝트 합의' });
  appendAgreement(l, { eventId: 'other-project', statement: '다른 프로젝트 합의', scopeRef: OTHER_SCOPE });
  appendAgreement(l, {
    eventId: 'other-principal',
    statement: '다른 사용자 합의',
    scopeRef: { principalRef: 'principal-other', projectRef: 'project-main' },
  });
  appendAgreement(l, {
    eventId: 'narrower-workspace',
    statement: '더 좁은 작업공간 합의',
    scopeRef: { ...SCOPE, workspaceRef: 'workspace-1' },
  });

  const state = projectWorkState(l.records, SCOPE);
  assert.deepEqual(state.activeAgreements.map((item) => item.label), ['메인 프로젝트 합의']);
  assert.deepEqual(projectWorkState(l.records, {}).activeAgreements, [], 'principal 없는 조회는 기본 거부');
  assert.deepEqual(projectWorkState(l.records, { ...SCOPE, projectRef: 'project-missing' }).activeAgreements, []);
});

test('교차 scope의 대체 사건은 현재 scope 합의를 지우거나 새 합의를 들이지 못한다', () => {
  const l = ledger();
  const original = appendAgreement(l, { eventId: 'original', statement: '검증된 원래 합의' });
  appendAgreement(l, {
    eventId: 'cross-scope-replacement',
    type: 'agreement_superseded',
    statement: '다른 프로젝트가 끼워 넣은 합의',
    scopeRef: OTHER_SCOPE,
    targetEventId: original.eventId,
  });

  assert.deepEqual(
    projectWorkState(l.records, SCOPE).activeAgreements.map((item) => item.label),
    ['검증된 원래 합의'],
  );
  assert.deepEqual(projectWorkState(l.records, OTHER_SCOPE).activeAgreements, [],
    '현재 scope에 대상 사건이 없으면 대체 사건도 활성화하지 않는다');
});

test('대체와 철회는 현재 합의만 바꾸며 철회된 옛 합의를 부활시키지 않는다', () => {
  const l = ledger();
  const old = appendAgreement(l, { eventId: 'old', statement: '초안 합의' });
  const current = appendAgreement(l, {
    eventId: 'current',
    type: 'agreement_superseded',
    statement: '확정 합의',
    targetEventId: old.eventId,
  });
  appendAgreement(l, {
    eventId: 'retracted',
    type: 'agreement_retracted',
    statement: '확정 합의를 철회함',
    targetEventId: current.eventId,
  });
  appendAgreement(l, { eventId: 'still-active', statement: '별도 유지 합의', subjectRef: 'subject-other' });

  const state = projectWorkState(l.records, SCOPE);
  assert.deepEqual(state.activeAgreements.map((item) => item.label), ['별도 유지 합의']);
  assert.doesNotMatch(workStateFacts(state) ?? '', /초안 합의|확정 합의/);
});

test('미정 질문과 해소 질문을 분리하고 해소 뒤 다시 열지 않는다', () => {
  const l = ledger();
  const opened = appendQuestion(l, { eventId: 'question-open' });
  appendQuestion(l, { eventId: 'question-resolved', type: 'question_resolved', targetEventId: opened.eventId });

  const state = projectWorkState(l.records, SCOPE);
  assert.equal(state.openQuestions.length, 0);
  assert.equal(state.resolvedQuestions.length, 1);
  assert.equal(state.resolvedQuestions[0].question, '최종 납품 형식은 무엇인가요?');
  assert.match(workStateFacts(state) ?? '', /해소된 질문/);
  assert.doesNotMatch(workStateFacts(state) ?? '', /미정 질문/);
});

test('실행 완료와 대화 산출물 전달은 서로 다른 상태와 사실로 남는다', () => {
  const l = ledger();
  l.append({
    eventId: 'execution', type: 'execution_completed', workRef: 'work-main',
    subjectRef: 'subject-file', scopeRef: SCOPE,
    evidence: {
      completionContractRef: 'cr1.internal.signature',
      receiptRef: 'rr1.internal.signature',
      verificationPassed: true,
    },
  });
  l.append({
    eventId: 'chat', type: 'chat_delivered', workRef: 'work-main',
    subjectRef: 'subject-chat', scopeRef: SCOPE,
    evidence: {
      resultContractRef: 'result-internal',
      turnRef: { sessionId: 'session-main', turnSeq: 2 },
      contentDigest: 'a'.repeat(64),
      persisted: true,
    },
  });

  const state = projectWorkState(l.records, SCOPE);
  assert.equal(state.completedExecutions.length, 1);
  assert.equal(state.deliveredChats.length, 1);
  assert.equal(state.executionCompleted, true);
  assert.equal(state.chatDelivered, true);
  const facts = workStateFacts(state) ?? '';
  assert.match(facts, /검증된 실행 완료: 1건/);
  assert.match(facts, /전달된 대화 산출물: 1건/);
});

test('모델용 사실에는 내부 ref·digest·절대경로를 노출하지 않는다', () => {
  const l = ledger();
  appendAgreement(l, {
    eventId: 'secret-shaped',
    statement: `결과는 /Users/jyp/Downloads/private.txt에 두고 wr1.payload.signature와 ${'b'.repeat(64)}를 확인한다`,
  });

  const facts = workStateFacts(projectWorkState(l.records, SCOPE)) ?? '';
  assert.match(facts, /결과는/);
  assert.doesNotMatch(facts, /\/Users\/jyp|private\.txt|wr1\.|\bb{64}\b/);
  assert.doesNotMatch(facts, /eventId|workRef|subjectRef|scopeRef|digest/i);
});

test('maxChars 안에서 현재 활성 합의와 미정 질문을 과거 사실보다 먼저 보존한다', () => {
  const state = {
    activeAgreements: [{ label: '지금 반드시 지켜야 할 합의', ordinal: 100 }],
    openQuestions: [{ question: '지금 답해야 할 질문은 무엇인가요?', changesAnswerFor: '현재 결과', ordinal: 99 }],
    resolvedQuestions: Array.from({ length: 30 }, (_, i) => ({
      question: `이미 끝난 오래된 질문 ${i} ${'과거'.repeat(20)}`,
      ordinal: i + 1,
    })),
    completedExecutions: Array.from({ length: 20 }, (_, i) => ({ ordinal: i + 1 })),
    deliveredChats: Array.from({ length: 20 }, (_, i) => ({ ordinal: i + 1 })),
  };

  const facts = workStateFacts(state, { maxChars: 180 });
  assert.ok(facts.length <= 180);
  assert.match(facts, /지금 반드시 지켜야 할 합의/);
  assert.match(facts, /지금 답해야 할 질문/);
  assert.doesNotMatch(facts, /이미 끝난 오래된 질문 29/);
});

test('투영은 입력을 바꾸지 않고 같은 입력에 항상 같은 결과를 낸다', () => {
  const l = ledger();
  appendAgreement(l, { eventId: 'stable', statement: '결정적 합의' });
  const records = l.records;
  const before = structuredClone(records);

  const first = projectWorkState(records, { principalRef: SCOPE.principalRef, scopeRef: SCOPE });
  const second = projectWorkState(records, { principalRef: SCOPE.principalRef, scopeRef: SCOPE });
  assert.deepEqual(first, second);
  assert.deepEqual(records, before);
});

test('비어 있는 상태는 모델 사실 블록을 만들지 않는다', () => {
  assert.equal(workStateFacts(projectWorkState([], SCOPE)), undefined);
  assert.equal(workStateFacts(null), undefined);
});
