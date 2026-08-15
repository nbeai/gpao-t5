// **막다른 답 금지 계약이 코드에 있는데 닿지 않는다.**
//
// 라이브 정면 대조(2026-08-16 · §7-af): 같은 방·같은 부탁("이 폴더 전체를 압축해서 백업본
// 하나 만들어줘")에서
//   비교군  tar 가 막히자 **zip 으로 갈아타 실제로 만들었다**(96,723B · 디스크로 확인)
//   T5     tar 를 세 번 시도하고 *"제가 직접 만들어 두지는 못했고 …"* 하며 **사용자에게
//          명령을 넘겼다** — 파일 손도 zip 도 살아 있었는데 한 번도 다른 수단을 안 골랐다
//
// 원인은 모델이 아니다. 내가 실제 손으로 밟은 값(§7-ah):
//   tar -czf … → exitCode **1**(실패했다) · failureState **undefined**(장부엔 실패가 없다)
//   → nextRung(...) → **null**  ← 사다리가 존재해도 안 켜진다
//
// `recovery-ladder.js` 에는 실패 종류별 다음 계단이 11갈래 있고 *"「안 됩니다」로 끝나는
// 문장을 만들지 않는다(막다른 답 금지)"* 는 계약까지 적혀 있다. 계약이 없어서가 아니라
// **닿지 않아서** 어겼다. 그래서 고칠 것은 문구가 아니라 **배선**이다.
//
// ⚠️ 닫는 문장은 **영역**이다 — ✗"압축이 막히면 zip 으로 바꾼다"(전용 집게)
//                            ✓"요구가 안 끝났으면 다른 수단으로 끝까지 간다"(손)
// 그래서 이 검사는 tar 를 특별 취급하지 않는다. **실패가 장부에 남는가**만 문다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { nextRung } from '../src/kernel/l2-plan/recovery-ladder.js';

const 방 = async () => {
  const d = await mkdtemp(join(tmpdir(), 'ladder-'));
  await writeFile(join(d, 'a.md'), 'x');
  return d;
};
const 손들 = ['local.terminal', 'local.file'];

test('실패한 걸음은 장부에 실패로 남는다 — 안 남으면 사다리가 존재해도 안 켜진다', async () => {
  const 손 = makeLocalTerminalTool({});
  const r = await 손.handler({ command: 'tar -czf backup.tar.gz .', cwd: await 방() });
  assert.notEqual(r.result?.exitCode ?? r.exitCode, 0, '이 명령은 실제로 실패한다(전제)');
  assert.notEqual(r.failureState, undefined, '실패했는데 장부가 비어 있으면 다음 수단이 영원히 안 나온다');
  assert.notEqual(r.failureState, 'none');
});

test('장부에 남은 실패는 「다음 수단」으로 이어진다 — 막다른 답을 만들지 않는다', async () => {
  const 손 = makeLocalTerminalTool({});
  const r = await 손.handler({ command: 'tar -czf backup.tar.gz .', cwd: await 방() });
  const 계단 = nextRung([{ ...r, tool: 'local.terminal' }], 손들);
  assert.notEqual(계단, null, '사다리가 null 이면 손은 거기서 멈추고 사용자에게 넘긴다');
  assert.ok(계단.next, '다음에 무엇을 할지가 있어야 한다');
});

test('반대시험 — 성공한 걸음은 사다리를 켜지 않는다 (없는 실패를 만들지 않는다)', async () => {
  const 손 = makeLocalTerminalTool({});
  const r = await 손.handler({ command: 'echo hi', cwd: await 방() });
  assert.equal(r.result?.exitCode ?? r.exitCode, 0);
  assert.equal(nextRung([{ ...r, tool: 'local.terminal' }], 손들), null);
});
