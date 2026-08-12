// P-OP 결함 가족 반대시험 — 코덱스 목적형 멀티턴 탐색(2026-08-09)이 잡은 A·B·C 가족.
//
// 근거(전량 커밋):
//   · 탐색 원본: /Users/jyp/Developer/T5-Multiturn-Exploration-2026-08-09/RESULTS-2026-08-09-ko.md
//   · 현재 HEAD 재현: docs/03-verification/evidence/p-op-defect-family-2026-08-09/
//     (S1·S4 · GPT-5.1 실호출 · 격리 HOME · 턴별 원장 덤프)
//
// 층 분리 판정(HEAD 6c2273e 재현 실측):
//   · WorkEvent 원장: **비어 있다**(S1 12턴·S4 10턴 모두 사건 0 · 정산 되부름 열림 0).
//     저장이 오염된 것이 아니라 **저장 자체가 서지 않았다.**
//   · 오염은 최종 종합에서 난다 — 모델 제안(시트 열·운영 규칙)이 transcript 를 타고
//     사용자 확정과 구별 없이 최종 브리핑에 실렸다(S1 12턴 실측).
//   · S4 절대 실패의 기계 원인: 격리 HOME(임시 폴더 안)에서 **명시된 루트 안 쓰기까지**
//     보호가 '운영체제와 앱이 쓰는 자리'로 막았다(6턴 write 3회 전부 blocked).
//
// 이 파일의 규율:
//   · 1단계(49f8645)에서 초록 5는 봉인, 빨강 5는 todo 로 기록했다.
//   · 2단계 수리(입장 물음표 거부 · F7.3 홈파생 제외 · 원장 밖 파일 이름 그물 ·
//     되부름 뒤 절대 재검증)가 서면서 todo 를 걷어 전부 정식 봉인이다.
//   · 정규식 문구 패치·대본 맞춤 분기 없음 — 전부 기존 경계(admission·projection·
//     출구 그물·working-state)의 기계 사실로 잰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { WorkEventStore } from '../src/surface/work-event-store.js';
import { admitWorkStateProposal } from '../src/surface/work-state-admission.js';
import { projectWorkState } from '../src/kernel/l1-intent/work-state.js';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';
import { deriveWorkingState } from '../src/kernel/l0-evidence/working-state.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const run = promisify(execFile);

async function 새원장() {
  const dir = await mkdtemp(join(tmpdir(), 'p-op-ledger-'));
  return new WorkEventStore(dir);
}

const 읽기영수증 = (name, extra = {}) => ({
  intended: 'local.file 실행',
  failureState: 'none',
  userSafeSummary: `${name} 을(를) 읽었어요.`,
  actualCall: { tool: 'local.file', args: { action: 'read', path: name } },
  result: { path: `/room/GPAO-T5/${name}`, ...extra },
});

// ── A. 모델 제안의 상태 승격 ────────────────────────────────────────────────

// ① 모델이 낸 두 선택지 중 사용자가 고르지 않은 것은 상태가 되지 않는다.
//    (입장 경계 봉인 — HEAD 초록. 모델 답에만 있는 문장은 사용자 원문 대조에서 떨어진다.)
test('A-① 모델 제안 문장은 사용자 원문에 없으면 입장하지 못한다 — 최종 상태 미정 유지', async () => {
  const store = await 새원장();
  const turnRef = { sessionId: 's-a1', turnSeq: 1 };
  const provisional = await store.issueWorkRef({ turnRef, workOrdinal: 0 });
  const admitted = await admitWorkStateProposal({
    store,
    turnRef,
    principalRef: 'owner',
    provisionalWorkRef: provisional,
    inputText: '좋아, 계속 진행하자.',
    reply: '단순 변심은 일반 문의로 처리하는 것으로 이미 정해졌습니다.',
    proposal: {
      changes: [{ type: 'agreement_set', utteranceQuote: '단순 변심은 일반 문의로 처리' }],
    },
  });
  assert.equal(admitted.accepted, false, '모델이 만든 문장이 사용자 확정으로 입장했다');
  assert.equal(admitted.reason, 'utterance_quote_mismatch');
  const state = projectWorkState(await store.load(), { principalRef: 'owner', projectRef: provisional });
  assert.equal(state.activeAgreements.length, 0, '사용자가 고르지 않은 것이 현재 합의가 됐다');
});

