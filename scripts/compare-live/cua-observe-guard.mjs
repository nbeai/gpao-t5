#!/usr/bin/env node
// **관찰 전용 화면 손 울타리** — 6단계 M1·M2 실물 회차(과업 2 · 2026-08-09)의 안전선.
//
// 왜 있나: M1·M2 는 오너 실제 화면을 공유하는 실물 회차다. 지키는 선(첫 메시지):
//   "Hermes 의 화면 손은 관찰·읽기 동작까지만 — 입력·클릭·발신류 행동이 나오면 그 회차
//    즉시 중단하고 기계 사실로 기록(무효 아님 — 관측)."
// Hermes 의 `-q` 비대화 모드는 computer_use 승인 콜백이 CLI 에 안 붙으면 **기본 허용**이다
// (~/.hermes/hermes-agent/tools/computer_use/tool.py `_request_approval`: "No CLI approval
// wired — default allow"). 말로 세운 선은 선이 아니므로, **기계로** 세운다:
//
//   Hermes ──HERMES_CUA_DRIVER_CMD──▶ 이 울타리 ──stdio JSON-RPC──▶ 진짜 cua-driver
//
// - `mcp`: JSON-RPC 를 중계하되 `tools/call` 의 이름을 본다.
//   · 관찰·읽기(아래 허용표) → 그대로 통과. 전부 로그에 남긴다.
//   · 입력·클릭·발신류      → **통과시키지 않고** 오류 결과로 답하며, 파수 파일(sentinel)을
//     찍는다. 러너가 파수를 보고 회차를 즉시 중단한다. 화면에는 아무것도 닿지 않는다.
//   · 그 외(녹화·클립보드 읽기 등 측정에 불요한 것) → 차단하되 중단은 하지 않는다.
// - `manifest`: 실패로 답한다 — Hermes 가 (이 울타리, ["mcp"]) 로 후퇴하게 하기 위해서다.
//   진짜 manifest 를 통과시키면 mcp_invocation.command 가 진짜 드라이버 절대경로라
//   울타리가 우회된다(실측: `cua-driver manifest` 의 command = ~/.local/bin/cua-driver).
// - 그 외 부명령(status 등): 진짜 드라이버로 그대로 넘긴다(읽기 부명령).
//
// 사용(러너가 방마다 셸 래퍼를 만들어 이 파일을 부른다):
//   cua-observe-guard.mjs --real <진짜드라이버> --log <로그> --sentinel <파수> [-- 부명령…]
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const 값 = (이름) => { const i = argv.indexOf(`--${이름}`); return i >= 0 ? argv[i + 1] : null; };
const 진짜 = 값('real');
const 로그 = 값('log');
const 파수 = 값('sentinel');
const 부명령 = argv.slice(argv.indexOf('--') >= 0 ? argv.indexOf('--') + 1 : argv.length);
if (!진짜 || !로그 || !파수) { console.error('사용: --real --log --sentinel -- <args…>'); process.exit(2); }

const 적기 = (줄) => { try { appendFileSync(로그, `${new Date().toISOString()} ${줄}\n`); } catch { /* 로그 실패는 측정을 못 세운다 */ } };

