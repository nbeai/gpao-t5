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
function 가짜드라이버(요소들, { observe실패 = false, 창상태 = 창 } = {}) {
  let 실행수 = 0;
  return {
    id: 'cua',
    label: '화면(가짜)',
    본것: 0,
    get 한것() { return 실행수; },
    async status() {
      return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } };
    },
    async observe() {
      this.본것 += 1;
      if (observe실패) throw new Error('화면을 못 읽었다');
      return {
        frontmost: { name: 창상태.app },
        본창: { ...창상태, bounds: { x: 0, y: 0, w: 1200, h: 800 } },
        elements: 요소들,
      };
    },
    async act() { 실행수 += 1; return { effect: 'confirmed' }; },
  };
}

const 검색칸 = { id: 'e3', 토큰: 's1:3', element_token: 's1:3', role: 'AXSearchField', label: '검색어 입력', value: '', isEnabled: true };
const 비밀칸 = { id: 'e4', 토큰: 's1:4', element_token: 's1:4', role: 'AXSecureTextField', label: '비밀번호', isEnabled: true };

const 타이핑 = (덧 = {}) => {
  const 값 = 덧.값 ?? '오늘 날씨';
  return {
    action: 'type', app: 'Safari', 창제목: '네이버',
    대상: { 토큰: 's1:3', label: '검색어 입력' },
    값,
    기대: { 요소: 's1:3', 값 },
    ...덧,
  };
};

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

// turnExchange에는 모델이 제안했지만 권위 경계에서 실행되지 않은 호출도 사실로 보인다.
// 실제 실행 여부는 원장의 actualCall만이 정본이다.
// ── ① 요소로 짚은 검색창 타이핑이 **첫 수에서** 카드 없이 자동이다 ─────────
test('① 첫 수의 검색창 타이핑은 카드 없이 자동이다 — 계획 경로에 probe 가 안 돌던 그 자리', async () => {
  const { ctx, 드라이버, 잰것 } = 판([검색칸], [타이핑()]);
  const 결과 = await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.notEqual(결과.kind, 'approval',
    `**첫 수 타이핑에 승인 카드가 떴다** — 계획 경로가 probe 를 안 태워 「못 재서 카드」가 된 자리다. 잰 탐침: ${잰것.탐침}회`);
  assert.equal(드라이버.한것, 1,
    `카드는 없는데 **손이 안 돌았다** — 카드만 사라지고 일이 안 되면 수리가 아니다: ${JSON.stringify(결과.turnExchange)}`);
});

// ── ② 같은 타이핑이 첫 수와 후속 걸음에서 **같은 등급**이다 ────────────────
//
// 모델이 한 응답에 같은 손을 두 번 부르면 **첫 호출은 계획 경로**, 나머지는 **걸음 줄**이다
// (`turn.js:1649-1651`). 즉 이 한 턴이 두 레인을 동시에 밟는다.
test('② 같은 타이핑이 계획 레인·걸음 레인에서 같은 등급이다 — 지금은 갈린다', async () => {
  const { ctx, 드라이버 } = 판([검색칸], [타이핑(), 타이핑({ 값: '내일 날씨' })]);
  const 결과 = await runTurn({ text: '네이버에서 날씨 두 번 검색해줘' }, ctx);
  assert.notEqual(결과.kind, 'approval',
    '**두 레인이 같은 행동에 다른 답을 냈다** — 첫 호출(계획)만 카드가 되고 둘째(걸음)는 자동이다');
  const 돈것 = 드라이버.한것;
  assert.equal(돈것, 2, `두 걸음 다 돌아야 한다(계획 레인 1 + 걸음 레인 1) — 실제: ${돈것}`);
});

