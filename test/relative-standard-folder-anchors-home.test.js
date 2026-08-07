// **표준 폴더를 부르는 상대 경로는 구성과 무관하게 홈의 그 자리다** (⑫ 매듭 봉인).
//
// ⑫ 회차 F R1 실측(2026-08-08 · evidence/step3-r-knot-2026-08-08/round-F/R1-12.json):
// 모델이 `path:'Desktop/2026-07_vs_2026-08_정산요약.txt'` 로 write 를 불렀고, 루트가 좁혀진
// 구성(GPAO_T5_FILE_ROOTS=<홈>/GPAO-T5)에서 첫 루트 기준으로 풀려 `GPAO-T5/Desktop/…` 에
// 생겼다. 성공 영수증이 나갔고 모델은 "바탕화면에 저장해뒀어"라고 답했는데 홈 Desktop 실물은
// 0개 — 제품 손이 거짓 성공을 제조했다. 사용자의 바탕화면은 하나다(감사 2026-08-08).
//
// 자 대조: 구성이 달라도(좁힌 루트/기본 홈 루트) · 부르는 말이 달라도(Desktop/바탕화면)
// 같은 한 자리(홈 Desktop)에 닿아야 하고, 카드(미리보기)도 실행과 같은 자리를 말해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

// tmp 밖의 홈 모양 — F7.3(시스템을 품는 임시 경로 면제 제거)을 안 밟는 자리(F-46 봉인에서 배움).
async function 무대() {
  const H = await mkdtemp(join(process.cwd(), '.tmp-anchor-'));
  const A = join(H, 'GPAO-T5');
  await mkdir(A, { recursive: true });
  await mkdir(join(H, 'Desktop'), { recursive: true });
  return {
    H,
    A,
    좁힌손: makeLocalFileTool({ roots: [A], homeDir: H, dataDir: A }), // 회차 방과 같은 구성
    기본손: makeLocalFileTool({ roots: [H], homeDir: H, dataDir: A }), // 제품 기본(홈이 방이다)
  };
}

