// **빈 키는 누른 것이 아니다** + **빈 칸도 되돌릴 수 있는 칸이다.**
//
// 밟은 사실(라이브 2026-08-06 · F-42/F-44 확인 턴).
//   · 입력은 됐다 — 입력칸(y 711)에 `F42 자동 테스트` 가 들어갔다.
//   · 전송은 안 됐다 — 모델이 `press_key` 에 **`값: ""`** 를 보냈고, 손이 **그대로 보냈다.**
//     그러고도 *"했어요"* 가 나왔다. 아무 키도 안 눌렀는데 한 것이 됐다(A14 자리).
//   · 카드가 아직 2장이다 — **빈 입력칸은 `value` 가 `null`** 이라 탐침이 `값있음:false` 로
//     떨어지고, 미상은 승인으로 간다. 글자를 넣은 뒤에는 `value` 가 읽힌다(확인함).
//     칸이 비어 있다는 이유로 카드를 띄우는 건 **첫 입력마다 카드**라는 뜻이다.
//
// 되돌릴 수 있는지는 **역할이 말해 준다** — 글자를 넣는 칸은 지우면 돌아간다.
// 이건 문구로 재는 게 아니라(계열 E) 드라이버가 준 **AX 분류**를 쓰는 것이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { toolActionKind } from '../src/kernel/l2-plan/action-plan.js';

const 빈칸 = {
  id: 's1:26', 토큰: 's1:26', 스냅샷: 's1', 번호: 26,
  role: 'AXTextArea', label: '메시지 입력', value: null, 창: 9, pid: 77, isEnabled: true,
};

const 손세우기 = (간것 = []) => makeDesktopActTool({
  drivers: [{
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({
      frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
      본창: { id: 9, app: '카카오톡', title: '박종윤', pid: 77 }, elements: [빈칸],
    }),
    act: (요청) => { 간것.push(요청); return { ok: true, 확인됨: true, 근거: 'ok' }; },
  }],
});

// ── 빈 키 ────────────────────────────────────────────────────────────────
test('빈 키는 누르지 않는다 — 아무것도 안 하고 "했어요"가 되던 자리', async () => {
  const 간것 = [];
  const r = await 손세우기(간것).handler({ action: 'press_key', app: 'K', 값: '' });
  assert.equal(간것.length, 0, `**빈 키를 그대로 보냈다**: ${JSON.stringify(간것)}`);
  assert.equal(r.blocked, true);
});

test('어떤 키인지 말해 준다 — 모델이 고칠 수 있어야 한다', async () => {
  const r = await 손세우기().handler({ action: 'press_key', app: 'K', 값: '' });
  assert.match(JSON.stringify(r.다음수단 ?? []), /값/, `**막고 갈 곳을 안 준다**: ${JSON.stringify(r.다음수단)}`);
  assert.match(r.userSafeSummary, /키/, r.userSafeSummary);
});

test('단축키·메뉴도 빈 값이면 안 한다 — 같은 규율이다', async () => {
  for (const [행동, 값] of [['hotkey', ''], ['menu', []]]) {
    const 간것 = [];
    await 손세우기(간것).handler({ action: 행동, app: 'K', 값 });
    assert.equal(간것.length, 0, `**${행동} 이 빈 값으로 나갔다**`);
  }
});

// ── 빈 칸도 되돌릴 수 있다 → 뒤집혔다가(F-58 (가-2) · 2026-08-09) **되돌아왔다** ────
//
// 이 검사는 원래 "빈 칸이라고 카드를 띄우지 마라(organize)"를 물었다. (가-2)가 그것을
// `field_input`(기본 카드)으로 뒤집었고, 오너 결재 ①(2026-08-11)이 다시 되돌렸다 —
// **칸에 글자 넣기는 자동이고, 카드는 밖으로 나가는 걸음에만.** 그러니 이 검사가 처음에
// 지키던 값("첫 입력마다 카드가 뜨면 그건 안전이 아니라 마찰")이 그대로 돌아온 것이다.
//
// (가-2)가 걱정한 구멍 — *채팅 입력칸에 글자가 카드 없이 들어간다* — 은 열리지 않는다.
// 들어간 글자가 **나가는** 걸음(엔터·보내기 버튼)에 카드가 그대로 서 있다. 이 파일 머리의
// 라이브가 정확히 채팅 입력칸이었고, 거기서도 "보내기"는 여전히 사람이 누른다.
test('글자 넣기는 빈 칸이어도 자동이다 — 첫 입력마다 카드는 안전이 아니라 마찰이다', async () => {
  const 눌러본사실 = await 손세우기().probe({
    action: 'type', app: 'K', 대상: { id: 's1:26', label: '메시지 입력' },
  });
  assert.equal(눌러본사실?.찾음, true);
  assert.equal(눌러본사실?.보안칸, false, '보안 칸 여부가 기계 사실로 안 선다 — 자동 조건 ②를 못 세운다');
  const kind = toolActionKind({ toolId: 'desktop.act', args: { action: 'type', 눌러본사실 } });
  const { decideAutoGrant } = await import('../src/kernel/l2-plan/authority.js');
  assert.equal(decideAutoGrant({ kind }), true,
    `**빈 칸 첫 입력에 카드가 뜬다**(kind=${kind}) — 결재 ① 이 집행되지 않았다`);
});

