// F-120 — 파일 손에 「복사」 동사가 없어서, 모델이 이동으로 대신하다 원본 불변을 깼다.
//
// 선빨강(라이브 원본 · 저장소에 있음):
//   docs/03-verification/evidence/live5-2026-08-14/run-150448/과업3-탐색·대량.json:170
//   복사가 필요하자 bulk_move 로 **옮겼고**(원본 불변 깨짐), 되돌린 뒤 사용자에게
//   "Finder 에서 Cmd+C → Cmd+V 하세요"라고 손으로 시켰다 — 떠넘김.
// 동사 여덟(list·read·write·move·bulk_move·delete·undo·versions)에 복사가 없다.
//
// 복사는 파일 손에서 가장 안전한 쓰기다 — 원본을 안 건드리고, 새로 생긴 사본을
// 지우면 완전히 되돌아간다. 없어서 위험한 우회(이동)가 생겼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-f120-'));
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
}

test('① copy: 사본이 생기고 원본은 그대로다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '받은자료'), { recursive: true });
  await writeFile(join(root, '받은자료/거래-05.csv'), '금액,1000\n');
  const r = await tool.handler({ action: 'copy', path: '받은자료/거래-05.csv', to: '취소건/거래-05.csv' });
  assert.notEqual(r.blocked, true, `복사가 막혔다: ${r.userSafeSummary}`);
  assert.equal(await readFile(join(root, '취소건/거래-05.csv'), 'utf8'), '금액,1000\n', '사본 내용이 다르다');
  assert.equal(await readFile(join(root, '받은자료/거래-05.csv'), 'utf8'), '금액,1000\n', '원본이 사라졌거나 변했다');
  // 원본을 안 건드렸다는 것은 말할 수 있는 사실이어야 한다(read 갈래의 originalUntouched 전례).
  assert.equal(r.result?.originalUntouched, true, '원본 불변 사실이 결과에 없다');
});

test('② copy: 폴더도 통째로 복사된다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '자료/안쪽'), { recursive: true });
  await writeFile(join(root, '자료/안쪽/메모.md'), '내용\n');
  const r = await tool.handler({ action: 'copy', path: '자료', to: '자료-백업' });
  assert.notEqual(r.blocked, true, `폴더 복사가 막혔다: ${r.userSafeSummary}`);
  assert.equal(await readFile(join(root, '자료-백업/안쪽/메모.md'), 'utf8'), '내용\n');
  assert.ok(await stat(join(root, '자료/안쪽/메모.md')), '원본 폴더가 사라졌다');
});

test('③ 반례: 대상이 이미 있으면 조용히 덮어쓰지 않는다 (move 와 같은 계약)', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, 'a.txt'), '새것\n');
  await writeFile(join(root, 'b.txt'), '소중한 기존 내용\n');
  const r = await tool.handler({ action: 'copy', path: 'a.txt', to: 'b.txt' });
  assert.equal(r.blocked ?? false, true, '이미 있는 대상 위로 조용히 복사했다');
  // 감시자 지적(H09 계열): 구현 전에는 「미지원 동사 일괄 차단」으로도 이 줄이 초록이었다.
  // 막힌 **이유**가 덮어쓰기 가드인지까지 물어야 반례가 증거가 된다.
  assert.ok(/이미 있/.test(r.userSafeSummary), `차단 사유가 덮어쓰기 가드가 아니다: ${r.userSafeSummary}`);
  assert.equal(await readFile(join(root, 'b.txt'), 'utf8'), '소중한 기존 내용\n', '기존 내용이 사라졌다');
});

test('④ undo: 복사를 되돌리면 사본이 사라지고 원본은 그대로다', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, '원본.md'), '내용\n');
  const c = await tool.handler({ action: 'copy', path: '원본.md', to: '사본.md' });
  assert.notEqual(c.blocked, true);
  const u = await tool.handler({ action: 'undo', path: '사본.md' });
  assert.notEqual(u.blocked, true, `undo 가 막혔다: ${u.userSafeSummary}`);
  await assert.rejects(() => stat(join(root, '사본.md')), '사본이 안 사라졌다');
  assert.equal(await readFile(join(root, '원본.md'), 'utf8'), '내용\n', '원본이 다쳤다');
});

test('⑥ bulk_copy: 사고 형상(여러 파일 복사)이 원본을 두고 끝난다', async () => {
  // 표본 2(봉인 라이브 2026-08-15): copy 를 만들고도 "md 파일들을 백업 폴더에 복사해 둬"에
  // 모델이 bulk_move 를 골라 시작문서가 통째로 비었다. 다중 형상은 같은 입자의 복사가 있어야 한다.
  const { root, tool } = await sandbox();
  await mkdir(join(root, '받은자료'), { recursive: true });
  for (const n of ['거래-05.csv', '거래-10.csv', '거래-15.csv']) await writeFile(join(root, '받은자료', n), '금액,1000\n');
  const r = await tool.handler({ action: 'bulk_copy', path: '받은자료', to: '취소건', match: { extensions: ['.csv'] } });
  assert.notEqual(r.blocked, true, `일괄 복사가 막혔다: ${r.userSafeSummary}`);
  assert.equal(r.result?.copied?.length, 3, '사본 셋이 안 생겼다');
  assert.equal(r.result?.originalUntouched, true);
  for (const n of ['거래-05.csv', '거래-10.csv', '거래-15.csv']) {
    assert.equal(await readFile(join(root, '받은자료', n), 'utf8'), '금액,1000\n', `원본 ${n} 이 다쳤다`);
    assert.equal(await readFile(join(root, '취소건', n), 'utf8'), '금액,1000\n', `사본 ${n} 이 없다`);
  }
});

test('⑦ 일괄 복사의 개수가 완료 주장 검증에서 실제로 세진다', async () => {
  // 감시자 재검문(2026-08-15)이 잡은 소비자: 바꾼개수가 moved 만 세서 bulk_copy 40개가
  // 1로 세지면, "40개를 복사했어요"라는 정직한 답이 거짓 완료 주장으로 잡힌다.
  const { 완료주장검증 } = await import('../src/kernel/l2-plan/exit-verification.js');
  const receipts = [{
    intended: 'local.file', failureState: 'none',
    actualCall: { tool: 'local.file', args: { action: 'bulk_copy', path: '받은자료', to: '취소건' } },
    result: {
      from: '/x/받은자료', to: '/x/취소건', originalUntouched: true,
      copied: Array.from({ length: 40 }, (_, i) => ({ from: `a${i}`, to: `b${i}` })), skipped: [],
    },
    userSafeSummary: '40개를 복사했어요 — 원본은 그대로예요.',
  }];
  const v = 완료주장검증({ reply: '40개를 복사했어요.', receipts });
  assert.equal(v.실제, 40, `일괄 복사가 ${v.실제}개로 세졌다`);
  assert.equal(v.일치, true, '정직한 개수 보고가 거짓 완료 주장으로 잡혔다');
});

test('⑤ 반례: 범위 밖으로의 복사는 막힌다', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, 'a.txt'), 'x\n');
  const r = await tool.handler({ action: 'copy', path: 'a.txt', to: '/etc/훔친사본.txt' });
  assert.equal(r.blocked ?? false, true, '범위 밖으로 복사가 나갔다');
  // 같은 이유(H09 계열): 차단 사유가 범위 계약인지까지 문다.
  assert.ok(/폴더 밖|범위/.test(r.userSafeSummary), `차단 사유가 범위 계약이 아니다: ${r.userSafeSummary}`);
});
