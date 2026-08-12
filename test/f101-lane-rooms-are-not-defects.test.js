// **F-101 · 작업 방을 여는 것이 결함이 아니다** (선빨강)
//
// 오너 지적(2026-08-12): *"방을 나누라고 하셨는데, 방을 나눌수록 점검이 더 빨개집니다.
// 점검표가 「문서에 적힌 방만 있어야 한다」고 보거든요. 이건 점검표 쪽을 고쳐야 합니다."*
//
// 밟은 것(`scripts/audit-project-entry.mjs` 를 읽고 확인):
// ```js
// for (const path of worktrees) {
//   if (자기자신) continue;
//   if (path.endsWith('/gpao-t5')) { …역사 표식만 확인…; continue; }
//   fail(`인수인계에 없는 sidecar worktree가 열려 있음: …`);   // ← 무조건. 인계를 안 읽는다
// }
// ```
// **메시지는 「인수인계에 없는」인데 코드는 인계 문서를 한 줄도 안 읽는다.** 그러므로
// *"인계에 적어 두면 풀린다"* 는 길은 **없다**(오너께 그 선택지를 올렸다가 코드를 읽고 정정했다).
// 그리고 `scripts/lane.mjs`(오너가 시킨 구조)를 쓰는 순간 `gate.mjs` → 이 감사가 빨개진다.
//
// ── 이 자가 원래 지키려던 것 ────────────────────────────────────────────────
// 방 **개수**가 아니라 **「살아 있는데 잊힌 작업」**과 **「낡은 방을 정본으로 착각」**이다
// (`AGENTS.md` 병렬 개발 계약 · 인계 §8). 첫째는 이미 `scripts/agent-start.mjs` 가
// 매 회차 재고 있다(오늘도 13일 낡은 가지를 계속 외쳤고, 그래서 지웠다).
//
// **그물을 안 넓힌다**: 작업 방이라도 **본선에 안 들어간 커밋을 들고 있으면 여전히 실패**하고,
// 작업 방이 아닌 자리에 열린 방도 **여전히 실패**한다. 바뀌는 것은 *깨끗한 작업 방* 하나뿐이다.
//
// **C5 가 아닌 근거는 기계로 선다**: 이 수리는 **내 작업을 통과시키지 않는다** —
// 잊힌 작업이 있는 방은 그대로 걸리고(반대시험 ②), 오늘 게이트를 초록으로 만든 것은
// 이 수리가 아니라 임시 방 정리와 문구 정정이었다(a7dd00d).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const 뿌리 = dirname(dirname(fileURLToPath(import.meta.url)));
const 셸 = (...a) => execFileSync(a[0], a.slice(1), { cwd: 뿌리, encoding: 'utf8' });

/**
 * 감사를 돌리고 **worktree 사유만** 골라 낸다 — 다른 사유는 이 검사의 것이 아니다.
 *
 * ⚠️ **실패는 `stderr` 로 나간다**(`audit-project-entry.mjs:116-117`). 첫 판은 `e.stdout` 만
 * 읽어서 **언제나 빈 배열**을 돌려줬고, 그래서 ①이 거짓 초록으로 통과했다 —
 * 자가 아무것도 안 재고 있었다(「재는 자가 틀리면 재는 것이 전부 거짓이다」).
 */
// ⚠️ **내가 만든 방의 사유만 센다**(2026-08-12 밟음). 첫 판은 감사가 낸 worktree 줄을 전부
// 셌는데, **다른 레인이 실제로 `../t5-lanes/ux` 를 열고 커밋 1개를 들고 있어** 그 사유가
// 섞여 들어와 ①②③ 이 빨갛게 나왔다. 제품은 옳게 작동했고 **검사가 환경에 의존한** 것이다.
// (좋은 소식이기도 하다 — 오너가 시킨 방 분리를 다른 손이 실제로 쓰고 있다는 뜻이다.)
function 방사유(자리 = null) {
  try {
    execFileSync('node', ['scripts/audit-project-entry.mjs'], { cwd: 뿌리, encoding: 'utf8' });
    return [];
  } catch (e) {
    return `${String(e.stdout ?? '')}\n${String(e.stderr ?? '')}`
      // **어휘로 거르면 문구를 고칠 때 자가 먼저 눈이 먼다.** 첫 판은 'worktree' 글자만
      // 걸렀는데 새 거절문은 한국어(`작업 방에 …`)라 **아무것도 안 잡혔고 ②가 거짓 초록**이었다.
      // 두 어휘를 다 본다 — 이 검사가 무는 것은 문구가 아니라 **방에 대한 판정**이다.
      .split('\n').filter((l) => l.startsWith('- ') && /worktree|작업 방/.test(l))
      .filter((l) => !자리 || l.includes(자리));
  }
}

