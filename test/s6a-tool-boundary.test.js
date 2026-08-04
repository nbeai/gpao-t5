// **S6-a — 실행 경계가 섰다. 행동은 하나도 안 바뀌었다.**
//
// 원리 ④: 정책은 **실행 경계의 훅**에 있다. `turn.js` 는 같은 판정을 두 벌 돌렸고
// 그 대가가 주석에 기록돼 있다 — `rm -rf` 가 걸음 경로에서만 자동 실행, 빈 대상 카드,
// 그리고 재현된 F-20(헌장 ③ 이 경로에 따라 갈림).
//
// **S6-a 의 성공 기준은 "옮겼다"가 아니라 "아무것도 안 바뀌었다"** 이다.
// 회귀·돌연변이가 그대로여야 다음 칸(S6-b · 계획 경로를 같은 자리로)이 안전하다.
//
// 여기서는 경계 자체의 계약을 잰다 — 순수하고, 실행하지 않고, 턴을 끝내지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 실행전판정 } from '../src/kernel/l2-plan/tool-boundary.js';

const 상태 = (over = []) => ({ connectedTools: [
  { id: 'local.file', executable: true, reversible: true, needsApproval: false },
  { id: 'telegram.send', executable: true, reversible: false, needsApproval: true },
  { id: 'local.terminal', executable: true, reversible: false, needsApproval: false },
  ...over,
] });

test('① 손의 선언이 판정에 그대로 실린다(되돌릴 수 있는가 · 승인이 필요한가)', async () => {
  const r = await 실행전판정({ toolId: 'telegram.send', args: { target: '111', text: 'x' }, selfState: 상태() });
  assert.equal(r.판정행동.revocable, false, '되돌릴 수 없다는 선언이 판정에 안 실렸다');
  assert.equal(r.판정행동.needsApproval, true);
});

test('② **이월이면 손 선언과 무관하게 승인으로 간다** — 되돌릴 수 있어도 지금 요청이 아니다', async () => {
  const 그냥 = await 실행전판정({ toolId: 'local.file', args: { action: 'list' }, selfState: 상태() });
  assert.equal(그냥.판정행동.needsApproval, false, '평범한 읽기가 승인으로 갔다');

  const 이월 = await 실행전판정({ toolId: 'local.file', args: { action: 'list' }, selfState: 상태(), 이번이월: true });
  assert.equal(이월.판정행동.needsApproval, true, '이월인데 자동으로 갔다 — 지금 요청이 아니다');
});

test('③ **발화 밖 파괴는 승인으로 간다**(현재 요청 침해 0)', async () => {
  const 발화 = { action: 'read', path: '보고서.md' };   // 사용자는 읽기를 시켰다
  const r = await 실행전판정({
    toolId: 'local.file', args: { action: 'delete', path: '다른것.csv' },
    selfState: 상태(), 이번발화: 발화,
  });
  assert.equal(r.판정행동.needsApproval, true,
    '사용자가 시키지 않은 파괴가 자동으로 갔다 — 절대 게이트 "현재 요청 침해"의 자리다');
});

test('④ 터미널은 **돌려 봐야 안다** — probe 결과가 판정 인자에 실린다', async () => {
  let 물어본것 = null;
  const tools = { tools: { 'local.terminal': {
    async probe(cmd, opts) { 물어본것 = { cmd, opts }; return { changes: true, probe: 'rm' }; },
  } } };
  const r = await 실행전판정({
    toolId: 'local.terminal', args: { command: 'rm -rf ./x', cwd: '/tmp' },
    selfState: 상태(), tools,
  });
  assert.deepEqual(물어본것, { cmd: 'rm -rf ./x', opts: { cwd: '/tmp' } }, 'probe 를 안 탔다');
  assert.equal(r.판정인자.changes, true, 'probe 가 알아낸 사실이 판정 인자에 안 실렸다');
  assert.equal(r.판정인자.granted, true);
});

test('⑤ **경계는 실행하지 않는다** — 판정만 돌려준다', async () => {
  let 실행됨 = false;
  const tools = { tools: { 'local.file': { async handler() { 실행됨 = true; return {}; } } } };
  await 실행전판정({ toolId: 'local.file', args: { action: 'delete', path: 'x' }, selfState: 상태(), tools });
  assert.equal(실행됨, false, '경계가 도구를 실행했다 — 훅은 판정까지다');
});

test('⑥ 모르는 손도 죽지 않는다(선언이 없으면 없는 대로 판정한다)', async () => {
  const r = await 실행전판정({ toolId: '없는손', args: {}, selfState: 상태() });
  assert.ok(r.판정행동.kind, '등급이 없으면 승인 경계가 판단할 근거를 잃는다');
  assert.equal(r.판정행동.revocable, undefined, '모르는 것을 안다고 하지 않는다');
});
