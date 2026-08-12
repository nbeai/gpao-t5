// **방 하나에 손 하나 — 커밋 순간에 무는 자** (선빨강 · 오너 지시 2026-08-12: *"방 나눠. 워크트리 분리하고 구조로 박아"*)
//
// 밟은 것(F-100 · 2026-08-12 · 같은 작업트리에서 두 손이 일했다):
// ```
// 18:23:26  손 A 가 `git merge --no-commit` — MERGE_HEAD 가 섰다. 그 사이 npm test 를 돌렸다(50초)
// 18:24:39  손 B 가 자기 문서를 `git add` 후 `git commit`
//           → git 은 MERGE_HEAD 가 있으면 **그 커밋을 병합 커밋으로 만든다**
// 결과      885c363 부모 둘 = 손 B 의 문서 커밋 + 손 A 의 조각 A 병합.
//           조각 A 병합이 **「장부·지도·계획서: F-95 등재…」라는 남의 제목으로 닫혔다**
// ```
// **손 B 는 그걸 막으려고 방어를 두 겹 세웠는데 둘 다 그 창이 껐다**(그 자리 오류 원문):
// ```
// 방어 ① `git commit -- <내 경로>`  →  fatal: cannot do a partial commit during a merge  (두 번 다)
// 방어 ② 색인에서 내 경로 내리기     →  소용없다. 흡수는 색인이 아니라 MERGE_HEAD 로 일어난다
// 관측   그때 MERGE_HEAD 를 봤는데 없었다 — 창이 열렸다 닫힌다. 한 번 보는 것으로는 못 잡는다
// ```
// 그래서 **착수 점검(한 번 보기)으로는 구조적으로 못 막는다.** 무는 자리는 **커밋 그 순간**뿐이다.
//
// ── 자가 무는 것은 딱 하나다 (그물을 안 넓힌다) ──────────────────────────────
// *"MERGE_HEAD 가 서 있는데, 병합을 연 손이 아닌 커밋"* — 그것만 거절한다.
//   · 평범한 단독 커밋      MERGE_HEAD 가 없다 → 그대로 지난다(마찰 0)
//   · 병합을 연 손의 마무리  `GPAO_T5_MERGE_OWNER=1 git commit` → 지난다
//   · 남의 병합 창에 얹힌 커밋 **거절.** 이것이 이 결함의 전부다
// 신분(세션 id·락 파일)을 안 쓴다 — 있으면 좋지만 **없어도 이 사고는 막힌다.**
// 「새 표면·게이트 금지」 규율에 걸리는 자리라 **오너가 직접 지시한 범위**로만 짓는다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));
const 훅 = join(뿌리, '.githooks/pre-commit');

/** 임시 저장소 하나 — 회차마다 새로 판다(공유 자리에서 와일드카드로 지우지 않는다). */
async function 임시저장소() {
  const 방 = await mkdtemp(join(tmpdir(), 't5-lane-'));
  const 셸 = (...a) => execFileSync(a[0], a.slice(1), { cwd: 방, encoding: 'utf8' });
  셸('git', 'init', '-q');
  셸('git', 'config', 'user.email', 'test@example.com');
  셸('git', 'config', 'user.name', '검사');
  // **첫 커밋을 세운다.** 커밋이 없는 저장소에서는 `git diff --cached` 가 비어서 훅이
  // 맨 앞에서 `exit 0` 으로 빠진다 — 그러면 이 검사는 **훅을 한 번도 안 밟는다**(첫 판에서
  // ④ 가 그렇게 빨갛게 나왔고, 빨강의 주인은 제품이 아니라 이 자였다).
  await writeFile(join(방, '씨앗.txt'), '씨앗\n', 'utf8');
  셸('git', 'add', '씨앗.txt');
  셸('git', 'commit', '-q', '--no-verify', '-m', '씨앗');
  await writeFile(join(방, '보통파일.txt'), '내용\n', 'utf8');
  셸('git', 'add', '보통파일.txt');
  return {
    방,
    /** 병합 창을 연다 — 손 A 가 `merge --no-commit` 을 한 그 상태. */
    병합창열기: async () => {
      const gitdir = 셸('git', 'rev-parse', '--git-dir').trim();
      await mkdir(join(방, gitdir), { recursive: true });
      await writeFile(join(방, gitdir, 'MERGE_HEAD'), `${'0'.repeat(40)}\n`, 'utf8');
    },
    /** 훅을 그대로 돌린다. 돌려주는 것은 종료코드와 stderr 원문. */
    훅돌리기: (env = {}) => {
      try {
        execFileSync(훅, [], { cwd: 방, encoding: 'utf8', env: { ...process.env, ...env } });
        return { 코드: 0, 말: '' };
      } catch (e) {
        return { 코드: e.status ?? 1, 말: String(e.stderr ?? '') };
      }
    },
    치우기: () => rm(방, { recursive: true, force: true }),
  };
}

