import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveLanes } from '../src/kernel/l5-growth/tcell-lane.js';
import {
  PROMPT_BOUND_CHARS,
  REQUIRED_EVENT_KINDS,
  TURN_COUNTS,
  buildLongWorkScenario,
  loadProductAdapter,
  runLongWorkScenario,
} from '../scripts/production90/p90-long-work-scenarios.mjs';

const scenarios = Object.fromEntries(TURN_COUNTS.map((count) => [count, buildLongWorkScenario(count)]));
const labels = (items = []) => items.map((item) => item.label ?? item.value?.label ?? item.value).filter(Boolean);
const countOf = (state, ...keys) => {
  for (const key of keys) if (Array.isArray(state?.[key])) return state[key].length;
  return null;
};
const boolOf = (state, ...keys) => keys.some((key) => state?.[key] === true
  || (Array.isArray(state?.[key]) && state[key].length > 0));

async function productRun(turnCount, opts = {}) {
  const adapter = await loadProductAdapter();
  assert.equal(adapter.available, true, adapter.assumption);
  return runLongWorkScenario(adapter, scenarios[turnCount], opts);
}

test('시나리오 계약: 30·60·100턴과 필수 사건 종류가 문장 분류 없이 고정된다', () => {
  assert.deepEqual(TURN_COUNTS, [30, 60, 100]);
  for (const scenario of Object.values(scenarios)) {
    assert.equal(scenario.turns.length, scenario.turnCount);
    assert.deepEqual(scenario.turns.map((turn) => turn.turnSeq),
      Array.from({ length: scenario.turnCount }, (_, index) => index + 1));
    const kinds = new Set(scenario.turns.flatMap((turn) => turn.candidates.map((candidate) => candidate.kind)));
    assert.deepEqual([...REQUIRED_EVENT_KINDS].sort(), [...kinds].sort());
    assert.ok(scenario.turns.flatMap((turn) => turn.candidates)
      .every((candidate) => candidate.workRef && candidate.subjectRef && candidate.scopeRef?.principalRef));
  }
});

test('진입 계약: 정식 delivered 영수증이 ActiveWorkLane 산출물로 인정된다', () => {
  const root = join(tmpdir(), 'p90-lane-root');
  const path = join(root, 'result.md');
  const lanes = deriveLanes([{
    id: '00000000-0000-0000-0000-000000000001',
    principalRef: 'principal-owner',
    ledgerEntries: [{
      lifecycle: 'delivered', failureState: 'none', turnRef: { sessionId: 's', turnSeq: 1 },
      actualCall: { tool: 'local.file', args: { action: 'write' } },
      result: { path, digest: 'digest-result' },
    }],
  }], { roots: [root] });
  assert.equal(lanes.length, 1, 'fixture 전용 executed가 아니라 정식 ToolReceipt의 delivered를 봐야 한다');
});

for (const turnCount of TURN_COUNTS) {
  test(`${turnCount}턴: 대체·철회 뒤 현재 합의만 남고 옛 값은 부활하지 않는다`, async () => {
    const { state, rendered } = await productRun(turnCount);
    const active = labels(state.activeAgreements ?? state.agreements ?? []);
    assert.deepEqual(active, scenarios[turnCount].expected.activeAgreementLabels);
    for (const old of scenarios[turnCount].expected.retractedLabels) {
      assert.ok(!active.includes(old), `철회한 합의가 활성으로 부활함: ${old}`);
      assert.ok(!rendered.includes(old), `철회한 합의가 모델 입력에 부활함: ${old}`);
    }
  });
}

test('미정 질문은 근거 TurnRef로 열리고 사용자 답변 뒤 resolved로 이동한다', async () => {
  const { state, events } = await productRun(60);
  assert.equal(countOf(state, 'openQuestions', 'questionsOpen'), 0);
  assert.equal(countOf(state, 'resolvedQuestions', 'questionsResolved'), 1);
  const opened = events.find((event) => event.type === 'question_opened');
  const resolved = events.find((event) => event.type === 'question_resolved');
  assert.ok(opened?.eventId);
  assert.equal(resolved?.evidence?.targetEventId, opened.eventId);
});

