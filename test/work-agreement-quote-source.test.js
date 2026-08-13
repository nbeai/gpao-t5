import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { admitWorkStateProposal } from '../src/surface/work-state-admission.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';

async function fixture() {
  const store = new WorkEventStore(await mkdtemp(join(tmpdir(), 't5-work-agreement-source-')));
  return {
    store,
    principalRef: 'local-owner',
    turnRef: { sessionId: 'session-agreement-source', turnSeq: 2 },
  };
}

test('모델 답이나 보여 준 작업 기억에만 있는 합의는 사용자 발화 근거가 아니어서 입장하지 못한다', async () => {
  const fx = await fixture();
  const invented = '행사 예산은 1천만원으로 확정하자';
  const result = await admitWorkStateProposal({
    ...fx,
    inputText: '지난 행사 계획을 이어서 정리해줘',
    reply: `${invented}고 정리했어요.`,
    shownProjects: [{
      workRef: '모델이 본 작업 기억',
      selectionRef: 'P1',
      quotes: [invented],
    }],
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: invented }],
    },
  });

  assert.equal(result.accepted, false, '사용자가 하지 않은 모델·기억 문장이 합의로 입장했다');
  assert.equal(result.reason, 'utterance_quote_mismatch');
  assert.deepEqual(await fx.store.load(), [], '거절된 후보가 작업 사건을 남겼다');
});

test('이번 사용자 발화에 실제로 인용된 합의는 그 턴의 근거로 입장한다', async () => {
  const fx = await fixture();
  const agreement = '행사 예산은 500만원으로 확정하자';
  const result = await admitWorkStateProposal({
    ...fx,
    inputText: `좋아. ${agreement}`,
    reply: '말한 예산으로 기록했어요.',
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: agreement }],
    },
  });

  assert.equal(result.accepted, true, result.reason);
  const [event] = await fx.store.load();
  assert.equal(event.type, 'agreement_set');
  assert.equal(event.evidence.statement, agreement);
  assert.deepEqual(event.evidence.turnRef, fx.turnRef);
});

test('앞선 사용자 발화의 실제 인용은 그 말을 한 턴의 근거로 입장한다', async () => {
  const fx = await fixture();
  const agreement = '행사 장소는 서울숲으로 확정하자';
  const sourceTurnRef = { sessionId: fx.turnRef.sessionId, turnSeq: 1 };
  const result = await admitWorkStateProposal({
    ...fx,
    inputText: '지금까지 정한 내용을 정리해줘',
    reply: '앞서 정한 장소까지 정리했어요.',
    priorUtterances: [{ text: `사용자 원문: ${agreement}`, turnRef: sourceTurnRef }],
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: agreement }],
    },
  });

  assert.equal(result.accepted, true, result.reason);
  const [event] = await fx.store.load();
  assert.equal(event.evidence.statement, agreement);
  assert.deepEqual(event.evidence.turnRef, sourceTurnRef,
    '뒤늦게 제출한 턴이 아니라 실제 사용자 발화 턴을 근거로 남겨야 한다');
});
