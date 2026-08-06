// **흡수 ② · 드라이버가 고치는 법을 알려주면 따라 한다.**
//
// 오너 지적(2026-08-06): *"기본인 읽기조차 안 되는데 어떻게 컴퓨터 유즈가 되지?"*
// 읽기가 왜 안 됐는지 드라이버는 **처음부터 말하고 있었다.** 우리가 안 읽었을 뿐이다:
//
// ```
// code:       window_owner_pid_mismatch
// owner_pid:  31490
// suggestion: window_id 13954 is owned by pid 31490, not pid 13000
//             (macOS hosts sandboxed Open/Save panels out-of-process).
//             Re-call get_window_state with pid=31490 and the same window_id.
// ```
//
// 우리는 이 답을 받아 **"요소 0개"** 라고만 말했다. 그리고 모델은 그걸 읽고
// *"화면 내용 접근 권한이 막혀 있어서"* 라고 사용자에게 답했다 — **권한 문제가 아니었다.**
//
// 비교군이 이걸 축으로 세워 뒀다(`tool.py:_text_response`):
//   *"`ok` 는 전송 성공일 뿐이고 **의미 판정은 effect/escalation**"* —
//   `verified` · `effect` · `escalation` · `path` · `degraded` · `delivery_mode` · `code` 를
//   **전부 모델에게 올린다.**
//
// 그래서 규칙 둘:
//   ① 드라이버가 **고칠 값을 주면 한 번 따라 해 본다**(자동 회복).
//   ② 그래도 안 되면 **그 이유를 그대로 올린다** — "0개"로 뭉개지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = {
  window_id: 13954, app_name: '메모', title: '메모', pid: 13000,
  is_on_screen: true, z_index: 1, bounds: { x: 5, y: 74, width: 868, height: 818 },
};

function 가짜({ 부른것 = [], 진짜pid = 31490 }) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') {
        // **실물이 이렇게 답한다** — 틀린 pid 면 고칠 값을 함께 준다.
        if (인자?.pid !== 진짜pid) {
          return {
            code: 'window_owner_pid_mismatch',
            owner_pid: 진짜pid, owner_app_name: '메모', pid: 인자?.pid, window_id: 인자?.window_id,
            suggestion: `window_id ${인자?.window_id} is owned by pid ${진짜pid}, not pid ${인자?.pid}. Re-call get_window_state with pid=${진짜pid}.`,
          };
        }
        return { snapshot_id: 's1', elements: [{ element_token: 's1:1', role: 'AXTextArea', label: '', value: '오늘 할 일' }] };
      }
      return {};
    },
  };
}

test('주인 pid 가 다르다고 하면 그 pid 로 다시 부른다 — 읽기가 여기서 막혀 있었다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜({ 부른것 }) }).observe({ scope: 'window', app: '메모' });
  assert.equal((o.elements ?? []).length, 1,
    `**드라이버가 고치는 법을 알려줬는데 안 따라 한다** — "요소 0개"가 나간다: ${JSON.stringify(o).slice(0, 200)}`);
  const 부름들 = 부른것.filter((c) => c.이름 === 'get_window_state');
  assert.equal(부름들.length, 2, '한 번만 부르고 포기했다');
  assert.equal(부름들[1].인자.pid, 31490, `고쳐 준 pid 로 안 불렀다: ${JSON.stringify(부름들[1].인자)}`);
});

test('두 번은 안 따라 한다 — 무한히 되묻지 않는다', async () => {
  const 부른것 = [];
  // 무엇을 줘도 계속 mismatch 라고 우기는 드라이버.
  const mcp = 가짜({ 부른것, 진짜pid: -1 });
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '메모' });
  assert.ok(부른것.filter((c) => c.이름 === 'get_window_state').length <= 2, '계속 다시 부른다');
  assert.equal((o.elements ?? []).length, 0);
});

test('그래도 안 되면 드라이버가 말한 이유를 그대로 올린다 — "0개"로 뭉개지 않는다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({ 진짜pid: -1 }) }).observe({ scope: 'window', app: '메모' });
  assert.match(String(o.못읽은이유 ?? ''), /window_owner_pid_mismatch|owned by pid/,
    `**왜 못 읽었는지가 사라진다** — 모델이 "권한이 막혔다"고 지어낸다: ${JSON.stringify(o).slice(0, 200)}`);
});

test('잘 읽히면 이유를 안 붙인다', async () => {
  const o = await makeCuaDriver({ mcp: 가짜({}) }).observe({ scope: 'window', app: '메모' });
  assert.equal(o.못읽은이유, undefined);
});

// ── 드라이버의 판정을 **그대로** 올린다 ─────────────────────────────────
// 실물이 이렇게 답한다(2026-08-06 · 메모 창):
//   degraded: true
//   degraded_reason: "ax_window_unresolved: … 트리를 **일부러 비워서** 돌려준다 —
//                     다른 창 요소를 주면 다음 행동을 잘못 근거짓게 되므로"
//   escalation: { reason: "…", recommended: "foreground" }
//   background_input: { routes: [accessibility·window_pointer·pid_keyboard 전부 refused] }
//   screenshot_error: { code: "px_capture_unavailable", … }
//
// 우리는 `elements` 만 보고 **전부 버렸다.** 그래서 T5 는 *"권한이 막혀 있어서"* 라고
// **지어냈다** — 권한 문제가 아니었다. 비교군 계약 그대로 올린다:
//   *"`ok` 는 전송 성공일 뿐이고 **의미 판정은 effect/escalation**."*
test('요소가 비어도 왜 비었는지·무엇을 하면 되는지 그대로 올린다', async () => {
  const mcp = {
    async call(이름, 인자) {
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') {
        return {
          elements: [], element_count: 0, total_element_count: 0, elements_complete: false,
          degraded: true,
          degraded_reason: 'ax_window_unresolved: the tree is returned EMPTY on purpose',
          escalation: { reason: 'background input refused while AX unresolved', recommended: 'foreground' },
          screenshot_error: { code: 'px_capture_unavailable' },
          pid: 인자?.pid, window_id: 인자?.window_id,
        };
      }
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '메모' });
  assert.match(String(o.못읽은이유 ?? ''), /ax_window_unresolved/,
    `**왜 비었는지가 사라진다** — 모델이 "권한이 막혔다"고 지어낸다: ${JSON.stringify(o).slice(0, 200)}`);
  assert.equal(o.올려야할길?.recommended, 'foreground',
    `**무엇을 하면 되는지가 사라진다** — 드라이버가 알려준 사다리를 못 탄다: ${JSON.stringify(o.올려야할길)}`);
});

test('잘 읽히면 그런 말을 안 붙인다 — 없는 걱정을 만들지 않는다', async () => {
  const mcp = {
    async call(이름) {
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [{ element_token: 's1:1', role: 'AXTextArea', value: '할 일' }] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '메모' });
  assert.equal(o.못읽은이유, undefined);
  assert.equal(o.올려야할길, undefined);
});
