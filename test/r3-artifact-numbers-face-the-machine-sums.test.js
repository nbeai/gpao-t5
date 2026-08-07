// **말이 아니라 실물의 재료를 잰다 — 쓴 숫자가 기계 합과 대조된다** (⑫ 접근 전환 봉인 · 2026-08-08).
//
// 회차 I R1 실증: 이웃 합계·그물 되부름·이웃 이름 세 겹을 받고도 모델이 "총 매출"을
// 부분합으로 실물에 적었다. 출구 되부름은 answerOnly 라 실물을 못 고친다 — 그래서 실물이
// 생기는 쓰기 영수증에 숫자 대조 사실을 싣는다(PM 승인 방향 (b) · 되부름을 실물에 적용).
// 차단 아님(쓰기는 됐다) · 문구 가르침 아님(기계 대조) · 트리거는 원장 사실(세 성질 유지).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 맥락 = (폴더) => [{
  폴더,
  안읽은: ['정산내역.csv'],
  빠진합: { '정산내역.csv': { 금액: 310000 } },
  전체합: { 금액: 2430000 },
  부분합: { '매출정산.csv': { 금액: 2120000 } },
}];

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 'r3-실물대조-'));
  await writeFile(join(dir, '매출정산.csv'), '거래처,금액\n가나상사,980000\n다라유통,1140000\n');
  await writeFile(join(dir, '정산내역.csv'), '거래처,금액\n마바상회,310000\n');
  return { dir, 손: makeLocalFileTool({ roots: [dir], homeDir: dir, dataDir: dir }) };
}

test('부분합에 총을 명명한 실물은 영수증이 대조 사실을 싣는다', async () => {
  const { dir, 손 } = await 무대();
  try {
    const r = await 손.handler(
      { action: 'write', path: '요약.txt', text: '이번 달 총 매출: 2,120,000원' },
      { 표맥락: 맥락(dir) },
    );
    assert.match(String(r.userSafeSummary), /숫자 대조: .*금액 전체 합 2,430,000이 쓴 숫자에 없음 · 빠짐: 정산내역\.csv\(금액 310,000\)/,
      `대조 사실이 영수증에 없다: ${r.userSafeSummary}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('반대시험: 전체 합을 쓴 실물 · 빠진 파일을 지명한 실물 · 표 맥락 없는 쓰기에는 안 붙는다', async () => {
  const { dir, 손 } = await 무대();
  try {
    const 경우들 = [
      [{ action: 'write', path: 'a.txt', text: '이번 달 총 매출: 2,430,000원' }, { 표맥락: 맥락(dir) }],
      [{ action: 'write', path: 'b.txt', text: '매출정산 기준 합계 2,120,000원 — 정산내역.csv 는 포함 안 함' }, { 표맥락: 맥락(dir) }],
      [{ action: 'write', path: 'c.txt', text: '이번 달 총 매출: 2,120,000원' }, {}],
      [{ action: 'write', path: 'd.txt', text: '점심 약속 총정리' }, { 표맥락: 맥락(dir) }],
      // 글의 숫자가 이 폴더의 합이 아니면 소음을 만들지 않는다.
      [{ action: 'write', path: 'e.txt', text: '작년 총 매출: 99,000,000원' }, { 표맥락: 맥락(dir) }],
    ];
    for (const [args, 문맥] of 경우들) {
      const r = await 손.handler(args, 문맥);
      assert.doesNotMatch(String(r.userSafeSummary), /숫자 대조/,
        `${args.path}: 정직한/무관한 실물에 대조가 붙었다 — 과잉 개입: ${r.userSafeSummary}`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('관통: 부분합 실물 → 영수증 대조 사실 → 모델이 같은 턴에 실물을 다시 쓴다', async () => {
  const { dir, 손 } = await 무대();
  try {
    let 단계 = 0;
    const model = {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
        const 문맥 = JSON.stringify(tc?.turnExchange ?? []);
        if (opts.tools?.length && 단계 === 0) {
          단계 = 1;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '매출정산.csv' } }] };
        }
        if (opts.tools?.length && 단계 === 1) {
          단계 = 2;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '요약.txt', text: '이번 달 총 매출: 2,120,000원' } }] };
        }
        if (opts.tools?.length && 단계 === 2 && /숫자 대조/.test(문맥)) {
          단계 = 3;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '요약.txt', text: '이번 달 총 매출: 2,430,000원 (매출정산 2,120,000 + 정산내역.csv 310,000)' } }] };
        }
        return { text: '바탕 요약을 정리했어 — 총 2,430,000원이야. 정산내역.csv 까지 포함했어.' };
      },
    };
    const r = await runTurn({ text: '이번 달 정산 합계 정리해서 파일로 저장해줘' }, {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      model,
      tools: demoTools({ localFile: 손 }),
    });
    assert.equal(r.kind, 'reply');
    assert.equal(단계, 3, '대조 사실이 모델 문맥(turnExchange)에 안 닿았다 — 다시 쓸 기회가 없었다');
    assert.equal(await readFile(join(dir, '요약.txt'), 'utf8'),
      '이번 달 총 매출: 2,430,000원 (매출정산 2,120,000 + 정산내역.csv 310,000)',
      '실물이 기계 합으로 다시 쓰이지 않았다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
