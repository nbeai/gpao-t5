import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindDeliverableReceipt, fileWorkIsInPlay, parseDeliverableJudgment, unsatisfiedDeliverables,
} from '../src/kernel/l2-plan/work-contract.js';

test('완료 계약 판단은 전용 전체 응답 FILE/CHAT 만 구조로 받는다', () => {
  assert.equal(parseDeliverableJudgment('FILE'), 'file');
  assert.equal(parseDeliverableJudgment('```text\nCHAT\n```'), 'chat');
  assert.equal(parseDeliverableJudgment('파일을 만들겠습니다'), null);
  assert.equal(parseDeliverableJudgment('FILE 그리고 설명'), null);
});

test('파일 손을 실제로 고른 흐름에서만 완료 계약 판단을 연다', () => {
  assert.equal(fileWorkIsInPlay([{ name: 'local.locate', args: {} }]), true);
  assert.equal(fileWorkIsInPlay([{ name: 'local.file', args: { action: 'read' } }]), true);
  assert.equal(fileWorkIsInPlay([{ name: 'web.collect', args: {} }]), false);
});

test('파일 산출물은 같은 계약 신분이 결합된 쓰기 영수증에만 결합된다', () => {
  const plan = {
    workRef: 'wr-bound', completionContract: { kind: 'file' }, completionContractRef: 'cr-bound',
    deliverables: [{ id: 'out-1', kind: 'file', operation: 'write', binding: 'derived' }],
  };
  const unrelated = [{
    failureState: 'none', actualCall: { tool: 'other.tool', args: {} },
    result: { path: '/tmp/x', digest: 'same-shape' },
  }];
  assert.equal(unsatisfiedDeliverables(plan, unrelated).length, 1,
    '다른 도구의 digest 가 파일 산출물로 둔갑했다');
  const read = [{
    failureState: 'none', actualCall: { tool: 'local.file', args: { action: 'read' } },
    result: { path: '/tmp/x', digest: 'read-digest' },
  }];
  assert.equal(unsatisfiedDeliverables(plan, read).length, 1,
    '읽기 영수증이 쓰기 산출물로 둔갑했다');
  const unrelatedWrite = {
    failureState: 'none', actualCall: { tool: 'local.file', args: { action: 'write' } },
    result: { path: '/tmp/out.md', digest: 'content-digest' },
  };
  assert.equal(unsatisfiedDeliverables(plan, [bindDeliverableReceipt(plan, unrelatedWrite)]).length, 1,
    '원본과 결합되지 않은 무관한 쓰기가 변환 산출물로 둔갑했다');
  const sourceOnlyWrite = {
    ...unrelatedWrite,
    result: { ...unrelatedWrite.result, source: '/tmp/source.md', originalUntouched: false },
  };
  assert.equal(unsatisfiedDeliverables(plan, [bindDeliverableReceipt(plan, sourceOnlyWrite)]).length, 1,
    'source 문자열만 있고 원본 보존 증거가 없는 쓰기가 변환 산출물로 둔갑했다');
  const derivedWrite = {
    ...unrelatedWrite,
    result: { ...unrelatedWrite.result, source: '/tmp/source.md', originalUntouched: true },
  };
  const bound = bindDeliverableReceipt(plan, derivedWrite);
  assert.deepEqual(bound.deliverableRefs, ['out-1']);
  assert.equal(unsatisfiedDeliverables(plan, [bound]).length, 0);
  assert.equal(unsatisfiedDeliverables(plan, [{ ...bound, workRef: 'wr-other' }]).length, 1,
    '다른 작업 신분의 영수증이 현재 산출물을 완료했다');
  assert.equal(unsatisfiedDeliverables(plan, [{ ...bound, completionContractRef: 'cr-other' }]).length, 1,
    '다른 완료 계약의 영수증이 현재 산출물을 완료했다');
});

test('처음부터 고른 직접 쓰기는 원본 표시 없이도 자기 완료 계약에 결합된다', () => {
  const plan = {
    workRef: 'wr-direct', completionContract: { kind: 'file' }, completionContractRef: 'cr-direct',
    deliverables: [{ id: 'out-direct', kind: 'file', operation: 'write', binding: 'direct' }],
  };
  const write = bindDeliverableReceipt(plan, {
    failureState: 'none', actualCall: { tool: 'local.file', args: { action: 'write' } },
    result: { path: '/tmp/new.md', digest: 'content-digest' },
  });
  assert.deepEqual(write.deliverableRefs, ['out-direct']);
  assert.equal(unsatisfiedDeliverables(plan, [write]).length, 0);
});
