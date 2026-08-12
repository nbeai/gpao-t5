// **이웃의 합계도 손이 아는 사실이다 · 그물이 물었다는 사실이 남는다** (매듭 ①·② 봉인 · 2026-08-08).
//
// 회차 H 실측: ⑤ R1·R2 가 한 파일 합계를 한정 없이 답했다. 그물(0c8f287)이 물었는지는
// 회차 원본으로 가릴 수 없었다 — 최종 답만 실린다(계측 공백). 그리고 물었더라도 answerOnly
// 되돌림에는 손이 없어 모델이 마저 읽을 수 없다 — 재료가 없는 되부름이었다.
//
// 구조 층 둘: ① 읽기의 이웃 사실에 이웃 CSV 의 표 합계를 동봉(레버 ① 연장) — 첫 답을 짓는
// 순간과 되돌림 순간 모두 모든 숫자가 기계 사실로 손에 있다. ② 출구 그물이 물면 진단면에
// 사실이 남는다(exitNetDiagnostic) — 다음 회차부터 "물었는데 반복"과 "안 물음"이 갈린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 'r3-이웃합계-'));
  await writeFile(join(dir, '매출정산.csv'), '거래처,금액\n가나상사,980000\n다라유통,1140000\n');
  await writeFile(join(dir, '정산내역.csv'), '거래처,금액\n마바상회,310000\n');
  return { dir, 손: makeLocalFileTool({ roots: [dir], homeDir: dir, dataDir: dir }) };
}

