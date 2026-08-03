import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

// **단언이 실패해도 서버는 닫힌다.** 각 검사는 끝에서 `close()` 를 부르지만, 그 앞의 단언이
// 던지면 그 줄에 도달하지 못한다. 그러면 열린 서버가 프로세스를 붙잡아 **파일이 아니라 회귀 전체가
// 멈춘다** — 실측 2026-08-03: 헌장 전환으로 이 파일의 검사 2건이 실패하자 `npm test` 가 34분 넘게
// 끝나지 않았고, 원인이 실패가 아니라 잔류로 보여 진단이 그만큼 늦어졌다.
// 실패는 실패로 보여야 한다. 정리를 성공 경로에만 두지 않는다(환경 헌장 §1의 같은 규율).
const 열린서버 = [];
after(async () => {
  await Promise.all(열린서버.map((s) => new Promise((resolve) => s.close(resolve))));
});

async function start(dir, model, extra = {}) {
  const store = new SessionStore(dir);
  const server = makeServer({ store, env: demoEnv(), tools: demoTools(), model, ...extra });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  열린서버.push(server);
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

test('단순 대화는 상태 정산 호출을 열지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-settlement-chat-'));
  let calls = 0;
  const model = { async respond() {
    calls += 1;
    return { text: '반가워요.', toolCalls: [] };
  } };
  const app = await start(dir, model);
  const session = await (await post(app.base, '/sessions')).json();
  const result = await (await post(app.base, '/turn', {
    sessionId: session.id, text: '안녕',
  })).json();
  assert.equal(result.reply, '반가워요.');
  assert.equal(result.workStateDiagnostic.reviewNeeded, false);
  assert.equal(result.workStateDiagnostic.reviewOpened, false);
  assert.equal(calls, 1);
  await app.close();
});

test('첫 응답이 noChange를 보고한 장기 작업은 정산 호출을 중복 실행하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-settlement-main-report-'));
  let settlementCalls = 0;
  const model = { async respond(tc) {
    if (tc.workStateSettlement) settlementCalls += 1;
    return {
      text: '상태를 확인했어요.',
      toolCalls: [{ name: 'work.state', args: { noChange: true } }],
    };
  } };
  const app = await start(dir, model);
  const session = await (await post(app.base, '/sessions')).json();
  const result = await (await post(app.base, '/turn', {
    sessionId: session.id, text: '행사 계획을 정리해줘',
  })).json();
  assert.equal(result.workStateDiagnostic.reportedByMain, true);
  assert.equal(result.workStateDiagnostic.reviewNeeded, false);
  assert.equal(settlementCalls, 0);
  await app.close();
});

test('새 장기 작업에서 첫 응답이 상태를 생략하면 종단 정산이 최초 합의를 기록한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-settlement-new-'));
  const request = '행사 계획을 정리하고 이름은 여름 모임으로 확정하자';
  let settlementCalls = 0;
  const model = { async respond(tc) {
    if (tc.workStateSettlement) {
      settlementCalls += 1;
      assert.equal(tc.currentRequest, request);
      assert.equal(tc.workStateSettlement.deliveryCandidate, '여름 모임으로 정리했어요.');
      return { text: '이 문장은 전달되면 안 돼요.', toolCalls: [{
        name: 'work.state', args: { changes: [{
          type: 'agreement_set', utteranceQuote: request,
        }] },
      }] };
    }
    return { text: '여름 모임으로 정리했어요.', toolCalls: [] };
  } };
  const app = await start(dir, model);
  const session = await (await post(app.base, '/sessions')).json();
  const result = await (await post(app.base, '/turn', {
    sessionId: session.id, text: request,
  })).json();
  assert.equal(result.reply, '여름 모임으로 정리했어요.');
  assert.equal(result.workStateDiagnostic.reviewOpened, true);
  assert.equal(result.workStateDiagnostic.recorded, true);
  assert.equal(settlementCalls, 1);
  assert.ok((await new WorkEventStore(dir).load()).some((event) =>
    event.type === 'agreement_set' && event.evidence?.statement === request));
  await app.close();
});

