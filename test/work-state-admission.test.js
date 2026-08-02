import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { admitWorkStateProposal } from '../src/surface/work-state-admission.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';

async function fixture() {
  const store = new WorkEventStore(await mkdtemp(join(tmpdir(), 't5-work-admit-')));
  return { store, principalRef: 'local-owner', turnRef: { sessionId: 'session-admit', turnSeq: 1 } };
}

test('사용자 원문과 답에 대조된 합의·미정만 OS 사건이 된다', async () => {
  const fx = await fixture();
  const result = await admitWorkStateProposal({
    ...fx,
    inputText: '참석자는 28명으로 확정하자',
    reply: '좋아요. 장소는 어디로 정할까요?',
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: '참석자는 28명으로 확정하자' }],
      openQuestion: { question: '장소는 어디로 정할까요?', changesAnswerFor: '행사 장소' },
    },
  });
  assert.equal(result.accepted, true);
  assert.match(result.workRef, /^wr1\./);
  assert.equal(result.events.length, 2);
  assert.deepEqual((await fx.store.load()).map((event) => event.type), ['agreement_set', 'question_opened']);
});

test('모델이 바꿔 쓴 사용자 말이나 답에 실제로 없는 질문은 전부 거부한다', async () => {
  const fx = await fixture();
  const result = await admitWorkStateProposal({
    ...fx,
    inputText: '28명으로 하자', reply: '좋아요.',
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: '참석자는 28명으로 확정' }],
      openQuestion: { question: '장소는 어디인가요?', changesAnswerFor: '행사 장소' },
    },
  });
  assert.equal(result.accepted, false);
  assert.equal((await fx.store.load()).length, 0, '부분 사건도 남기면 안 된다');
});

test('수정·철회·해소는 같은 작업의 현재 대상 원문을 정확히 지목한다', async () => {
  const fx = await fixture();
  const first = await admitWorkStateProposal({
    ...fx, inputText: '참석자는 35명으로 하자', reply: '장소는 어디로 정할까요?',
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: '참석자는 35명으로 하자' }],
      openQuestion: { question: '장소는 어디로 정할까요?', changesAnswerFor: '행사 장소' },
    },
  });
  const second = await admitWorkStateProposal({
    ...fx,
    turnRef: { ...fx.turnRef, turnSeq: 2 },
    workRef: first.workRef,
    inputText: '아니 28명으로 바꾸고 장소는 서울로 하자', reply: '28명과 서울로 반영했어요.',
    proposal: { changes: [
      { type: 'agreement_superseded', utteranceQuote: '28명으로 바꾸고', targetQuote: '참석자는 35명으로 하자' },
      { type: 'question_resolved', utteranceQuote: '장소는 서울로 하자', targetQuote: '장소는 어디로 정할까요?' },
    ] },
  });
  assert.equal(second.accepted, true);
  assert.equal(second.events.length, 2);

  const wrong = await admitWorkStateProposal({
    ...fx,
    turnRef: { ...fx.turnRef, turnSeq: 3 }, workRef: first.workRef,
    inputText: '그 합의는 철회할게', reply: '알겠어요.',
    proposal: { changes: [{
      type: 'agreement_retracted', utteranceQuote: '그 합의는 철회할게', targetQuote: '참석자는 35명으로 하자',
    }] },
  });
  assert.equal(wrong.accepted, false, '이미 대체된 옛 합의를 다시 철회 대상으로 삼으면 안 된다');
});

test('principalRef가 없으면 cross-session 가능한 작업 신분을 만들지 않는다', async () => {
  const fx = await fixture();
  const result = await admitWorkStateProposal({
    ...fx, principalRef: null, inputText: '이름은 봄 행사로 하자', reply: '좋아요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: '이름은 봄 행사로 하자' }] },
  });
  assert.equal(result.accepted, false);
  assert.equal((await fx.store.load()).length, 0);
});

test('새 대화는 실제로 보여준 프로젝트 원문 하나를 지목할 때만 기존 WorkRef를 이어받는다', async () => {
  const fx = await fixture();
  const first = await admitWorkStateProposal({
    ...fx, inputText: '참석자는 35명으로 하자', reply: '좋아요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: '참석자는 35명으로 하자' }] },
  });
  const continued = await admitWorkStateProposal({
    ...fx,
    turnRef: { sessionId: 'session-new', turnSeq: 1 },
    inputText: '그 프로젝트 계속하자', reply: '이어서 할게요.',
    proposal: { changes: [], continueFrom: '참석자는 35명으로 하자' },
    shownProjects: [{ workRef: first.workRef, quotes: ['참석자는 35명으로 하자'] }],
  });
  assert.equal(continued.accepted, true);
  assert.equal(continued.workRef, first.workRef);
  assert.equal(continued.events.length, 0, '이어받기 자체를 새 합의로 꾸미면 안 된다');

  const guessed = await admitWorkStateProposal({
    ...fx,
    turnRef: { sessionId: 'session-guess', turnSeq: 1 },
    inputText: '그거 계속하자', reply: '이어서 할게요.',
    proposal: { changes: [], continueFrom: '보여주지 않은 프로젝트' },
    shownProjects: [],
  });
  assert.equal(guessed.accepted, false);
});