// ── ③ 보안 칸 타이핑은 첫 수에서도 **보호된 입력면**이다 (헌장 ①) ──────────
test('③ 보안 칸 타이핑은 카드가 아니라 보호 차단이며 실행 0이다', async () => {
  const { ctx, 드라이버 } = 판([비밀칸], [타이핑({ 대상: { 토큰: 's1:4', label: '비밀번호' }, 값: 'hunter2' })]);
  const 결과 = await runTurn({ text: '비밀번호 입력해줘' }, ctx);
  assert.equal(결과.kind, 'reply');
  assert.equal(드라이버.한것, 0, '보호 입력을 일반 화면 손이 실행했다');
  assert.match(JSON.stringify(결과.ledger), /비밀값|protected_secret_surface|blocked/,
    '계획 레인에서 보호 차단 사실이 모델·원장으로 전달되지 않았다');
  assert.notEqual(결과.reply, '했어.', '실행 0인데 모델의 완료 답을 그대로 사용자에게 보냈다');
  assert.doesNotMatch(JSON.stringify([결과.ledger, 결과.turnExchange]), /hunter2/,
    '보호 입력값이 원장이나 모델 교환 사실에 남았다');
});

test('③-b 과거에 허락한 같은 화면 손도 보안 칸 보호를 열지 못한다', async () => {
  const { ctx, 드라이버 } = 판([비밀칸], [타이핑({ 대상: { 토큰: 's1:4', label: '비밀번호' }, 값: 'hunter2' })]);
  ctx.허락한손 = new Set(['desktop.act']);
  const 결과 = await runTurn({ text: '비밀번호 입력해줘' }, ctx);
  assert.notEqual(결과.kind, 'approval');
  assert.equal(드라이버.한것, 0, '과거 승인 면제가 보호 비밀 입력을 실행했다');
  assert.match(JSON.stringify(결과.ledger), /비밀값|protected_secret_surface|blocked/);
  assert.notEqual(결과.reply, '했어.', '승인 재개 뒤 실행 0인데 완료 답을 그대로 보냈다');
  assert.doesNotMatch(JSON.stringify([결과.ledger, 결과.turnExchange]), /hunter2/);
});

test('③-c 승인 뒤 일반 칸이 보안 칸으로 바뀌면 현재 현실에서 다시 막고 값도 남기지 않는다', async () => {
  const 바뀌는칸 = {
    id: 'e4', 토큰: 's1:4', element_token: 's1:4', role: 'AXTextField',
    label: '입력', value: '', isEnabled: true,
  };
  const 호출 = 타이핑({
    대상: { 토큰: 's1:4', label: '입력' },
    값: 'hunter2',
    기대: { 요소: 's1:4', 값: 'hunter2', 바깥으로: true },
  });
  const { ctx, 드라이버 } = 판([바뀌는칸], [호출]);
  const 카드 = await runTurn({ text: '그 칸에 넣고 보내줘' }, ctx);
  assert.equal(카드.kind, 'approval');

  바뀌는칸.role = 'AXSecureTextField';
  바뀌는칸.label = '비밀번호';
  const 결과 = await runTurn({ approve: 카드.pendingId }, ctx);

  assert.equal(드라이버.한것, 0, '승인 전 일반 칸이라는 옛 사실로 보안 칸에 실제 입력했다');
  assert.notEqual(결과.kind, 'approval', '보호 차단을 새 승인카드로 바꿨다');
  assert.notEqual(결과.reply, '했어.', '실행 0인데 완료 답을 그대로 보냈다');
  assert.doesNotMatch(JSON.stringify([결과.ledger, 결과.turnExchange]), /hunter2/,
    '보호 경계로 바뀐 값이 원장이나 모델 교환에 남았다');
});

test('③-d 승인 뒤 외부 전송 상대가 바뀌면 옛 카드로 실행하지 않고 현재 카드로 교체한다', async () => {
  const 창상태 = { id: 3, pid: 5, app: '카톡', title: 'A방' };
  const 입력칸 = {
    id: 'e5', 토큰: 's1:5', element_token: 's1:5', role: 'AXTextArea',
    label: '메시지 입력', value: '', isEnabled: true,
  };
  const 호출 = 타이핑({
    app: '카톡', 창제목: undefined,
    대상: { 토큰: 's1:5', label: '메시지 입력' },
    값: 'hello', 기대: { 요소: 's1:5', 값: 'hello', 바깥으로: true },
  });
  const { ctx, 드라이버 } = 판([입력칸], [호출], { 창상태 });
  const 첫카드 = await runTurn({ text: '현재 방에 hello 보내줘' }, ctx);
  assert.equal(첫카드.kind, 'approval');
  assert.match(JSON.stringify(첫카드.pending), /A방/);

  창상태.title = 'B방';
  const 바뀐카드 = await runTurn({ approve: 첫카드.pendingId }, ctx);
  assert.equal(드라이버.한것, 0, 'A방 승인을 B방 실행에 사용했다');
  assert.equal(바뀐카드.kind, 'approval', '바뀐 외부 효과를 현재 카드로 다시 묻지 않았다');
  assert.match(JSON.stringify(바뀐카드.pending), /B방/);
  assert.doesNotMatch(JSON.stringify(바뀐카드.pending), /A방/);
  assert.equal(ctx.knownCounterparts.size, 0, '실행하지 않은 옛 A방을 아는 상대로 기억했다');
  assert.equal(ctx.pending.size, 1, '옛 카드와 새 카드가 함께 살아 있다');
});

