// **합이 암산이 아니라 기계 사실에서 나온다** (매듭 ② 구조 층 봉인 · 2026-08-08).
//
// 회차 G 실측(evidence/step3-r-knot-2026-08-08/round-G):
//   · ⑤ 세 회차 전부 합산이 모델 암산(캡슐 호출 0) — 회차 E 는 어느 파일 조합도 아닌
//     2,270,000 을 지어냈다. ⑫ R1·R3 은 부분합에 "총" 을 명명했다.
//   · ⑫ R2 는 캡슐로 갔는데 `readRes.text` 짐작으로 죽었다(1차 TypeError · 2차 `|| ""` 로
//     네 파일을 전부 읽고도 "합계 계산 불가"를 실물에 적음). 반환 모양은 스키마에 이미
//     적혀 있었다 — 문장을 더 얹는 길은 같은 방법 다섯 번째라 막혔다(오너 지시).
//
// 구조 층 둘: ① 읽기가 CSV 숫자 열 합계를 표 사실로 동봉한다(요약줄 + result.table).
//            ② 캡슐 t5.call 반환이 result 의 밭을 위층에도 편다 — 자연 짐작이 사실에 닿는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeCapsuleTool } from '../src/runtime/capsule.js';

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 'knot2-'));
  await mkdir(dir, { recursive: true });
  return { dir, 손: makeLocalFileTool({ roots: [dir], homeDir: dir, dataDir: dir }) };
}

