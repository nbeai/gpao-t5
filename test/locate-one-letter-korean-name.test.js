// **한 글자도 이름이다** — 라이브 실측(실모델 gpt-5.1 · 2026-08-14 · 격리 방).
//
//   사용자: *"**표 폴더**에 이번 달 매출이랑 환불이 들어 있어. 동부랑 서부를 더하고
//            환불을 빼서 순매출을 내줘…"*
//   격리 집에는 `일감/표/매출-동부.tsv` · `매출-서부.tsv` · `환불.tsv` 가 **실재했다.**
//   T5: *"「표 폴더」라는 이름이나 그에 해당하는 폴더를 컴퓨터 안에서 못 찾고 있어.
//        홈 전체, 그리고 `일감` 폴더 안을 5단계까지 뒤졌는데 후보가 안 나와."*
//   영수증: `local.locate` 2회 · 후보 0. 과업이 **시작도 못 했다**(실물 0건).
//
// ── 매듭은 낱말 한 줄이다 ────────────────────────────────────────────────
//   `local-locate.js` 의 `낱말()`:  `.filter((w) => w.length >= 2)`
// `표` 는 한 글자라 여기서 통째로 사라지고, 낱말 목록이 비면 어떤 이름과도 안 맞는다.
// 한국어는 한 글자 명사가 흔하다 — 표·집·글·돈·책·방·짐·차. **T5 는 한국형 AI OS 다.**
//
// ── 그런데 그 규칙에는 목적이 있었다 ──────────────────────────────────────
// 영어의 `a`·`x` 같은 한 글자는 소음이고, 그걸 낱말로 받으면 후보가 폭발한다.
// 그리고 한글 한 글자를 **부분 문자열**로 풀어도 같은 폭발이 온다 — 이 저장소에서만
// 세어 봐도 이름에 `표` 가 든 항목이 17개인데 이름이 `표` 인 것은 0개다.
// 그러니 목록이 아니라 **성질**로 가른다:
//   ① 글자 하나가 음절·뜻을 통째로 담는 문자(한글·한자)만 한 글자로도 낱말이다.
//   ② 그런 한 글자는 **이름의 조각과 같을 때만** 맞는다 — 긴 이름 속에 우연히 든 것은
//      이름이 맞은 것이 아니다(이 파일 계열이 두 번 데인 그 병: `지침` · `md`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalLocateTool } from '../src/runtime/local-locate.js';

/** 라이브 그 집 — 한 글자 이름의 폴더가 **실재한다**. 그리고 소음이 될 이웃들. */
async function 격리집() {
  const home = await mkdtemp(join(tmpdir(), 't5-한글자-'));
  const 심기 = async (p, files) => {
    await mkdir(join(home, p), { recursive: true });
    for (const f of files) await writeFile(join(home, p, f), 'x', 'utf8');
  };
  await 심기('일감/표', ['매출-동부.tsv', '매출-서부.tsv', '환불.tsv']);
  // 한 글자가 **속에** 든 이름들 — 이것들이 "이름이 맞아요"로 쏟아지면 고친 게 아니다.
  await 심기('보관/발표자료', ['1월.pdf', '2월.pdf']);
  await 심기('보관/표준약관', ['약관.docx', '별지.docx']);
  await 심기('보관/가계부표시', ['메모.txt']);
  // 라틴 한 글자가 속에 든 이름들 — `a`·`x` 를 낱말로 받으면 여기가 통째로 후보가 된다.
  await 심기('archive/data', ['a.txt', 'x.txt']);
  await 심기('archive/export', ['index.md', 'max.md']);
  return home;
}

const 찾기 = (home, what, extra = {}) =>
  makeLocalLocateTool({ home }).handler({ what, depth: 5, ...extra });
const 후보들 = (r) => r?.result?.candidates ?? [];
const 이름으로맞음 = (r) => 후보들(r).filter((c) => /이름이 맞아요|이름이 정확히 맞아요|낱말이 있어요/.test(String(c.why ?? '')));

test('① **한 글자 한글 이름의 폴더가 실재하면 후보로 나온다**(라이브 그 회차)', async () => {
  const home = await 격리집();
  const r = await 찾기(home, '표 폴더');
  const 그자리 = 후보들(r).filter((c) => String(c.path).endsWith('/일감/표'));
  assert.equal(그자리.length, 1,
    '**있는 폴더를 못 찾았다.** 한 글자 이름이 낱말에서 지워져 어떤 이름과도 안 맞는다.\n'
    + `  말한 것: ${r.userSafeSummary}\n`
    + `  후보: ${JSON.stringify(후보들(r).map((c) => c.path))}`);
});

test('② 부른 말이 한 글자 그 자체여도 찾는다 — 모델은 `what:"표"` 로도 부른다', async () => {
  const home = await 격리집();
  const r = await 찾기(home, '표');
  assert.ok(후보들(r).some((c) => String(c.path).endsWith('/일감/표')),
    `한 글자로 부른 자리를 못 찾았다: ${JSON.stringify(후보들(r).map((c) => c.path))}`);
});

test('③ **한 글자는 이름 조각과 같을 때만 맞는다** — 긴 이름 속의 우연은 이름이 아니다', async () => {
  const home = await 격리집();
  const r = await 찾기(home, '표 폴더');
  const 우연 = 이름으로맞음(r).filter((c) => /발표자료|표준약관|가계부표시/.test(String(c.path)));
  assert.deepEqual(우연.map((c) => c.path), [],
    '**한 글자가 속에 들었다는 이유로 "이름이 맞아요"가 붙었다** — 후보 폭발이자 커널의 거짓말이다.\n'
    + `  ${우연.map((c) => `${c.path} → ${c.why} (${c.confidence})`).join('\n  ')}`);
});

test('④ **라틴 한 글자는 여전히 낱말이 아니다** — 후보 폭발이 돌아오지 않는다', async () => {
  const home = await 격리집();
  for (const 말 of ['a 파일 찾아줘', 'x 정리해줘']) {
    const r = await 찾기(home, 말);
    assert.deepEqual(이름으로맞음(r).map((c) => c.path), [],
      `"${말}" — 한 글자 라틴 낱말이 이름 매치를 만들었다(소음): `
      + JSON.stringify(이름으로맞음(r).map((c) => [c.path, c.why])));
  }
});

test('⑤ 두 글자 이상 낱말의 부분 일치는 그대로다(회귀 보호)', async () => {
  const home = await 격리집();
  const r = await 찾기(home, '약관');
  assert.ok(후보들(r).some((c) => /표준약관|약관\.docx/.test(String(c.path))),
    `평소 찾기가 좁아졌다: ${JSON.stringify(후보들(r).map((c) => c.path))}`);
});