/** 작업 방 하나를 실제로 연다(실제 경로 · 실제 git). 끝나면 반드시 치운다. */
async function 작업방(이름, { 커밋 = false } = {}) {
  // **실제 방 모양 그대로**: lane.mjs 는 `<어딘가>/t5-lanes/<이름>` 에 판다.
  // 임시 뿌리 이름을 `t5-lanes-XXXX` 로 두면 그 모양이 아니라, 자를 헐겁게 만들어야 통과한다.
  const 임시 = await mkdtemp(join(tmpdir(), 't5-방-'));
  const 방뿌리 = join(임시, 't5-lanes');
  await mkdir(방뿌리, { recursive: true });
  const 자리 = join(방뿌리, 이름);
  const 가지 = `lane-test/${이름}`;
  셸('git', 'worktree', 'add', '-q', '-b', 가지, 자리, 'HEAD');
  if (커밋) {
    await writeFile(join(자리, '방메모.txt'), '아직 본선에 안 들어간 일\n', 'utf8');
    execFileSync('git', ['add', '방메모.txt'], { cwd: 자리 });
    execFileSync('git', ['commit', '-q', '--no-verify', '-m', '방에서만 한 일'], { cwd: 자리 });
  }
  return {
    자리,
    치우기: async () => {
      셸('git', 'worktree', 'remove', '--force', 자리);
      try { 셸('git', 'branch', '-D', 가지); } catch { /* 이미 없다 */ }
      await rm(임시, { recursive: true, force: true });
    },
  };
}

// ── ① 밟은 그 자리 ───────────────────────────────────────────────────────────
test('F101 ①: 깨끗한 작업 방을 여는 것은 결함이 아니다 — 방을 나누라고 해 놓고 벌하지 않는다', async () => {
  const 방 = await 작업방('깨끗한방');
  try {
    assert.deepEqual(방사유(방.자리), [],
      '**방을 나누자마자 감사가 빨개진다** — 오너가 시킨 구조(scripts/lane.mjs)를 쓰는 순간이다. '
      + '이 자가 지키려던 것은 방 개수가 아니라 「잊힌 작업」이고, 그건 ②가 잡는다');
  } finally { await 방.치우기(); }
});

// ── ② 봉인 유지 — 잊힌 작업은 여전히 잡힌다 ─────────────────────────────────
test('F101 ②: 본선에 안 들어간 커밋을 든 방은 **여전히** 잡힌다 — 그물이 안 넓어졌다', async () => {
  const 방 = await 작업방('일이남은방', { 커밋: true });
  try {
    const 사유 = 방사유(방.자리);
    assert.equal(사유.length, 1,
      `**잊힌 작업이 있는 방을 놓쳤다** — 이 자의 존재 이유가 죽는다. 나온 사유: ${JSON.stringify(사유)}`);
    assert.match(사유[0], /안 들어간|본선|잊/,
      `거절 이유가 「잊힌 작업」이라고 말해야 한다 — 지금: ${사유[0]}`);
  } finally { await 방.치우기(); }
});

// ── ③ 작업 방이 아닌 자리는 여전히 잡힌다 ───────────────────────────────────
test('F101 ③: 작업 방이 아닌 자리에 열린 방은 여전히 잡힌다', async () => {
  const 방뿌리 = await mkdtemp(join(tmpdir(), 't5-남의자리-'));
  const 자리 = join(방뿌리, 'unknown-room');
  const 가지 = 'lane-test/남의자리';
  셸('git', 'worktree', 'add', '-q', '-b', 가지, 자리, 'HEAD');
  try {
    // 이 자리는 `t5-lanes`·`.claude/worktrees` 어느 쪽도 아니다 — 그물 밖이면 안 된다.
    assert.equal(방사유(자리).length, 1,
      '**아무 자리에나 열린 방이 통과했다** — 그물이 넓어졌다');
  } finally {
    셸('git', 'worktree', 'remove', '--force', 자리);
    try { 셸('git', 'branch', '-D', 가지); } catch { /* 이미 없다 */ }
    await rm(방뿌리, { recursive: true, force: true });
  }
});

// ── ④ 거짓 기준을 안 말한다 ─────────────────────────────────────────────────
test('F101 ④: 거절 문구가 자기가 실제로 재는 것을 말한다 — "인수인계에 없는"은 거짓이었다', async () => {
  const { readFile } = await import('node:fs/promises');
  const 원문 = await readFile(join(뿌리, 'scripts/audit-project-entry.mjs'), 'utf8');
  assert.ok(!원문.includes('인수인계에 없는 sidecar worktree'),
    '**자가 자기 기준을 거짓말한다** — 메시지는 「인수인계에 없는」인데 코드는 인계를 한 줄도 '
    + '안 읽는다. 그래서 「인계에 적어 두면 풀린다」는 길이 없는데 있는 것처럼 들린다');
});
