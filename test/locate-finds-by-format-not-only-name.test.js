// **찾기가 형식으로도 되어야 손이다** (콘솔 라이브 2026-08-12 · 오너 지시).
//
// 오너 지시: *"엑셀·PDF·텍스트 파일 등을 다양하게 찾게 해봐. 폴더명을 알려주고, 안 알려주고
// 이렇게 따로. 즉, 특화된 집게가 아니라 진짜 손이 되어야 하니까."*
//
// 밟은 회차 — *"내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘."*
//   `local.locate` 가 **이름으로만** 후보를 올려 「엑셀」이라는 이름의 파일이 없으니 0을 냈다.
//   모델은 캡슐로 직접 훑다 Desktop·Documents·Downloads **셋만** 보고
//   *"이 컴퓨터에는 엑셀 형식 파일이 저장돼 있지 않다"* 고 단정했다.
//   실제 파일은 `~/GPAO-T5/2026-08 정산/2026-08 정산표.xlsx` 였다.
//   **손이 못 하니 모델이 임시로 만들었고, 임시로 만든 것은 범위를 틀렸다.**
//
// 새 표를 발명하지 않았다 — `DOC_EXT`·`IMAGE_EXT`·`TEXT_EXT` 가 이미 형식을 알고,
// `표준폴더말`(다운로드→Downloads)이 「부르는 말 → 기계 값」 대응의 선례다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

async function 방(파일들) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'locate-fmt-')));
  for (const rel of 파일들) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, 'x', 'utf8');
  }
  return root;
}
const 찾기 = async (root, 말, depth = 4) =>
  (await makeLocalLocateTool({ home: root }).handler({ what: 말, from: root, depth }))?.result ?? {};

test('이름이 하나도 안 맞아도 형식이 맞으면 찾는다 — 밟은 그 자리', async () => {
  // 라이브와 같은 모양: 파일 이름 어디에도 「엑셀」이 없다.
  const root = await 방(['GPAO-T5/2026-08 정산/2026-08 정산표.xlsx', '메모/그냥글.md']);
  try {
    const r = await 찾기(root, '엑셀 파일');
    const 파일 = (r.candidates ?? []).filter((c) => c.kind === 'file');
    assert.ok(파일.some((c) => c.path.endsWith('2026-08 정산표.xlsx')),
      `**형식으로 못 찾는다** — 후보: ${JSON.stringify((r.candidates ?? []).map((c) => c.path))}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('여러 형식이 각각 선다 — 한 형식 전용이 아니다', async () => {
  const root = await 방(['a/보고.pdf', 'b/자료.txt', 'c/표.csv', 'd/문서.docx', 'e/그림.png']);
  try {
    for (const [말, 끝] of [['pdf 파일', '.pdf'], ['텍스트 파일', '.txt'], ['csv 파일', '.csv'], ['워드 파일', '.docx']]) {
      const r = await 찾기(root, 말);
      const 파일 = (r.candidates ?? []).filter((c) => c.kind === 'file');
      assert.ok(파일.some((c) => c.path.endsWith(끝)), `"${말}" 로 ${끝} 를 못 찾는다`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('폴더를 안 알려줘도 홈 아래 깊은 자리를 찾는다', async () => {
  const root = await 방(['깊은/더깊은/또깊은/정산표.xlsx']);
  try {
    const r = await 찾기(root, '엑셀 파일');
    assert.ok((r.candidates ?? []).some((c) => c.path.endsWith('정산표.xlsx')),
      `깊은 자리를 못 본다: ${JSON.stringify(r.searched)}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('`이름.확장자` 로 부른 것은 형식 질의가 아니다 — 그 파일을 부른 것이다', async () => {
  const root = await 방(['notes/NEXT-REVIEW.md', 'notes/다른글.md']);
  try {
    const r = await 찾기(root, '존재하지않는이름.md');
    const 파일 = (r.candidates ?? []).filter((c) => c.kind === 'file');
    assert.equal(파일.length, 0,
      `**없는 파일을 물었는데 남의 파일이 섰다**: ${JSON.stringify(파일.map((c) => c.path))}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('형식을 안 부르면 예전 그대로 이름으로만 — 그물이 안 넓어졌다', async () => {
  const root = await 방(['a/견적서.pdf', 'b/계약서.pdf']);
  try {
    const r = await 찾기(root, '견적서');
    const 파일 = (r.candidates ?? []).filter((c) => c.kind === 'file');
    assert.ok(파일.length && 파일.every((c) => c.path.includes('견적서')),
      `이름 질의에 다른 파일이 딸려 왔다: ${JSON.stringify(파일.map((c) => c.path))}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