test('그 칸에서 엔터를 치는 것은 여전히 카드다 — 넣기와 보내기는 다른 걸음이다', async () => {
  const kind = toolActionKind({
    toolId: 'desktop.act',
    args: { action: 'press_key', 값: 'return', 눌러본사실: { 칸내용: '안녕', 본창: { app: 'K' } } },
  });
  const { decideAutoGrant } = await import('../src/kernel/l2-plan/authority.js');
  assert.equal(decideAutoGrant({ kind }), false, '**칸 내용이 카드 없이 밖으로 나간다**');
  assert.equal(decideAutoGrant({ kind, counterpartKnown: true }), true,
    '아는 상대인데도 묻는다 — 반복 마찰을 줄이는 자리가 죽었다(사거리 비대칭병 재발)');
});

// ── 결재 ① 나머지 절반 (§5-2 · 2026-08-12) — 검색 칸의 엔터는 확정이라 자동이다 ──
//
// 실측(2026-08-11): 네이버 검색 한 문장에 카드 2장 — 그중 하나가 검색창의 엔터였다.
// 검색 확정에는 헌장 ③ 의 「상대」가 없다. 판정 재료는 탐침이 읽은 AX 역할 하나다.
test('검색 칸의 엔터는 전송이 아니라 확정이다 — 자동으로 간다', async () => {
  const kind = toolActionKind({
    toolId: 'desktop.act',
    args: {
      action: 'press_key', 값: 'return',
      눌러본사실: { 칸내용: '전세사기', 칸역할: 'AXSearchField', 본창: { app: 'Google Chrome' } },
    },
  });
  assert.equal(kind, 'search', `검색 확정이 search 로 안 선다 — kind=${kind}`);
  const { decideAutoGrant } = await import('../src/kernel/l2-plan/authority.js');
  assert.equal(decideAutoGrant({ kind }), true,
    '**검색 확정에 카드가 뜬다** — 결재 ① 나머지 절반이 집행되지 않았다');
});

test('검색 아닌 칸의 엔터는 역할이 있어도 그대로 카드다 — 규율이 안 느슨해진다', async () => {
  const { decideAutoGrant } = await import('../src/kernel/l2-plan/authority.js');
  for (const 역할 of ['AXTextArea', 'AXTextField', 'AXComboBox', '', undefined]) {
    const kind = toolActionKind({
      toolId: 'desktop.act',
      args: {
        action: 'press_key', 값: 'return',
        눌러본사실: { 칸내용: '안녕', ...(역할 !== undefined ? { 칸역할: 역할 } : {}), 본창: { app: 'K' } },
      },
    });
    assert.equal(kind, 'send', `역할 ${역할 ?? '(없음)'} 에서 kind=${kind} — 외부 확정 효과가 send 로 서지 않는다`);
    assert.equal(decideAutoGrant({ kind }), false,
      `**${역할 ?? '(없음)'} 칸의 엔터가 카드 없이 나간다** — 헌장 ③ 게이트가 죽었다`);
  }
});

test('탐침이 검색 칸의 역할을 실어 온다 — 판정 재료는 신고가 아니라 기계 사실이다', async () => {
  const 검색칸 = {
    id: 's1:3', 토큰: 's1:3', 스냅샷: 's1', 번호: 3,
    role: 'AXSearchField', label: '검색', value: '전세사기', 창: 9, pid: 77, isEnabled: true,
  };
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'Chrome' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: 'Google Chrome', title: 'NAVER', pid: 77 }, elements: [검색칸],
      }),
      act: () => ({ ok: true }),
    }],
  });
  const 눌러본사실 = await 손.probe({ action: 'press_key', app: 'Google Chrome', 값: 'return' });
  assert.equal(눌러본사실?.칸내용, '전세사기');
  assert.equal(눌러본사실?.칸역할, 'AXSearchField',
    `**탐침이 역할을 버린다** — 검색 확정 판정이 설 재료가 없다: ${JSON.stringify(눌러본사실)}`);
});

test('글자를 넣는 칸이 아니면 그대로 미상이다 — 규율이 안 느슨해진다', async () => {
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: 'K', pid: 77 },
        elements: [{ id: 's1:7', 토큰: 's1:7', role: 'AXButton', label: '보내기', 창: 9, pid: 77, isEnabled: true }],
      }),
      act: () => ({ ok: true }),
    }],
  });
  const 눌러본사실 = await 손.probe({ action: 'click', app: 'K', 대상: { id: 's1:7', label: '보내기' } });
  assert.notEqual(
    toolActionKind({ toolId: 'desktop.act', args: { action: 'click', 눌러본사실 } }),
    'organize',
    '**값 없는 버튼이 카드 없이 눌린다**',
  );
});