test('좁힌 구성에서 Desktop/… write 가 홈 Desktop 실물에 닿는다 — 루트 안 Desktop 이 아니라', async () => {
  const { H, A, 좁힌손 } = await 무대();
  try {
    const r = await 좁힌손.handler({ action: 'write', path: 'Desktop/요약.txt', text: 'x' }, {});
    assert.ok(!r.blocked && !r.failed, `홈 Desktop 으로의 write 가 거절됐다: ${r.userSafeSummary}`);
    assert.equal(r.result?.path, join(H, 'Desktop', '요약.txt'));
    assert.ok(existsSync(join(H, 'Desktop', '요약.txt')), '홈 Desktop 실물이 없다 — 거짓 성공이다');
    assert.ok(!existsSync(join(A, 'Desktop')), '루트 안 Desktop 이 생겼다 — 회차 F R1 의 그 병이다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('자 대조: 구성 둘(좁힌/기본) · 표기 둘(Desktop/desktop)이 전부 같은 한 자리다', async () => {
  const { H, 좁힌손, 기본손 } = await 무대();
  try {
    const 닿은곳 = [];
    for (const [손, 경로] of [[좁힌손, 'Desktop/자.txt'], [기본손, 'Desktop/자.txt'], [좁힌손, 'desktop/자.txt']]) {
      const r = await 손.handler({ action: 'write', path: 경로, text: 'x' }, {});
      assert.ok(!r.blocked && !r.failed, `${경로} write 가 거절됐다: ${r.userSafeSummary}`);
      닿은곳.push(r.result?.path);
      await rm(join(H, 'Desktop', '자.txt'), { force: true }); // 다음 대조가 덮어쓰기 갈래로 새지 않게
    }
    assert.deepEqual([...new Set(닿은곳)], [join(H, 'Desktop', '자.txt')],
      `앵커가 구성·표기에 따라 갈렸다: ${JSON.stringify(닿은곳)}`);
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('원본 보호도 같은 자다 — 좁힌 구성에서 source 가 대상과 같은 자리면 덮어쓰지 않는다', async () => {
  const { H, 좁힌손 } = await 무대();
  try {
    // source 해석만 홈 없는 자를 보면 ScopeError 가 삼켜져 원본 보호가 조용히 꺼진다(공정감시 지적).
    await writeFile(join(H, 'Desktop', '견적서.md'), '원본');
    const r = await 좁힌손.handler({ action: 'write', path: 'Desktop/견적서.md', text: '정리', source: 'Desktop/견적서.md' }, {});
    assert.match(String(r.userSafeSummary), /원본이라 덮어쓰지 않았/,
      `원본 자리 덮어쓰기가 막히지 않았다: ${r.userSafeSummary}`);
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 부르는 말(문서·바탕화면)은 경로에서 가로채지 않는다 — 평범한 폴더 이름이다', async () => {
  const { H, A, 좁힌손 } = await 무대();
  try {
    // 실측: 모델이 `to:'문서'` 를 루트 안 새 폴더 이름으로 자연스럽게 쓴다(bulk_move·후속발화 검사).
    // 말→자리 번역은 locate 의 일이고, 여기서 가로채면 사용자가 만든 문서/ 폴더가 사라져 보인다.
    const r = await 좁힌손.handler({ action: 'write', path: '문서/메모.md', text: 'x' }, {});
    assert.ok(!r.blocked && !r.failed, `문서/ 상대 경로 write 가 거절됐다: ${r.userSafeSummary}`);
    assert.ok(existsSync(join(A, '문서', '메모.md')),
      '문서/ 가 작업 루트가 아니라 다른 앵커로 끌려갔다 — 평범한 이름을 가로챘다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('카드도 같은 자리를 말한다 — 인자가 아니라 결과를 보여줘야 승인이 승인이 된다', async () => {
  const { H, 좁힌손 } = await 무대();
  try {
    const 카드 = 좁힌손.previewOf({ action: 'write', path: 'Desktop/요약.txt', text: 'x' });
    assert.ok(String(카드.scope).includes(join('Desktop', '요약.txt')) && !String(카드.scope).includes('GPAO-T5'),
      `카드가 실행과 다른 자리를 말한다: ${카드.scope}`);
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 표준 폴더가 아닌 상대 경로는 여전히 작업 루트에 생긴다 — 쓰기 자리 불변', async () => {
  const { H, A, 좁힌손 } = await 무대();
  try {
    const r = await 좁힌손.handler({ action: 'write', path: '메모.md', text: 'x' }, {});
    assert.ok(!r.blocked && !r.failed, `작업 루트 write 가 거절됐다: ${r.userSafeSummary}`);
    assert.ok(existsSync(join(A, '메모.md')), '이름만 준 새 파일이 작업 폴더에 안 생겼다 — 계약이 넓어졌다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 홈 앵커를 지나 홈 밖으로 나가는 경로는 거절된다 — 앵커를 옮긴 것이지 범위를 넓힌 게 아니다', async () => {
  const { H, 좁힌손 } = await 무대();
  try {
    const r = await 좁힌손.handler({ action: 'write', path: 'Desktop/../../탈출.txt', text: 'x' }, {});
    assert.ok(r.blocked || r.failed, '홈 밖 write 가 허용됐다 — 자가 무너졌다');
    assert.ok(!existsSync(join(H, '..', '탈출.txt')), '홈 밖에 실물이 생겼다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 홈 Desktop 에 실물이 없어도 루트 안 Desktop 으로 되돌아가지 않는다 — 읽기도 한 자리다', async () => {
  const { H, A, 좁힌손 } = await 무대();
  try {
    // 루트 안에만 Desktop/미끼.txt 를 만들어 둔다 — 실재 기반 규칙이 되살아나면 여기로 끌려간다.
    await mkdir(join(A, 'Desktop'), { recursive: true });
    await writeFile(join(A, 'Desktop', '미끼.txt'), 'x');
    const r = await 좁힌손.handler({ action: 'read', path: 'Desktop/미끼.txt' }, {});
    assert.ok(!r.result?.content && /찾지 못했/.test(String(r.userSafeSummary)),
      `홈 Desktop 에 없는 파일이 루트 안 Desktop 에서 읽혔다 — 존재 여부로 앵커가 도로 갈린다: ${r.userSafeSummary}`);
  } finally { await rm(H, { recursive: true, force: true }); }
});
