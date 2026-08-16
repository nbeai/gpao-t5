// 상태 지도 §12-S2 — **샌드박스의 부재가 안전의 증거로 읽혔다** (2026-08-12).
//
// `runCommand` 는 `sandboxAvailable()` 이 false 면 모드와 무관하게 생 `/bin/zsh` 로 간다
// (terminal-run.js:43). 그러면 쓰기·네트워크·시그널이 아무것도 안 막힌 채 **실제로 실행**되고,
// 막힌 자국이 없으니 `looksBlocked` → false → `changes:false` → `read` → **자동**이 됐다.
// 탐침이 아무것도 증명하지 못하는 상황에서 「안 바꾼다」를 주장한 것이다.
//
// 오픈북(오픈클로 `docs/tools/exec.md:98-100`):
//   "sandboxing is off by default … explicit host=sandbox **fails closed** instead of
//    silently running on the gateway host … Enable sandboxing or use host=gateway
//    **with approvals**."
// 축 둘 — ① 조용히 맨몸으로 돌지 않는다 ② 맨몸 경로는 승인을 탄다.
// 우리 판: 명령을 못 돌게 막지는 않되(리눅스에서 터미널이 통째로 죽는다) **탐침이 무죄를
// 주장하지 못하게** 한다 → `unknown_kind` → 카드(fail-closed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';
import { 실행전판정 } from '../src/kernel/l2-plan/tool-boundary.js';
import { decideAutoGrant } from '../src/kernel/l2-plan/authority.js';

// 샌드박스 유무를 주입한다 — 이 판정이 무는 자리는 리눅스인데 검사는 macOS 에서 돈다.
// 주입이 없으면 이 검사가 이 기계에서 영영 건너뛰고, 그건 수리를 안 한 것과 같다.
const 손 = (있나) => makeLocalTerminalTool({
  cwd: '/tmp', dataDir: '/tmp/t5-s2', ...(있나 === undefined ? {} : { sandboxAvailable: () => 있나 }),
});

test('샌드박스가 없으면 탐침이 「안 바꾼다」를 주장하지 않는다', async () => {
  const r = await 손(false).probe('ls -la');
  assert.notEqual(r?.changes, false,
    `**샌드박스가 없는데 탐침이 무죄를 주장했다** — 이 값이 read/자동으로 간다: ${JSON.stringify(r)}`);
  assert.equal(r?.샌드박스없음, true, '못 쟀다는 사실이 결과에 안 실렸다');
});

test('그 탐침 결과는 read가 아닌 probe_observation으로 판정되고 자동 not_run 경계로 간다', async () => {
  const terminal = 손(false);
  const judged = await 실행전판정({ toolId: 'local.terminal', args: { command: 'ls -la' },
    selfState: { connectedTools: [{ id: 'local.terminal', status: 'usable' }] },
    tools: { tools: { 'local.terminal': terminal } } });
  assert.equal(judged.kind, 'probe_observation');
  assert.equal(decideAutoGrant(judged.판정행동), true);
  assert.equal(judged.판정인자.probeResult.sandboxEnforcement.state, 'unavailable');
});

test('샌드박스가 있으면 예전 그대로 — 그물이 안 넓어졌다', { skip: !sandboxAvailable() }, async () => {
  const r = await 손(true).probe('ls -la');
  assert.equal(r?.샌드박스없음, undefined, '샌드박스가 있는데 못 잼 표식이 붙었다');
  assert.equal(typeof r?.changes, 'boolean', `changes 판정이 사라졌다: ${JSON.stringify(r)}`);
  assert.equal(r.sandboxEnforcement?.state, 'enforced');
});

test('수명주기 위험은 샌드박스와 무관하게 먼저 잡힌다', async () => {
  const r = await 손(false).probe('launchctl unload something');
  assert.ok(r?.lifecycle, '수명주기 판정이 샌드박스 분기에 가려졌다');
  assert.equal(r?.changes, true, '수명주기 위험이 changes 를 안 세운다');
});
