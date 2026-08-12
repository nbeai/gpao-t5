// **이음매 ① — 같은 타이핑이 첫 수와 후속 턴에서 같은 등급이다** (§5-2 결재 ① · 2026-08-12)
//
// ── 밟은 기계 사실 ────────────────────────────────────────────────────────
//   `turn.js:1736`  계획 경로 — 실행전판정 을 **`'local.terminal'` 하나에만** 건다(손 이름이 박혀 있다)
//   `turn.js:3088`  걸음 경로 — 실행전판정 을 **모든 손에** 건다
//   `tool-boundary.js:66`  desktop.act 의 click·type·press_key·hotkey 에 probe 를 태워
//                          `눌러본사실` 을 판정인자에 싣는다
//   `action-plan.js:186`   자동 조건 셋 — ① 눌러본사실.찾음===true ② 보안칸 아님 ③ 역할이 secure 아님
//
// 계획 경로에는 probe 가 안 도니 `눌러본사실` 이 없고, 그래서 **같은 `desktop.act type` 이
// 첫 수에는 카드(`field_input`), 후속 턴에는 자동(`organize`)** 이 된다.
// 사용자가 보기엔 같은 행동인데 T5 가 두 번 다르게 군다.
//
// ── 고치는 것은 조항이 아니라 자리다 ──────────────────────────────────────
// 새 분류도 새 게이트도 안 만든다. 계획 경로가 손 하나를 **이름으로 박아 둔 것**이 결함이고,
// 그 경로도 걸음 경로와 **같은 질문을 같은 함수**(`실행전판정`)에 물으면 된다.
//
// ── 오픈북 ────────────────────────────────────────────────────────────────
//   클로드코드(나)   검색창에 글자를 치는 데 승인을 안 받는다. 승인은 되돌릴 수 없는 것·
//                    바깥으로 나가는 것에만. **같은 행동을 첫 수와 두 번째 수에서 다르게
//                    판정하지 않는다.**
//   오픈클로         `docs/tools/browser.md:849-851` — 에이전트에게 브라우저 손은 **하나**이고
//                    `browser act` 가 스냅샷의 `ref` 로 click/type/drag/select 를 한다.
//                    타이핑에 걸리는 per-action 승인은 **없다**(승인은 `exec` 쪽이다).
//   오픈클로         `docs/tools/exec.md:98-100` — *"Explicit `host=sandbox` still fails closed
//                    instead of silently running on the gateway host."* → **못 재면 조인다.**
//   쿠아             `SKILL.md:339-341` — *"After any action, keep using `verify_state` or a fresh
//                    state snapshot for the actual task postcondition."* → 입력 **뒤에** 재관찰.
//   헤르메스         `tools/computer_use/tool.py:86-92` — `type` 은 `_DESTRUCTIVE_ACTIONS` 라
//                    승인을 타지만, 승인 범위가 세션의 `(action, delivery_mode)` 로 잡혀
//                    **첫 수와 다음 수의 등급이 갈리지 않는다**(`_always_allow`).
//
// ── 헌장은 못 넘는다 ──────────────────────────────────────────────────────
// 이 수리는 「못 재서 카드」를 「재서 자동」으로 바꾸는 것이지
// 「위험한 것을 자동」으로 바꾸는 것이 **아니다.** 반대시험 ③④⑤⑥ 가 그 바닥이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoContext } from '../src/surface/demo-context.js';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 창 = { id: 3, pid: 5, app: 'Safari', title: '네이버' };

/** 화면을 흉내 내는 드라이버. **요소는 여기서만 나온다** — 모델이 준 것이 아니다. */
function 가짜드라이버(요소들, { observe실패 = false } = {}) {
  return {
    id: 'cua',
    label: '화면(가짜)',
    본것: 0,
    async status() {
      return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } };
    },
    async observe() {
      this.본것 += 1;
      if (observe실패) throw new Error('화면을 못 읽었다');
      return {
        frontmost: { name: 창.app },
        본창: { ...창, bounds: { x: 0, y: 0, w: 1200, h: 800 } },
        elements: 요소들,
      };
    },
    async act() { return { effect: 'confirmed' }; },
  };
}

const 검색칸 = { id: 'e3', element_token: 's1:3', role: 'AXSearchField', label: '검색어 입력', value: '', isEnabled: true };
const 비밀칸 = { id: 'e4', element_token: 's1:4', role: 'AXSecureTextField', label: '비밀번호', isEnabled: true };