test('CSV 읽기가 숫자 열 합계를 표 사실로 동봉한다 — 요약줄과 result.table 둘 다', async () => {
  const { dir, 손 } = await 무대();
  try {
    await writeFile(join(dir, '정산.csv'), '거래처,금액\n가나상사,1350000\n다라유통,760000\n');
    const r = await 손.handler({ action: 'read', path: '정산.csv' }, {});
    assert.deepEqual(r.result.table, { rows: 2, columns: ['거래처', '금액'], sums: { 금액: 2110000 } });
    assert.match(String(r.userSafeSummary), /표 2행 · 열: 거래처·금액 · 합계 금액 2,110,000/,
      '합계·열 목록이 요약줄에 없다 — 합계는 암산의 재료(매듭 ②), 열 목록은 지어낸 구분의 반대 재료(X1)');
    assert.ok(!('거래처' in r.result.table.sums), '문자 열이 합계로 세어졌다 — 지어낸 사실이다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('목록의 CSV 에도 표 합계가 동봉되고 줄에 실린다 — 멈춘 자리에 숫자가 있다 (⑬ 표적 수리)', async () => {
  const { dir, 손 } = await 무대();
  try {
    await writeFile(join(dir, '정산.csv'), '거래처,금액\n마바상회,520000\n');
    await writeFile(join(dir, '메모.md'), '점심 약속\n');
    const r = await 손.handler({ action: 'list', path: '.' }, {});
    const csv = r.result.items.find((i) => i.name === '정산.csv');
    assert.deepEqual(csv?.table, { rows: 1, columns: ['거래처', '금액'], sums: { 금액: 520000 } },
      '목록의 CSV 에 표 사실이 없다 — 멈춘 자리(목록)에 이름·시각뿐이면 일반론이 쉽다(E4 vs X1 실측)');
    assert.equal(r.result.items.find((i) => i.name === '메모.md')?.table, undefined, 'CSV 아닌 항목에 표가 붙었다');
    const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
    const 글 = compactResult(r.result);
    assert.match(글, /정산\.csv.*\(표 1행 · 열: 거래처·금액 · 합계 금액 520,000\)/,
      `목록 줄에 표 사실이 안 실렸다: ${글}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('반대시험: 애매한 표는 아예 안 낸다 — 틀린 합계는 없는 합계보다 나쁘다', async () => {
  const { dir, 손 } = await 무대();
  try {
    const 애매한것들 = [
      ['들쭉.csv', '거래처,금액\n가나,100,200\n'],          // 열 수 불일치(천 단위 쉼표 오염)
      ['따옴표.csv', '거래처,금액\n"가나, 상사",100\n'],     // 따옴표 필드 — 단순한 자의 밖
      ['숫자머리.csv', '2026,08\n가나,100\n'],              // 머리줄이 숫자 — 표가 아니다
      ['글만.csv', '거래처,메모\n가나,좋음\n'],              // 숫자 열이 없다
      ['겹열.csv', '금액,금액\n100,200\n'],                 // 같은 이름 열 둘 — 덮어쓴 합계는 지어낸 사실이다
    ];
    for (const [이름, 내용] of 애매한것들) {
      await writeFile(join(dir, 이름), 내용);
      const r = await 손.handler({ action: 'read', path: 이름 }, {});
      assert.equal(r.result.table, undefined, `${이름}: 애매한 표에 합계를 냈다 — ${JSON.stringify(r.result.table)}`);
    }
    // CSV 가 아니면 같은 내용이어도 안 낸다(표 사실은 CSV 의 것이다).
    await writeFile(join(dir, '메모.txt'), '거래처,금액\n가나,100\n');
    const r = await 손.handler({ action: 'read', path: '메모.txt' }, {});
    assert.equal(r.result.table, undefined, 'CSV 아닌 파일에 표 사실을 냈다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('캡슐 t5.call 반환 — 자연 짐작(r.text)과 정본(r.result.text)이 같은 사실을 본다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knot2-cap-'));
  try {
    const rec = {
      failureState: 'none',
      userSafeSummary: '정산.csv 을(를) 읽었어요.',
      result: { path: join(dir, '정산.csv'), text: '거래처,금액\n가나,100\n', bytes: 24, summary: '속임수' },
    };
    const capsule = makeCapsuleTool({ cwd: dir, tools: { run: async () => rec }, selfState: {} });
    const r = await capsule.handler({
      code: `
        const 읽음 = await t5.call('local.file', { action: 'read', path: '정산.csv' });
        console.log(JSON.stringify({ 위층: 읽음.text ?? null, 정본: 읽음.result?.text ?? null, summary: 읽음.summary }));
      `,
    }, {});
    assert.ok(!r.blocked, `캡슐이 막혔다: ${r.userSafeSummary}`);
    const 출력 = JSON.parse(String(r.result.output).trim());
    assert.equal(출력.위층, '거래처,금액\n가나,100\n', '자연 짐작(r.text)이 사실에 안 닿는다 — 회차 G R2 의 그 병이다');
    assert.equal(출력.위층, 출력.정본, '두 표기가 다른 사실을 본다 — 두 진실이다');
    assert.equal(출력.summary, '정산.csv 을(를) 읽었어요.', '정본 키(summary)가 result 의 밭에 덮였다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('반대시험: 실패 반환은 펴지 않는다 — {ok:false, error, next} 그대로', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knot2-cap-'));
  try {
    const rec = {
      failureState: 'user_visible_failure',
      userSafeSummary: '그 파일을 찾지 못했어요.',
      nextSafeAction: '이름을 알려 주세요.',
      result: { text: '남으면 안 되는 것' },
    };
    const capsule = makeCapsuleTool({ cwd: dir, tools: { run: async () => rec }, selfState: {} });
    const r = await capsule.handler({
      code: `
        const 읽음 = await t5.call('local.file', { action: 'read', path: '없는것.csv' });
        console.log(JSON.stringify({ ok: 읽음.ok, error: 읽음.error ?? null, 샌것: 읽음.text ?? null }));
      `,
    }, {});
    assert.ok(!r.blocked, `캡슐이 막혔다: ${r.userSafeSummary}`);
    const 출력 = JSON.parse(String(r.result.output).trim());
    assert.equal(출력.ok, false);
    assert.equal(출력.error, '그 파일을 찾지 못했어요.');
    assert.equal(출력.샌것, null, '실패 반환에 result 의 밭이 샜다 — 실패가 성공 모양을 입는다');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
