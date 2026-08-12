import assert from 'node:assert/strict';
import test from 'node:test';

import { runTurn } from '../src/kernel/turn.js';
import { splitModelControlCalls } from '../src/kernel/l2-plan/model-control.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const agreement = (quote) => ({ type: 'agreement_set', utteranceQuote: quote });
const stateCall = (args) => ({ name: 'work.state', args });
const terminalCall = () => ({ name: 'local.terminal', args: { command: 'pwd' } });
const changingTerminalCall = () => ({ name: 'local.terminal', args: { command: 'touch result.txt' } });

function sequenceModel(outputs, fallback = '끝냈어요.') {
  let index = 0;
  return {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return fallback;
      return outputs[index++] ?? { text: fallback, toolCalls: [] };
    },
  };
}

function turnContext(model) {
  const terminal = {
    async probe(command) {
      return { command, cwd: '/tmp', changes: false, probe: { exitCode: 0, stdout: '/tmp', stderr: '' } };
    },
    async handler(args) {
      return {
        result: { command: args.command, exitCode: 0, stdout: '/tmp', cwd: '/tmp' },
        userSafeSummary: '현재 위치를 확인했어요.',
      };
    },
  };
  return { env: demoEnv(), tools: demoTools({ localTerminal: terminal }), model };
}

function approvalContext(model) {
  const ctx = turnContext(model);
  ctx.pending = new Map();
  ctx.newId = () => 'approval-work-state';
  ctx.tools.tools['local.terminal'].probe = async (command) => ({
    command, cwd: '/tmp', changes: String(command).includes('touch'),
    probe: { exitCode: 0, stdout: '', stderr: '' },
  });
  return ctx;
}

function rejected(split) {
  return split.workStateProposal == null || split.workStateConflict != null;
}

test('한 모델 응답 안의 여러 work.state를 호출 순서대로 하나의 제안으로 병합한다', () => {
  const split = splitModelControlCalls([
    stateCall({ changes: [agreement('참석자는 35명으로 하자')] }),
    stateCall({ openQuestion: { question: '장소는 어디로 할까요?', changesAnswerFor: '행사 장소' } }),
    stateCall({ continueFrom: '지난 행사 준비를 이어가자' }),
  ]);

  assert.deepEqual(split.workStateProposal, {
    changes: [agreement('참석자는 35명으로 하자')],
    openQuestion: { question: '장소는 어디로 할까요?', changesAnswerFor: '행사 장소' },
    continueFrom: '지난 행사 준비를 이어가자',
  });
});

test('첫 호출의 합의와 도구 실행 뒤 호출의 미정 질문을 모두 보존한다', async () => {
  const result = await runTurn({ text: '상태를 확인하고 행사 준비도 정리해줘' }, turnContext(sequenceModel([
    { text: '', toolCalls: [
      stateCall({ changes: [agreement('참석자는 35명으로 하자')] }),
      terminalCall(),
    ] },
    { text: '장소만 정하면 돼요.', toolCalls: [
      stateCall({ openQuestion: { question: '장소는 어디로 할까요?', changesAnswerFor: '행사 장소' } }),
    ] },
  ])));

  assert.deepEqual(result.workStateProposal, {
    changes: [agreement('참석자는 35명으로 하자')],
    openQuestion: { question: '장소는 어디로 할까요?', changesAnswerFor: '행사 장소' },
  });
});

test('도구 실행 뒤 모델 호출에서 처음 나온 합의도 턴 결과까지 운반한다', async () => {
  const result = await runTurn({ text: '현재 위치를 보고 작업 원칙을 정해줘' }, turnContext(sequenceModel([
    { text: '', toolCalls: [terminalCall()] },
    { text: '앞으로 결과는 별도 파일로 남길게요.', toolCalls: [
      stateCall({ changes: [agreement('앞으로 결과는 별도 파일로 남기자')] }),
    ] },
  ])));

  assert.deepEqual(result.workStateProposal, {
    changes: [agreement('앞으로 결과는 별도 파일로 남기자')],
  });
});

test('여러 work.state에 반복된 정확히 같은 변경은 한 번만 보존한다', () => {
  const same = agreement('참석자는 35명으로 하자');
  const firstOnly = agreement('예산은 300만원으로 하자');
  const lastOnly = agreement('행사는 금요일에 열자');
  const split = splitModelControlCalls([
    stateCall({ changes: [firstOnly, same, same] }),
    stateCall({ changes: [same, lastOnly] }),
  ]);

  assert.deepEqual(split.workStateProposal?.changes, [firstOnly, same, lastOnly]);
});

test('턴 전체의 일곱 번째 변경은 앞의 여섯 개를 남기지 않고 제안 묶음 전체를 거부한다', () => {
  const split = splitModelControlCalls([
    stateCall({ changes: Array.from({ length: 4 }, (_, index) => agreement(`합의 ${index + 1}`)) }),
    stateCall({ changes: Array.from({ length: 3 }, (_, index) => agreement(`합의 ${index + 5}`)) }),
  ]);

  assert.equal(rejected(split), true, '상한 초과 제안의 앞부분만 저장하면 모델이 낸 한 묶음을 OS가 조용히 다시 쓴다');
});

