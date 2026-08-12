import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkEventStore } from '../src/surface/work-event-store.js';

const OWNER = 'principal-completion-owner';
const TURN = { sessionId: 'session-completion-binding', turnSeq: 1 };
const DELIVERABLE = 'primary-file-output';
const FILE_CONTRACT = Object.freeze({
  kind: 'file', sourceTurnRef: TURN,
  deliverables: [{ id: DELIVERABLE, kind: 'file', operation: 'write', binding: 'direct' }],
});

async function fixture() {
  const store = new WorkEventStore(await mkdtemp(join(tmpdir(), 't5-completion-binding-')));
  const currentWorkRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 0 });
  const otherWorkRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 1 });
  const currentContractRef = await store.issueCompletionContractRef({
    workRef: currentWorkRef,
    contract: FILE_CONTRACT,
  });
  const otherContractRef = await store.issueCompletionContractRef({
    workRef: otherWorkRef,
    contract: FILE_CONTRACT,
  });
  return { store, currentWorkRef, otherWorkRef, currentContractRef, otherContractRef };
}

function deliveredWrite({ workRef, completionContractRef } = {}) {
  return {
    intended: '별도 결과물 파일을 만든다',
    actualCall: { tool: 'local.file', args: { action: 'write', path: '/tmp/result.md' } },
    result: { path: '/tmp/result.md', digest: 'a'.repeat(64) },
    failureState: 'none',
    lifecycle: 'delivered',
    deliverableRefs: [DELIVERABLE],
    userSafeSummary: '결과물 파일을 만들었어요.',
    ...(workRef ? { workRef } : {}),
    ...(completionContractRef ? { completionContract: FILE_CONTRACT, completionContractRef } : {}),
  };
}

async function completionCandidate(store, workRef, completionContractRef, receiptRef, ordinal = 0) {
  return {
    type: 'execution_completed',
    workRef,
    subjectRef: await store.issueSubjectRef({ turnRef: { ...TURN, turnSeq: 2 }, eventOrdinal: ordinal }),
    scopeRef: { principalRef: OWNER, projectRef: workRef },
    evidence: { completionContractRef, receiptRef, verificationPassed: true },
  };
}

async function runCompletion(store, {
  workRef, completionContractRef, receipt, execute, turnOrdinal = 0, completionContract = FILE_CONTRACT,
}) {
  return store.runCompletionExecution({
    turnRef: { ...TURN, turnSeq: 2 }, turnOrdinal,
    workRef, completionContract, completionContractRef,
    execute: execute ?? (async () => receipt),
  });
}

test('다른 WorkRef와 완료 계약에 결합된 delivered 영수증은 현재 작업 완료로 바꿔 붙일 수 없다', async () => {
  const {
    store, currentWorkRef, otherWorkRef, currentContractRef, otherContractRef,
  } = await fixture();
  const sealed = await runCompletion(store, {
    workRef: otherWorkRef, completionContractRef: otherContractRef,
    receipt: deliveredWrite({ workRef: otherWorkRef, completionContractRef: otherContractRef }),
  });

  await assert.rejects(
    store.append(await completionCandidate(
      store, currentWorkRef, currentContractRef, sealed.receiptRef,
    )),
    /ReceiptRef|CompletionContractRef|WorkRef|결합/,
    '다른 작업의 영수증을 현재 작업의 사전 계약에 바꿔 붙이면 안 된다',
  );
  assert.equal((await store.load()).filter((event) => event.type === 'execution_completed').length, 0);
});

test('deliverableRefs만 같은 영수증에 사후 완료 계약을 만들어 붙여도 완료가 아니다', async () => {
  const { store, currentWorkRef } = await fixture();
  const postHocContractRef = await store.issueCompletionContractRef({
    workRef: currentWorkRef,
    contract: { deliverableRefs: [DELIVERABLE] },
  });

  await assert.rejects(
    async () => {
      const receiptRef = await store.issueReceiptRef({
        turnRef: { ...TURN, turnSeq: 2 }, turnOrdinal: 0, receipt: deliveredWrite(),
      });
      await store.append(await completionCandidate(
        store, currentWorkRef, postHocContractRef, receiptRef,
      ));
    },
    /ReceiptRef|CompletionContractRef|WorkRef|사전|결합/,
    '영수증이 나온 뒤 deliverableRefs만 보고 만든 계약은 완료 근거가 아니다',
  );
  assert.equal((await store.load()).filter((event) => event.type === 'execution_completed').length, 0);
});

