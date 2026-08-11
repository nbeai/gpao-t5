// 상태 지도 §12-J6 — **locate 가 폴더당 400개에서 필터 전에 자르는데 표식이 없다** (2026-08-12).
//
// `local-locate.js:449` 는 `readdir(dir).slice(0, MAX_ENTRIES_PER_DIR)` 을 **매칭 전에** 한다.
// 항목이 수천 개인 폴더(다운로드·사진·바탕화면)에서 401번째부터는 **후보가 될 기회조차 없다.**
// 그런데 결과에는 아무 표식이 없고 *"폴더 300개를 3단계까지 훑었어요"* 는 그대로 나간다 —
// 모델은 그 문장을 **다 봤다**로 읽고, 사용자에게 "그런 파일은 없어요"라고 답한다.
// 같은 파일의 `stoppedAtLimit`(총 폴더 상한)은 사실로 실리는데 이 절단만 안 보인다.
//
// ── 오픈북: 잘림을 어떻게 알리나 ────────────────────────────────────────────
// 쿠아 `skills/cua-driver/SKILL.md:665-668`:
//   *"The tree can be very large (Finder is ~1600 elements, ~190 KB); when it exceeds
//     token limits the MCP harness saves it to a file and returns the path."*
//   → 잘라 버리지 않는다. **잘린 사실을 말하고 전체가 어디 있는지 준다.**
// 클로드코드(나) 실측(2026-08-12 · 이 세션에서 직접 밟은 기계 사실):
//   `seq 1 20000 | tr '\n' ' '` 의 결과가
//   *"Output too large (106.3KB). Full output saved to: …/tool-results/bt0igba4o.txt"* 로 왔다.
//   → **잘렸다는 사실 · 얼마나 큰지 · 전체를 어디서 보는지** 셋이 함께 온다.
//
// 우리는 전체를 줄 수 없다(폴더가 수천 개면 그게 곧 덤프다). 그러나 **잘렸다는 사실과
// 어디서 몇 개를 못 봤는지**는 줄 수 있고, 그게 없으면 침묵이 거짓말이 된다.
//
// 상한 값(400) 자체는 안 건드린다 — 바꿀 근거가 없다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

/** 항목이 `개수` 개인 폴더 하나. 400 을 넘기면 손은 앞의 400개만 본다. */
async function 큰폴더(개수) {
  const 뿌리 = await mkdtemp(join(tmpdir(), 'j6-locate-'));
  const 방 = join(뿌리, '다운로드');
  await mkdir(방, { recursive: true });
  for (let i = 0; i < 개수; i += 1) {
    await writeFile(join(방, `자료-${String(i).padStart(4, '0')}.txt`), 'x');
  }
  return { 뿌리, 방, 손: makeLocalLocateTool({ home: 뿌리 }) };
}

test('400개를 넘게 든 폴더는 **못 본 것이 있다는 사실**이 결과에 실린다', async () => {
  const { 뿌리, 손 } = await 큰폴더(450);
  try {
    const r = await 손.handler({ what: '있을리없는이름', from: 뿌리, depth: 2 }, {});
    const 잘린것 = r.result?.truncatedFolders;
    assert.ok(Array.isArray(잘린것) && 잘린것.length >= 1,
      `절단 사실이 결과에 없다 — 「다 훑었다」로 읽힌다: ${JSON.stringify(r.result)}`);
    const 그폴더 = 잘린것.find((f) => String(f.path).endsWith('다운로드'));
    assert.ok(그폴더, `어느 폴더가 잘렸는지 안 적혔다: ${JSON.stringify(잘린것)}`);
    // **몇 개를 못 봤는지**까지 준다. "잘렸다"만으로는 2개인지 2천 개인지 모른다.
    assert.equal(그폴더.unseen, 50, `못 본 개수가 틀리다: ${JSON.stringify(그폴더)}`);
    assert.equal(그폴더.seen, 400);
    // 사용자·모델이 읽는 문장에도 실린다 — 결과 객체에만 있으면 요약만 보는 층은 못 본다.
    assert.match(String(r.userSafeSummary), /못 봤|앞 400|너무 많/,
      `요약이 여전히 「다 훑었다」처럼 말한다: ${r.userSafeSummary}`);
  } finally { await rm(뿌리, { recursive: true, force: true }); }
});

test('반대시험: 400개 안쪽이면 표식을 붙이지 않는다 — 없는 절단을 말하지 않는다', async () => {
  const { 뿌리, 손 } = await 큰폴더(12);
  try {
    const r = await 손.handler({ what: '있을리없는이름', from: 뿌리, depth: 2 }, {});
    assert.equal(r.result?.truncatedFolders, undefined,
      `안 잘렸는데 잘렸다고 한다: ${JSON.stringify(r.result?.truncatedFolders)}`);
    assert.doesNotMatch(String(r.userSafeSummary), /못 봤|앞 400/);
  } finally { await rm(뿌리, { recursive: true, force: true }); }
});

test('찾았을 때도 절단 사실은 함께 온다 — 답이 나왔다고 침묵하지 않는다', async () => {
  const { 뿌리, 방, 손 } = await 큰폴더(450);
  try {
    // 앞쪽(확실히 400 안)에 드는 이름 하나를 대상으로 삼는다.
    const r = await 손.handler({ what: '자료-0001', from: 뿌리, depth: 2 }, {});
    assert.ok((r.result?.candidates ?? []).length >= 1, '앞쪽 파일도 못 찾았다');
    assert.ok((r.result?.truncatedFolders ?? []).length >= 1,
      '후보를 찾았다고 절단 사실을 뺐다 — 더 나은 것이 401번째에 있었을 수 있다');
    assert.ok(String(방).length);
  } finally { await rm(뿌리, { recursive: true, force: true }); }
});
