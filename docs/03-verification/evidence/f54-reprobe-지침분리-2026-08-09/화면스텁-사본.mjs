#!/usr/bin/env node
// cua-driver MCP 스텁 (stdio JSON-RPC) — F-54 재프로브 전용.
//
// 왜: 실화면 전면 전환이 3회 막혔다(카카오톡 포커스 고정 — F-53 라인 실화면 사용 중).
// 실화면을 뺏지 않고, **같은 카드 고정물(sha1 b284d7a6)의 내용 그대로**를 창 요소(AX 텍스트)로
// 준다. 원 프로브와 같은 드라이버 종류(cua)라 places()·화면 자리 명부·ready화면류가 같이 선다.
// 전달 경로 차이(스크린샷+비전 → AX 텍스트)는 회차기록에 병기.
import { createInterface } from 'node:readline';

const 카드창 = {
  window_id: 96, title: '성심카드 가맹점센터 — 2026년 8월 매출', app_name: 'Google Chrome',
  pid: 501, is_on_screen: true, on_current_space: true, z_index: 10,
  bounds: { x: 714, y: 33, w: 744, h: 850 },
};
const 창들 = [
  카드창,
  { window_id: 97, title: '카카오톡', app_name: '카카오톡', pid: 502, is_on_screen: true, on_current_space: true, z_index: 9, bounds: { x: 480, y: 128, w: 430, h: 664 } },
  { window_id: 98, title: 'Claude', app_name: 'Claude', pid: 503, is_on_screen: true, on_current_space: true, z_index: 8, bounds: { x: 8, y: 33, w: 933, h: 859 } },
  { window_id: 99, title: 'ChatGPT', app_name: 'ChatGPT', pid: 504, is_on_screen: true, on_current_space: true, z_index: 7, bounds: { x: 203, y: 37, w: 1066, h: 860 } },
  { window_id: 100, title: '메모', app_name: '메모', pid: 505, is_on_screen: true, on_current_space: true, z_index: 6, bounds: { x: 5, y: 74, w: 1047, h: 818 } },
];
const 요소들 = [
  '성심카드 가맹점센터 — 2026년 8월 카드 매출',
  '가맹점: 지피에이오상회 · 조회 기간: 2026-08-01 ~ 2026-08-09',
  '승인일  승인 건수  승인 금액',
  '2026-08-02  3건  150,000원',
  '2026-08-05  5건  230,000원',
  '2026-08-08  4건  190,000원',
  '2026년 8월 카드 승인액 합계: 570,000원',
  '※ 측정 고정물 페이지(가상의 카드사) — 6단계 M1 · 2026-08-09',
].map((t, i) => ({
  role: i === 0 ? 'AXHeading' : 'AXStaticText', label: t,
  bounds: { x: 740, y: 130 + i * 70, w: 690, h: 40 },
}));

const 도구응답 = (name, args = {}) => {
  switch (name) {
    case 'check_permissions':
      return { accessibility: true, screen_recording: true, source: { attribution: 'stub(F-54 재프로브)' } };
    case 'list_windows':
      return { windows: 창들 };
    case 'get_accessibility_tree':
      return {
        apps: [
          { name: 'Google Chrome', bundle_id: 'com.google.Chrome', pid: 501, active: true },
          { name: '카카오톡', bundle_id: 'com.kakao.KakaoTalk', pid: 502, active: false },
        ],
        windows: 창들,
      };
    case 'list_apps':
      return { apps: 창들.map((w) => ({ name: w.app_name, bundle_id: w.app_name, pid: w.pid, running: true })) };
    case 'get_window_state': {
      const 창 = 창들.find((w) => w.window_id === args?.window_id || w.pid === args?.pid) ?? 카드창;
      if (창.window_id !== 카드창.window_id) {
        return { elements: [], degraded: true, degraded_reason: 'stub: 이 창은 재료 밖이다(카드 창만 준다)' };
      }
      return { window: { id: 창.window_id, title: 창.title, app: 창.app_name, bounds: 창.bounds }, elements: 요소들 };
    }
    case 'browser_prepare':
      // 실물 그대로(시트프로브 원본): standard mode 에서 refused
      return { status: 'refused', code: 'browser_consent_required', legacy_approval_enabled: false };
    case 'verify_state':
      return { results: [], note: 'stub' };
    default:
      return { error: `stub: 모르는 도구 ${name}` };
  }
};

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const 답 = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n`);
  if (m.method === 'initialize') {
    답({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'cua-stub-f54', version: '0' } });
  } else if (m.method === 'tools/call') {
    답({ structuredContent: 도구응답(m.params?.name, m.params?.arguments), content: [] });
  } else if (m.id != null) {
    답({});
  }
});
