// **이름을 부른 것은 반영이 아니다 — 반영은 숫자다** (6단계 ⑫ R1 수리 봉인 · 2026-08-09).
//
// R1 패배 원문(evidence/step6-compare-2026-08-09/R1-item12 · PM 라벨확정):
//   T5 는 네 표를 전부 읽고(read 4회) 실물에 네 파일을 전부 "기준"이라 적었다 — 그런데
//   달 비교의 합은 절반의 파일에서만 왔고(2,110,000/2,120,000), 읽은 표 전체의 기계 합
//   (2,630,000/2,430,000)은 실물 어디에도 없다. 기존 제외-그물은 호명(이름 부름)과 개별 합을
//   보고 지나갔다. Hermes 는 전체 합을 냈고, ⑫는 이 회차로 미달이 됐다.
//
// 수리(PM 주소록: 호명 기반 → 숫자 기반): 다 읽은 폴더(표 2개 이상)의 기계 합이 답·실물의
// 숫자 집합에 없는데 총·전체·합계를 명명하면, 그 사실을 되부른다 — 쓰기 영수증(손이 살아
// 있는 자리)과 출구 그물(답만 있는 자리) **같은 한 벌**이다. 차단 아님 · 문구는 기존 그물과
// 같은 셋(총·전체·합계)뿐 · 트리거는 원장 대조다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool, 표맥락에서 } from '../src/runtime/local-file.js';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// R1 고정물의 두 달 폴더 모양 그대로 — 표 둘씩, 이웃은 서로.
const 읽기 = (폴더, 파일, sums, 이웃) => ({
  failureState: 'none',
  actualCall: { tool: 'local.file', args: { action: 'read', path: `/방/${폴더}/${파일}` } },
  result: {
    path: `/방/${폴더}/${파일}`,
    table: { rows: 1, columns: ['거래처', '금액'], sums },
    같은자리파일: [이웃],
    같은자리표: { [이웃]: { rows: 1, columns: ['거래처', '금액'], sums: {} } },
  },
});
const R1영수증 = () => [
  읽기('2026-07 정산', '2026-07 매출정산.csv', { 금액: 2110000 }, '7월 정산내역.csv'),
  읽기('2026-07 정산', '7월 정산내역.csv', { 금액: 520000 }, '2026-07 매출정산.csv'),
  읽기('2026-08 정산', '2026-08 매출정산.csv', { 금액: 2120000 }, '8월 정산내역.csv'),
  읽기('2026-08 정산', '8월 정산내역.csv', { 금액: 310000 }, '2026-08 매출정산.csv'),
];
const 재다 = (reply) => 완료주장검증({ reply, receipts: R1영수증(), 원장글: JSON.stringify(R1영수증()) });

test('출구: R1 실물 모양 — 네 파일을 기준이라 부르며 합은 절반만 실으면 기계 합을 되부른다', async () => {
  const 검증 = 재다(
    '비교 요약을 저장해 뒀어요. 7월 매출합계 2,110,000원 · 8월 매출합계 2,120,000원(+10,000원). '
    + '기타 7월 520,000원 → 8월 310,000원. 전체 매출은 거의 비슷해요. '
    + '기준: 2026-07 매출정산.csv, 7월 정산내역.csv, 2026-08 매출정산.csv, 8월 정산내역.csv.',
  );
  assert.equal(검증.일치, false, 'R1 패배 모양이 그대로 지나갔다 — 호명이 여전히 반영으로 통한다');
  assert.ok(/2,630,000/.test(검증.모델에게) && /2,430,000/.test(검증.모델에게),
    `읽은 표들의 기계 합이 사실에 없다 — 모델이 고칠 재료가 없다: ${검증.모델에게}`);
});

test('출구 반대시험: 정직한 답들은 지나간다 — 전체 합 실림 · 명명 없음 · 미완료 밝힘 · 무관 숫자 · 표 하나', async () => {
  // 전체 합이 숫자로 실렸다(부분합 병기) — 통과.
  assert.equal(재다('7월 전체 2,630,000원(2,110,000+520,000) · 8월 전체 2,430,000원(2,120,000+310,000)이에요.').일치, true,
    '기계 합을 실은 답에 물었다 — 오탐이다');
  // 총·전체·합계 명명이 없다 — 파일별 숫자 나열은 편집 자유다(R3 실물의 통과형).
  // 한 폴더만 다룬 턴으로 잰다 — 두 폴더를 읽고 한 폴더를 통째로 침묵하는 것은 기존
  // 미반영 그물(회차 L 봉인)의 정당한 자리라 여기 반대시험의 대상이 아니다.
  const 칠월만 = R1영수증().slice(0, 2);
  assert.equal(완료주장검증({
    reply: '7월 매출정산은 2,110,000원, 7월 정산내역은 520,000원이에요.',
    receipts: 칠월만, 원장글: JSON.stringify(칠월만),
  }).일치, true, '명명 없는 파일별 나열에 물었다 — 과잉 개입');
  // 미완료를 밝혔다 — 정직한 중간 보고를 거짓으로 몰지 않는다(같은 한 벌: 미완료를밝혔나).
  assert.equal(완료주장검증({
    reply: '합계는 아직 못 냈어요. 지금까지 읽은 값은 2,110,000원과 520,000원이에요.',
    receipts: 칠월만, 원장글: JSON.stringify(칠월만),
  }).일치, true, '미완료를 밝힌 답에 물었다');
  // 이 폴더 숫자를 안 썼다 — 소음 금지.
  assert.equal(재다('전체 일정은 2026-08 기준으로 정리했어요.').일치, true, '무관한 숫자 턴에 물었다');
  // 표 하나뿐인 폴더 — 그 파일 합이 곧 전체라 공백이 없다(이웃 없음 · 반만읽기 그물과도 무관).
  const 하나 = [{
    failureState: 'none',
    actualCall: { tool: 'local.file', args: { action: 'read', path: '/방/보관/장부.csv' } },
    result: { path: '/방/보관/장부.csv', table: { rows: 1, columns: ['항목', '금액'], sums: { 금액: 410000 } }, 같은자리파일: [] },
  }];
  assert.equal(완료주장검증({
    reply: '보관 폴더 합계는 410,000원이에요.', receipts: 하나, 원장글: JSON.stringify(하나),
  }).일치, true, '표 하나 폴더에 물었다 — 공백 없는 자리다');
});