test('실행 뒤 정상 모양 계약을 만들어도 공개 영수증 서명 경로로 완료를 만들 수 없다', async () => {
  const { store, currentWorkRef, currentContractRef } = await fixture();
  const alreadyExecuted = deliveredWrite({
    workRef: currentWorkRef, completionContractRef: currentContractRef,
  });
  await assert.rejects(
    store.issueReceiptRef({
      turnRef: { ...TURN, turnSeq: 2 }, turnOrdinal: 0, receipt: alreadyExecuted,
    }),
    /사전 계약이 감싼 실행 경로/,
  );
});

test('실행 콜백이 서명된 계약 신분에 다른 완료 계약 본문을 바꿔 끼울 수 없다', async () => {
  const { store, currentWorkRef, currentContractRef } = await fixture();
  const swappedContract = {
    ...FILE_CONTRACT,
    deliverables: [{ id: 'different-output', kind: 'file', operation: 'write', binding: 'direct' }],
  };

  await assert.rejects(
    runCompletion(store, {
      workRef: currentWorkRef,
      completionContractRef: currentContractRef,
      execute: async () => {
        return {
          ...deliveredWrite({ workRef: currentWorkRef, completionContractRef: currentContractRef }),
          completionContract: swappedContract,
          deliverableRefs: ['different-output'],
        };
      },
    }),
    /완료 계약 본문|CompletionContractRef|결합/,
  );
});

test('계약 신분과 입력 본문이 다르면 도구 실행 콜백 전에 거부한다', async () => {
  const { store, currentWorkRef, currentContractRef } = await fixture();
  const swappedContract = {
    ...FILE_CONTRACT,
    deliverables: [{ id: 'different-output', kind: 'file', operation: 'write', binding: 'direct' }],
  };
  let executed = false;
  await assert.rejects(runCompletion(store, {
    workRef: currentWorkRef,
    completionContractRef: currentContractRef,
    completionContract: swappedContract,
    execute: async () => {
      executed = true;
      return deliveredWrite({ workRef: currentWorkRef, completionContractRef: currentContractRef });
    },
  }), /실행 전에 발급된|CompletionContractRef|결합/);
  assert.equal(executed, false, '계약 검증 전에 도구 실행 콜백을 불렀다');
});

test('사전에 계획된 WorkRef와 CompletionContractRef가 영수증에 정확히 결합된 경우만 완료된다', async () => {
  const { store, currentWorkRef, currentContractRef } = await fixture();
  const sealed = await runCompletion(store, {
    workRef: currentWorkRef,
    completionContractRef: currentContractRef,
    receipt: deliveredWrite({
      workRef: currentWorkRef,
      completionContractRef: currentContractRef,
    }),
  });

  const result = await store.append(await completionCandidate(
    store, currentWorkRef, currentContractRef, sealed.receiptRef,
  ));
  assert.equal(result.accepted, true);
  const completed = (await store.load()).filter((event) => event.type === 'execution_completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].evidence.completionContractRef, currentContractRef);
  assert.equal(completed[0].evidence.receiptRef, sealed.receiptRef);
});

test('실패·승인 대기·읽기 영수증은 실행 완료를 만들지 않는다', async () => {
  const cases = [
    {
      name: '실패',
      receipt: { ...deliveredWrite(), lifecycle: 'failed', failureState: 'failed' },
    },
    {
      name: '승인 대기',
      receipt: {
        ...deliveredWrite(), lifecycle: 'attempting', actualCall: null,
        userSafeSummary: '승인을 기다리고 있어요.',
      },
    },
    {
      name: '읽기',
      receipt: {
        ...deliveredWrite(),
        actualCall: { tool: 'local.file', args: { action: 'read', path: '/tmp/source.md' } },
        result: { path: '/tmp/source.md', digest: 'b'.repeat(64) },
      },
    },
  ];

  for (const [index, entry] of cases.entries()) {
    const { store, currentWorkRef, currentContractRef } = await fixture();
    await assert.rejects(async () => {
      const sealed = await runCompletion(store, {
        workRef: currentWorkRef,
        completionContractRef: currentContractRef,
        turnOrdinal: index,
        receipt: {
          ...entry.receipt,
          workRef: currentWorkRef,
          completionContract: FILE_CONTRACT,
          completionContractRef: currentContractRef,
        },
      });
      await store.append(await completionCandidate(
        store, currentWorkRef, currentContractRef, sealed.receiptRef, index,
      ));
    }, undefined, `${entry.name} 영수증은 완료 근거가 될 수 없다`);
    assert.equal((await store.load()).filter((event) => event.type === 'execution_completed').length, 0,
      `${entry.name} 영수증 뒤에 완료 사건이 남았다`);
  }
});
