// P-OP 원인 ①③ 반대시험 — **원장이 시작되고, 이어지고, 재시작을 넘긴다.**
//
// 근거(전량 커밋): docs/03-verification/evidence/p-op-identity-2026-08-10/
//   · S1-gate-probe.json / S1-gate-probe-after.json — 정산 게이트 항 덤프(수리 전/후)
//   · false-premise-probe.json — 거짓 전제에 모델이 실제로 낸 work.state 제출 원본
//   · S1-clean-instrument-r*.json — 계측기 오염을 걷은 뒤의 12턴 원본
//
// 여기서 재는 것은 전부 **기계 사실**이다: 게이트 항 · 원장 사건 · 투영된 현재값.
// 문장 모양(물음표·낱말)으로 가르는 판정은 이 파일에 없다.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { admitWorkStateProposal } from '../src/surface/work-state-admission.js';
import { projectWorkState } from '../src/kernel/l1-intent/work-state.js';

const 열린서버 = [];
after(async () => {
  await Promise.all(열린서버.map((s) => new Promise((resolve) => s.close(resolve))));
});

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

async function start(dir, model) {
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), model });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  열린서버.push(server);
  return { base: `http://127.0.0.1:${server.address().port}`, server };
}

/**
 * 정산 자리에서만 상태를 제출하는 모델. 본선 턴에서는 **기억 후보를 함께 낸다** —
 * 라이브에서 정산을 껐던 바로 그 겹침이다(지속 선호를 말하는 턴이 곧 작업을 세우는 턴이다).
 */
function 정산모델(합의문장, { 기억후보 = true } = {}) {
  return {
    async respond(tc) {
      if (tc?.workStateSettlement) {
        return { text: '', toolCalls: [{ name: 'work.state', args: { changes: [{ type: 'agreement_set', utteranceQuote: 합의문장 }] } }] };
      }
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      return {
        text: '그렇게 정리할게요.',
        toolCalls: 기억후보 ? [{
          name: 'memory.propose',
          args: {
            kind: 'preference',
            statement: 합의문장,
            evidence: { utteranceQuote: 합의문장, speechAct: 'declaration', appliesTo: 'from_now_on' },
          },
        }] : [],
      };
    },
  };
}

// ── ① 정산이 열린다 — 다른 채널의 후보가 함께 떠도 ────────────────────────────
//
// 라이브 실측(수리 전): S1 12턴 · 2회차에서 `reviewNeeded` 가 **22턴 내내 false**.
// 게이트를 덤프하니 유일한 최초 후보 턴(t5)이 `hasForeignControlProposal:true` 로 닫혔고,
// 그 뒤로는 `hadActiveGoal:true` 로 영영 닫혔다 — WorkEvent 0.
test('①-a 기억 후보가 함께 뜬 턴에서도 정산이 열리고 원장에 사건이 선다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p-op-gate-'));
  const 합의 = '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.';
  const { base } = await start(dir, 정산모델(합의));
  const s = await post(base, '/sessions');
  const turn = await post(base, '/turn', { sessionId: s.id, text: 합의 });

  assert.equal(turn.workStateDiagnostic.reviewNeeded, true,
    `정산 게이트가 닫혔다: ${JSON.stringify(turn.workStateDiagnostic.gate)}`);
  assert.equal(turn.workStateDiagnostic.reviewOpened, true, '게이트는 열렸는데 정산 호출이 안 섰다');
  const records = await new WorkEventStore(dir).load();
  assert.ok(records.some((r) => r.type === 'agreement_set' && r.evidence?.statement === 합의),
    '사용자가 확정한 것이 원장에 안 남았다');
});

// ①-b 손이 하나도 없어도 상태 채널은 선다(대화만으로 하는 작업의 자리).
test('①-b 연결된 손이 0이어도 work.state 채널이 모델 앞에 선다', () => {
  const 손없음 = { connectedTools: [] };
  const names = modelSchemasFor(손없음, ['work.state']).map((x) => x.name);
  assert.ok(names.includes('work.state'),
    '손이 없다고 상태 채널이 사라졌다 — 대화 작업에서 원장이 시작될 수 없다(실측 WorkEvent 0)');
  assert.equal(modelSchemasFor(buildSelfState(demoEnv()), ['work.state']).some((x) => x.name === 'work.state'), true);
});