// ② 거짓 전제는 사건을 만들지 않는다 — **문장 모양이 아니라 원장 대조로** 잰다.
//
//    1차 수리는 "물음표로 끝나는 인용은 합의 증거가 아니다"였다. 그건 문구 층 판정이고
//    (평서문 거짓 전제는 그냥 통과한다) PM 이 그 방법을 물렸다. 실측으로 대체한다:
//    거짓 전제 넷을 **실제 모델**(GPT-5.1)에게 `work.state` 로 물었을 때 나온 제안 원본이
//    `docs/03-verification/evidence/p-op-identity-2026-08-10/false-premise-probe.json` 이고,
//    그 제안들을 실제 경계에 통과시켜 **사건 0**을 잰다. 판정 근거는 두 기계 사실뿐이다:
//      · 사용자가 하지 않은 말은 이 대화의 어느 발화에도 없다(utterance_quote_mismatch)
//      · 모델이 자기 답 문장을 대상으로 지목하면 원장에 그런 현재값이 없다(target_not_current)
test('A-② 거짓 전제는 원장 대조에서 떨어진다 — 사건 0 (실제 모델 제안 원본)', async () => {
  const probe = JSON.parse(await readFile(
    new URL('../docs/03-verification/evidence/p-op-identity-2026-08-10/false-premise-probe.json', import.meta.url),
    'utf8',
  ));
  const 거짓전제 = probe.probes.filter((p) => p.id.startsWith('declarative') || p.id === 'question');
  assert.equal(거짓전제.length, 4, '거짓 전제 표본이 줄었다 — 원본이 바뀌었는지 확인한다');
  for (const p of 거짓전제) {
    const store = await 새원장();
    // 앞선 확정들이 원장에 서 있는 상태에서 잰다(빈 원장은 아무것도 증명하지 않는다).
    const 세운것 = [
      '문의는 스마트스토어랑 인스타 DM 두 곳에서 들어와.',
      '급한 문의는 배송 지연, 오배송, 환불 요청으로 보자.',
    ];
    let workRef = null;
    const priorUtterances = [];
    for (const [i, 문장] of 세운것.entries()) {
      const turnRef = { sessionId: 's-a2', turnSeq: i + 1 };
      priorUtterances.push({ text: 문장, turnRef });
      const r = await admitWorkStateProposal({
        store, turnRef, principalRef: 'owner', workRef,
        provisionalWorkRef: workRef ?? await store.issueWorkRef({ turnRef, workOrdinal: 0 }),
        inputText: 문장, reply: '네.',
        proposal: { changes: [{ type: 'agreement_set', utteranceQuote: 문장 }] },
      });
      workRef = r.workRef ?? workRef;
    }
    const 기준 = (await store.load()).length;
    if (!p.proposal?.changes?.length) continue; // 모델이 noChange 를 냈다 — 그 자체로 사건 0
    await admitWorkStateProposal({
      store, turnRef: { sessionId: 's-a2', turnSeq: 9 }, principalRef: 'owner', workRef,
      priorUtterances,
      inputText: p.text,
      reply: '단순 변심은 아직 급한 문의에 포함하지 않았어요. 지금 정해 주세요.',
      proposal: p.proposal,
    });
    assert.equal((await store.load()).length, 기준,
      `거짓 전제가 사건이 됐다(${p.id}): ${p.text}`);
  }
});

