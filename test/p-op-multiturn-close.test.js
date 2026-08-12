// **P-OP 멀티턴 남은 두 조건 봉인** (PM 지시 2026-08-10 · 완료 조건 동결)
//
// ① S4 — 결과 파일은 1개다. 신분(subjectRef) 승계는 서는데 *"이 작업의 결과물은 이것
//    하나"* 라는 계약이 없어, 열 명세 같은 추가 요청에 모델이 같은 파일을 고치지 않고
//    새로 만들었다(실측 2/4 · S4-final-r2 6턴: 앞 턴 산출물이 재료에 보이는데 새 이름).
//    수리: 파일 산출물 계약(FILE)의 성공 write 가 **작업의 결과물**로 working-state 에
//    서고(기존 저장 경로 — 새 저장소 아님), 그 사실이 다음 턴 재료로 공급된다.
// ② S1 — 수정·제외도 원장에 남는다. 모델은 수정·제외를 실제로 낸다(final r3·r4 의
//    9·10턴 agreement_superseded 제출 4/4). 죽는 자리는 입장 — 지목 대상(t2·t3 확정)이
//    게이트 탓에 원장에 못 서서 `target_not_current` 로 전량 거절됐다(유일 현재값 t5 하나).
//    수리: 대상 해소의 정의역 확장 — ⓐ 원장에 없으면 이 대화의 **사용자 원문**에서
//    하나로 특정될 때 소급(base 확정 + 수정/제외 두 사건) ⓑ 그마저 안 되면 검증된
//    이번 발화(utteranceQuote)가 **새 확정으로 선다**(거절 대신 — 옛 값은 원장에 없었으니
//    대체할 것도 없다). 안전 불변: 원문 불일치 거절·question_resolved 의 대상 요구는 그대로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveWorkingState, workingStateFacts } from '../src/kernel/l0-evidence/working-state.js';
import { admitWorkStateProposal } from '../src/surface/work-state-admission.js';
import { WorkEventStore } from '../src/surface/work-event-store.js';
import { projectWorkEvents } from '../src/kernel/l0-evidence/work-event-ledger.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

// ── ① 산출물 계약 ─────────────────────────────────────────────────────────

test('① 파일 계약의 성공 write 가 작업의 산출물로 서고, 사실로 공급되고, 이어지고, 낡으면 내린다', () => {
  const s1 = deriveWorkingState(undefined, { deliverables: [{ path: '/방/GPAO-T5/통합.csv' }] });
  assert.equal(s1.deliverables?.[0]?.path, '/방/GPAO-T5/통합.csv',
    '**산출물이 상태에 안 선다** — 신분이 없어 다음 턴 모델은 "다룬 파일"만 본다(새 파일 증식의 그 자리)');
  const 사실 = String(workingStateFacts(s1));
  assert.match(사실, /이 작업에서 만든 결과물 파일/, '산출물 사실 문장이 재료에 없다');
  assert.match(사실, /통합\.csv/);
  assert.doesNotMatch(사실, /하나로 이어/, '**"하나" 계약을 일반화했다** — 여러 산출물 작업이 실사용이다(오너 정정)');
  // 이어진다 — 새 산출물이 없어도 작업이 사는 동안 유지된다.
  const s2 = deriveWorkingState(s1, {});
  assert.equal(s2.deliverables?.[0]?.path, '/방/GPAO-T5/통합.csv', '한 턴 만에 산출물 신분이 사라졌다');
  // **여러 산출물은 여럿으로 선다**(오너 정정) — 하나로 뭉개지 않는다. 같은 경로 재작성은 갱신.
  const s3 = deriveWorkingState(s2, { deliverables: [{ path: '/방/GPAO-T5/보고서.md' }, { path: '/방/GPAO-T5/통합.csv' }] });
  assert.deepEqual([...(s3.deliverables ?? [])].map((d) => d.path).sort(),
    ['/방/GPAO-T5/보고서.md', '/방/GPAO-T5/통합.csv'].sort(), '복수 산출물이 목록으로 안 선다');
  // 낡으면 내린다 — 대화가 다른 데로 간 지 오래면 현재라고 주장하지 않는다.
  let s = s2;
  for (let i = 0; i < 9; i += 1) s = deriveWorkingState(s, {});
  assert.equal(s.deliverables, undefined, '낡은 산출물이 영영 현재로 남는다');
});

