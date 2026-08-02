import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkEventStore } from '../src/surface/work-event-store.js';
import { admitWorkStateProposal } from '../src/surface/work-state-admission.js';

const PRINCIPAL = 'local-owner';

async function fresh(Store = WorkEventStore) {
  return new Store(await mkdtemp(join(tmpdir(), 't5-work-atomicity-')));
}

function admission({ store, sessionId, statements, question }) {
  const inputText = statements.join(' 그리고 ');
  const reply = question ? `좋아요. ${question.question}` : '좋아요. 모두 반영했어요.';
  return admitWorkStateProposal({
    store,
    principalRef: PRINCIPAL,
    turnRef: { sessionId, turnSeq: 1 },
    inputText,
    reply,
    proposal: {
      changes: statements.map((utteranceQuote) => ({ type: 'agreement_set', utteranceQuote })),
      ...(question ? { openQuestion: question } : {}),
    },
  });
}

function recordsForSession(records, sessionId) {
  return records.filter((record) => record.evidence?.turnRef?.sessionId === sessionId);
}

test('후보 묶음의 세 번째 사건이 원장 검증에 실패하면 앞 사건도 durable로 남지 않는다', async () => {
  const store = await fresh();

  await assert.rejects(admission({
    store,
    sessionId: 'validation-failure',
    statements: ['참석자는 28명으로 확정하자', '행사 이름은 봄 모임으로 하자'],
    question: {
      question: '비밀번호 huntertwo',
      changesAnswerFor: '접속 정보',
    },
  }), /민감/);

  assert.deepEqual(await store.load(), [], '거부된 후보 묶음의 앞 사건이 부분 저장되면 안 된다');
});

test('후보 묶음의 두 번째 저장이 실패하면 첫 사건도 durable로 남지 않는다', async () => {
  class FailSecondAppendStore extends WorkEventStore {
    async _commitRecords() {
      throw new Error('injected atomic commit failure');
    }
  }

  const store = await fresh(FailSecondAppendStore);
  await assert.rejects(admission({
    store,
    sessionId: 'storage-failure',
    statements: ['예산은 300만원으로 하자', '행사일은 10월 2일로 하자'],
  }), /injected atomic commit failure/);

  assert.deepEqual(await store.load(), [], '저장 실패한 후보 묶음은 전부 롤백돼야 한다');
});

test('정상 후보 묶음은 동시 저장 뒤 재시작해도 각 묶음 전부가 보인다', async () => {
  const store = await fresh();
  const [first, second] = await Promise.all([
    admission({
      store,
      sessionId: 'normal-a',
      statements: ['참석자는 28명으로 하자', '장소는 서울로 하자'],
      question: { question: '행사 시간은 언제로 할까요?', changesAnswerFor: '행사 시간' },
    }),
    admission({
      store,
      sessionId: 'normal-b',
      statements: ['보고서는 PDF로 만들자', '파일명은 결과보고서로 하자'],
      question: { question: '제출일은 언제로 할까요?', changesAnswerFor: '제출일' },
    }),
  ]);

  assert.equal(first.events.length, 3);
  assert.equal(second.events.length, 3);

  const restarted = new WorkEventStore(store.dir);
  const records = await restarted.load();
  assert.equal(records.length, 6);
  assert.equal(recordsForSession(records, 'normal-a').length, 3);
  assert.equal(recordsForSession(records, 'normal-b').length, 3);
  assert.deepEqual(records.map((record) => record.ordinal), [1, 2, 3, 4, 5, 6]);
});

test('동시 후보 묶음 중 하나가 실패해도 그 묶음의 앞부분은 남지 않는다', async () => {
  class FailBadBundleSecondAppendStore extends WorkEventStore {
    async _commitRecords(records) {
      if (records.some((record) => record.evidence?.turnRef?.sessionId === 'concurrent-bad')) {
        throw new Error('injected concurrent bundle failure');
      }
      return super._commitRecords(records);
    }
  }

  const store = await fresh(FailBadBundleSecondAppendStore);
  const results = await Promise.allSettled([
    admission({
      store,
      sessionId: 'concurrent-good',
      statements: ['계약서는 DOCX로 만들자', '완성본은 별도 파일로 두자'],
    }),
    admission({
      store,
      sessionId: 'concurrent-bad',
      statements: ['초안은 오늘 만들자', '검토본은 내일 만들자'],
    }),
  ]);

  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);

  const restarted = new WorkEventStore(store.dir);
  const records = await restarted.load();
  assert.equal(recordsForSession(records, 'concurrent-good').length, 2);
  assert.equal(
    recordsForSession(records, 'concurrent-bad').length,
    0,
    '실패 묶음의 첫 사건이 정상 묶음 사이에 끼어 durable로 남으면 안 된다',
  );
});
