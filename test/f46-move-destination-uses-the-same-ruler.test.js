// **행동이 달라도 자는 하나다 — move 목적지가 write 와 같은 자를 본다** (F-46 프랙탈 봉인).
//
// ⑫ 회차 E 실측(2026-08-08): 같은 방에서 write 는 홈 Desktop 에 됐는데(R1·R3),
// "만들고 옮기기"(R2)는 move 목적지의 좁은 자에 두 번 거절됐다 — 모델은 두 번 시도하고
// "권한이 없다"고 정직하게 알렸다. 병은 모델이 아니라 자였다. 사용자에겐 이 불일치가
// "파일마다 되다 안 되다"로 보인다(F-46 의 프랙탈 — 선언·강제가 행동별로 갈림).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

// tmp 밖의 홈 모양 — F7.3(시스템을 품는 임시 경로 면제 제거)을 안 밟는 자리(r8 에서 배움).
async function 무대() {
  const H = await mkdtemp(join(process.cwd(), '.tmp-f46-'));
  const A = join(H, 'GPAO-T5');
  await mkdir(join(A, '자료'), { recursive: true });
  await mkdir(join(H, 'Desktop'), { recursive: true });
  await writeFile(join(A, '자료', 'f.txt'), 'x');
  return { H, A, 손: makeLocalFileTool({ roots: [A], home: H, dataDir: A }) };
}

test('move 의 목적지가 홈 안이면 write 와 똑같이 허용된다', async () => {
  const { H, A, 손 } = await 무대();
  try {
    const r = await 손.handler({ action: 'move', path: join(A, '자료', 'f.txt'), to: join(H, 'Desktop', 'f.txt') }, {});
    assert.ok(!r.blocked && !r.failed, `홈 Desktop 으로의 move 가 거절됐다: ${r.userSafeSummary}`);
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('반대시험: 홈 밖 목적지는 여전히 거절된다 — 자를 넓힌 게 아니라 통일한 것이다', async () => {
  const { H, A, 손 } = await 무대();
  try {
    const r = await 손.handler({ action: 'move', path: join(A, '자료', 'f.txt'), to: '/etc/f.txt' }, {});
    assert.ok(r.blocked || r.failed, '홈 밖으로의 move 가 허용됐다 — 자가 무너졌다');
  } finally { await rm(H, { recursive: true, force: true }); }
});

test('읽기 요약줄이 이웃 파일 사실을 함께 말한다 (감사 승인 레버 ①)', async () => {
  const { H, A, 손 } = await 무대();
  try {
    await writeFile(join(A, '자료', 'g.csv'), 'y');
    const r = await 손.handler({ action: 'read', path: join(A, '자료', 'f.txt') }, {});
    assert.match(String(r.userSafeSummary), /같은 자리에 1개 더: g\.csv/,
      '이웃 사실이 요약줄에 없다 — data 깊숙이만 있으면 모델이 지나친다(실측)');
  } finally { await rm(H, { recursive: true, force: true }); }
});
