// **막다른 답 금지 계약이 코드에 있는데 닿지 않는다 — 이음새가 없어서다.**
//
// 라이브 정면 대조(2026-08-16 · §7-af): 같은 방·같은 부탁("이 폴더 전체를 압축해서 백업본
// 하나 만들어줘")에서
//   비교군  tar 가 막히자 **zip 으로 갈아타 실제로 만들었다**(96,723B · 디스크로 확인)
//   T5     tar 를 세 번 시도하고 *"제가 직접 만들어 두지는 못했고 …"* 하며 **사용자에게
//          명령을 넘겼다** — 파일 손도 zip 도 살아 있었는데 한 번도 다른 수단을 안 골랐다
//
// **원인은 「실패가 장부에 안 남는다」는 일반 결함이 아니었다**(내 첫 진단 · 감시자가 뒤집음).
// 같은 방 실측: `zip -r`·`cp` 는 `blocked:true`·`needsGrant:true` 로 남고 사다리가 **이미 켜진다.**
// `tar` 만 이렇게 말해서 `code/failed` 로 샜다:  `tar: Failed to open 'backup.tar.gz'`
// 즉 **막혔다고 말하는 말투가 하나 더 있었고, 그 말이 다음 층에 안 닿았다.**
//
// ⚠️ 닫는 문장은 **영역**이다 — ✗"압축이 막히면 zip 으로 바꾼다"(전용 집게)
//                            ✓"요구가 안 끝났으면 다른 수단으로 끝까지 간다"(손)
// 그래서 도구 이름 목록을 만들지 않는다. 가르는 근거는 §7-y 와 같은 축 —
// **「열지 못했다」고 말한 그 자리를 명령이 스스로 지목했는가.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { executionBlock } from '../src/runtime/terminal-run.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { nextRung, rungMessage } from '../src/kernel/l2-plan/recovery-ladder.js';

const 방 = async () => {
  const d = await mkdtemp(join(tmpdir(), 'ladder-'));
  await writeFile(join(d, 'a.md'), 'x');
  return d;
};
const 손들 = ['local.terminal', 'local.file'];
const 손 = () => makeLocalTerminalTool({});

test('막혔다고 다른 말투로 말해도 「쓰려다 막힘」으로 닿는다', async () => {
  const r = await 손().handler({ command: 'tar -czf backup.tar.gz .', cwd: await 방() });
  assert.notEqual(r.result?.exitCode ?? r.exitCode, 0, '이 명령은 실제로 막힌다(전제)');
  assert.equal(r.needsGrant, true, '막힌 쓰기는 승인 경로로 간다 — zip·cp 는 이미 그렇게 간다');
});

test('그 실패는 「다음 수단」으로 이어진다 — 막다른 답을 만들지 않는다', async () => {
  const r = await 손().handler({ command: 'tar -czf backup.tar.gz .', cwd: await 방() });
  // 손은 「막혔다」까지 말하고, **실패 상태를 장부에 세우는 것은 손 위층(도구 러너)**이다 —
  // zip·cp 가 이미 그 경로로 사다리를 켠다(감시자 실측). 이 검사가 무는 것은 그 이음새다:
  // 손이 `blocked` 를 내면 러너가 세우는 그 상태에서 **사다리가 실제로 계단을 낸다**.
  assert.equal(r.blocked, true, '손이 「막혔다」를 내야 위층이 실패를 세울 수 있다');
  const 계단 = nextRung([{ ...r, tool: 'local.terminal', failureState: 'blocked' }], 손들);
  assert.notEqual(계단, null, '사다리가 null 이면 손은 거기서 멈추고 사용자에게 넘긴다');
  // 계약은 필드 이름이 아니라 **사용자에게 갈 문장**이다 — "안 됩니다"로 끝나지 않아야 한다.
  const 문장 = rungMessage(계단);
  assert.ok(문장 && String(문장).length > 0, '다음에 무엇을 할지가 문장으로 나와야 한다');
});