test('정산 noChange와 오류는 사건을 만들거나 사용자 답을 막지 않는다', async () => {
  for (const mode of ['no_change', 'error']) {
    const dir = await mkdtemp(join(tmpdir(), `t5-work-settlement-${mode}-`));
    const model = { async respond(tc) {
      if (tc.workStateSettlement) {
        if (mode === 'error') throw new Error('settlement unavailable');
        return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      }
      return { text: '요청한 내용을 정리했어요.', toolCalls: [] };
    } };
    const app = await start(dir, model);
    const session = await (await post(app.base, '/sessions')).json();
    const result = await (await post(app.base, '/turn', {
      sessionId: session.id, text: '행사 계획을 정리해줘',
    })).json();
    assert.equal(result.reply, '요청한 내용을 정리했어요.');
    assert.equal(result.workStateDiagnostic.reviewNeeded, true);
    assert.equal((await new WorkEventStore(dir).load()).length, 0);
    assert.equal((await app.store.load(session.id)).workRef, undefined);
    if (mode === 'error') assert.equal(result.workStateDiagnostic.error, 'model_error');
    await app.close();
  }
});

test('정산은 전달 후보를 바꾸지 않고 답에 없던 미정 질문을 기록하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-settlement-question-'));
  const question = '행사 장소는 어디로 할까요?';
  const model = { async respond(tc) {
    if (tc.workStateSettlement) return {
      text: `후보 답을 바꿔서 ${question}`,
      toolCalls: [{ name: 'work.state', args: {
        openQuestion: { question, changesAnswerFor: '행사 장소' },
      } }],
    };
    return { text: '참석자 목록을 정리했어요.', toolCalls: [] };
  } };
  const app = await start(dir, model);
  const session = await (await post(app.base, '/sessions')).json();
  const result = await (await post(app.base, '/turn', {
    sessionId: session.id, text: '행사 참석자 목록을 정리해줘',
  })).json();
  assert.equal(result.reply, '참석자 목록을 정리했어요.');
  assert.equal(result.workStateDiagnostic.recorded, false);
  assert.equal(result.workStateDiagnostic.reason, 'question_not_delivered');
  assert.equal((await new WorkEventStore(dir).load()).length, 0);
  await app.close();
});

test('승인 재개 정산은 빈 클릭이 아니라 pending의 최초 사용자 원문을 검증한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-settlement-approval-'));
  const request = '오래된 행사자료 폴더를 지워줘';
  let settlementCalls = 0;
  const model = { async respond(tc, opts = {}) {
    if (tc.workStateSettlement) {
      settlementCalls += 1;
      assert.equal(tc.currentRequest, request);
      return { text: '', toolCalls: [{ name: 'work.state', args: { changes: [{
        type: 'agreement_set', utteranceQuote: request,
      }] } }] };
    }
    if (tc.workContractAssessment) return {
      text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }],
    };
    if (tc.evidenceFacts?.length) return { text: '정리했어요.', toolCalls: [] };
    if (opts.tools?.length) return { text: '', toolCalls: [{
      name: 'local.terminal', args: { command: 'rm -rf 오래된행사자료' },
    }] };
    return '정리했어요.';
  } };
  // **탈것을 터미널로 옮겼다**(자동성 헌장 2026-08-03) — 되돌릴 수 있는 파일 작업은 자동이라
  // 승인 재개라는 사건 자체를 만들 수 없다. 재는 것은 파일이 아니라 **승인 재개 정산이 빈 클릭이
  // 아니라 pending 에 봉인된 최초 사용자 원문을 검증하는가**이므로 승인이 나는 손이면 된다.
  const tools = demoTools({
    localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }),
    localTerminal: {
      async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
      async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '정리했어요.' }; },
    },
  });
  const app = await start(dir, model, { tools });
  const session = await (await post(app.base, '/sessions')).json();
  const approval = await (await post(app.base, '/turn', {
    sessionId: session.id, text: request,
  })).json();
  assert.equal(approval.kind, 'approval');
  assert.equal(settlementCalls, 0, '승인 전에는 정산을 열지 않는다');
  const savedSession = JSON.parse(await readFile(join(dir, `${session.id}.json`), 'utf8'));
  const sealedWorkRef = savedSession.pendingApprovals?.[approval.pendingId]?.workRef ?? null;
  const done = await (await post(app.base, '/turn', {
    sessionId: session.id, approve: approval.pendingId,
  })).json();
  assert.equal(done.kind, 'reply');
  assert.equal(done.workStateDiagnostic.reviewOpened, true);
  assert.equal(done.workStateDiagnostic.recorded, true);
  assert.equal(settlementCalls, 1);
  const events = await new WorkEventStore(dir).load();
  assert.ok(events.some((event) =>
    event.type === 'agreement_set' && event.evidence?.statement === request));

  // 승인 재개는 **요청 턴에 발급된 WorkRef 를 그대로 이어받는다.** 빈 승인 클릭 턴에서 새
  // 신분을 발급하면, 사용자는 한 가지 일을 시켰는데 장부는 요청 턴과 실행 턴을 다른
  // 프로젝트로 적는다. pending 에 workRef 를 봉인해 두는 이유가 이것이고, 그 fallback 이
  // 실제 도달 경로다 — 첫 턴이 승인으로 끝나면 session.workRef 는 아직 없다.
  //
  // 원장의 고유 workRef 개수로는 이 계약을 못 문다(요청 턴은 사건을 남기지 않으므로 어느
  // 쪽이든 한 개다). **봉인된 값과 기록된 값이 같은지**를 직접 대조해야 한다.
  assert.ok(sealedWorkRef, '승인 대기에 요청 턴의 WorkRef 가 봉인돼야 한다');
  for (const event of events) {
    assert.equal(event.workRef, sealedWorkRef,
      `승인 재개가 봉인된 WorkRef 를 버리고 새 신분을 발급했다 — ${event.type}`);
  }
  await app.close();
});

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