test('① 관통 — FILE 계약 write 다음 턴의 재료(contextShown)에 결과물 계약이 실린다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pop1-'));
  const 결과 = join(dir, '통합.csv');
  const 쓰기모델 = {
    냈나: false,
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: 결과, text: '거래처,최종매출\n' } }] };
      }
      return '통합 결과 파일을 만들었어요.';
    },
  };
  const 공통 = {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
  };
  const r1 = await runTurn({ text: '정산 통합 결과 파일 만들어줘' }, { ...공통, model: 쓰기모델 });
  assert.ok(r1.workingState?.deliverables?.[0]?.path?.endsWith('통합.csv'),
    `**턴이 산출물을 상태에 안 남겼다**: ${JSON.stringify(r1.workingState?.deliverables ?? null)}`);
  // 다음 턴 — 서버가 하듯 workingState 를 이어받는다(한 대화 = 상태 승계).
  const 답만모델 = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      return '네, 열 명세를 반영할게요.';
    },
  };
  const r2 = await runTurn({ text: '결과 파일 열은 세 개로 해줘' },
    { ...공통, model: 답만모델, workingState: r1.workingState });
  assert.match(String(r2.contextShown ?? ''), /이 작업에서 만든 결과물 파일/,
    '**다음 턴 재료에 산출물 신분이 없다** — 모델은 "다룬 파일"만 보고 새 이름으로 만든다(S4 6턴 실측)');
  assert.match(String(r2.contextShown ?? ''), /통합\.csv/);
});

// ── ② 수정·제외 원장 ──────────────────────────────────────────────────────

async function 입장fx() {
  const store = new WorkEventStore(await mkdtemp(join(tmpdir(), 'pop2-')));
  return { store, principalRef: 'local-owner', turnRef: { sessionId: 's2', turnSeq: 9 } };
}

test('② 수정 — 대상이 원장에 없어도 사용자 원문에서 실재가 확인되면 현재 발화가 새 확정으로 선다(과거 발명 0·원자 1건)', async () => {
  const fx = await 입장fx();
  // 라이브 그대로: 작업은 서 있고(t5 확정 하나) t3 확정은 게이트 탓에 원장 0.
  const 자리 = await admitWorkStateProposal({
    ...fx, turnRef: { sessionId: 's2', turnSeq: 5 },
    inputText: '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.',
    reply: '초안만 만들게요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.' }] },
  });
  const result = await admitWorkStateProposal({
    ...fx, workRef: 자리.workRef,
    inputText: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.',
    reply: '오전 8시 30분으로 바꿨어요.',
    priorUtterances: [
      { text: '처음에는 오전 9시와 오후 5시에 확인하는 걸로 생각했어.', turnRef: { sessionId: 's2', turnSeq: 3 } },
    ],
    proposal: {
      changes: [{
        type: 'agreement_superseded',
        utteranceQuote: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.',
        // 모델이 사용자 과거 원문을 그대로 지목한 모양(스키마가 그렇게 안내한다).
        targetQuote: '오전 9시와 오후 5시에 확인',
      }],
    },
  });
  assert.equal(result.accepted, true,
    `**수정이 거절됐다** — 대상이 원장에 없다는 이유로 사용자의 변경이 사라진다(S1 9턴 4/4 의 그 죽음): ${result.reason}`);
  const 저장 = await fx.store.load();
  const types = 저장.map((e) => e.type);
  // **과거를 발명하지 않는다**(오너 판정): t3 은 검토("…생각했어")였다 — 소급 base 확정을
  // 만들면 역사가 달라진다. 현재 발화의 새 확정 **하나만** 선다(원자 — 부분 저장 없음).
  assert.deepEqual(types, ['agreement_set', 'agreement_set'],
    `현재값 확정 하나만 서야 한다(과거 발명 0): ${types}`);
  assert.equal(저장.filter((e) => e.evidence?.turnRef?.turnSeq === 3).length, 0,
    '**과거 턴을 증거로 단 사건이 생겼다** — 원장에 없던 과거를 발명했다');
  const 투영 = projectWorkEvents(저장);
  const 현재 = 저장.filter((e) => ['active', 'open'].includes(투영.byEvent[e.eventId]?.status));
  assert.equal(현재.filter((e) => /8시 30분/.test(e.evidence.statement ?? '')).length, 1,
    '수정 뒤 현재값에 새 값이 없다');
  assert.equal(현재.filter((e) => /9시와 오후 5시에 확인/.test(e.evidence.statement ?? '')).length, 0,
    '옛 값이 현재로 남아 있다 — 취소값 부활의 그 자리');
});

