import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'web.collect', connected: true, executable: true }],
});

// §11: 사실·경계를 주고 판단·문장은 모델에 남긴다.
test('Task Context Packet 은 원문을 보존하고 naturalness 를 열어둔다', () => {
  const intent = interpret('안녕');
  const tc = buildTaskContext({ intent, selfState });
  assert.equal(tc.currentRequest, '안녕'); // 왜곡 금지
  assert.equal(tc.naturalness, 'method_and_language_open');
  assert.equal(tc.answerMode, 'fast_chat');
});

test('선언된 사실만 담고 지시문을 담지 않는다', () => {
  const intent = interpret('포모도로가 뭐야?');
  const tc = buildTaskContext({ intent, selfState });
  // selfStateFacts 는 값 사실만: 문자열 지시("반드시", "해라")가 없어야 한다.
  const json = JSON.stringify(tc.selfStateFacts);
  assert.doesNotMatch(json, /반드시|해라|하지 마|instruction/);
  assert.ok('model' in tc.selfStateFacts);
});

test('evidenceFacts 는 userSafeSummary 만 담고 diagnosticTrace 를 담지 않는다', () => {
  const intent = interpret('뉴스 수집해줘');
  const receipts = [{
    intended: '수집', actualCall: { tool: 'web.collect' }, failureState: 'none',
    userSafeSummary: '공개 자료로 확인', diagnosticTrace: { stack: 'secret' },
  }];
  const tc = buildTaskContext({ intent, selfState, receipts });
  const json = JSON.stringify(tc.evidenceFacts);
  assert.match(json, /공개 자료로 확인/);
  assert.doesNotMatch(json, /secret|stack/);
});