test('새 대화 주 호출이 상태를 생략하면 하나뿐인 carryable 브리프로 정산한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 't5-work-product-carry-settlement-'));
  const quote = '행사 참석자는 42명으로 확정하자';
  const model = { async respond(tc) {
    if (tc.workContractAssessment) return 'CHAT';
    if (tc.currentRequest === quote) return {
      text: '42명으로 확정했어요.',
      toolCalls: [{ name: 'work.state', args: { changes: [{
        type: 'agreement_set', utteranceQuote: quote,
      }] } }],
    };
    if (tc.workStateSettlement) {
      assert.match(tc.workStateSettlement.currentWorkBrief, /프로젝트 P1/);
      assert.match(tc.workStateSettlement.currentWorkBrief, /행사 참석자는 42명으로 확정하자/);
      return { text: '전달되지 않는 정산 문장', toolCalls: [{
        name: 'work.state', args: { changes: [], continueFromRef: 'P1' },
      }] };
    }
    return { text: '같은 행사 준비를 이어갈게요.', toolCalls: [] };
  } };
  const app = await start(dir, model);
  const first = await (await post(app.base, '/sessions')).json();
  await post(app.base, '/turn', { sessionId: first.id, text: quote });
  const firstSaved = await app.store.load(first.id);

  const second = await (await post(app.base, '/sessions')).json();
  const response = await (await post(app.base, '/turn', {
    sessionId: second.id, text: '그 행사 준비를 이어서 하자',
  })).json();
  assert.equal(response.reply, '같은 행사 준비를 이어갈게요.');
  assert.equal(response.workStateDiagnostic.reviewOpened, true);
  assert.equal((await app.store.load(second.id)).workRef, firstSaved.workRef);
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
  // 헌장(2026-08-03) 뒤 되돌릴 수 있는 쓰기는 자동이라 중간 승인이 없다. **재는 계약은 그대로다** —
  // 완료는 실제 `delivered` 영수증과 완료 계약이 결합될 때만 서고, 원본은 변하지 않는다.
  const done = await (await post(app.base, '/turn', { sessionId: session.id, text: request })).json();
  assert.equal(done.kind, 'reply');
  assert.equal(await readFile(source, 'utf8'), '원본 내용');
  assert.equal(await readFile(target, 'utf8'), '완성 내용');
  const saved = await app.store.load(session.id);
  const completionReceipt = saved.ledgerEntries.find((entry) => entry.deliverableRefs?.length);
  assert.equal(completionReceipt.workRef, saved.workRef);
  assert.equal(completionReceipt.completionContract?.kind, 'file');
  assert.equal(completionReceipt.completionContract.sourceTurnRef.sessionId, session.id,
    '완료 계약은 실행 영수증 뒤가 아니라 원래 ActionPlan 턴에 결합돼야 한다');
  assert.equal(completionReceipt.completionContract.sourceTurnRef.turnSeq, 1);
  const records = await new WorkEventStore(dir).load();
  assert.ok(records.some((event) => event.type === 'execution_completed'
    && event.evidence?.verificationPassed === true
    && event.evidence?.completionContractRef === completionReceipt.completionContractRef));
  assert.ok(records.some((event) => event.type === 'chat_delivered'));
  await app.close();
});