// ②′ 앞 턴에 사용자가 실제로 한 말은 **그 턴의 신분으로** 원장에 남는다.
//     라이브 실측(2026-08-10 · S1 t7): 모델이 t2~t5 의 확정 넷을 뒤늦게 제출했는데 전부
//     `utterance_quote_mismatch` 로 떨어졌다 — 사용자가 한 말인데 원장에 못 남았다.
test("②′ 앞 턴 사용자 원문 인용은 그 턴의 TurnRef 로 남는다", async () => {
  const store = await 새원장();
  const 앞말 = '급한 문의는 배송 지연, 오배송, 환불 요청으로 보자.';
  const 앞턴 = { sessionId: 's-a2p', turnSeq: 3 };
  const 이번턴 = { sessionId: 's-a2p', turnSeq: 7 };
  const admitted = await admitWorkStateProposal({
    store, turnRef: 이번턴, principalRef: 'owner',
    provisionalWorkRef: await store.issueWorkRef({ turnRef: 이번턴, workOrdinal: 0 }),
    priorUtterances: [{ text: 앞말, turnRef: 앞턴 }],
    inputText: '참, 다음 달 촬영 콘셉트는 여름 바다로 할까 생각 중이야.',
    reply: '촬영은 별개로 두고 정리했어요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: 앞말 }] },
  });
  assert.equal(admitted.accepted, true, `사용자가 한 말이 원장에 못 남았다: ${admitted.reason}`);
  const record = (await store.load()).find((r) => r.evidence?.statement === 앞말);
  assert.deepEqual(record.evidence.turnRef, 앞턴,
    '증거의 신분이 제출한 턴으로 적혔다 — 그 말이 있었던 턴이어야 한다');
});

// ②″ 같은 문장의 재등재는 부활이다 — 철회·대체된 값이 다시 현재가 되지 않는다.
test('②″ 이미 사건이 된 문장은 다시 합의로 서지 않는다', async () => {
  const store = await 새원장();
  const 뺀것 = '문의는 스마트스토어랑 인스타 DM 두 곳에서 들어와.';
  const t2 = { sessionId: 's-a2r', turnSeq: 2 };
  const first = await admitWorkStateProposal({
    store, turnRef: t2, principalRef: 'owner',
    provisionalWorkRef: await store.issueWorkRef({ turnRef: t2, workOrdinal: 0 }),
    inputText: 뺀것, reply: '네.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: 뺀것 }] },
  });
  const t10 = { sessionId: 's-a2r', turnSeq: 10 };
  const 빼자 = '인스타 DM은 이번 운영에서 빼고 스마트스토어만 먼저 하자.';
  await admitWorkStateProposal({
    store, turnRef: t10, principalRef: 'owner', workRef: first.workRef,
    inputText: 빼자, reply: '네, 스마트스토어만 볼게요.',
    proposal: { changes: [{ type: 'agreement_superseded', utteranceQuote: 빼자, targetQuote: 뺀것 }] },
  });
  const 다시 = await admitWorkStateProposal({
    store, turnRef: { sessionId: 's-a2r', turnSeq: 12 }, principalRef: 'owner', workRef: first.workRef,
    priorUtterances: [{ text: 뺀것, turnRef: t2 }],
    inputText: '정리해줘.', reply: '정리했어요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: 뺀것 }] },
  });
  assert.equal(다시.accepted, false, '대체된 값이 같은 문장으로 다시 현재가 됐다');
  assert.equal(다시.reason, 'already_recorded');
  const state = projectWorkState(await store.load(), { principalRef: 'owner', projectRef: first.workRef });
  assert.deepEqual(state.activeAgreements.map((a) => a.statement), [빼자],
    '취소된 값이 부활했다');
});

