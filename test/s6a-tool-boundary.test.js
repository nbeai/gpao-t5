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

// ── 승인 면제 (S6-b) — **같은 질문을 두 번 하지 않는다** ────────────────────
//
// 면제는 둘인데 각 경로가 서로 다른 하나만 읽고 있었다(F-20 재현).
// 이제 경계 한 자리에서 둘 다 본다. 돌연변이 스윕이 이 계약이 **무방비**라고 알려 줘서 세웠다.
import { 승인면제 } from '../src/kernel/l2-plan/tool-boundary.js';
import { rememberCounterpart } from '../src/kernel/l2-plan/known-counterpart.js';

test('⑦ **되돌릴 수 있는 손은 이번 요청에서 다시 안 묻는다**', () => {
  const 허락한손 = new Set(['local.file']);
  const r = 승인면제({ toolId: 'local.file', 허락한손, 되돌릴수있나: true });
  assert.equal(r.면제, true, '같은 요청에서 이미 허락한 손인데 또 묻는다 — 같은 질문을 두 번 받는다');
  assert.equal(r.이유, '허락한손');
});

// **손 면제는 되돌릴 수 없는 것까지 덮지 않는다**(2026-08-05 · 밟아서 확인).
// 사용자가 `rm -rf ./임시` 를 승인했더니 재개 루프에서 모델이 낸 `rm -rf /전혀다른곳` 이
// 승인 없이 실행됐다. 승인은 **그 명령**에 준 것이지 "앞으로 이 손 마음대로"가 아니다.
test('⑦-a **되돌릴 수 없는 것은 손을 허락했어도 다시 묻는다**(헌장 ②)', () => {
  const 허락한손 = new Set(['local.terminal']);
  assert.equal(승인면제({ toolId: 'local.terminal', 허락한손, 되돌릴수있나: false }).면제, false,
    '승인한 손이라고 다음 파괴까지 자동으로 나갔다 — 헌장 ②가 무너진다');
});

test('⑦-b 되돌릴 수 있는지 **모르면 묻는다**(모르는 것을 안전하다고 하지 않는다)', () => {
  const 허락한손 = new Set(['새손']);
  assert.equal(승인면제({ toolId: '새손', 허락한손 }).면제, false,
    '선언이 없는 손을 되돌릴 수 있다고 가정했다');
});

test('⑧ **손이 다르면 다른 결정이다** — 면제가 번지지 않는다', () => {
  const 허락한손 = new Set(['local.file']);
  assert.equal(승인면제({ toolId: 'local.terminal', 허락한손 }).면제, false,
    '파일을 허락했다고 터미널까지 자동으로 열리면 승인이 의미를 잃는다');
});

test('⑨ **헌장 ③ — 아는 상대면 전송을 다시 안 묻는다**(경로와 무관하게)', () => {
  const known = new Set();
  rememberCounterpart(known, 'telegram.send', '111');
  const r = 승인면제({
    toolId: 'telegram.send', 판정인자: { target: '111' },
    knownCounterparts: known, 전송인가: true,
  });
  assert.equal(r.면제, true, '아는 상대인데 또 물었다 — 헌장 ③ 위반');
  assert.equal(r.이유, '아는상대');
});

test('⑩ **새 상대는 묻는다** — 헌장 ③ 은 첫 전송을 면제하지 않는다', () => {
  const known = new Set();
  rememberCounterpart(known, 'telegram.send', '111');
  assert.equal(승인면제({
    toolId: 'telegram.send', 판정인자: { target: '999' },
    knownCounterparts: known, 전송인가: true,
  }).면제, false, '모르는 상대에게 첫 전송이 자동으로 나갔다 — 헌장 ③ 의 본체다');
});

test('⑪ 대상이 아직 없으면 면제하지 않는다(어디로 보낼지 모르는 채 자동 금지)', () => {
  const known = new Set();
  rememberCounterpart(known, 'telegram.send', '111');
  assert.equal(승인면제({
    toolId: 'telegram.send', 판정인자: {}, knownCounterparts: known, 전송인가: true,
  }).면제, false, '대상 미정인데 면제했다 — 빈 대상으로 나갈 수 있다');
});

test('⑫ 전송이 아닌 손에는 아는 상대 면제를 쓰지 않는다', () => {
  const known = new Set();
  rememberCounterpart(known, 'telegram.send', '111');
  assert.equal(승인면제({
    toolId: 'local.file', 판정인자: { target: '111' }, knownCounterparts: known, 전송인가: false,
  }).면제, false, '전송 면제가 파일 손까지 번졌다');
});
