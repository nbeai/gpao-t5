import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

async function start(dir, model, extra = {}) {
  const store = new SessionStore(dir);
  const server = makeServer({ store, env: demoEnv(), tools: demoTools(), model, ...extra });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    store, server, base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function stateModel(seen) {
  return {
    async respond(tc, opts = {}) {
      seen.push(tc);
      if (!opts.tools?.length) return '답을 완성했어요.';
      if (tc.currentRequest === '참석자는 35명으로 하자') return {
        text: '좋아요. 장소는 어디로 정할까요?',
        toolCalls: [{ name: 'work.state', args: {
          changes: [{ type: 'agreement_set', utteranceQuote: '참석자는 35명으로 하자' }],
          openQuestion: { question: '장소는 어디로 정할까요?', changesAnswerFor: '행사 장소' },
        } }],
      };
      if (tc.currentRequest === '아니 28명으로 바꾸고 장소는 서울로 하자') return {
        text: '28명과 서울로 반영했어요.',
        toolCalls: [{ name: 'work.state', args: { changes: [
          { type: 'agreement_superseded', utteranceQuote: '28명으로 바꾸고', targetQuote: '참석자는 35명으로 하자' },
          { type: 'question_resolved', utteranceQuote: '장소는 서울로 하자', targetQuote: '장소는 어디로 정할까요?' },
        ] } }],
      };
      return { text: '현재 상태를 이어서 답했어요.', toolCalls: [] };
    },
  };
}

test('제품 턴이 합의·수정·미정을 기록하고 재시작 뒤 모델 입력에 현재 사실만 복원한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-product-'));
  const seen = [];
  let app = await start(dir, stateModel(seen));
  const session = await (await post(app.base, '/sessions')).json();
  for (const text of ['참석자는 35명으로 하자', '아니 28명으로 바꾸고 장소는 서울로 하자']) {
    const response = await post(app.base, '/turn', { sessionId: session.id, text });
    assert.equal(response.status, 200);
  }
  const saved = await app.store.load(session.id);
  assert.match(saved.workRef, /^wr1\./);
  assert.doesNotMatch(JSON.stringify(saved.transcript), /workStateProposal/,
    '모델 통제 후보는 사용자 transcript에 남지 않는다');
  await app.close();

  app = await start(dir, stateModel(seen));
  const response = await post(app.base, '/turn', { sessionId: session.id, text: '지금까지 뭐가 정해졌지?' });
  assert.equal(response.status, 200);
  const last = seen.at(-1);
  assert.deepEqual(last.projectWorkState.activeAgreements.map((item) => item.label), ['28명으로 바꾸고']);
  assert.equal(last.projectWorkState.openQuestions.length, 0);
  assert.doesNotMatch(JSON.stringify(last.projectWorkState), /35명/);
  const records = await new WorkEventStore(dir).load();
  assert.ok(records.some((event) => event.type === 'chat_delivered'));
  await app.close();
});

test('모델의 완료 주장과 원문 불일치는 제품에서 사건을 만들지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-product-reject-'));
  const model = { async respond(_tc, opts = {}) {
    return opts.tools?.length ? { text: '완료했어요.', toolCalls: [{ name: 'work.state', args: {
      changes: [
        { type: 'execution_completed', utteranceQuote: '완료' },
        { type: 'agreement_set', utteranceQuote: '사용자가 말하지 않은 합의' },
      ],
    } }] } : '완료했어요.';
  } };
  const app = await start(dir, model);
  const session = await (await post(app.base, '/sessions')).json();
  await post(app.base, '/turn', { sessionId: session.id, text: '그 일을 해줘' });
  assert.equal((await new WorkEventStore(dir).load()).length, 0);
  assert.equal((await app.store.load(session.id)).workRef, undefined);
  await app.close();
});