// ③ 이후 사용자가 실제로 고르면 같은 WorkRef 에서 현재값이 갱신된다. (HEAD 초록)
test('A-③ 사용자 확정은 같은 WorkRef 의 현재값을 갱신한다', async () => {
  const store = await 새원장();
  const turnRef = { sessionId: 's-a3', turnSeq: 1 };
  const provisional = await store.issueWorkRef({ turnRef, workOrdinal: 0 });
  const 처음 = '급한 문의는 배송 지연, 오배송, 환불 요청으로 보자.';
  const first = await admitWorkStateProposal({
    store,
    turnRef,
    principalRef: 'owner',
    provisionalWorkRef: provisional,
    inputText: 처음,
    reply: '네, 그렇게 볼게요.',
    proposal: { changes: [{ type: 'agreement_set', utteranceQuote: 처음 }] },
  });
  assert.equal(first.accepted, true);
  const 확정 = '단순 변심은 일반 문의로 두자.';
  const second = await admitWorkStateProposal({
    store,
    turnRef: { sessionId: 's-a3', turnSeq: 2 },
    principalRef: 'owner',
    workRef: first.workRef,
    inputText: 확정,
    reply: '네, 그렇게 기록했어요.',
    proposal: {
      changes: [{ type: 'agreement_superseded', utteranceQuote: 확정, targetQuote: 처음 }],
    },
  });
  assert.equal(second.accepted, true, '사용자 확정이 입장하지 못했다');
  assert.equal(second.workRef, first.workRef, '같은 작업이 다른 WorkRef 로 갈라졌다');
  const state = projectWorkState(await store.load(), { principalRef: 'owner', projectRef: first.workRef });
  assert.deepEqual(state.activeAgreements.map((a) => a.statement), [확정],
    '최신 확정이 현재값이 되지 않았다(옛값이 살아 있거나 둘 다 남았다)');
});

// ── B. 보류의 수명과 파일 실행 ─────────────────────────────────────────────

// ④ 임시 보류("아직 바꾸지 마") 뒤의 명시 요청은 실행된다 — 커널이 write 를 막지 않는다.
//    (HEAD 초록 — 턴 층에는 보류를 영구화하는 구조가 없다. S4 라이브의 미실행은
//     모델 판단 + 아래 ④′ 보호 오탐의 결과였다.)
test('B-④ 임시 보류 뒤의 명시 생성 요청은 같은 턴에 실행된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p-op-b4-'));
  await writeFile(join(dir, 'A사_7월_최종.csv'), '항목,금액\n판매,420000\n');
  let 골랐나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (opts.tools?.some((t) => t.name === 'local.file') && !골랐나) {
        골랐나 = true;
        return {
          text: '',
          toolCalls: [{
            name: 'local.file',
            args: {
              action: 'write',
              path: '7월_통합_결과.csv',
              text: '거래처,최종매출,조정사유\nA사,390000,환불 30000 반영\n',
              source: 'A사_7월_최종.csv',
            },
          }],
        };
      }
      return '7월_통합_결과.csv 파일을 만들었어요.';
    },
  };
  const r = await runTurn({ text: '원본은 두고 별도 통합 결과 파일을 CSV로 만들어줘.' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
    recentTurns: [
      { role: 'user', text: '7월 정산 파일 확인해줘. 아직 파일은 바꾸지 마.' },
      { role: 'assistant', text: '확인했어요. 아직 아무것도 바꾸지 않았어요.' },
    ],
  });
  assert.equal(r.kind, 'reply');
  const files = await readdir(dir);
  assert.ok(files.includes('7월_통합_결과.csv'),
    '옛 임시 보류가 최신 명시 요청을 눌렀다 — 실물이 없다');
});

// ⑤ 파생 결과를 만들어도 원본은 그대로다. (HEAD 초록)
test('B-⑤ 파생 결과 생성 뒤 원본 내용 불변', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p-op-b5-'));
  const 원본내용 = '항목,금액\n판매,420000\n';
  await writeFile(join(dir, 'A사_7월_최종.csv'), 원본내용);
  let 골랐나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (opts.tools?.some((t) => t.name === 'local.file') && !골랐나) {
        골랐나 = true;
        return {
          text: '',
          toolCalls: [{
            name: 'local.file',
            args: { action: 'write', path: '결과.csv', text: '거래처,최종매출\nA사,390000\n', source: 'A사_7월_최종.csv' },
          }],
        };
      }
      return '결과.csv 를 만들었어요.';
    },
  };
  await runTurn({ text: '별도 결과 파일 만들어줘.' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.equal(await readFile(join(dir, 'A사_7월_최종.csv'), 'utf8'), 원본내용,
    '파생 결과를 만들며 원본이 바뀌었다');
});

