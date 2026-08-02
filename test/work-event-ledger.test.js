import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORK_EVENT_TYPES,
  WorkEventLedger,
  projectWorkEvents,
} from '../src/kernel/l0-evidence/work-event-ledger.js';

const turn = (turnSeq) => ({ sessionId: 'session-a', turnSeq });
const safeGuard = (value) => /password|비밀번호|sk-proj-/i.test(String(value));
const scopeRef = { principalRef: 'principal-owner', projectRef: 'project-1' };

function ledger(options = {}) {
  return new WorkEventLedger({ sensitiveGuard: safeGuard, ...options });
}

function agreement(overrides = {}) {
  return {
    eventId: 'event-agreement-1',
    type: 'agreement_set',
    workRef: 'work-1',
    subjectRef: 'subject-1',
    scopeRef,
    evidence: {
      turnRef: turn(1),
      statement: '보고서는 표로 만든다',
    },
    ...overrides,
  };
}

test('정본에 없는 사건 유형과 알 수 없는 필드는 거부한다', () => {
  assert.deepEqual(WORK_EVENT_TYPES, [
    'agreement_set',
    'agreement_superseded',
    'agreement_retracted',
    'question_opened',
    'question_resolved',
    'execution_completed',
    'chat_delivered',
  ]);
  assert.throws(() => ledger().append({ ...agreement(), type: 'model_says_done' }), /사건 유형/);
  assert.throws(() => ledger().append({ ...agreement(), rawPrompt: '숨은 원문' }), /허용되지 않은 필드/);
});

test('원문 사건은 주입된 민감정보 경계를 반드시 통과해야 한다', () => {
  assert.throws(
    () => new WorkEventLedger().append(agreement()),
    /sensitiveGuard|민감정보 경계/,
    '원문을 저장하면서 검사기를 생략할 수 없다',
  );
  assert.throws(() => ledger().append(agreement({
    evidence: { turnRef: turn(1), statement: '비밀번호 huntertwo' },
  })), /민감/);
  assert.throws(() => ledger().append(agreement({
    workRef: 'sk-proj-1234567890secret',
  })), /민감/, 'ref 칸으로 위장한 비밀값도 durable 원장에 들어가면 안 된다');
  assert.doesNotThrow(() => ledger().append(agreement()));
});

test('같은 eventId의 같은 사건은 멱등이고 다른 사건은 충돌한다', () => {
  const store = ledger();
  const first = store.append(agreement());
  const again = store.append(agreement());
  assert.deepEqual(again, first);
  assert.equal(store.records.length, 1);
  assert.throws(() => store.append(agreement({
    evidence: { turnRef: turn(1), statement: '보고서는 목록으로 만든다' },
  })), /eventId.*충돌/);
});

test('호출자가 반환 기록이나 records 사본을 바꿔도 append-only 원장은 변하지 않는다', () => {
  const store = ledger();
  const returned = store.append(agreement());
  returned.evidence.statement = '호출자가 바꾼 값';
  const exposed = store.records;
  exposed[0].evidence.statement = '배열 사본에서 바꾼 값';
  exposed.push({ eventId: 'forged' });

  assert.equal(store.records.length, 1);
  assert.equal(store.records[0].evidence.statement, '보고서는 표로 만든다');
  assert.equal(store.project().bySubject['subject-1'].status, 'active');
});