// ── ★ 이 수리의 제일 큰 위험 (감시자 조정 ①) ──────────────────────────────
// 「exit≠0 이면 실패」로 뭉뚱그리면 **정상적인 비영 종료**까지 실패가 된다.
// `grep` 미검출은 exit 1 이지만 **아무 일도 안 막힌 정상 결과**다. 여기에 실패를 붙이면
// 사다리가 "다시 시도해 볼까요" → "다른 방법을 알려 주세요" 를 내고, 그건 이 수리가
// 없애려는 바로 그 떠넘김 문장이다.
test('반대시험 — 정상적인 비영 종료는 실패로 만들지 않는다', async () => {
  const d = await 방();
  const r = await 손().handler({ command: 'grep -q ZZZ없는말 a.md', cwd: d });
  assert.notEqual(r.result?.exitCode ?? r.exitCode, 0, 'grep 미검출은 exit≠0 이다(전제)');
  assert.notEqual(r.needsGrant, true, '아무것도 안 막혔는데 승인으로 보내지 않는다');
  assert.equal(nextRung([{ ...r, tool: 'local.terminal' }], 손들), null, '정상 결과에 「다시 시도」를 붙이지 않는다');
});

test('반대시험 — 자리를 지목 안 한 실패는 그대로 「모른다」다 (목록이 아니라 자리로 가른다)', () => {
  // 명령이 지목하지 않은 자리에서 열기에 실패한 것은 쓰려 한 증거가 아니다.
  const b = executionBlock({ command: 'tar -czf backup.tar.gz .', exitCode: 1, stdout: '', stderr: "tar: Failed to open '/어딘가/남의자리'" });
  assert.notEqual(b?.why, 'write', '명령에 없는 자리는 쓰려 한 증거가 아니다');
});

// ── ★ §7-ak · 조준 정정 2 (2026-08-16 · 위 검사들이 못 문 자리) ─────────────
//
// 위 검사는 **이름이 리터럴인** tar 만 물었다. 라이브가 실제로 친 명령은 그게 아니었다:
//     cd 작업 && tar -czf 작업-backup-$(date +%Y%m%d-%H%M%S).tar.gz 작업
// 이름을 실행 중에 만들면 셸이 뱉는 자리(`작업-backup-20260816-004213.tar.gz`)가
// **명령 문자열에 리터럴로 없다** → `명령이지목한자리인가` 는 언제나 거짓 → `code/failed`.
// 그러면 `looksBlocked` 가 false 라 승인도 사다리도 안 열리고, 영수증은 **성공**으로 남는다.
//
// ── 정의역을 먼저 열거한다 — 수리 모양을 고르기 전에 (감시자 조정 2026-08-16) ──
// 「대조 불능」과 「대조했는데 지목 안 함」은 **다른 사실**이다. 셋으로 갈린다:
//   (ㄱ) 명령에 셸 확장이 있다(`$( )`·백틱·`$VAR`·glob) → 리터럴 대조가 **원리적으로 불가능**
//   (ㄴ) 확장이 없는데 이름이 명령에 없다             → 대조를 했고 **결과가 「지목 안 함」**
//   (ㄷ) 이름이 명령에 리터럴로 있다                  → sandbox/write (지금 그대로 · 안 건드린다)
// 라이브가 밟은 것은 **(ㄱ) 하나뿐**이다. (ㄴ)은 순회하다 만난 자리라 지금 판정이 옳다 —
// 여기까지 같이 열면 **막히지도 않은 읽기 실패가 승인 카드로 가는 반대 방향의 집게**가 된다.
// 그래서 이 검사는 (ㄱ)만 물고, 아래 반대시험이 (ㄴ)을 지킨다.

