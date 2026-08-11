// 상태 지도 §12-F4 — **`undo` 의 범위 자가 write 보다 좁다** (2026-08-12).
//
// `local-file.js` 는 실제 작업을 `activeRoots`(선언 루트 ∪ 홈)로 푼다(`:629`). 그 결정은
// 이 파일 안에 이유까지 적혀 있다 — *"「내 컴퓨터」는 내 컴퓨터다 … 저장·옮기기·지우기도
// 홈 안에서 한다."* 그런데 `undo` 만 `resolveInScope(last.from, { roots, home })` 로
// **선언 루트만** 본다(`:571`).
//
// 그래서 `GPAO_T5_FILE_ROOTS` 로 루트를 좁힌 구성에서 이런 조합이 성립한다:
//   ① 홈 안에 쓴다 → 된다(카드는 *"되돌려줘로 되살릴 수 있어요"* 라고 약속한다)
//   ② 되돌린다     → **범위 밖이라며 거절한다**
// 카드가 못 지킬 약속을 한 자리다. 사용자에게는 "지운 건 되돌릴 수 있다"가 조건부 거짓이 된다.
//
// **자를 바꾸는 게 아니라 같은 자를 쓰게 한다.** 보호 검사(`protectionBlocks`)와 사본 경계
// (`to` 는 휴지통 또는 범위 안)는 그대로 선다 — 그건 범위와 다른 층이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 루트가 좁혀진 구성 — 선언 루트는 `작업` 하나, 홈은 그 바깥이다(GPAO_T5_FILE_ROOTS 꼴). */
async function 좁힌구성() {
  const 뿌리 = await realpath(await mkdtemp(join(tmpdir(), 'f4-undo-')));
  const 홈 = join(뿌리, '홈');
  const 작업 = join(홈, '작업');
  await mkdir(작업, { recursive: true });
  const 손 = makeLocalFileTool({ roots: [작업], homeDir: 홈, dataDir: 뿌리 });
  return { 뿌리, 홈, 작업, 손 };
}

test('홈에 쓴 것을 되돌릴 수 있다 — 쓰기가 되는 자리는 되돌리기도 된다', async () => {
  const { 뿌리, 홈, 손 } = await 좁힌구성();
  try {
    const 쓴것 = join(홈, '메모.md');
    const w = await 손.handler({ action: 'write', path: 쓴것, text: '가나다' }, {});
    assert.ok(!w.blocked, `홈에 쓰기가 막혔다 — 이 검사의 전제가 깨졌다: ${w.userSafeSummary}`);
    await stat(쓴것);   // 실제로 생겼다

    const u = await 손.handler({ action: 'undo' }, {});
    assert.ok(!u.blocked && !u.failed,
      `홈에 쓰고 되돌리지 못한다 — 카드가 못 지킬 약속을 했다: ${u.userSafeSummary}`);
    await assert.rejects(() => stat(쓴것), '되돌렸다면서 파일이 그대로 있다');
  } finally { await rm(뿌리, { recursive: true, force: true }); }
});

test('홈에서 지운 것도 되살아난다 — 「휴지통에 남아요」가 조건부 거짓이 아니다', async () => {
  const { 뿌리, 홈, 손 } = await 좁힌구성();
  try {
    const 지울것 = join(홈, '영수증.txt');
    await writeFile(지울것, '원본', 'utf8');
    const d = await 손.handler({ action: 'delete', path: 지울것 }, {});
    assert.ok(!d.blocked, `홈에서 삭제가 막혔다: ${d.userSafeSummary}`);
    await assert.rejects(() => stat(지울것));

    const u = await 손.handler({ action: 'undo' }, {});
    assert.ok(!u.blocked && !u.failed, `홈에서 지운 것을 못 되살린다: ${u.userSafeSummary}`);
    await stat(지울것);   // 되살아났다
  } finally { await rm(뿌리, { recursive: true, force: true }); }
});

test('반대시험: 홈 밖을 가리키는 기록은 그대로 거절한다 — 자를 넓힌 게 아니다', async () => {
  const { 뿌리, 홈, 작업, 손 } = await 좁힌구성();
  try {
    // 되돌리기 표를 직접 손댄다 — 이 파일의 주석이 기록한 그 위협 모형(로그 변조)이다.
    const 바깥 = join(뿌리, '바깥', '남의것.txt');
    await mkdir(join(뿌리, '바깥'), { recursive: true });
    await writeFile(바깥, '남의 것', 'utf8');
    const 휴지통 = join(뿌리, '.trash');
    await mkdir(휴지통, { recursive: true });
    await writeFile(join(휴지통, 'undo-log.json'),
      JSON.stringify([{ op: 'delete', from: 바깥, to: join(휴지통, '남의것.txt') }]), 'utf8');

    const u = await 손.handler({ action: 'undo' }, {});
    assert.ok(u.blocked || u.failed,
      `홈 밖(작업·홈 어느 쪽도 아닌 자리)을 가리키는 기록이 실행됐다: ${u.userSafeSummary}`);
    assert.ok(String(홈).length && String(작업).length);
  } finally { await rm(뿌리, { recursive: true, force: true }); }
});