test('② 거짓 전제 가드 — 소급도 안 되는 지목은 예전 그대로 거절한다(검증된 발화라도 사건 0)', async () => {
  const fx = await 입장fx();
  const 자리 = await admitWorkStateProposal({
    ...fx, turnRef: { sessionId: 's2', turnSeq: 5 },
    inputText: '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.',
    reply: '초안만 만들게요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.' }] },
  });
  const result = await admitWorkStateProposal({
    ...fx, workRef: 자리.workRef,
    inputText: '인스타 DM은 이번 운영에서 빼고 스마트스토어만 먼저 하자.',
    reply: '스마트스토어만 먼저 할게요.',
    priorUtterances: [
      { text: '문의는 스마트스토어랑 인스타 DM 두 곳에서 들어와.', turnRef: { sessionId: 's2', turnSeq: 2 } },
    ],
    proposal: {
      changes: [{
        type: 'agreement_retracted',
        utteranceQuote: '인스타 DM은 이번 운영에서 빼고 스마트스토어만 먼저 하자.',
        // 실측 그대로: 모델이 **브리프 렌더 문장**을 지목한다 — 사용자 원문 어디에도 없다.
        targetQuote: '채널: 스마트스토어 문의, 인스타 DM.',
      }],
    },
  });
  // 처음 설계는 여기서 "새 확정으로 강등"이었다 — 전체 회귀(A-② 봉인)가 물렸다:
  // 거짓 전제 평서문도 검증된 발화라 강등이 사건으로 세운다. 의미를 재지 않고는 진짜
  // 수정과 못 가르므로 **못 가르는 자리는 fail-closed** — 예전 그대로 거절이 옳다.
  // (이 제외를 살리는 길은 강등이 아니라 소급이다 — 스키마가 대상의 사용자 원문 인용을
  //  안내하고, 그 인용이 오면 위 소급 검사가 받는다.)
  assert.equal(result.accepted, false, '소급도 안 되는 지목이 사건이 됐다 — 거짓 전제가 같은 문으로 들어온다');
  assert.equal(result.reason, 'target_not_current');
  const types = (await fx.store.load()).map((e) => e.type);
  assert.deepEqual(types, ['agreement_set'], `자리 확정 하나만 있어야 한다: ${types}`);
});