test('합의의 대체와 철회는 실제 활성 대상 사건을 정확히 지목한다', () => {
  const store = ledger();
  store.append(agreement());
  store.append({
    eventId: 'event-agreement-2',
    type: 'agreement_superseded',
    workRef: 'work-1',
    subjectRef: 'subject-1',
    scopeRef,
    evidence: {
      turnRef: turn(2),
      statement: '보고서는 목록으로 만든다',
      targetEventId: 'event-agreement-1',
    },
  });

  let state = store.project();
  assert.equal(state.byEvent['event-agreement-1'].status, 'superseded');
  assert.equal(state.bySubject['subject-1'].status, 'active');
  assert.equal(state.bySubject['subject-1'].eventId, 'event-agreement-2');

  assert.throws(() => store.append({
    eventId: 'bad-retract',
    type: 'agreement_retracted',
    workRef: 'work-1',
    subjectRef: 'subject-other',
    scopeRef,
    evidence: { turnRef: turn(3), statement: '철회한다', targetEventId: 'event-agreement-2' },
  }), /subjectRef|대상/);

  store.append({
    eventId: 'event-retract-1',
    type: 'agreement_retracted',
    workRef: 'work-1',
    subjectRef: 'subject-1',
    scopeRef,
    evidence: { turnRef: turn(3), statement: '목록 합의를 철회한다', targetEventId: 'event-agreement-2' },
  });
  state = store.project();
  assert.equal(state.byEvent['event-agreement-2'].status, 'retracted');
  assert.equal(state.bySubject['subject-1'].status, 'retracted');
});

test('열린 질문은 근거가 결합된 해소 사건만 resolved로 바뀐다', () => {
  const store = ledger();
  store.append({
    eventId: 'question-1',
    type: 'question_opened',
    workRef: 'work-1',
    subjectRef: 'subject-question-1',
    scopeRef,
    evidence: {
      turnRef: turn(4),
      question: '결과를 표와 목록 중 어떤 형식으로 만들까요?',
      changesAnswerFor: 'completion-contract-1',
    },
  });
  assert.equal(store.project().bySubject['subject-question-1'].status, 'open');
  assert.throws(() => store.append({
    eventId: 'question-resolution-bad',
    type: 'question_resolved',
    workRef: 'work-1',
    subjectRef: 'subject-question-1',
    scopeRef,
    evidence: { targetEventId: 'question-1' },
  }), /TurnRef|ReceiptRef|근거/);

  store.append({
    eventId: 'question-resolution-1',
    type: 'question_resolved',
    workRef: 'work-1',
    subjectRef: 'subject-question-1',
    scopeRef,
    evidence: { targetEventId: 'question-1', turnRef: turn(5) },
  });
  assert.equal(store.project().bySubject['subject-question-1'].status, 'resolved');
});

test('실행 완료는 계약과 성공 영수증 검증이 모두 있어야 한다', () => {
  const store = ledger();
  const base = {
    eventId: 'execution-1',
    type: 'execution_completed',
    workRef: 'work-1',
    subjectRef: 'subject-execution-1',
    scopeRef,
    evidence: {
      completionContractRef: 'work-1:contract-digest',
      receiptRef: 'session-a:6:receipt-digest',
      verificationPassed: true,
    },
  };
  assert.throws(() => store.append({
    ...base,
    evidence: { ...base.evidence, verificationPassed: false },
  }), /검증|완료/);
  assert.throws(() => store.append({
    ...base,
    evidence: { receiptRef: base.evidence.receiptRef, verificationPassed: true },
  }), /CompletionContractRef|completionContractRef/);
  store.append(base);
  assert.equal(store.project().bySubject['subject-execution-1'].status, 'completed');
});

test('chat_delivered는 내용 있는 지속 결과일 뿐 프로젝트 전체 완료가 아니다', () => {
  const store = ledger();
  store.append({
    eventId: 'chat-1',
    type: 'chat_delivered',
    workRef: 'work-1',
    subjectRef: 'subject-chat-1',
    scopeRef,
    evidence: {
      resultContractRef: 'chat-contract-1',
      turnRef: turn(7),
      contentDigest: 'sha256:content-1',
      persisted: true,
    },
  });
  const state = store.project();
  assert.equal(state.bySubject['subject-chat-1'].status, 'chat-delivered');
  assert.deepEqual(state.completedWorkRefs, [], '대화 결과 전달만으로 작업 전체 완료가 되면 안 된다');
});