// ④′ 격리 HOME(임시 폴더 안)에서도 **명시된 루트 안** 쓰기는 실행된다.
//     HEAD 빨강(기계 재현): HOME 이 임시 폴더 안에 서면 h('Library/LaunchAgents') 가
//     SCRATCH 항목 안에 들어가 F7.3 필터가 `/private$TMPDIR` 면제를 통째로 걷는다 —
//     그 순간 realpath 된 방 전체가 '/private/var'(SYSTEM_DIRS) 로 읽혀 **루트 안 쓰기까지**
//     '운영체제와 앱이 쓰는 자리'로 막힌다. S4 절대 실패(결과 파일 0개)의 기계 원인이며,
//     원본 보호 범위가 파생 결과물 생성 범위를 삼킨 자리다(수리 계약 B).
test('B-④′ 격리 HOME 에서도 명시된 루트 안 쓰기는 막히지 않는다', async () => {
  const script = `
    const { mkdtempSync, mkdirSync, realpathSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    (async () => {
      const room = realpathSync(mkdtempSync(join(tmpdir(), 'p-op-b4p-')));
      const home = join(room, 'home');
      const fileRoot = join(home, 'GPAO-T5');
      mkdirSync(fileRoot, { recursive: true });
      process.env.HOME = home;
      const { makeLocalFileTool } = await import(process.env.P_OP_LOCAL_FILE);
      const tool = makeLocalFileTool({ dataDir: join(room, 'state'), roots: [fileRoot], homeDir: home });
      const out = await tool.handler({ action: 'write', path: '결과.csv', text: '거래처,금액\\nA사,390000\\n' }, {});
      console.log(JSON.stringify(out ?? null));
    })().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
  `;
  const localFileUrl = new URL('../src/runtime/local-file.js', import.meta.url).href;
  const { stdout } = await run(process.execPath, ['-e', script], {
    env: { ...process.env, P_OP_LOCAL_FILE: localFileUrl },
  });
  const out = JSON.parse(stdout.trim());
  assert.notEqual(out?.blocked, true,
    `명시된 루트 안 쓰기가 막혔다: ${out?.userSafeSummary ?? ''}`);
});

// ── FILE 절대 게이트 ────────────────────────────────────────────────────────

// ⑥ 성공한 write Receipt 없이 "만들었다"는 사용자에게 가지 않는다.
//    HEAD 빨강(실측 · S4 6턴 원문 모양): 읽기 영수증이 있으면 확인된실행>0 이라 지나가고,
//    주장된 파일 이름은 `/` 가 없어 가리킨자리들 대조에도 안 걸린다.
test('FILE-⑥ 쓰기 영수증 0 인 파일 완료 주장은 출구에서 모델에게 돌아간다', () => {
  const receipts = [읽기영수증('A사_7월_최종.csv'), 읽기영수증('B사_7월_최종.csv')];
  const v = 완료주장검증({
    reply: '지금 기준으로 만든 통합 결과는 이렇게 정리돼 있어요. 결과 파일 이름: 7월_통합_정산.csv — A사는 환불을 차감해 390,000으로 반영했고, B사는 310,000으로 넣었습니다.',
    receipts,
    원장글: JSON.stringify([receipts, []]),
  });
  assert.equal(v.일치, false,
    '성공한 write Receipt 가 없는데 파일 완료 주장이 사용자에게 갔다');
  assert.equal(v.사용자에게, false);
});