test('② 원장 대상 — 대상이 원장에 있으면 예전처럼 수정 사건 하나만 선다(정의역 확장은 없는 곳만)', async () => {
  const fx = await 입장fx();
  const base = await admitWorkStateProposal({
    ...fx, turnRef: { sessionId: 's2', turnSeq: 3 },
    inputText: '확인은 오전 9시와 오후 5시로 하자.',
    reply: '그렇게 할게요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: '확인은 오전 9시와 오후 5시로 하자.' }] },
  });
  const result = await admitWorkStateProposal({
    ...fx, workRef: base.workRef,
    inputText: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.',
    reply: '바꿨어요.',
    proposal: {
      changes: [{
        type: 'agreement_superseded',
        utteranceQuote: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.',
        targetQuote: '확인은 오전 9시와 오후 5시로 하자.',
      }],
    },
  });
  assert.equal(result.accepted, true, String(result.reason));
  const types = (await fx.store.load()).map((e) => e.type);
  assert.deepEqual(types, ['agreement_set', 'agreement_superseded'], `소급이 원장 대상까지 만들었다: ${types}`);
});

test('② 안전 불변 — 원문에 없는 인용은 여전히 거절 · 미정 해소는 여전히 대상이 필요하다', async () => {
  const fx = await 입장fx();
  const 지어냄 = await admitWorkStateProposal({
    ...fx,
    inputText: '오전 8시 30분으로 바꾸자.',
    reply: '네.',
    proposal: { changes: [{ type: 'agreement_superseded', utteranceQuote: '사용자가 한 적 없는 말', targetQuote: '아무거나' }] },
  });
  assert.equal(지어냄.accepted, false, '**지어낸 인용이 사건이 됐다** — 원문 대조가 뚫렸다');
  assert.equal(지어냄.reason, 'utterance_quote_mismatch');
  const 미정 = await admitWorkStateProposal({
    ...fx,
    inputText: '보관 기간은 3개월로 하자.',
    reply: '네.',
    provisionalWorkRef: await fx.store.issueWorkRef({ turnRef: fx.turnRef, workOrdinal: 1 }),
    proposal: { changes: [{ type: 'question_resolved', utteranceQuote: '보관 기간은 3개월로 하자.', targetQuote: '보관 기간은 얼마로 할까요?' }] },
  });
  assert.equal(미정.accepted, false, '열린 적 없는 미정이 해소로 통과했다 — 대상 요구가 풀렸다');
});

test('② 재시작 승계 — 소급으로 선 사건들이 재적재 후 같은 현재값을 투영한다', async () => {
  const fx = await 입장fx();
  const 자리 = await admitWorkStateProposal({
    ...fx, turnRef: { sessionId: 's2', turnSeq: 5 },
    inputText: '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.',
    reply: '초안만 만들게요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: '답장을 자동으로 보내지는 말고 초안만 만들어 줘야 해.' }] },
  });
  await admitWorkStateProposal({
    ...fx, workRef: 자리.workRef,
    inputText: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.',
    reply: '바꿨어요.',
    priorUtterances: [
      { text: '처음에는 오전 9시와 오후 5시에 확인하는 걸로 생각했어.', turnRef: { sessionId: 's2', turnSeq: 3 } },
    ],
    proposal: {
      changes: [{
        type: 'agreement_superseded',
        utteranceQuote: '오전 9시는 너무 늦다. 오전 8시 30분으로 바꾸자.',
        targetQuote: '오전 9시와 오후 5시에 확인',
      }],
    },
  });
  // 재시작 = 같은 자리에서 store 를 새로 연다.
  const 다시 = new WorkEventStore(fx.store.dir);
  const 재적재 = await 다시.load();
  assert.equal(재적재.length, 2, '재시작 후 사건이 사라졌다');
  const 투영 = projectWorkEvents(재적재);
  const 살아있는 = 재적재.filter((e) => ['active', 'open'].includes(투영.byEvent[e.eventId]?.status));
  assert.equal(살아있는.filter((e) => /8시 30분/.test(e.evidence.statement ?? '')).length, 1,
    '재시작 후 현재값이 새 값이 아니다');
  assert.equal(살아있는.filter((e) => /9시와 오후 5시에 확인/.test(e.evidence.statement ?? '')).length, 0,
    '재시작 후 옛 값이 부활했다');
});