test('투영은 입력 사건 배열을 바꾸지 않고 같은 사건에서 결정적으로 재현된다', () => {
  const store = ledger();
  store.append(agreement());
  const records = structuredClone(store.records);
  assert.deepEqual(projectWorkEvents(records), store.project());
  assert.deepEqual(store.records, records);
});

test('hash chain 변조는 마지막 유효 checkpoint에서 멈추고 read-only degraded가 된다', () => {
  const store = ledger({ checkpointEvery: 2 });
  store.append(agreement());
  store.append({
    eventId: 'question-1',
    type: 'question_opened',
    workRef: 'work-1',
    subjectRef: 'subject-question-1',
    scopeRef,
    evidence: {
      turnRef: turn(2, 'assistant'),
      question: '형식을 정할까요?',
      changesAnswerFor: 'contract-1',
    },
  });
  store.append({
    eventId: 'chat-1',
    type: 'chat_delivered',
    workRef: 'work-1',
    subjectRef: 'subject-chat-1',
    scopeRef,
    evidence: {
      resultContractRef: 'chat-contract-1',
      turnRef: turn(3),
      contentDigest: 'sha256:content-1',
      persisted: true,
    },
  });

  const corrupted = structuredClone(store.records);
  corrupted[2].evidence.contentDigest = 'sha256:tampered';
  const loaded = WorkEventLedger.fromRecords(corrupted, { checkpointEvery: 2, sensitiveGuard: safeGuard });
  assert.equal(loaded.degraded, true);
  assert.equal(loaded.readOnly, true);
  assert.equal(loaded.records.length, 2, 'checkpoint 뒤의 검증되지 않은 꼬리를 읽으면 안 된다');
  assert.equal(loaded.recovery.lastValidCheckpoint, 2);
  assert.equal(loaded.recovery.failedAt, 3);
  assert.throws(() => loaded.append(agreement({ eventId: 'new-event' })), /read-only|읽기 전용/);
});

test('checkpoint 자체 손상도 이전 checkpoint까지만 복구한다', () => {
  const store = ledger({ checkpointEvery: 2 });
  for (let i = 1; i <= 4; i += 1) {
    store.append(agreement({
      eventId: `agreement-${i}`,
      subjectRef: `subject-${i}`,
      evidence: { turnRef: turn(i), statement: `합의 ${i}` },
    }));
  }
  const corrupted = structuredClone(store.records);
  corrupted[3].checkpoint.chainHash = '0'.repeat(64);
  const loaded = WorkEventLedger.fromRecords(corrupted, { checkpointEvery: 2, sensitiveGuard: safeGuard });
  assert.equal(loaded.degraded, true);
  assert.equal(loaded.records.length, 2);
  assert.equal(loaded.recovery.lastValidCheckpoint, 2);
  assert.match(loaded.recovery.reason, /checkpoint/);
});

test('정상 hash chain은 재로드 후에도 쓰기 가능하고 다음 ordinal로 이어진다', () => {
  const original = ledger({ checkpointEvery: 2 });
  original.append(agreement());
  original.append({
    eventId: 'chat-1',
    type: 'chat_delivered',
    workRef: 'work-1',
    subjectRef: 'subject-chat-1',
    scopeRef,
    evidence: {
      resultContractRef: 'chat-contract-1',
      turnRef: turn(2),
      contentDigest: 'sha256:content-1',
      persisted: true,
    },
  });

  const loaded = WorkEventLedger.fromRecords(original.records, {
    checkpointEvery: 2,
    sensitiveGuard: safeGuard,
  });
  assert.equal(loaded.degraded, false);
  assert.equal(loaded.readOnly, false);
  assert.equal(loaded.recovery.lastValidCheckpoint, 2);
  const next = loaded.append(agreement({
    eventId: 'agreement-2',
    subjectRef: 'subject-2',
    evidence: { turnRef: turn(3), statement: '두 번째 합의' },
  }));
  assert.equal(next.ordinal, 3);
  assert.equal(next.previousHash, original.records[1].hash);
});