test('표맥락에서: 다 읽은 폴더(표 2+)도 전체 합과 함께 낸다 — 표 하나 폴더는 안 낸다', () => {
  const 맥락 = 표맥락에서(R1영수증());
  assert.equal(맥락.length, 2, `두 달 폴더가 다 나와야 한다: ${JSON.stringify(맥락)}`);
  const 칠월 = 맥락.find((f) => f.폴더.endsWith('2026-07 정산'));
  assert.deepEqual(칠월.안읽은, []);
  assert.deepEqual(칠월.전체합, { 금액: 2630000 }, '다 읽은 폴더의 전체 합이 기계로 안 나온다');
  assert.equal(표맥락에서([읽기('보관', '장부.csv', { 금액: 410000 }, '메모.md')]), undefined,
    '표 하나 폴더가 맥락에 나왔다 — 소음이다');
});

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 'r9-숫자반영-'));
  await mkdir(join(dir, '월별'), { recursive: true });
  await writeFile(join(dir, '월별', 'a.csv'), '항목,금액\n하나,2110000\n');
  await writeFile(join(dir, '월별', 'b.csv'), '항목,금액\n둘,520000\n');
  return { dir, 손: makeLocalFileTool({ roots: [dir], homeDir: dir, dataDir: dir }) };
}

test('쓰기 영수증: 다 읽은 폴더의 합이 빠진 실물에 숫자 대조 사실이 붙는다 — 호명은 통과가 아니다', async () => {
  const { dir, 손 } = await 무대();
  try {
    const 맥락 = [{
      폴더: join(dir, '월별'), 안읽은: [], 빠진합: {},
      전체합: { 금액: 2630000 }, 부분합: { 'a.csv': { 금액: 2110000 }, 'b.csv': { 금액: 520000 } },
    }];
    const r = await 손.handler(
      { action: 'write', path: '요약.txt', text: '합계 비교: a.csv 2,110,000원 · b.csv 520,000원 (기준: a.csv, b.csv)' },
      { 표맥락: 맥락 },
    );
    assert.match(String(r.userSafeSummary), /숫자 대조: .*읽은 표 2개 금액 전체 합 2,630,000이 쓴 숫자에 없음/,
      `다 읽은 폴더의 빠진 합이 영수증에 없다: ${r.userSafeSummary}`);
    assert.match(String(r.userSafeSummary), /근거로 부르면서 그 합은 안 실었다/,
      `호명-숫자 모순이 사실로 안 남았다: ${r.userSafeSummary}`);
    // 반대: 전체 합을 실으면 안 붙는다.
    const r2 = await 손.handler(
      { action: 'write', path: '요약2.txt', text: '합계 2,630,000원 (a.csv 2,110,000 + b.csv 520,000)' },
      { 표맥락: 맥락 },
    );
    assert.doesNotMatch(String(r2.userSafeSummary), /숫자 대조/, `정직한 전체 합에 대조가 붙었다: ${r2.userSafeSummary}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('관통: 다 읽고 절반 합 실물 → 영수증 대조 사실 → 모델이 같은 턴에 기계 합으로 다시 쓴다', async () => {
  const { dir, 손 } = await 무대();
  try {
    let 단계 = 0;
    const model = {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
        const 문맥 = JSON.stringify(tc?.turnExchange ?? []);
        if (opts.tools?.length && 단계 === 0) {
          단계 = 1;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '월별/a.csv' } }] };
        }
        if (opts.tools?.length && 단계 === 1) {
          단계 = 2;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '월별/b.csv' } }] };
        }
        if (opts.tools?.length && 단계 === 2) {
          단계 = 3;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '요약.txt', text: '이번 합계: 2,110,000원 (기준: a.csv, b.csv)' } }] };
        }
        if (opts.tools?.length && 단계 === 3 && /읽은 표 2개 금액 전체 합 2,630,000/.test(문맥)) {
          단계 = 4;
          return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '요약.txt', text: '이번 합계: 2,630,000원 (a.csv 2,110,000 + b.csv 520,000)' } }] };
        }
        return { text: '합계 2,630,000원으로 정리해 뒀어요 (a.csv 2,110,000 + b.csv 520,000).' };
      },
    };
    const r = await runTurn({ text: '월별 자료 합쳐서 요약 파일로 저장해줘' }, {
      env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
      model,
      tools: demoTools({ localFile: 손 }),
    });
    assert.equal(r.kind, 'reply');
    assert.equal(단계, 4, '대조 사실이 모델 문맥에 안 닿았다 — 실물을 고칠 기회가 없었다');
    assert.equal(await readFile(join(dir, '요약.txt'), 'utf8'),
      '이번 합계: 2,630,000원 (a.csv 2,110,000 + b.csv 520,000)',
      '실물이 기계 합으로 다시 쓰이지 않았다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