// ── ② 재시작을 넘는다 — 같은 현재값이 다시 공급된다 ──────────────────────────
test('② 서버를 새로 띄워도 같은 대화에 같은 현재값이 공급된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p-op-restart-'));
  // 정산이 열리는 턴에서만 사건이 선다(게이트는 목표 신호를 본다) — 그 조건을 갖춘 발화로 잰다.
  // 남은 결함으로 기록: **어떤 확정 발화가 목표 신호를 만드는지가 고르지 않다**(재실행 원본
  // S1-final-r*.json). 이 칸이 재는 것은 "선 사건이 재시작을 넘는가"이고 그건 그 위의 계약이다.
  const 합의 = '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.';
  const first = await start(dir, 정산모델(합의));
  const s = await post(first.base, '/sessions', {});
  await post(first.base, '/turn', { sessionId: s.id, text: 합의 });
  await new Promise((resolve) => first.server.close(resolve));

  const 받은맥락 = [];
  const 두번째모델 = {
    async respond(tc) {
      받은맥락.push(tc);
      if (tc?.workStateSettlement) return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      return '네.';
    },
  };
  const second = await start(dir, 두번째모델);         // **새 서버 · 같은 자리**
  await post(second.base, '/turn', { sessionId: s.id, text: '지금까지 정해진 것 알려줘.' });

  const 턴맥락 = 받은맥락.find((c) => c?.projectWorkState);
  assert.ok(턴맥락, '재시작 뒤 턴에 작업 상태가 하나도 안 실렸다 — 현재값 공급이 끊겼다');
  assert.deepEqual(턴맥락.projectWorkState.activeAgreements.map((a) => a.statement), [합의],
    '재시작 뒤 같은 현재값이 안 왔다');
});

// ── ③ 지목 대상 해소 — 원장 안에서 하나로 특정될 때만 ────────────────────────
//
// 라이브 실측: 수정·제외 제안이 `target_not_current` 로 줄줄이 떨어졌다(모델은 브리프에
// 렌더된 문장의 **일부**를 지목한다). 저장 원문과 글자까지 같아야만 맞다고 보면
// **사용자가 바꾼 값이 원장에 안 남고 옛 값이 현재로 남는다** — 취소값 부활의 자리다.
async function 원장하나(문장들) {
  const store = new WorkEventStore(await mkdtemp(join(tmpdir(), 'p-op-target-')));
  let workRef = null;
  for (const [i, 문장] of 문장들.entries()) {
    const turnRef = { sessionId: 's', turnSeq: i + 1 };
    const r = await admitWorkStateProposal({
      store, turnRef, principalRef: 'owner', workRef,
      provisionalWorkRef: workRef ?? await store.issueWorkRef({ turnRef, workOrdinal: 0 }),
      inputText: 문장, reply: '네.',
      proposal: { changes: [{ type: 'agreement_set', utteranceQuote: 문장 }] },
    });
    workRef = r.workRef ?? workRef;
  }
  return { store, workRef };
}

test('③-a 저장 원문의 일부만 지목해도 하나로 특정되면 현재값이 바뀐다', async () => {
  const 옛것 = '처음에는 오전 9시와 오후 5시에 확인하는 걸로 생각했어.';
  const { store, workRef } = await 원장하나([옛것, '급한 문의는 배송 지연, 오배송, 환불 요청으로 보자.']);
  const 바꿈 = '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.';
  const r = await admitWorkStateProposal({
    store, turnRef: { sessionId: 's', turnSeq: 9 }, principalRef: 'owner', workRef,
    inputText: 바꿈, reply: '8시 30분으로 바꿨어요.',
    proposal: { changes: [{ type: 'agreement_superseded', utteranceQuote: 바꿈, targetQuote: '오전 9시와 오후 5시에 확인하는 걸로' }] },
  });
  assert.equal(r.accepted, true, `사용자가 바꾼 값이 원장에 못 남았다: ${r.reason}`);
  const state = projectWorkState(await store.load(), { principalRef: 'owner', projectRef: workRef });
  const 현재 = state.activeAgreements.map((a) => a.statement);
  assert.ok(현재.includes(바꿈), '새 값이 현재가 아니다');
  assert.ok(!현재.includes(옛것), '바꾼 뒤에도 옛 값이 현재로 남았다 — 취소값 부활이다');
});

test('③-b 여럿을 품는 조각은 지어내지 않고 거부한다', async () => {
  const { store, workRef } = await 원장하나([
    '오전 확인은 9시에 한다.',
    '오후 확인은 9시간 뒤에 한다.',
  ]);
  const r = await admitWorkStateProposal({
    store, turnRef: { sessionId: 's', turnSeq: 9 }, principalRef: 'owner', workRef,
    inputText: '확인 시간을 바꾸자.', reply: '바꿨어요.',
    proposal: { changes: [{ type: 'agreement_superseded', utteranceQuote: '확인 시간을 바꾸자.', targetQuote: '9시' }] },
  });
  assert.equal(r.accepted, false, '무엇을 가리키는지 모르는데 하나를 골라 바꿨다');
  assert.equal(r.reason, 'target_not_current');
});
