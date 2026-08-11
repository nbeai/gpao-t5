// 상태 지도 §12-S3 — **캡슐 안의 손이 승인 판정을 안 지난다** (2026-08-12).
//
// `capsule.js` 의 RPC 펌프는 `tools.run(...)` 을 곧장 부른다. 그런데 승인 판정
// (`실행전판정` → `decideAutoGrant`)은 그 위층(`tool-boundary.js` · `turn.js`)에 산다.
// 그래서 캡슐 안에서는 **게이트가 통째로 건너뛰어진다**:
//   · `이번이월`(앞 턴에서 넘어온 일 — 지금 요청이 아니다) → 카드가 떠야 할 자리인데 그냥 돈다
//   · `발화밖파괴`(사용자가 가리키지 않은 자리의 삭제)     → 같은 자리
//   · `unknown_kind`(어휘 밖 손 — 분류가 안 된 것)         → 자동으로 흘러간다
//
// 지금 허용손이 `local.file`(reversible:true) 하나라 실효 차이는 좁다. **그러나 경계는
// 좁아서 안전한 게 아니라 서 있어서 안전한 것이다** — 허용손이 하나 늘면 그날 뚫린다.
//
// ── 오픈북: 비교군은 이 자리를 어떻게 다루나 ────────────────────────────────
// Hermes `tools/code_execution_tool.py:1405-1407`:
//   *"Wrapped so the thread inherits the turn's approval context + callbacks
//     (see tools.thread_context) — else gateway sandbox tool calls silently
//     auto-approve dangerous commands (#33057, #30882)."*
// 즉 **샌드박스 안의 RPC 호출이 승인 맥락을 잃으면 조용히 자동승인된다**는 것을 사고번호까지
// 달아 기록해 두었다. 우리가 지금 서 있는 자리가 정확히 그 자리다.
//
// 이 검사는 그 자리를 문다. **판정 함수를 복제하지 않는다** — 캡슐이 커널과 같은 자를 부르는지만 잰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 캡슐실행 } from '../src/runtime/capsule.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';
import { sandboxAvailable } from '../src/runtime/sandbox.js';

const selfState = buildSelfState(demoEnv({ include: ['local.file'], hands: ['local.file'] }));
// 커널 격리가 없는 컴퓨터에서는 캡슐이 애초에 안 열린다 — 그 자리를 성공으로 세지 않는다.
const 캡슐이돈다 = sandboxAvailable();

async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 's3-capsule-gate-'));
  await writeFile(join(dir, '지울것.txt'), '가나다');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir, homeDir: dir });
  return { dir, tools: new ToolRunner({ 'local.file': localFile }) };
}

test('이월된 일은 캡슐 안에서도 그냥 돌지 않는다 — 지금 요청이 아니다', { skip: !캡슐이돈다 }, async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `const r = await t5.call('local_file', { action: 'delete', path: '지울것.txt' });
           console.log(JSON.stringify({ ok: r.ok, error: r.error }));`,
    tools,
    selfState,
    cwd: dir,
    허용손: ['local.file'],
    // 앞 턴에서 넘어온 일이다. `tool-boundary.js:87` 은 이걸 그대로 `needsApproval` 로 올린다.
    이번이월: true,
  });
  assert.equal(existsSync(join(dir, '지울것.txt')), true,
    '이월된 삭제가 캡슐 안에서 승인 없이 실행됐다 — 게이트가 캡슐을 안 문다');
  // **거부는 사실로 남아야 한다.** 조용히 안 하는 것은 거짓 성공의 사촌이다.
  const 거부 = 결과.거부 ?? [];
  assert.ok(거부.length >= 1, `거부 사실이 캡슐 결과에 없다: ${JSON.stringify(결과.거부)}`);
  assert.equal(거부[0].tool, 'local.file');
  assert.ok(String(거부[0].사유 ?? '').length > 0, '거부에 사유가 없다');
  // 스크립트에게도 사유가 간다 — 모델이 이유를 못 받으면 이유를 지어낸다(파일 손에서 겪은 병).
  assert.match(String(결과.stdout ?? ''), /"ok":false/);
});

test('어휘 밖 손(unknown_kind)은 캡슐 안에서 자동으로 흘러가지 않는다', { skip: !캡슐이돈다 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 's3-capsule-unknown-'));
  let 불렸나 = 0;
  // 어느 어휘에도 없는 손이다 — `toolActionKind` 는 `unknown_kind` 로 답한다. 원격 커넥터가
  // 자기 종류를 스스로 적어 내는 자리와 같은 모양(`authority.js:190` 머리 주석의 그 사고).
  // **실행 가능하게** 세운다 — 안 그러면 ToolRunner 의 다른 문에서 막혀 이 계약을 못 잰다.
  const 미상손selfState = {
    ...selfState,
    connectedTools: [...selfState.connectedTools,
      { id: 'x.thing', label: '어휘 밖 손', connected: true, status: 'usable', executable: true, hasHandler: true }],
  };
  const tools = new ToolRunner({
    'x.thing': {
      async handler() { 불렸나 += 1; return { result: { done: true }, userSafeSummary: '했어요' }; },
    },
  });
  const 결과 = await 캡슐실행({
    코드: `const r = await t5.call('x_thing', {}); console.log(JSON.stringify({ ok: r.ok }));`,
    tools,
    selfState: 미상손selfState,
    cwd: dir,
    허용손: ['x.thing'],
  });
  assert.equal(불렸나, 0, '분류되지 않은 손이 캡슐 안에서 승인 없이 실행됐다');
  assert.ok((결과.거부 ?? []).some((r) => r.tool === 'x.thing'),
    `거부 사실이 없다: ${JSON.stringify(결과.거부)}`);
});

test('게이트를 지나는 일은 그대로 돈다 — 카드를 늘리지 않는다', { skip: !캡슐이돈다 }, async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `const r = await t5.call('local_file', { action: 'read', path: '지울것.txt' });
           console.log(String(r.ok));`,
    tools,
    selfState,
    cwd: dir,
    허용손: ['local.file'],
  });
  assert.equal(결과.ok, true, 결과.멈춘이유 ?? 결과.stderr);
  assert.equal(결과.영수증.length, 1, '게이트가 멀쩡한 읽기까지 막았다');
  assert.equal((결과.거부 ?? []).length, 0);
});

// **되돌릴 수 있는 파괴는 그대로 자동이다**(헌장 ② 의 조건). 게이트를 세운다는 것은
// 마찰을 늘린다는 뜻이 아니다 — 커널과 **같은 답**을 낸다는 뜻이다.
test('이월이 아니면 되돌릴 수 있는 삭제는 캡슐 안에서도 자동이다', { skip: !캡슐이돈다 }, async () => {
  const { dir, tools } = await 무대();
  const 결과 = await 캡슐실행({
    코드: `await t5.call('local_file', { action: 'delete', path: '지울것.txt' });`,
    tools,
    selfState,
    cwd: dir,
    허용손: ['local.file'],
  });
  assert.equal(결과.ok, true, 결과.멈춘이유 ?? 결과.stderr);
  assert.equal(existsSync(join(dir, '지울것.txt')), false,
    '커널이 자동으로 두는 일까지 캡슐이 막았다 — 두 층이 다른 답을 낸다');
  assert.equal((결과.거부 ?? []).length, 0);
});
