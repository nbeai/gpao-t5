// **한 답 안에서 두 문장이 서로를 부정하면 안 된다** (실물 홈 실측 2026-08-12).
//
// 형식 질의가 세는 자를 쥔 뒤(`locate-counts-when-asked-how-many.test.js`) 실물 홈에서
// 이 문장이 나왔다:
//
//   *"「pdf 파일」은 모두 **133개**예요 — /Users/jyp/Downloads(87개) · … (OS 색인으로 셌어요,
//     앱이 쓰는 자리 378개는 뺐어요) 다만 항목이 아주 많은 폴더 2곳은 앞 400개만 봤어요 —
//     거기서 **2032개는 못 봤어요**(더 좁혀 주시면 그 안을 볼게요)."*
//
// 전수는 정확한데(133 = 87+43+3, 독립 실측과 일치) 바로 뒤에 「2032개는 못 봤어요」가
// 붙는다. 사용자는 두 문장을 한 사실로 읽고 **133 을 못 믿는다.** 둘 다 참인데 정의역이
// 다르기 때문이다 — 133 은 **색인**이 센 것이고, 2032 는 **걸음**이 못 본 항목 수다.
// 색인이 셌으면 걸음의 절단은 전수를 흔들지 않는다. 흔드는 것은 **보여 줄 후보 고르기**뿐이다.
//
// **입을 다무는 것은 답이 아니다**(§12-J6 — 못 본 것을 말한다). 지우지 않고 **무엇에 대한
// 절단인지**를 말한다. 비교군의 축도 같다 — 오픈클로 `find` 는 잘린 것이 「결과 목록」임을
// 밝히고 다음 길을 준다(*"1000 results limit reached … refine pattern"*).
//
// 색인을 **못 쓴** 회차에서는 정의역이 진짜로 같다(걸음이 전수도 세고 후보도 골랐다).
// 그때는 예전 문장 그대로여야 한다 — 그게 아래 ③이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

/** 한 폴더에 400칸(`MAX_ENTRIES_PER_DIR`)을 넘겨야 걸음 절단이 실제로 선다. */
async function 큰방() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'locate-contra-')));
  await mkdir(join(root, '많은자리'), { recursive: true });
  for (let i = 0; i < 450; i += 1) {
    await writeFile(join(root, '많은자리', `잡자료${i}.log`), 'x', 'utf8');
  }
  for (const rel of ['자료/보고A.pdf', '자료/보고B.pdf', '깊은/안쪽/보고C.pdf']) {
    const p = join(root, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, 'x', 'utf8');
  }
  return root;
}
const 부르기 = (root, mdfind) =>
  makeLocalLocateTool({ home: root, mdfind })
    .handler({ what: 'pdf 파일', from: root, depth: 4 });

test('① 색인이 셌으면 절단 문구가 전수를 부정하지 않는다', async () => {
  const root = await 큰방();
  try {
    // 색인이 셋을 다 본다 — 걸음이 못 본 자리와 무관하게 전수는 3이다.
    const 색인 = async () => ['자료/보고A.pdf', '자료/보고B.pdf', '깊은/안쪽/보고C.pdf']
      .map((r) => join(root, r));
    const r = await 부르기(root, 색인);
    const 말 = String(r.userSafeSummary);
    assert.equal(r.result?.formatTotal, 3, `전제가 안 섰다: ${r.result?.formatTotal}`);
    assert.ok((r.result?.truncatedFolders ?? []).length,
      '전제가 안 섰다 — 걸음 절단이 실제로 서야 이 검사가 무언가를 잰다');
    assert.doesNotMatch(말, /개는 못 봤어요/,
      `**전수를 부정하는 문장이 붙었다** — 사용자는 "모두 3개"를 못 믿는다: ${말}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('② 지우지 않는다 — 무엇이 잘렸는지는 그대로 말한다', async () => {
  const root = await 큰방();
  try {
    const 색인 = async () => ['자료/보고A.pdf', '자료/보고B.pdf', '깊은/안쪽/보고C.pdf']
      .map((r) => join(root, r));
    const r = await 부르기(root, 색인);
    const 말 = String(r.userSafeSummary);
    // 문구가 아니라 **사실**을 문다 — 잘렸다는 것과 어디까지 봤는지가 남아 있으면 된다.
    assert.match(말, /폴더 \d+곳은 앞 400개만/,
      `**절단 사실이 통째로 사라졌다** — 침묵이 곧 거짓말이다(§12-J6): ${말}`);
    // 기계 사실 칸은 어느 갈래에서도 그대로 남는다 — 모델이 따질 근거다.
    assert.ok((r.result?.unseenEntries ?? 0) > 0, '기계 칸까지 지웠다');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('③ 색인을 못 쓴 회차는 예전 그대로 — 그때는 정의역이 진짜로 같다', async () => {
  const root = await 큰방();
  try {
    const r = await 부르기(root, async () => null);   // 색인 없음
    const 말 = String(r.userSafeSummary);
    assert.equal(r.result?.countedBy, 'walk', `전제가 안 섰다: ${r.result?.countedBy}`);
    assert.match(말, /개는 못 봤어요/,
      `**걸음이 셌는데 절단을 감췄다** — 그 전수는 실제로 덜 센 것이다: ${말}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
