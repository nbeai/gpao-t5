// **F-53 원인 1층 봉인 — 드라이버의 거절 사유는 삼키지 않고 영수증에 싣는다** (2026-08-09).
//
// 발신 시험 실측(evidence/step5-full-2026-08-09/real-rounds/발신시험.json): 방 열기
// double_click ×3 이 전부 "그 동작을 실행하지 못했어요"(일반문 · 사유 0 · 판정
// 'not_dispatched')로 끝났고, 모델은 이유 없는 막다른 실패에서 *"이 환경에서는 막혀
// 있어서"* 를 지어냈다(거짓 실패 서사 ⓒ). 원인: 거절이 throw 로 일반 catch 에 삼켜졌다 —
// 실제로는 **나갔고, 드라이버가 이유를 말하며 거절했다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 거절드라이버 = (사유) => ({
  id: 'cua', label: '화면(가짜)',
  async status() { return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } }; },
  async observe() {
    return { frontmost: { name: '카카오톡' }, 본창: { id: 9, pid: 7, app: '카카오톡', title: '카카오톡', bounds: { x: 0, y: 0, w: 400, h: 600 } },
      elements: [], 그림: 'x'.repeat(64), 그림크기: { w: 400, h: 600 } };
  },
  // 내부 계약 그대로(desktop-driver-answer 의 네 갈래) — effect:'refused' + code 가 사유다.
  async act() { return { effect: 'refused', code: 사유 }; },
  verify() { return null; },
});

test('거절은 사유와 함께 실패로 돌아온다 — 일반문·not_dispatched 로 뭉개지 않는다', async () => {
  const 손 = makeDesktopActTool({ drivers: [거절드라이버('no matching element for label in snapshot')] });
  const r = await 손.handler({
    action: 'double_click', app: 'KakaoTalk', 창제목: '카카오톡',
    대상: { label: 'n.BEAI 사일런트서비스' }, 기대: { 요소: '대화 입력', 값: '' },
  }, {});
  const 몸 = r?.result ?? r;
  assert.equal(몸.failed ?? r.failed, true, `실패가 실패로 안 왔다: ${JSON.stringify(r).slice(0, 200)}`);
  const 요약 = String(r.userSafeSummary ?? 몸.userSafeSummary ?? '');
  assert.ok(요약.includes('no matching element'),
    `**사유가 삼켜졌다** — 모델은 또 "환경이 막혀 있다"를 지어낸다: "${요약}"`);
  assert.notEqual(요약.trim(), '그 동작을 실행하지 못했어요.', '일반문 그대로다 — 수리가 안 닿았다');
  const 진행 = 몸.진행 ?? r.진행;
  assert.equal(진행?.판정, 'refused', `판정이 틀리다(실제로는 나갔고 거절당했다): ${JSON.stringify(진행)}`);
  const 수단 = JSON.stringify(몸.다음수단 ?? r.다음수단 ?? []);
  assert.ok(수단.includes('x·y') || 수단.includes('observe'),
    '남은 길이 없다 — 길을 안 준 문장이 벽이 된다(launch 선례)');
});
