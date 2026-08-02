import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkEventStore } from '../src/surface/work-event-store.js';

const TURN = { sessionId: 'session-store', turnSeq: 1 };
const SCOPE = { principalRef: 'principal-owner', projectRef: 'project-store' };

async function fresh() {
  return new WorkEventStore(await mkdtemp(join(tmpdir(), 't5-work-store-')));
}

test('저장소만 WorkRef·subjectRef·eventId를 발급하고 재시작 뒤 검증한다', async () => {
  const store = await fresh();
  const workRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 0 });
  const subjectRef = await store.issueSubjectRef({ turnRef: TURN, eventOrdinal: 0 });
  const first = await store.append({
    type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '결과물은 별도 파일로 만든다' },
  });

  assert.match(first.eventId, /^we1\./);
  assert.equal(first.accepted, true);
  const restarted = new WorkEventStore(store.dir);
  assert.deepEqual((await restarted.load()).map((event) => event.eventId), [first.eventId]);
  assert.equal(await restarted.findWorkRef({ sessionId: TURN.sessionId, principalRef: SCOPE.principalRef }), workRef);
  assert.equal((await restarted.append({
    type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '결과물은 별도 파일로 만든다' },
  })).eventId, first.eventId, '같은 OS 근거는 멱등이어야 한다');
});

test('모델이 꾸민 ref·eventId와 민감 원문은 durable 사건이 되지 않는다', async () => {
  const store = await fresh();
  const workRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 0 });
  const subjectRef = await store.issueSubjectRef({ turnRef: TURN, eventOrdinal: 0 });
  await assert.rejects(store.append({
    eventId: 'model-event', type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '안전한 합의' },
  }));
  await assert.rejects(store.append({
    type: 'agreement_set', workRef: 'wr1.model', subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '안전한 합의' },
  }));
  await assert.rejects(store.append({
    type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '비밀번호 huntertwo' },
  }));
  assert.equal((await store.load()).length, 0);
});

test('실행 완료는 같은 WorkRef의 계약과 delivered 영수증 결합만 받는다', async () => {
  const store = await fresh();
  const workRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 0 });
  const subjectRef = await store.issueSubjectRef({ turnRef: TURN, eventOrdinal: 1 });
  const contractBody = {
    kind: 'file', sourceTurnRef: TURN,
    deliverables: [{ id: 'report', kind: 'file', operation: 'write', binding: 'direct' }],
  };
  const contract = await store.issueCompletionContractRef({ workRef, contract: contractBody });
  const sealed = await store.runCompletionExecution({
    turnRef: { ...TURN, turnSeq: 2 }, turnOrdinal: 0,
    workRef, completionContract: contractBody, completionContractRef: contract,
    execute: async () => ({
      lifecycle: 'delivered', failureState: 'none',
      actualCall: { tool: 'local.file', args: { action: 'write', path: '/tmp/report.md' } },
      result: { path: '/tmp/report.md', digest: 'a'.repeat(64) },
      deliverableRefs: ['report'], workRef, completionContract: contractBody,
      completionContractRef: contract,
    }),
  });
  const receipt = sealed.receiptRef;

  const done = await store.append({
    type: 'execution_completed', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { completionContractRef: contract, receiptRef: receipt, verificationPassed: true },
  });
  assert.equal(done.accepted, true);

  const otherWork = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 1 });
  const wrongContract = await store.issueCompletionContractRef({ workRef: otherWork, contract: { deliverable: 'other' } });
  await assert.rejects(store.append({
    type: 'execution_completed', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { completionContractRef: wrongContract, receiptRef: receipt, verificationPassed: true },
  }));
});

test('hash chain 손상은 마지막 checkpoint까지만 읽고 원본을 덮지 않는다', async () => {
  const store = await fresh();
  const workRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 0 });
  const subjectRef = await store.issueSubjectRef({ turnRef: TURN, eventOrdinal: 0 });
  await store.append({
    type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '첫 합의' },
  });
  const before = await readFile(store.file, 'utf8');
  const parsed = JSON.parse(before);
  parsed.records[0].hash = '0'.repeat(64);
  await writeFile(store.file, JSON.stringify(parsed), 'utf8');

  const restarted = new WorkEventStore(store.dir);
  const status = await restarted.loadWithStatus();
  assert.equal(status.degraded, true);
  assert.equal(status.readOnly, true);
  await assert.rejects(restarted.append({
    type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: '두 번째 합의' },
  }));
  assert.equal(await readFile(store.file, 'utf8'), JSON.stringify(parsed), '손상 원본을 덮으면 안 된다');
});

test('파일 경쟁 append도 사건을 잃지 않는다', async () => {
  const store = await fresh();
  const workRef = await store.issueWorkRef({ turnRef: TURN, workOrdinal: 0 });
  const subjects = await Promise.all([0, 1].map((eventOrdinal) =>
    store.issueSubjectRef({ turnRef: TURN, eventOrdinal })));
  await Promise.all(subjects.map((subjectRef, index) => store.append({
    type: 'agreement_set', workRef, subjectRef, scopeRef: SCOPE,
    evidence: { turnRef: TURN, statement: `합의 ${index + 1}` },
  })));
  assert.equal((await store.load()).length, 2);
});
