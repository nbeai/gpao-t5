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