test('새 대화는 모델에게 실제로 보인 같은 principal 프로젝트만 이어받는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-product-carry-'));
  const seen = [];
  const model = { async respond(tc, opts = {}) {
    seen.push(tc);
    if (!opts.tools?.length) return '답을 완성했어요.';
    if (tc.currentRequest === '행사 참석자는 42명으로 확정하자') return {
      text: '42명으로 확정했어요.',
      toolCalls: [{ name: 'work.state', args: { changes: [{
        type: 'agreement_set', utteranceQuote: '행사 참석자는 42명으로 확정하자',
      }] } }],
    };
    if (tc.currentRequest === '그 행사 준비를 이어서 하자') return {
      text: '같은 행사 준비를 이어갈게요.',
      toolCalls: [{ name: 'work.state', args: {
        continueFrom: '행사 참석자는 42명으로 확정하자',
      } }],
    };
    return { text: '확인했어요.', toolCalls: [] };
  } };
  const app = await start(dir, model);
  const first = await (await post(app.base, '/sessions')).json();
  await post(app.base, '/turn', { sessionId: first.id, text: '행사 참석자는 42명으로 확정하자' });
  const firstSaved = await app.store.load(first.id);

  const second = await (await post(app.base, '/sessions')).json();
  await post(app.base, '/turn', { sessionId: second.id, text: '그 행사 준비를 이어서 하자' });
  const secondInput = seen.find((tc) => tc.currentRequest === '그 행사 준비를 이어서 하자');
  assert.ok(secondInput.carryableWork.some((line) => line.includes('행사 참석자는 42명으로 확정하자')));
  const secondSaved = await app.store.load(second.id);
  assert.equal(secondSaved.workRef, firstSaved.workRef, '보인 프로젝트를 지목하면 같은 WorkRef를 이어받는다');
  assert.doesNotMatch(JSON.stringify(secondSaved.transcript), /workStateProposal/);

  const outsider = await (await post(app.base, '/sessions')).json();
  const outsiderSaved = await app.store.load(outsider.id);
  outsiderSaved.principalRef = 'principal-other';
  await app.store.save(outsiderSaved);
  await post(app.base, '/turn', { sessionId: outsider.id, text: '이어갈 일이 있나?' });
  const outsiderInput = seen.find((tc) => tc.currentRequest === '이어갈 일이 있나?');
  assert.ok(!(outsiderInput.carryableWork ?? []).some((line) => line.includes('행사 참석자는 42명으로 확정하자')));
  assert.equal((await app.store.load(outsider.id)).workRef, undefined);
  await app.close();
});

test('제품의 실행 완료는 실제 산출물 delivered 영수증과 완료 계약이 결합될 때만 선다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-product-complete-'));
  const source = join(dir, '원본.md');
  const target = join(dir, '결과.md');
  await writeFile(source, '원본 내용', 'utf8');
  let mainCalls = 0;
  const request = '원본은 그대로 두고 결과 파일을 만들어줘';
  const model = { async respond(tc, opts = {}) {
    if (tc?.workContractAssessment) return 'FILE';
    if (!opts.tools?.length) return '결과 파일을 만들었어요.';
    mainCalls += 1;
    if (mainCalls === 1) return { text: '', toolCalls: [
      { name: 'work.state', args: { changes: [{ type: 'agreement_set', utteranceQuote: request }] } },
      { name: 'local.file', args: { action: 'read', path: source } },
    ] };
    if (tc?.evidenceFacts?.some((fact) => fact.calledWith?.includes?.('write'))) {
      return { text: '결과 파일을 만들었어요.', toolCalls: [] };
    }
    return { text: '', toolCalls: [{
      name: 'local.file', args: { action: 'write', path: target, text: '완성 내용', source },
    }] };
  } };
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) });
  const app = await start(dir, model, { tools });
  const session = await (await post(app.base, '/sessions')).json();
  const first = await (await post(app.base, '/turn', { sessionId: session.id, text: request })).json();
  assert.equal(first.kind, 'approval');
  const done = await (await post(app.base, '/turn', { sessionId: session.id, approve: first.pendingId })).json();
  assert.equal(done.kind, 'reply');
  assert.equal(await readFile(source, 'utf8'), '원본 내용');
  assert.equal(await readFile(target, 'utf8'), '완성 내용');
  const records = await new WorkEventStore(dir).load();
  assert.ok(records.some((event) => event.type === 'execution_completed'
    && event.evidence?.verificationPassed === true));
  assert.ok(records.some((event) => event.type === 'chat_delivered'));
  await app.close();
});