// ⑦ 되부름 뒤에도 같은 거짓 완료를 반복하면 원장 기반 미완료 답으로 끝난다 —
//    원래 거짓 답으로 회귀하지 않는다.
//    HEAD 빨강(실측): 한 턴에 한 번만 되돌리는 계약(이미돌려줬나)이 두 번째의 같은 거짓을
//    그대로 사용자에게 보냈다("통합 결과 파일을 만들어 뒀어요" · 원장 실행 0).
//    게이트의 정의역은 수리 계약 그대로 **파일 산출물 존재**다: 이 턴의 완료 계약이
//    FILE(work.deliverable=file)인데 성공한 파일 변경 영수증이 0 — 일반 대화는 통제하지 않는다.
test('FILE-⑦ 보정 실패 시 거짓 답으로 회귀하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'p-op-f7-'));
  await writeFile(join(dir, 'a.txt'), 'x');
  let 되부름수 = 0;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (tc?.completionMismatch) 되부름수 += 1;
      return '통합 결과 파일을 만들어 뒀어요.'; // 되부름을 받고도 같은 거짓을 반복한다
    },
  };
  const r = await runTurn({ text: '결과 파일 만들어줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.ok(되부름수 >= 1, '출구 되부름이 아예 서지 않았다');
  assert.doesNotMatch(String(r.reply), /만들어 뒀어요/,
    '보정이 실패했는데 원래 거짓 답이 그대로 사용자에게 갔다 — 원장 기반 미완료 답이어야 한다');
});

// ── C. 근거 신분의 문자 그대로 인용 ────────────────────────────────────────

// ⑧ 최종 답의 파일명은 원장 문자열과 완전히 일치해야 한다.
//    HEAD 빨강(탐색 1회 관측 + 기계 확인): `B사_7월_최종.csv` → `B사_July_최종.csv` 처럼
//    원장에 없는 변형 이름이 대조 없이 사용자에게 간다(가리킨자리들은 `/` 낀 경로만 본다).
test('C-⑧ 원장에 없는 변형 파일명은 근거로 나가지 못한다', () => {
  const receipts = [읽기영수증('A사_7월_최종.csv'), 읽기영수증('B사_7월_최종.csv')];
  const v = 완료주장검증({
    reply: 'A사 근거 파일은 A사_7월_최종.csv 이고, B사 근거 파일은 B사_July_최종.csv 였습니다.',
    receipts,
    원장글: JSON.stringify([receipts, []]),
  });
  assert.equal(v.일치, false,
    '원장에 없는 파일 이름(B사_July_최종.csv)이 근거 신분으로 그대로 나갔다');
});

// ⑨ 다음 턴은 존재하지 않는 산출물을 이어받지 않는다. (HEAD 초록 —
//    운용 상태의 대상은 성공한 영수증에서만 나온다. 발화 주장만으로는 대상이 되지 않는다.)
test('⑨ 실물 없는 "만들었다" 발화는 다음 턴 운용 상태의 대상이 되지 않는다', async () => {
  const state = deriveWorkingState(null, {
    receipts: [{
      ...읽기영수증('A사_7월_최종.csv'),
      subject: { key: 'file:A사_7월_최종.csv', kind: 'file', label: 'A사_7월_최종.csv' },
    }],
  });
  const labels = (state.subjects ?? []).map((s) => s.label);
  assert.ok(labels.includes('A사_7월_최종.csv'), '실제로 다룬 원본이 대상에서 빠졌다');
  assert.ok(!labels.some((l) => String(l).includes('통합')),
    '만들어지지 않은 산출물이 다음 턴 대상으로 승계됐다');
  // WorkEvent 층에서도 같다 — 실행 완료 사건은 검증 통과가 있어야만 투영된다.
  const 투영 = projectWorkState([{
    eventId: 'we1.fake',
    ordinal: 1,
    type: 'execution_completed',
    workRef: 'wr1.a.b',
    subjectRef: 'sr1.a.b',
    scopeRef: { principalRef: 'owner', projectRef: 'wr1.a.b' },
    evidence: { verificationPassed: false },
  }], { principalRef: 'owner', projectRef: 'wr1.a.b' });
  assert.equal(투영.executionCompleted, false,
    '검증 없는 실행 완료가 진행 사실로 승계됐다');
});
