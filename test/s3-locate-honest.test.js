// **S3 — 커널은 프로세스에게 거짓말하지 않는다.**
//
// 원리: 커널이 시스템콜에 errno 대신 **추측**을 돌려주면, 프로세스는 그 추측 위에 판단을 쌓는다.
// 그건 모델 잘못이 아니다.
//
// 라이브 실측(2026-08-05 · 오너 첫 대화):
//   사용자 "그럼 이 파일 찾아서 내용 보여줘. YOON.md"
//   locate 가 돌려준 것 — **무관한 파일 다섯 개**, 전부 이렇게:
//       why: "이름이 맞아요 · 0달 전"      confidence: "high"
//       NEXT-REVIEW.md · WHAT-IS-NOT-DONE.md · WHAT-WE-ARE-BUILDING.md
//       gpt-t3-qa-chat-after-direct-wait.md · gpt-t3-qa-chat-draft-filled.md
//   **YOON 은 어디에도 없다.** 확장자만 같았다.
//
// 원인: 이름을 `.` 로 쪼개 낱말로 만들고(`YOON.md` → `["yoon","md"]`)
// **하나라도 포함되면 맞다**고 봤다(`.some(포함)`). `md` 가 모든 `.md` 에 걸린다.
// `계약서.pdf` → `["계약서","pdf"]` 도 같다 — **모든 PDF 가 "이름이 맞아요"** 가 된다.
//
// 고치는 방향은 목록이 아니라 구조다(§4-6):
//   **확장자는 낱말이 아니다.** 그리고 **확신은 실제 일치에서만 나온다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

async function 방(파일들) {
  const root = await mkdtemp(join(tmpdir(), 't5-s3-'));
  for (const p of 파일들) {
    const full = join(root, p);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, 'x', 'utf8');
  }
  return root;
}

const 찾기 = async (root, what) => {
  const 손 = makeLocalLocateTool({ home: root });
  const r = await 손.handler({ what, from: root, depth: 5 });
  return r?.result ?? r;
};

test('① **확장자만 같은 파일을 "이름이 맞아요"라고 하지 않는다**(라이브 그 사고)', async () => {
  const root = await 방(['notes/NEXT-REVIEW.md', 'notes/WHAT-IS-NOT-DONE.md', 'notes/qa-chat-draft.md']);
  const r = await 찾기(root, 'YOON.md');
  const 거짓 = (r.candidates ?? []).filter((c) => /이름이 맞아요/.test(c.why ?? ''));
  assert.deepEqual(거짓, [],
    `이름이 안 맞는데 맞다고 했다: ${JSON.stringify((r.candidates ?? []).map((c) => [c.path.split('/').pop(), c.why, c.confidence]))}`);
});

test('② 확장자만 같은 후보에 **확신 high 를 주지 않는다**', async () => {
  const root = await 방(['a/보고서.pdf', 'a/계획.pdf']);
  const r = await 찾기(root, '계약서.pdf');
  const 높음 = (r.candidates ?? []).filter((c) => c.confidence === 'high');
  assert.deepEqual(높음, [],
    `모든 PDF 가 확신 높음이 됐다: ${JSON.stringify(높음.map((c) => c.path))}`);
});

test('③ **진짜 있으면 정확히 찾는다**(과잉 교정 금지)', async () => {
  const root = await 방(['깊이/더깊이/YOON.md', 'notes/NEXT-REVIEW.md']);
  const r = await 찾기(root, 'YOON.md');
  const 맞음 = (r.candidates ?? []).find((c) => c.path.endsWith('YOON.md'));
  assert.ok(맞음, `실제로 있는 파일을 못 찾았다: ${JSON.stringify(r.candidates ?? [])}`);
  assert.equal(맞음.confidence, 'high', '정확히 같은 이름인데 확신이 낮다');
});

test('④ 이름의 **일부**로 불러도 찾는다 — 사람은 그렇게 부른다', async () => {
  const root = await 방(['업무/2026-정산-최종.xlsx', 'notes/NEXT-REVIEW.md']);
  const r = await 찾기(root, '정산');
  assert.ok((r.candidates ?? []).some((c) => c.path.includes('정산')),
    '사람이 부르는 말로 못 찾으면 손이 죽는다');
});

test('⑤ 확장자로만 물으면 그건 확장자 질문이다(그때는 확장자로 찾는다)', async () => {
  const root = await 방(['a/보고서.pdf', 'a/메모.txt']);
  const r = await 찾기(root, 'pdf 파일');
  assert.ok((r.candidates ?? []).some((c) => c.path.endsWith('.pdf')),
    '확장자만 물었는데 못 찾았다 — 확장자를 통째로 무시하면 안 된다');
});

test('⑥ 못 찾으면 **못 찾았다고 한다** — 후보를 지어내지 않는다', async () => {
  const root = await 방(['notes/NEXT-REVIEW.md']);
  const r = await 찾기(root, '존재하지않는이름.md');
  assert.equal((r.candidates ?? []).length, 0,
    `없는데 후보를 만들었다: ${JSON.stringify(r.candidates)}`);
  assert.ok(r.searched, '얼마나 훑었는지를 안 준다 — 조용한 0 금지');
});
