import test from 'node:test';
import assert from 'node:assert/strict';

import {
  recoveryEvidenceForTurn, repeatedNoProgressSignal,
} from '../src/conversation-recovery.js';

function previousExchange({ user, reply, receipts = [] }) {
  return [
    { role: 'user', text: user },
    {
      role: 'assistant',
      result: {
        kind: 'reply', reply,
        recoveryEvidence: recoveryEvidenceForTurn({ userText: user, reply, kind: 'reply', receipts }),
      },
    },
  ];
}

test('서로 다른 연결 요청에 실행 없이 같은 막다른 답이 반복되면 회복권을 연다', () => {
  const reply = '앞선 미완료 작업과 지금 요청이 함께 잡혔어요. 지금 할 일만 한 번 더 말씀해 주세요.';
  const session = { transcript: previousExchange({
    user: '응 연결하려면 내가 뭘 도와줘야 하니', reply,
  }) };
  const evidence = recoveryEvidenceForTurn({
    userText: '연결 시작해', reply, kind: 'reply', receipts: [],
  });
  const signal = repeatedNoProgressSignal({
    session, currentUserText: '연결 시작해', currentResult: { kind: 'reply', reply }, evidence,
  });
  assert.equal(signal?.kind, 'repeated_no_progress');
  assert.equal(signal?.canResetConversation, true);
  assert.equal(signal?.canContinueCleanly, true);
  assert.doesNotMatch(JSON.stringify(signal), /미완료 작업|연결 시작해/u);
});

test('같은 질문에 같은 정상 답을 다시 한 경우와 실제 도구 실행이 있던 경우는 막힘으로 꾸미지 않는다', () => {
  const reply = '서울의 내일 최고기온은 28도예요.';
  const sameQuestion = { transcript: previousExchange({ user: '서울 내일 최고기온은?', reply }) };
  const sameEvidence = recoveryEvidenceForTurn({
    userText: '서울 내일 최고기온은?', reply, kind: 'reply', receipts: [],
  });
  assert.equal(repeatedNoProgressSignal({
    session: sameQuestion, currentUserText: '서울 내일 최고기온은?',
    currentResult: { kind: 'reply', reply }, evidence: sameEvidence,
  }), null);

  const executed = [{
    outcome: 'succeeded', actualCall: { name: 'browser', args: { action: 'snapshot' } },
    result: { state: 'observed' },
  }];
  const priorWithWork = { transcript: previousExchange({ user: '자료 확인해줘', reply, receipts: executed }) };
  const workedEvidence = recoveryEvidenceForTurn({
    userText: '다시 확인해줘', reply, kind: 'reply', receipts: executed,
  });
  assert.equal(repeatedNoProgressSignal({
    session: priorWithWork, currentUserText: '다시 확인해줘',
    currentResult: { kind: 'reply', reply }, evidence: workedEvidence,
  }), null);
});

test('같은 공급자 오류가 실행 진전 없이 반복돼도 모델과 무관한 회복권을 연다', () => {
  const first = recoveryEvidenceForTurn({
    userText: '구글 연결해줘', reply: '연결할 수 없어요.', kind: 'error',
    failureCode: 'connection_unavailable', receipts: [],
  });
  const session = { transcript: [
    { role: 'user', text: '구글 연결해줘' },
    { role: 'assistant', result: {
      kind: 'error', reply: '연결할 수 없어요.', failureCode: 'connection_unavailable',
      recoveryEvidence: first,
    } },
  ] };
  const evidence = recoveryEvidenceForTurn({
    userText: '다시 연결해줘', reply: '연결할 수 없어요.', kind: 'error',
    failureCode: 'connection_unavailable', receipts: [],
  });
  assert.equal(repeatedNoProgressSignal({
    session, currentUserText: '다시 연결해줘',
    currentResult: { kind: 'error', reply: '연결할 수 없어요.', failureCode: 'connection_unavailable' },
    evidence,
  })?.kind, 'repeated_no_progress');
});

test('연결 상태만 같은 값으로 다시 확인하고 막다른 답을 반복해도 진전으로 꾸미지 않는다', () => {
  const reply = '전용 연결은 아직 없어요.';
  const connectionReceipt = (checkedAt) => ({
    outcome: 'succeeded', actualCall: { name: 'connection', args: { action: 'inspect', id: 'google-workspace' } },
    requestedCall: { name: 'connection', args: { action: 'inspect', id: 'google-workspace' } },
    result: {
      state: 'inspected', checkedAt,
      connection: { id: 'google-workspace', state: 'needs_connection', reason: 'not_connected' },
    },
  });
  const firstReceipts = [connectionReceipt('2026-08-20T00:00:00.000Z')];
  const secondReceipts = [connectionReceipt('2026-08-20T00:01:00.000Z')];
  const session = { transcript: previousExchange({ user: '구글 연동해줘', reply, receipts: firstReceipts }) };
  const evidence = recoveryEvidenceForTurn({
    userText: '그럼 지금 연결 시작해', reply, kind: 'reply', receipts: secondReceipts,
  });
  assert.equal(repeatedNoProgressSignal({
    session, currentUserText: '그럼 지금 연결 시작해', currentResult: { kind: 'reply', reply }, evidence,
  })?.kind, 'repeated_no_progress');
});

test('중간에 다른 과업을 마쳤어도 마지막 복구 이후 같은 연결 막힘이 다시 나타나면 회복권을 연다', () => {
  const blocked = '앞선 미완료 작업과 지금 요청이 함께 잡혔어요. 지금 할 일만 한 번 더 말씀해 주세요.';
  const session = { transcript: [
    ...previousExchange({ user: '구글 연결을 시작해줘', reply: blocked }),
    ...previousExchange({
      user: '그 전에 다운로드 폴더에서 사장개조 자료를 찾아줘',
      reply: '관련 폴더 세 곳과 독립 파일 두 개를 찾았어요.',
      receipts: [{
        outcome: 'succeeded', requestedCall: { name: 'exec', args: { command: 'find fixture' } },
        actualCall: { name: 'exec', args: { command: 'find fixture' } },
        result: { state: 'completed', effectObservation: { changed: false } },
      }],
    }),
  ] };
  const evidence = recoveryEvidenceForTurn({
    userText: '이제 노션 연결을 그대로 진행해', reply: blocked, kind: 'reply', receipts: [],
  });
  assert.equal(repeatedNoProgressSignal({
    session, currentUserText: '이제 노션 연결을 그대로 진행해',
    currentResult: { kind: 'reply', reply: blocked }, evidence,
  })?.kind, 'repeated_no_progress');
});

test('사용자가 대화 상태를 다시 준비한 뒤에는 그 이전 막힘을 새 반복으로 세지 않는다', () => {
  const blocked = '앞선 미완료 작업과 지금 요청이 함께 잡혔어요. 지금 할 일만 한 번 더 말씀해 주세요.';
  const session = { transcript: [
    ...previousExchange({ user: '구글 연결해줘', reply: blocked }),
    { role: 'system_event', event: { kind: 'session_recovered', mode: 'reset' } },
  ] };
  const evidence = recoveryEvidenceForTurn({
    userText: '노션 연결해줘', reply: blocked, kind: 'reply', receipts: [],
  });
  assert.equal(repeatedNoProgressSignal({
    session, currentUserText: '노션 연결해줘',
    currentResult: { kind: 'reply', reply: blocked }, evidence,
  }), null);
});