// ── ① 밟은 그 자리 ───────────────────────────────────────────────────────────
test('방①: 남의 병합 창이 열려 있으면 내 커밋이 거절된다 — 그 커밋이 남의 병합 커밋이 된다', async () => {
  const r = await 임시저장소();
  try {
    await r.병합창열기();
    const { 코드, 말 } = r.훅돌리기();
    assert.equal(코드, 1,
      '**남의 병합 창 위에서 커밋이 그대로 지나갔다** — 2026-08-12 에 그렇게 조각 A 병합이 '
      + '남의 제목으로 닫혔다(885c363 부모 둘). 착수 점검은 창이 열렸다 닫혀서 못 잡는다');
    assert.match(말, /MERGE_HEAD|병합/,
      '거절 이유가 사람 말로 나와야 한다 — 무엇이 막았는지 모르면 다음 사람이 훅을 끈다');
    assert.match(말, /GPAO_T5_MERGE_OWNER/,
      '**어떻게 지나가는지**를 함께 줘야 한다(막기만 하면 우회가 아니라 훅 삭제로 간다)');
  } finally { await r.치우기(); }
});

// ── ② 병합을 연 손은 자기 병합을 닫을 수 있다 ────────────────────────────────
test('방②: 병합을 연 손은 GPAO_T5_MERGE_OWNER=1 로 자기 병합을 닫는다', async () => {
  const r = await 임시저장소();
  try {
    await r.병합창열기();
    const { 코드 } = r.훅돌리기({ GPAO_T5_MERGE_OWNER: '1' });
    assert.equal(코드, 0,
      '**병합을 연 손까지 막혔다** — 그러면 병합을 아무도 못 닫고, 다음 사람이 훅을 지운다');
  } finally { await r.치우기(); }
});

// ── ③ 평범한 단독 커밋에는 마찰이 0 이다 ─────────────────────────────────────
test('방③: 병합 창이 없으면 그대로 지난다 — 혼자 일하는 손에게 마찰을 만들지 않는다', async () => {
  const r = await 임시저장소();
  try {
    const { 코드 } = r.훅돌리기();
    assert.equal(코드, 0, '**평범한 커밋이 막혔다** — 카드가 늘어나는 변경은 개선이 아니라 실패다');
  } finally { await r.치우기(); }
});

// ── ④ 원래 있던 봉인은 그대로 산다 ───────────────────────────────────────────
test('방④: 산출물·시크릿 차단이 그대로 선다 — 새 검사가 옛 검사를 덮지 않는다', async () => {
  const r = await 임시저장소();
  try {
    const 셸 = (...a) => execFileSync(a[0], a.slice(1), { cwd: r.방, encoding: 'utf8' });
    await mkdir(join(r.방, 'dist'), { recursive: true });
    await writeFile(join(r.방, 'dist/번들.js'), 'x\n', 'utf8');
    셸('git', 'add', '-f', 'dist/번들.js');
    const { 코드, 말 } = r.훅돌리기();
    assert.equal(코드, 1, '**산출물 차단이 죽었다** — 환경헌장 봉인이다');
    assert.match(말, /산출물|시크릿/, '옛 거절 이유가 그대로 나와야 한다');
  } finally { await r.치우기(); }
});

// ── ⑤ 살아 있는 훅이 어디서 오는지 — 이 검사가 그 사실을 못 박는다 ───────────
//
// `core.hooksPath` 가 **절대경로**(`/Users/jyp/Developer/gpao-t5/.githooks`)로 잡혀 있어서,
// 실제로 도는 훅은 **본 worktree 의 체크아웃 파일**이다. 내 가지에 있는 `.githooks/pre-commit`
// 을 고쳐도 **본 worktree 가 그 가지를 체크아웃하기 전까지는 안 돈다.**
// 그 사실을 모르면 「박았다」고 적고 실제로는 아무것도 안 무는 자를 세우게 된다
// (「만든 것과 닿은 것은 다르다」 · 오늘 이 저장소에서 세 번 난 병).
test('방⑤: 훅 자리가 **상대경로**다 — 훅이 가지를 따라다녀야 이 수리가 닿는다', async () => {
  const { readFile } = await import('node:fs/promises');
  const 자리 = execFileSync('git', ['config', '--get', 'core.hooksPath'],
    { cwd: 뿌리, encoding: 'utf8' }).trim();
  assert.ok(자리, 'core.hooksPath 가 없으면 훅이 아예 안 돈다');
  assert.ok(!자리.startsWith('/'),
    `**훅 자리가 절대경로다(${자리}).** 그러면 연결 worktree 가 몇 개든 **본 worktree 가\n`
    + '체크아웃한 가지의 훅 하나**만 돈다 — 이 가지에서 훅을 고쳐도 아무것도 안 문다.\n'
    + '   실측 2026-08-12: 본 worktree 는 13일 낡은 `codex/…` 가지에 서 있었고,\n'
    + '   그 가지의 훅이 모든 방에서 돌고 있었다.\n'
    + '   → 훅 파일 자신이 적어 둔 그대로 상대경로로 설치한다: `git config core.hooksPath .githooks`\n'
    + '     그러면 훅이 **가지를 따라다닌다**(각 worktree 가 자기 체크아웃의 훅을 쓴다).');
  const 사는것 = await readFile(join(뿌리, 자리, 'pre-commit'), 'utf8').catch(() => '');
  assert.equal(사는것, await readFile(훅, 'utf8'),
    '이 worktree 에서 도는 훅이 이 가지의 훅과 같아야 한다');
});