test('③-e 새 카드에서 상대 신분이 안 서면 옛 상대를 기억하지 않는다', async () => {
  const 창상태 = { id: 3, pid: 5, app: '카톡', title: 'A방' };
  const 입력칸 = { id: 'e5', 토큰: 's1:5', element_token: 's1:5', role: 'AXTextArea', label: '메시지 입력', value: '', isEnabled: true };
  const 호출 = 타이핑({
    app: '카톡', 창제목: undefined, 대상: { 토큰: 's1:5', label: '메시지 입력' },
    값: 'hello', 기대: { 요소: 's1:5', 값: 'hello', 바깥으로: true },
  });
  const { ctx, 드라이버 } = 판([입력칸], [호출], { 창상태 });
  const 첫카드 = await runTurn({ text: '현재 방에 hello 보내줘' }, ctx);
  assert.equal(첫카드.kind, 'approval');

  창상태.title = 'B방 4'; // 변하는 안 읽음 배지라 상대 신분은 의도적으로 서지 않는다.
  const 새카드 = await runTurn({ approve: 첫카드.pendingId }, ctx);
  assert.equal(새카드.kind, 'approval');
  assert.equal(드라이버.한것, 0);
  await runTurn({ approve: 새카드.pendingId }, ctx);

  assert.equal(드라이버.한것, 1, '두 번째 현재 카드를 승인했는데 실행되지 않았다');
  assert.equal(ctx.knownCounterparts.size, 0, '실행하지 않은 옛 A방을 아는 상대로 기억했다');
});

// ── ④ 좌표·커서로 짚은 타이핑은 여전히 카드다 (미상 → fail-closed) ─────────
test('④ 좌표로 짚은 타이핑은 관측/재계획이며 실행 0이다', async () => {
  const { ctx, 드라이버 } = 판([검색칸], [타이핑({ 대상: { x: 100, y: 200 } })]);
  const 결과 = await runTurn({ text: '거기에 글자 넣어줘' }, ctx);
  assert.equal(결과.kind, 'reply');
  assert.equal(드라이버.한것, 0);
});

test('④-b 커서 자리에 치는 타이핑도 관측/재계획이며 실행 0이다', async () => {
  // 대상이 비어 있고 탐침도 그 칸을 못 찾는 판 — `커서에침` 이 서서 미상이다.
  const { ctx, 드라이버 } = 판([], [타이핑({ 대상: {} })]);
  const 결과 = await runTurn({ text: '여기 글자 넣어줘' }, ctx);
  assert.equal(결과.kind, 'reply');
  assert.equal(드라이버.한것, 0);
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
test('⑥-a 탐침이 화면을 못 읽으면 카드 없이 실행 제외한다', async () => {
  const { ctx, 드라이버 } = 판([검색칸], [타이핑()], { observe실패: true });
  const 결과 = await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.equal(결과.kind, 'reply');
  assert.equal(드라이버.한것, 0);
});

test('⑥-b 탐침 자체가 터져도 판정 자리가 죽지 않고 실행 제외된다', async () => {
  const { ctx, 손, 드라이버 } = 판([검색칸], [타이핑()]);
  손.probe = async () => { throw new Error('탐침이 터졌다'); };
  const 결과 = await runTurn({ text: '네이버에서 오늘 날씨 검색해줘' }, ctx);
  assert.equal(결과.kind, 'reply');
  assert.equal(드라이버.한것, 0);
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