test('서로 다른 openQuestion 또는 continueFrom이 한 턴에 경쟁하면 묶음 전체를 거부한다', () => {
  const questionConflict = splitModelControlCalls([
    stateCall({ openQuestion: { question: '장소는 어디로 할까요?', changesAnswerFor: '행사 장소' } }),
    stateCall({ openQuestion: { question: '예산은 얼마로 할까요?', changesAnswerFor: '행사 예산' } }),
  ]);
  const continuationConflict = splitModelControlCalls([
    stateCall({ continueFrom: '행사 준비' }),
    stateCall({ continueFrom: '정산 작업' }),
  ]);

  assert.deepEqual(
    [rejected(questionConflict), rejected(continuationConflict)],
    [true, true],
    '서로 다른 질문이나 프로젝트 중 마지막 하나만 고르면 안 된다',
  );
});

test('이전 사용자 턴의 work.state 후보가 다음 사용자 턴으로 누출되지 않는다', async () => {
  const first = await runTurn({ text: '참석자는 35명으로 하자' }, turnContext(sequenceModel([
    { text: '35명으로 정했어요.', toolCalls: [
      stateCall({ changes: [agreement('참석자는 35명으로 하자')] }),
    ] },
  ])));
  const second = await runTurn({ text: '오늘 점심은 뭐가 좋을까?' }, turnContext(sequenceModel([
    { text: '비빔밥이 좋아요.', toolCalls: [] },
  ])));

  assert.deepEqual(first.workStateProposal?.changes, [agreement('참석자는 35명으로 하자')]);
  assert.equal(second.workStateProposal, null);
});

test('승인 전후 work.state는 같은 요청의 한 묶음으로 병합해 승인 뒤 한 번만 반환한다', async () => {
  const ctx = approvalContext(sequenceModel([
    { text: '파일을 만들게요.', toolCalls: [
      stateCall({ changes: [agreement('결과는 별도 파일로 남기자')] }),
      changingTerminalCall(),
    ] },
    { text: '이름만 정하면 돼요.', toolCalls: [
      stateCall({ openQuestion: { question: '파일 이름은 무엇으로 할까요?', changesAnswerFor: '결과 파일 이름' } }),
    ] },
  ]));

  const before = await runTurn({ text: '결과는 별도 파일로 남기자' }, ctx);
  assert.equal(before.kind, 'approval');
  assert.equal(before.workStateProposal ?? null, null,
    '승인 전 일부 후보를 먼저 저장하면 승인 후 충돌·상한을 우회한다');

  const after = await runTurn({ approve: before.pendingId }, ctx);
  assert.deepEqual(after.workStateProposal, {
    changes: [agreement('결과는 별도 파일로 남기자')],
    openQuestion: { question: '파일 이름은 무엇으로 할까요?', changesAnswerFor: '결과 파일 이름' },
  });
});

test('승인 전 여섯 변경과 승인 후 일곱 번째 변경은 전체 묶음으로 거부한다', async () => {
  const ctx = approvalContext(sequenceModel([
    { text: '진행할게요.', toolCalls: [
      stateCall({ changes: Array.from({ length: 6 }, (_, index) => agreement(`합의 ${index + 1}`)) }),
      changingTerminalCall(),
    ] },
    { text: '끝냈어요.', toolCalls: [stateCall({ changes: [agreement('합의 7')] })] },
  ]));
  const before = await runTurn({ text: '합의 1 합의 2 합의 3 합의 4 합의 5 합의 6' }, ctx);
  const after = await runTurn({ approve: before.pendingId }, ctx);
  assert.equal(after.workStateProposal, null, '승인 경계가 변경 6개 상한을 초기화했다');
});

test('승인 전후 서로 다른 미정 질문이 경쟁하면 전체 묶음을 거부한다', async () => {
  const ctx = approvalContext(sequenceModel([
    { text: '장소를 정해야 해요.', toolCalls: [
      stateCall({ openQuestion: { question: '장소는 어디로 할까요?', changesAnswerFor: '행사 장소' } }),
      changingTerminalCall(),
    ] },
    { text: '예산도 정해야 해요.', toolCalls: [
      stateCall({ openQuestion: { question: '예산은 얼마로 할까요?', changesAnswerFor: '행사 예산' } }),
    ] },
  ]));
  const before = await runTurn({ text: '행사 준비를 파일로 남겨줘' }, ctx);
  const after = await runTurn({ approve: before.pendingId }, ctx);
  assert.equal(after.workStateProposal, null, '승인 전후 질문 충돌에서 마지막 질문만 남았다');
});

test('도구 걸음 중 생긴 승인도 그때까지 모은 work.state를 승인 뒤까지 보존한다', async () => {
  const ctx = approvalContext(sequenceModel([
    { text: '', toolCalls: [
      stateCall({ changes: [agreement('결과는 별도 파일로 남기자')] }),
      terminalCall(),
    ] },
    { text: '파일 이름을 정해야 해요.', toolCalls: [
      stateCall({ openQuestion: { question: '파일 이름은 무엇으로 할까요?', changesAnswerFor: '결과 파일 이름' } }),
      changingTerminalCall(),
    ] },
    { text: '승인한 작업을 끝냈어요.', toolCalls: [] },
  ]));
  const before = await runTurn({ text: '상태를 확인하고 결과를 파일로 남겨줘' }, ctx);
  assert.equal(before.kind, 'approval');
  assert.equal(before.workStateProposal ?? null, null);
  const after = await runTurn({ approve: before.pendingId }, ctx);
  assert.deepEqual(after.workStateProposal, {
    changes: [agreement('결과는 별도 파일로 남기자')],
    openQuestion: { question: '파일 이름은 무엇으로 할까요?', changesAnswerFor: '결과 파일 이름' },
  });
});