test('§7-ak 선빨강 — 이름을 실행 중에 만든 걸음이 막히면 장부가 **성공**으로 적힌다', async () => {
  // ⚠️ `handler` 반환값은 영수증이 아니다 — `failureState` 는 **ToolRunner 가 붙인다**
  //    (tool-runner.js). §7-ah 가 handler 를 직접 재서 「failureState: undefined」를 보고
  //    한 칸 넓은 진단을 냈다. 그래서 이 검사는 `tools.run` 을 지난 값만 본다.
  const d = await 방();
  const tools = new ToolRunner({ 'local.terminal': 손() });
  const selfState = buildSelfState(demoEnv({ hands: Object.keys(tools.tools) }));
  const rec = await tools.run('local.terminal', {
    command: 'tar -czf backup-$(date +%Y%m%d-%H%M%S).tar.gz .', cwd: d,
  }, selfState);

  assert.notEqual(rec.failureState, 'none',
    '**막힌 걸음이 장부에 성공으로 남았다.** 그러면 nextRung 은 이 영수증을 아예 안 본다 — '
    + '사다리가 있어도 켤 재료를 못 받는다(recovery-ladder.js:188)');
  const 계단 = nextRung([rec], 손들);
  assert.notEqual(계단, null, '사다리가 null 이면 T5 는 거기서 멈추고 사용자에게 명령을 넘긴다');
  assert.ok(rungMessage(계단), '다음에 무엇을 할지가 문장으로 나와야 한다(막다른 답 금지)');
});

// ── ★ 오탐 반대시험 — **수리보다 먼저 세운다** (손 관리자 조건 ② · 2026-08-16) ──
//
// 손 관리자가 격리 방에서 직접 쟀다: `awk -f /nonexistent/x.awk a.txt` 는 **순수 읽기 실패**인데
// stderr 가 `awk: can't open file /nonexistent/x.awk` 라 같은 정규식에 걸린다.
// 게다가 그 정규식의 포획값은 경로가 아니라 **낱말 `file`** 이다 — 판별의 입구가 자리가 아니라
// **문자열 어법**이라는 기계 증거다. 폴백을 통째로 복사하면 이게 승인 카드로 간다:
// 승인해도 결과가 같은 일에 사용자가 **헛클릭**한다. 그건 개입 축에서 T5 를 뒤로 미는 것이고,
// 이 수리가 없애려는 병의 거울상이다.
test('§7-ak 오탐 반대시험 — 확장 없는 순수 읽기 실패는 승인 카드로 가지 않는다', () => {
  const b = executionBlock({
    command: 'awk -f /nonexistent/x.awk a.txt', exitCode: 2, stdout: '',
    stderr: "awk: can't open file /nonexistent/x.awk",
  });
  assert.notEqual(b?.kind, 'sandbox',
    '**아무것도 안 막혔다.** 없는 파일을 읽으려다 실패한 것을 승인으로 보내면 사용자는 '
    + '승인해도 결과가 같은 일에 헛클릭한다 — (ㄴ) 갈래는 지금 판정이 옳다. 열지 마라');
});

test('§7-ak 반대시험 — 정상 비영 종료는 영수증에서도 실패가 아니다 (러너를 지나서 잰다)', async () => {
  const d = await 방();
  const tools = new ToolRunner({ 'local.terminal': 손() });
  const selfState = buildSelfState(demoEnv({ hands: Object.keys(tools.tools) }));
  const rec = await tools.run('local.terminal', { command: 'grep -q ZZZ없는말 a.md', cwd: d }, selfState);

  assert.equal(rec.failureState, 'none',
    '`grep` 미검출은 **아무것도 안 막힌 정상 결과**다. 여기에 실패를 붙이면 사다리가 '
    + '"다른 방법을 알려 주세요"를 내고, 그게 이 수리가 없애려는 바로 그 떠넘김 문장이다');
  assert.equal(nextRung([rec], 손들), null, '정상 결과에 「다시 시도」를 붙이지 않는다');
});
