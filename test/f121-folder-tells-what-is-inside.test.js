// F-121 — 목록에서 폴더가 캄캄하다: 안에 무엇이 있는지 개수조차 안 보인다.
//
// 선빨강(라이브 n=10 · 기준선 §7-f·§7-g): 집계 질문에서 모델이 최상위만 재고
// 「무근거 단정」("제일 깁니다" — 폴더 안은 안 잰 채)으로 답했다. list 결과의 폴더
// 항목이 { name, kind:'folder', modifiedAt } 뿐이라 잴 것이 있다는 사실 자체가
// 모델 눈에 없다(오너 원실측 §0: "겉보기로는 짧을 가능성이 큽니다").
//
// 수리는 사실 채움(유도): 폴더 항목에 「안에 항목 몇 개」 한 칸. 재라고 말하지
// 않는다 — 잴 것이 있음이 보이게 한다. 한 층만, 상한(100)에서 끊고 끊었다고 말한다
// (손 관리자 규격: opendir 스트리밍 N+1 · 수만 항목 폴더에서 메모리 함정 방지).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'gpao-t5-f121-'));
  return { root, tool: makeLocalFileTool({ roots: [root], dataDir: root }) };
}

test('① 폴더 항목이 안의 항목 수를 말한다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '시작문서'));
  for (const n of ['a.md', 'b.md', 'c.md']) await writeFile(join(root, '시작문서', n), 'x\n');
  await writeFile(join(root, 'README.md'), 'x\n');
  const r = await tool.handler({ action: 'list', path: '.' });
  const 폴더 = r.result.items.find((i) => i.name === '시작문서');
  assert.equal(폴더.kind, 'folder');
  assert.equal(폴더.childCount, 3, '폴더 안 항목 수가 목록에 없다 — 폴더가 캄캄하다');
});

test('② 파일 항목에는 그 칸이 없다', async () => {
  const { root, tool } = await sandbox();
  await writeFile(join(root, '메모.md'), 'x\n');
  const r = await tool.handler({ action: 'list', path: '.' });
  const 파일 = r.result.items.find((i) => i.name === '메모.md');
  assert.equal(파일.childCount, undefined);
});

test('③ 큰 폴더는 상한에서 끊고 끊었다고 말한다', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '큰폴더'));
  await Promise.all(Array.from({ length: 120 }, (_, i) => writeFile(join(root, '큰폴더', `f${i}.txt`), 'x')));
  const r = await tool.handler({ action: 'list', path: '.' });
  const 폴더 = r.result.items.find((i) => i.name === '큰폴더');
  assert.equal(폴더.childCount, 100, '상한(100)에서 안 끊었다');
  assert.equal(폴더.childCountCapped, true, '끊었다는 사실이 없다 — 100 이 전부로 읽힌다');
});

test('④ 반례: 턴 머리 관측(worksetObservation)에는 안 실린다 — F-65 경계 유지', async () => {
  const { root, tool } = await sandbox();
  await mkdir(join(root, '시작문서'));
  await writeFile(join(root, '시작문서', 'a.md'), 'x\n');
  const r = await tool.handler({ action: 'list', path: '.' }, { worksetObservation: true });
  const 폴더 = r.result.items.find((i) => i.name === '시작문서');
  assert.equal(폴더.childCount, undefined, '턴 머리 관측이 넓어졌다 — F-65 가 못 박은 경계다');
});
