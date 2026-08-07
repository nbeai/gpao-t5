// **폴더 이름 말고 그 안에 무엇이 들었는지를 준다.**
//
// PM 매듭 ①(2026-08-07). ⑫⑤가 "지난달"·"이번 달"을 못 고른다. 밟은 사실:
//
// ```
// 모델 입력   [지금] 2026년 8월 7일 금요일        ← 오늘은 안다
// locate 후보 path: "~/GPAO-T5/지난달 정산 파일"
//             why:  "이름이 맞아요 · 문서 3개 · 오늘 고쳤어요"
//             confidence: "high"
// ```
// **근거가 이름·개수·수정시각뿐이다.** 그 폴더가 실제로 몇 월 자료인지는 어디에도 없다.
// 그래서 *"지난달"* 이라는 말에 `지난달 정산 파일`(내용은 2026-06)이 이긴다 — 이름이 정확히
// 맞으니까. 오늘이 8월이면 지난달은 07 인데, 그걸 가를 재료가 없다.
//
// **날짜를 몰라서가 아니다.** 오늘은 프롬프트에 있다. 폴더가 몇 월인지를 모른다.
//
// 손은 이미 그 폴더를 열어 파일 목록을 갖고 있다(`counts` 를 세려면 읽어야 한다).
// **아는 것을 안 주고 있었을 뿐이다** — 오늘 하루 종일 나온 그 모양이다.
//
// ⛔ 낱말 규칙이 아니다. 파일·폴더 이름에서 **연-월을 읽어** 사실로 적는다.
//    못 읽으면 안 적는다(없는 기간을 지어내지 않는다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 자료기간 } from '../src/runtime/local-locate.js';

test('폴더 이름에 연-월이 있으면 그것을 읽는다', () => {
  assert.equal(자료기간('2026-07 정산', []), '2026-07');
  assert.equal(자료기간('2026-08 정산', []), '2026-08');
});

test('폴더 이름에 없으면 안에 든 파일에서 읽는다 — "지난달 정산 파일" 이 그 자리다', () => {
  assert.equal(자료기간('지난달 정산 파일',
    ['2026-06 매출정산.csv', '6월 정산내역.csv', '정산_0615.csv']), '2026-06');
});

test('여러 달이 섞이면 섞였다고 말한다 — 하나로 단정하지 않는다', () => {
  assert.equal(자료기간('정산모음', ['2026-06 매출.csv', '2026-07 매출.csv']), '2026-06~2026-07');
});

test('못 읽으면 안 적는다 — 없는 기간을 지어내지 않는다', () => {
  assert.equal(자료기간('내 자료', ['메모.txt', '계약서.pdf']), null);
});

test('연도 없이 "6월"만 있으면 안 적는다 — 어느 해인지 모른다', () => {
  assert.equal(자료기간('정산', ['6월 정산내역.csv']), null);
});

// ── 후보에 실제로 붙는다 ────────────────────────────────────────────────
// 감사 지적(2026-08-08 · 세 번째): 첫 판은 실기계 `~/GPAO-T5` 고정물에 기댔다 — 이 맥에서만
// 초록인 검사였다(빈 HOME 으로 돌리면 정확히 이 하나가 빨갛다). 본선은 어느 기계에서든
// 초록이어야 한다 — 검사가 자기 고정물을 짓는다(러너와 같은 방식).
test('후보에 기간이 붙는다 — 붙지 않으면 모델은 이름으로만 고른다', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'r8-기간-'));
  const 심기 = async (p, files) => {
    await mkdir(join(home, p), { recursive: true });
    for (const f of files) await writeFile(join(home, p, f), '거래처,금액\n마바상회,520000\n');
  };
  await 심기('2026-07 정산', ['2026-07 매출정산.csv', '7월 정산내역.csv', '증빙.pdf']);
  await 심기('지난달 정산 파일', ['2026-06 매출정산.csv', '6월 정산내역.csv', '증빙.pdf']);
  const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
  const 손 = makeLocalLocateTool({ home });
  const r = await 손.handler({ what: '정산' }, {});
  const 후보 = (r.result?.candidates ?? []).filter((c) => /정산/.test(c.path));
  assert.ok(후보.length, '정산 후보가 없다 — 고정물을 지었는데도 못 찾으면 찾기가 깨진 것이다');
  const 기간있는것 = 후보.filter((c) => c.자료기간);
  assert.ok(기간있는것.length,
    `**후보에 기간이 하나도 없다** — 모델이 "지난달"을 이름으로만 푼다: ${JSON.stringify(후보.slice(0, 2))}`);
  // 이름(2026-07)에서 읽은 것과 안의 파일(2026-06)에서 읽은 것이 각각 제 기간을 단다.
  assert.ok(기간있는것.some((c) => c.자료기간 === '2026-07'));
  assert.ok(기간있는것.some((c) => c.자료기간 === '2026-06'), '이름이 "지난달"인 폴더의 내용 기간이 안 붙었다');
});