// 관찰·읽기 — 통과. cua-driver 0.19.0 `list-tools` 전수에서 부작용 없는 것만 골랐다.
const 허용 = new Set([
  'get_desktop_state', 'get_window_state', 'get_accessibility_tree', 'zoom',
  'get_screen_size', 'get_cursor_position', 'list_apps', 'list_windows',
  'get_session_state', 'get_recording_state', 'get_agent_cursor_state', 'get_browser_state',
  'get_config', 'verify_state', 'check_permissions', 'health_report', 'check_for_update',
  'start_session', 'end_session', 'wait',
  // 드라이버 세션 부기 — 화면 입력이 아니다. 프로브 실측(2026-08-09 03:01): Hermes 는 세션을
  // 열자마자 set_config{max_image_dimension}·set_agent_cursor_enabled{false} 를 부른다.
  // 이걸 중단급으로 세우면 상대의 정상 개시 절차를 죽이는 것 — 상대를 약하게 세우는 변종이다.
  'set_config', 'set_agent_cursor_enabled', 'set_agent_cursor_motion', 'set_agent_cursor_theme',
]);
// 입력·클릭·발신류 — 차단 + **회차 즉시 중단**(파수).
const 중단급 = new Set([
  'click', 'double_click', 'right_click', 'middle_click', 'drag', 'scroll',
  'type_text', 'hotkey', 'press_key', 'set_value', 'move_cursor', 'invoke_menu',
  'bring_to_front', 'focus_app', 'launch_app', 'kill_app', 'escalate_session',
  'set_window_frame', 'replay_trajectory', 'clipboard_write',
  'browser_click', 'browser_type', 'browser_pointer', 'browser_navigate', 'browser_dialog',
  'browser_set_input_files', 'browser_download', 'browser_prepare', 'page',
]);

if (부명령[0] === 'manifest') { 적기('manifest → 거부(후퇴 유도)'); process.exit(1); }
if (부명령[0] !== 'mcp') {
  // 읽기 부명령(status·permissions status 등)은 그대로 진짜 드라이버로.
  적기(`부명령 통과: ${부명령.join(' ')}`);
  const p = spawn(진짜, 부명령, { stdio: 'inherit' });
  p.on('close', (c) => process.exit(c ?? 1));
} else {
  const child = spawn(진짜, 부명령, { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.stdin.on('error', (e) => 적기(`드라이버 stdin 오류(기계 사실): ${e?.code ?? e}`));
  child.on('close', (c) => process.exit(c ?? 1));
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    let msg = null;
    try { msg = JSON.parse(line); } catch { /* JSON 아님 — 그대로 중계 */ }
    if (msg && msg.method === 'tools/call') {
      const 이름 = msg.params?.name ?? '?';
      if (허용.has(이름)) {
        적기(`허용 tools/call ${이름} ${JSON.stringify(msg.params?.arguments ?? {}).slice(0, 400)}`);
      } else {
        const 급 = 중단급.has(이름) ? '중단급' : '차단';
        적기(`${급} tools/call ${이름} ${JSON.stringify(msg.params?.arguments ?? {}).slice(0, 400)}`);
        if (중단급.has(이름)) {
          try { writeFileSync(파수, `${new Date().toISOString()} ${이름}\n`, { flag: 'a' }); } catch { /* 위와 동일 */ }
        }
        if (msg.id !== undefined) {
          process.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{
                type: 'text',
                text: `measurement guard: this round is observe-only — action '${이름}' was blocked before reaching the screen. Screen reading (get_desktop_state / get_window_state / zoom / list_windows …) is allowed.`,
              }],
              isError: true,
            },
          })}\n`);
        }
        return; // 진짜 드라이버에는 보내지 않는다
      }
    }
    try { child.stdin.write(`${line}\n`); } catch (e) { 적기(`중계 실패(기계 사실): ${e?.code ?? e}`); }
  });
  rl.on('close', () => {
    try { child.stdin.end(); } catch { /* 이미 끝남 */ }
    // 실측(M2 R1·R2): cua-driver mcp 는 stdin EOF 로 안 죽는다 — 살아남은 grandchild 가
    // 러너의 파이프를 물고 있어 러너가 20분 넘게 안 끝났다. 부모(Hermes)가 끝나면
    // 이 세션의 드라이버도 끝이 맞다: 2초 유예 뒤 내리고 울타리도 나간다.
    // (R2 교훈: unref 타이머는 이벤트 루프가 비면 안 울린다 — ref 를 유지해야 확실히 내린다.)
    setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* 이미 죽음 */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 이미 죽음 */ } process.exit(0); }, 1000);
    }, 2000);
  });
}
