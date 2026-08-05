// **CU A 의 첫 계약 — 조용한 0 을 "창이 없네요"로 답하지 않는다.**
//
// 밟은 사실(2026-08-05, 서명한 탐침을 직접 돌림):
// ```
// 권한(실제 probe)   화면 기록 false · 손쉬운 사용 false · 이벤트 전송 false
// 앞 앱              Google Chrome · com.google.Chrome · pid 72904   ← 권한 0으로 나온다
// 창 목록            0개                                             ← 여기서 막힌다
// ```
// **권한이 없을 때 창 목록은 예외가 아니라 빈 배열로 온다.** 그걸 그대로 결과로 쓰면
// T5 는 *"창이 없네요"* 라고 답한다 — **없는 사실을 지어내는 것**이고, 파일·검색에서 이미
// 여러 번 밟은 그 병이다(조용한 0). GUI 는 그게 훨씬 흔하다: 권한·잠금·전환 중에 늘 빈다.
//
// 그래서 A 의 첫 계약은 눈을 뜨는 게 아니라 **못 볼 때 못 본다고 말하는 것**이다.
//
// ── CU 는 다음 기능이 아니라 S8 의 판정이다(오너) ──────────────────────────
// 슬롯이 진짜인지는 **두 번째 슬롯이 설 때** 판명된다. 검색 슬롯 하나로는 "그냥 함수"와
// 구분이 안 된다. 그래서 `desktop` 을 같은 등록소·같은 계약으로 세우고, 그게 서는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSlotRegistry } from '../src/kernel/l2-plan/slot-registry.js';
import { DESKTOP_SLOT, 화면슬롯세우기 } from '../src/runtime/desktop-slot.js';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

/** 권한을 통제하는 가짜 백엔드 — 실기 없이 계약만 잰다. */
const 백엔드 = (권한, 창 = []) => ({
  id: '시험백엔드', needs: [],
  async status() {
    return {
      platform: 'macos', osVersion: '14.0',
      backend: { id: '시험백엔드', ready: true },
      permissions: 권한,
      capabilities: ['observe'],
    };
  },
  async observe() { return { frontmost: { name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 72904 }, windows: 창 }; },
});

const 다줌 = { accessibility: 'granted', screenRecording: 'granted' };
const 없음 = { accessibility: 'denied', screenRecording: 'not_requested' };

const 손세우기 = (백) => {
  const 등록소 = 화면슬롯세우기(makeSlotRegistry());
  등록소.붙이기(DESKTOP_SLOT, 백);
  return makeDesktopTool({ drivers: 등록소.드라이버(DESKTOP_SLOT) });
};

// ── ① 두 번째 슬롯이 선다 (S8 판정) ──────────────────────────────────────
test('desktop 이 같은 등록소·같은 계약으로 선다 — 슬롯이 검색 전용이 아니다', () => {
  const 등록소 = 화면슬롯세우기(makeSlotRegistry());
  assert.ok(등록소.슬롯목록().includes(DESKTOP_SLOT));
  assert.deepEqual(등록소.드라이버(DESKTOP_SLOT), [], '아무도 안 붙었으면 정직하게 빈손이다');
  // 계약을 못 채운 드라이버는 검색 슬롯과 **같은 방식으로** 거절된다.
  assert.throws(() => 등록소.붙이기(DESKTOP_SLOT, { id: 'status 없음' }), /계약/);
});

// ── ② A 의 첫 계약: 조용한 0 금지 ────────────────────────────────────────
test('권한이 없으면 **빈 목록을 사실로 내지 않는다** — 상태를 먼저 말한다', async () => {
  const 손 = 손세우기(백엔드(없음, []));
  const out = await 손.handler({ action: 'observe' });

  assert.equal(out.blocked, true, '권한이 없는데 성공으로 돌려줬다 — "창이 없네요"가 나가는 자리다');
  assert.equal(out.result, undefined, '못 봤으면 목록이 없다(빈 배열도 목록이다)');
  assert.match(out.userSafeSummary, /권한|허용/, '왜 못 봤는지가 사용자 문장에 없다');
  // 막다른 답이 아니다 — 웹 손과 **같은 계약**이다.
  assert.ok(out.다음수단?.some((m) => m.방법 === 'grant_permission'), '무엇을 하면 되는지가 없다');
  assert.equal(out.권한?.accessibility, 'denied', '어느 권한이 왜 막혔는지는 사실이다');
});

test('권한이 있으면 목록을 낸다 — 그리고 진짜 0 은 0 이라고 말한다', async () => {
  const 있음 = 손세우기(백엔드(다줌, [{ id: 1, title: '무제', app: 'TextEdit' }]));
  const a = await 있음.handler({ action: 'observe' });
  assert.equal(a.blocked, undefined);
  assert.equal(a.result.windows.length, 1);

  // **여기가 갈리는 자리다.** 권한이 있는데 0개면 그건 진짜 0 이고, 그렇게 말해야 한다.
  const 진짜0 = 손세우기(백엔드(다줌, []));
  const b = await 진짜0.handler({ action: 'observe' });
  assert.equal(b.blocked, undefined, '권한이 있는데 막혔다고 했다 — 진짜 0 을 못 보게 됐다');
  assert.equal(b.result.windows.length, 0);
  assert.equal(b.result.권한확인됨, true, '이 0 이 왜 믿을 만한지가 결과에 없다');
});

// ── ③ 앞 앱은 권한 없이도 말할 수 있다 (실측대로) ──────────────────────────
test('창은 못 봐도 앞 앱은 말한다 — 실측에서 권한 0 으로도 나왔다', async () => {
  const 손 = 손세우기(백엔드(없음, []));
  const out = await 손.handler({ action: 'status' });
  assert.equal(out.blocked, undefined, '상태 조회까지 막으면 왜 막혔는지도 못 말한다');
  assert.equal(out.result.permissions.accessibility, 'denied');
  assert.equal(out.result.frontmost?.name, 'Google Chrome', '권한 없이 되는 것까지 안 주면 덜 말하는 것이다');
});

// ── ④ 드라이버가 없으면 없다고 한다 ──────────────────────────────────────
test('백엔드가 안 붙었으면 "창이 없다"가 아니라 "볼 수 없다"다', async () => {
  const 손 = makeDesktopTool({ drivers: [] });
  const out = await 손.handler({ action: 'observe' });
  assert.equal(out.blocked, true);
  assert.equal(out.result, undefined);
  assert.doesNotMatch(out.userSafeSummary, /창이 없|없어요$/, '없는 사실을 지어냈다');
});

// ── ⑤ 다음 수단에도 같은 규칙이 선다 ─────────────────────────────────────
//
// 라이브에서 잡았다: 손쉬운 사용이 `granted` 인데도 **둘 다** 내밀고 있었다.
// 사용자는 이미 준 것을 또 주러 가고, 무엇이 진짜 막힌 건지 흐려진다.
// **없는 사실을 지어내지 않는 규칙은 다음 수단에도 똑같이 선다.**
test('이미 허용된 권한은 다음 수단에서 뺀다', async () => {
  const 반쪽 = 손세우기(백엔드({ accessibility: 'granted', screenRecording: 'denied' }, []));
  const out = await 반쪽.handler({ action: 'observe' });
  assert.equal(out.blocked, true, '화면 기록이 없으면 창 목록은 못 낸다');
  const 요구 = out.다음수단.map((m) => m.무엇);
  assert.deepEqual(요구, ['screen_recording'],
    `이미 준 권한을 또 요구했다: ${JSON.stringify(요구)}`);
});