const 타이핑 = (덧 = {}) => ({
  action: 'type', app: 'Safari', 창제목: '네이버',
  대상: { 토큰: 's1:3', label: '검색어 입력' },
  값: '오늘 날씨',
  ...덧,
});

/**
 * 한 대화 = 한 ctx. 모델은 요청 턴에서 `호출들` 을 한 번만 낸다.
 * (전역 카운터로 세면 승인 재개·답완성 호출까지 먹어 대본이 제품을 못 잰다 — F-58 검사의 교훈.)
 */
function 판(요소들, 호출들, opts = {}) {
  const 드라이버 = 가짜드라이버(요소들, opts);
  const 손 = makeDesktopActTool({ drivers: [드라이버] });
  // **탐침을 몇 번 돌렸는지 센다**(반대시험 ⑦). 손 바깥에서 세야 판정 자리를 안 건드린다.
  const 잰것 = { 탐침: 0 };
  const 원래탐침 = 손.probe.bind(손);
  손.probe = async (args) => { 잰것.탐침 += 1; return 원래탐침(args); };
  const ctx = {
    ...demoContext({ desktopAct: 손 }),
    knownCounterparts: new Set(),
    pending: new Map(),
    model: {
      냈나: false,
      async respond(tc) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        if (tc?.answerOnly) return { text: '했어.' };
        if (this.냈나) return { text: '했어.' };
        this.냈나 = true;
        return { text: '', toolCalls: 호출들.map((args, i) => ({ providerCallId: `p${i + 1}`, name: 'desktop.act', args })) };
      },
    },
  };
  return { ctx, 드라이버, 손, 잰것 };
}

const 화면손돌았나 = (결과) => (결과.turnExchange ?? []).some((x) => x.tool === 'desktop.act');

// ── ① 요소로 짚은 검색창 타이핑이 **첫 수에서** 카드 없이 자동이다 ─────────
test('① 첫 수의 검색창 타이핑은 카드 없이 자동이다 — 계획 경로에 probe 가 안 돌던 그 자리', async () => {
  const { ctx, 잰것 } = 판([검색칸], [타이핑()]);
  const 결과 = await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.notEqual(결과.kind, 'approval',
    `**첫 수 타이핑에 승인 카드가 떴다** — 계획 경로가 probe 를 안 태워 「못 재서 카드」가 된 자리다. 잰 탐침: ${잰것.탐침}회`);
  assert.ok(화면손돌았나(결과),
    '카드는 없는데 **손이 안 돌았다** — 카드만 사라지고 일이 안 되면 수리가 아니다');
});

// ── ② 같은 타이핑이 첫 수와 후속 걸음에서 **같은 등급**이다 ────────────────
//
// 모델이 한 응답에 같은 손을 두 번 부르면 **첫 호출은 계획 경로**, 나머지는 **걸음 줄**이다
// (`turn.js:1649-1651`). 즉 이 한 턴이 두 레인을 동시에 밟는다.
test('② 같은 타이핑이 계획 레인·걸음 레인에서 같은 등급이다 — 지금은 갈린다', async () => {
  const { ctx } = 판([검색칸], [타이핑(), 타이핑({ 값: '내일 날씨' })]);
  const 결과 = await runTurn({ text: '네이버에서 날씨 두 번 검색해줘' }, ctx);
  assert.notEqual(결과.kind, 'approval',
    '**두 레인이 같은 행동에 다른 답을 냈다** — 첫 호출(계획)만 카드가 되고 둘째(걸음)는 자동이다');
  const 돈것 = (결과.turnExchange ?? []).filter((x) => x.tool === 'desktop.act').length;
  assert.equal(돈것, 2, `두 걸음 다 돌아야 한다(계획 레인 1 + 걸음 레인 1) — 실제: ${돈것}`);
});

// ── ③ 보안 칸 타이핑은 첫 수에서도 **보호된 입력면**이다 (헌장 ①) ──────────
test('③ 보안 칸 타이핑은 첫 수에서도 카드다 — 비밀값은 사람만(헌장 ①)', async () => {
  const { ctx } = 판([비밀칸], [타이핑({ 대상: { 토큰: 's1:4', label: '비밀번호' }, 값: 'hunter2' })]);
  const 결과 = await runTurn({ text: '비밀번호 입력해줘' }, ctx);
  assert.equal(결과.kind, 'approval',
    '**비밀번호 칸에 카드 없이 글자가 들어간다** — 헌장 ① 붕괴. 이 수리가 못 넘는 바닥이다');
});