test('CSV 읽기의 이웃 사실에 이웃 CSV 의 표 합계가 동봉된다 — 이름 배열은 순수하게 남는다', async () => {
  const { dir, 손 } = await 무대();
  try {
    const r = await 손.handler({ action: 'read', path: '매출정산.csv' }, {});
    assert.match(String(r.userSafeSummary), /정산내역\.csv\(표 1행 · 합계 금액 310,000\)/,
      `이웃 합계가 요약줄에 없다: ${r.userSafeSummary}`);
    assert.deepEqual(r.result.같은자리표, { '정산내역.csv': { rows: 1, columns: ['거래처', '금액'], sums: { 금액: 310000 } } });
    // ⚠ 출구 그물이 이름 일치로 잰다 — 같은자리파일은 순수 이름 배열로 동결.
    assert.deepEqual(r.result.같은자리파일, ['정산내역.csv']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('반대시험: CSV 아닌 파일을 읽을 때는 이웃 합계를 세지 않는다 — 합산 맥락에서만 돈다', async () => {
  const { dir, 손 } = await 무대();
  try {
    await writeFile(join(dir, '메모.txt'), '오늘 할 일\n');
    const r = await 손.handler({ action: 'read', path: '메모.txt' }, {});
    assert.equal(r.result.같은자리표, undefined, 'CSV 아닌 읽기에서 이웃 CSV 를 읽었다 — 비용이 맥락 없이 든다');
    assert.ok((r.result.같은자리파일 ?? []).includes('매출정산.csv'), '이웃 이름 사실은 그대로 남아야 한다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('관통: 반만 읽고 「합계」를 말하면 그물이 물고 — 진단이 남고 — 되돌림 재료에 이웃 합계가 있다', async () => {
  const { dir, 손 } = await 무대();
  try {
    let 읽었나 = false;
    let 받은사실 = null;
    const model = {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        if (tc?.completionMismatch) {
          받은사실 = tc.completionMismatch.사실;
          // 되돌림 문맥(turnExchange 요약줄)에 이웃 합계가 실려 있어야 마저 셈할 수 있다.
          const 문맥 = JSON.stringify(tc.turnExchange ?? []);
          return { text: 문맥.includes('합계 금액 310,000')
            ? '매출정산 2,120,000원에 정산내역 310,000원을 더해 이번 달은 2,430,000원이야.'
            : '재료가 없어 못 고쳤어.' };
        }
        if (opts.tools?.length && !읽었나) {
          읽었나 = true;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '매출정산.csv' } }] };
        }
        return { text: '이번 달 매출 합계는 2,120,000원이야.' };
      },
    };
    const r = await runTurn({ text: '이번 달 얼마 벌었지?' }, {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      model,
      tools: demoTools({ localFile: 손 }),
    });
    assert.equal(r.kind, 'reply');
    assert.ok(받은사실 && 받은사실.includes('정산내역.csv'),
      `그물이 안 물었거나 안 읽은 파일 이름이 사실에 없다: ${받은사실}`);
    assert.ok(r.exitNetDiagnostic?.사실?.includes('정산내역.csv'),
      '그물이 문 사실이 진단면에 안 남았다 — 회차 원본이 또 장님이 된다');
    assert.match(String(r.reply), /2,430,000/,
      `되돌림 재료(이웃 합계)로 완성된 답이 아니다: ${r.reply}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('캡슐 경유 부분읽기도 같은 자로 잰다 — innerReceipts 가 그물 정의역이다 (회차 J R1)', async () => {
  const { 완료주장검증 } = await import('../src/kernel/l2-plan/exit-verification.js');
  const 캡슐영수증 = {
    failureState: 'none',
    actualCall: { tool: 'local.capsule', args: {} },
    result: {
      output: '2120000\n',
      innerReceipts: [{
        failureState: 'none',
        actualCall: { tool: 'local.file', args: { action: 'read', path: '/방/2026-08 정산/2026-08 매출정산.csv' } },
        result: { path: '/방/2026-08 정산/2026-08 매출정산.csv', 같은자리파일: ['8월 정산내역.csv'] },
      }],
    },
  };
  const 검증 = 완료주장검증({
    reply: '이번 달 총 수입은 2,120,000원이야.',
    receipts: [캡슐영수증],
    원장글: JSON.stringify([캡슐영수증]),
  });
  assert.equal(검증.일치, false, '캡슐로 반만 읽고 한정 없는 "총"을 말했는데 그물이 지나쳤다 — J R1 의 그 갈래다');
  assert.ok(String(검증.모델에게).includes('8월 정산내역.csv'), `안 읽은 파일 이름이 사실에 없다: ${검증.모델에게}`);
  // 반대: 캡슐 안에서 다 읽었으면(안 읽은 이웃 없음) 안 문다.
  const 다읽음 = JSON.parse(JSON.stringify(캡슐영수증));
  다읽음.result.innerReceipts.push({
    failureState: 'none',
    actualCall: { tool: 'local.file', args: { action: 'read', path: '/방/2026-08 정산/8월 정산내역.csv' } },
    result: { path: '/방/2026-08 정산/8월 정산내역.csv', 같은자리파일: ['2026-08 매출정산.csv'] },
  });
  const 검증2 = 완료주장검증({ reply: '이번 달 총 수입은 2,430,000원이야.', receipts: [다읽음], 원장글: JSON.stringify([다읽음]) });
  assert.equal(검증2.일치, true, `캡슐 안에서 다 읽은 정직한 총합에 그물이 물었다 — 과잉 개입: ${검증2.모델에게}`);
});

test('읽고도 안 실은 파일은 사실로 되부른다 — 침묵만 실패다 (⑫ 회차 L 판정 · PM 지시)', async () => {
  const { 완료주장검증 } = await import('../src/kernel/l2-plan/exit-verification.js');
  const 읽기 = (파일, sums) => ({
    failureState: 'none',
    actualCall: { tool: 'local.file', args: { action: 'read', path: `/방/2026-08 정산/${파일}` } },
    result: { path: `/방/2026-08 정산/${파일}`, table: { rows: 1, columns: ['거래처', '금액'], sums }, 같은자리파일: [] },
  });
  const 영수증들 = [읽기('2026-08 매출정산.csv', { 금액: 2120000 }), 읽기('8월 정산내역.csv', { 금액: 310000 })];
  const 재다 = (reply) => 완료주장검증({ reply, receipts: 영수증들, 원장글: JSON.stringify(영수증들) });

  // 정방향: 읽은 표의 합을 인용하면서, 다른 읽은 표는 숫자도 이름도 안 실었다 → 사실 되부름.
  const 침묵 = 재다('이번 달 총매출은 2,120,000원이야.');
  assert.equal(침묵.일치, false, '읽고 안 실은 파일의 침묵이 그대로 나갔다 — L R1·R3 의 그 얼굴이다');
  assert.ok(String(침묵.모델에게).includes('8월 정산내역.csv(금액 310,000)'), `빠진 파일 사실이 없다: ${침묵.모델에게}`);

  // 반대시험 셋 — 편집 자유와 무관 턴을 지킨다.
  assert.equal(재다('매출 2,120,000원에 정산내역 310,000원까지 총 2,430,000원이야.').일치, true, '전부 실은 답에 물었다');
  assert.equal(재다('매출 기준 2,120,000원이야. 8월 정산내역.csv 는 별도라 뺐어.').일치, true, '제외를 이름으로 밝힌 답에 물었다 — 편집 자유 침해');
  assert.equal(재다('두 파일 다 읽어서 정리해 뒀어. 필요한 것 있으면 말해줘.').일치, true, '숫자 없는 답에 물었다');
  // 묶음 합(2,430,000)만 말해도 두 파일이 반영된 것이다 — 합산 정답 오탐 방지.
  assert.equal(재다('이번 달 전체는 2,430,000원이야.').일치, true, '묶음 합 정답에 물었다 — 오탐이다');
  // 무관한 숫자(날짜)만 있는 턴은 대상이 아니다.
  assert.equal(재다('2026-08 자료 두 개를 정리했어.').일치, true, '표 숫자를 안 쓴 턴에 물었다 — 개입이지 사실이 아니다');
});

test('반대시험: 그물이 안 문 턴에는 진단이 없다 — 계측이 사실을 지어내지 않는다', async () => {
  const { dir, 손 } = await 무대();
  try {
    let 읽었나 = false;
    const model = {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        if (opts.tools?.length && !읽었나) {
          읽었나 = true;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '매출정산.csv' } }] };
        }
        // 범위를 명시하고 안 읽은 파일을 지명한다 — 동결 기준의 통과형. 그물이 물면 안 된다.
        return { text: '매출정산.csv 기준으로는 2,120,000원이야. 정산내역.csv 는 아직 안 읽었어.' };
      },
    };
    const r = await runTurn({ text: '이번 달 얼마 벌었지?' }, {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      model,
      tools: demoTools({ localFile: 손 }),
    });
    assert.equal(r.exitNetDiagnostic, undefined,
      `정직한 부분 답에 그물이 물었다 — 과잉 개입이다: ${JSON.stringify(r.exitNetDiagnostic)}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