test('실행 완료는 CompletionContract와 delivered ToolReceipt 결합으로만 활성화된다', async () => {
  const { state, events } = await productRun(60);
  const completed = events.find((event) => event.type === 'execution_completed');
  assert.match(completed?.evidence?.receiptRef ?? '', /^rr1\./);
  assert.match(completed?.evidence?.completionContractRef ?? '', /^cr1\./);
  assert.equal(completed?.evidence?.verificationPassed, true);
  assert.equal(boolOf(state, 'executionCompleted', 'completedExecutions', 'completedWork'), true);

  const adapter = await loadProductAdapter();
  assert.equal(adapter.available, true, adapter.assumption);
  const dir = await mkdtemp(join(tmpdir(), 't5-p90-fake-done-'));
  const store = await adapter.createStore(dir);
  await assert.rejects(adapter.append(store, {
    kind: 'execution_completed', workRef: 'work-fake', subjectRef: 'subject-fake',
    scopeRef: { principalRef: 'principal-owner', projectRef: 'project-fake' },
    modelClaim: { done: true },
  }), /필드|ref|계약/, '모델 done 주장만으로 완료 사건을 만들면 안 된다');
});

test('대화 산출물은 chat_delivered로 남되 프로젝트 전체 실행 완료를 가장하지 않는다', async () => {
  const { state, events } = await productRun(30);
  const chat = events.find((event) => event.type === 'chat_delivered');
  assert.ok(chat?.eventId);
  assert.equal(chat?.evidence?.persisted, true);
  assert.equal(boolOf(state, 'chatDelivered', 'deliveredChats'), true);
  assert.equal(events.filter((event) => event.type === 'execution_completed').length, 1,
    'chat 전달을 별도 실행 완료로 중복 세면 안 된다');
});

test('재시작 뒤 사건 신분·대체·철회·해소·완료 관계가 그대로 복원된다', async () => {
  const scenario = scenarios[100];
  const { state, events } = await productRun(100, { restartAt: 50 });
  const expectedEvents = scenario.turns.reduce((count, turn) => count + turn.candidates.length, 0);
  assert.equal(events.length, expectedEvents);
  assert.equal(new Set(events.map((event) => event.eventId)).size, events.length, '재시작 중복 사건 0');
  assert.deepEqual(labels(state.activeAgreements ?? state.agreements ?? []), scenario.expected.activeAgreementLabels);
  assert.equal(countOf(state, 'openQuestions', 'questionsOpen'), 0);
  assert.equal(boolOf(state, 'executionCompleted', 'completedExecutions', 'completedWork'), true);
});

test('principal/project가 다른 무관 대화에는 프로젝트 상태가 입장하지 않는다', async () => {
  const { state, rendered } = await productRun(60, {
    principalRef: 'principal-owner',
    projectRef: 'project-unrelated',
    conversationRef: 'conversation-unrelated',
  });
  assert.equal(countOf(state, 'activeAgreements', 'agreements') ?? 0, 0);
  assert.equal(countOf(state, 'openQuestions', 'questionsOpen') ?? 0, 0);
  assert.equal(rendered, '');
});

test('100턴이어도 모델 입력용 작업상태는 상한 안이며 활성 사실을 보존한다', async () => {
  const { rendered } = await productRun(100);
  assert.ok(rendered.length > 0, '관련 활성 사실은 공급돼야 한다');
  assert.ok(rendered.length <= PROMPT_BOUND_CHARS,
    `작업상태 ${rendered.length}자가 상한 ${PROMPT_BOUND_CHARS}자를 넘음`);
  assert.ok(rendered.includes(scenarios[100].expected.activeAgreementLabels[0]), '현재 합의가 상한에 밀리면 안 된다');
});

test('장기 작업상태 기록과 복원은 새 승인 카드를 만들지 않는다', async () => {
  for (const turnCount of TURN_COUNTS) {
    const { approvalCount, events } = await productRun(turnCount);
    assert.equal(approvalCount, 0, `${turnCount}턴 상태 관리가 승인 요청을 추가함`);
    assert.equal(events.some((event) => event.type === 'approval_requested'), false);
  }
});