// ── ④ 좌표·커서로 짚은 타이핑은 여전히 카드다 (미상 → fail-closed) ─────────
test('④ 좌표로 짚은 타이핑은 여전히 카드다 — 이름 없는 자리는 약속할 수 없다', async () => {
  const { ctx } = 판([검색칸], [타이핑({ 대상: { x: 100, y: 200 } })]);
  const 결과 = await runTurn({ text: '거기에 글자 넣어줘' }, ctx);
  assert.equal(결과.kind, 'approval',
    '**눈으로 본 자리에 조용히 글자가 들어간다** — 좌표 규율(오너 2026-08-06)은 손대지 않는다');
});

test('④-b 커서 자리에 치는 타이핑도 여전히 카드다 — 커서가 어디 있는지 우리가 모른다', async () => {
  // 대상이 비어 있고 탐침도 그 칸을 못 찾는 판 — `커서에침` 이 서서 미상이다.
  const { ctx } = 판([], [타이핑({ 대상: {} })]);
  const 결과 = await runTurn({ text: '여기 글자 넣어줘' }, ctx);
  assert.equal(결과.kind, 'approval',
    '**커서 자리에 조용히 글자가 들어간다** — 어디에 넣는지 모르는데 자동으로 넣었다');
});

// ── ⑤ `기대.바깥으로 === true` (새 상대 전송)는 여전히 승인이다 (헌장 ③) ───
test('⑤ 밖으로 나간다고 신고된 걸음은 여전히 승인이다 — 새 상대 첫 전송(헌장 ③)', async () => {
  const { ctx } = 판([검색칸], [타이핑({ 기대: { 요소: '대화 입력', 값: '오늘 날씨', 바깥으로: true } })]);
  const 결과 = await runTurn({ text: '이 말 보내줘' }, ctx);
  assert.equal(결과.kind, 'approval',
    '**새 상대에게 카드 없이 나갔다** — 헌장 ③ 붕괴. 이 수리가 못 넘는 바닥이다');
});

// ── ⑥ probe 가 없거나 실패하는 손은 **카드로 떨어진다** ────────────────────
//
// 오픈클로 `docs/tools/exec.md:98-100`: *"Explicit `host=sandbox` still fails closed instead of
// silently running on the gateway host."* — 못 재면 조인다. 재 봤더니 안전한 것만 자동이다.
test('⑥-a 탐침이 화면을 못 읽으면 카드다 — 못 재면 조인다(fail-closed)', async () => {
  const { ctx } = 판([검색칸], [타이핑()], { observe실패: true });
  const 결과 = await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.equal(결과.kind, 'approval',
    '**화면을 못 읽었는데 자동으로 글자를 넣었다** — 미상이 자동으로 흘렀다');
});

test('⑥-b 탐침 자체가 터져도 판정 자리가 죽지 않고 카드로 떨어진다', async () => {
  const { ctx, 손 } = 판([검색칸], [타이핑()]);
  손.probe = async () => { throw new Error('탐침이 터졌다'); };
  const 결과 = await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.equal(결과.kind, 'approval',
    '**탐침이 터졌는데 자동으로 흘렀다(또는 턴이 통째로 죽었다)** — 못 재면 카드다');
});

// ── ⑦ 같은 사실을 두 번 재지 않는다 ────────────────────────────────────────
//
// 계획 경로에서 잰 `눌러본사실` 이 실려 가면 걸음·실행이 같은 질문을 다시 묻지 않는다.
// 왕복은 사용자 비용이다 — 자리를 옮기는 값이 두 배가 되면 수리가 아니라 세금이다.
test('⑦ 한 걸음의 판정 탐침은 한 번이다 — 같은 사실을 두 번 묻지 않는다', async () => {
  const { ctx, 잰것 } = 판([검색칸], [타이핑()]);
  await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.equal(잰것.탐침, 1,
    `같은 걸음의 판정 탐침이 ${잰것.탐침}회 돌았다 — 계획에서 잰 것을 걸음이 또 재고 있다`);
});
