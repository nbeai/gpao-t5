// F-114 ·5-4 — 화면 행동이 확실히 목적 상태에 닿지 못했다면,
// 주변 자리 공백이 한 번의 보정을 먼저 쓰거나 보정 뒤 결과 답을 통과시키지 못한다.
// 실물 Calculator 회차의 모양을 축약했지만, 판정은 앱·숫자가 아니라
// ToolReceipt의 desktop.act + dispatched/unsatisfied 기계 사실만 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증, 절대재검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 실패한화면행동 = ({ action = 'focus', app = '계산기', 창 = 813, pid = 18355 } = {}) => ({
  intended: 'desktop.act 실행',
  actualCall: { tool: 'desktop.act', args: { action, app, 기대: { 요소: '', 값: '' } } },
  failureState: 'failed', lifecycle: 'failed',
  userSafeSummary: '실행은 했는데 원하신 상태가 되지 않았어요.',
  진행: {
    단계: 'dispatched', 판정: 'unsatisfied',
    전: { frontmost: '다른앱' }, 후: { frontmost: '다른앱' },
    실행신분: { 창, pid },
  },
  다음수단: [
    { 방법: 'observe', 왜: '지금 실제 상태를 보고 다시 판단한다' },
    { 방법: 'retry', 왜: '앱이 뜨는 데 시간이 걸렸을 수 있다' },
  ],
});

const 화면관찰 = {
  intended: 'desktop.screen 실행',
  actualCall: { tool: 'desktop.screen', args: { action: 'observe', app: '계산기' } },
  failureState: 'none', lifecycle: 'delivered',
  result: {
    본창: { id: 813, app: '계산기', title: '계산기', pid: 18355 },
    elements: [],
    화면사실: { 조작막힘: true, 조작막힌이유: 'off_space_or_ax_unresolved' },
  },
  userSafeSummary: '그 창은 지금 화면 정보로는 못 읽었어요.',
};

const 주변자리 = {
  파일: ['ZoomLauncher', 'files', 'state'],
  화면: [{ label: '계산기', app: '계산기', window: 813 }],
};

test('unsatisfied 화면 행동이 주변 자리 공백보다 먼저 보인다', () => {
  const v = 완료주장검증({
    reply: '56', receipts: [실패한화면행동(), 화면관찰], 자리종류: 주변자리,
  });
  assert.equal(v.일치, false);
  assert.match(String(v.모델에게), /desktop\.act\|focus/,
    `직접 실패 대신 주변 자리가 보정을 소비했다: ${v.모델에게}`);
  assert.doesNotMatch(String(v.모델에게), /파일 자리는 안 봤다/);
});

test('한 번 보정한 답이 unsatisfied 화면 행동 위에 결과를 쓰면 왕복 없이 차단한다', () => {
  const v = 절대재검증({
    reply: '56', receipts: [실패한화면행동(), 화면관찰],
  });
  assert.equal(v.재거짓, true);
  assert.match(String(v.사실), /desktop\.act\|focus/);
});

test('같은 화면 행동의 fresh goal_verified는 앞의 unsatisfied를 회복한다', () => {
  const failed = 실패한화면행동();
  const success = {
    intended: 'desktop.act 실행', actualCall: failed.actualCall,
    failureState: 'none', lifecycle: 'delivered',
    result: { 단계: 'goal_verified', 행동: 'focus', 실행신분: { 창: 813, pid: 18355 } },
    userSafeSummary: '창을 앞으로 가져온 것을 확인했어요.',
  };
  const v = 완료주장검증({ reply: '확인된 화면 결과입니다.', receipts: [failed, success] });
  assert.equal(v.일치, true);
  assert.equal(절대재검증({ reply: '확인된 화면 결과입니다.', receipts: [failed, success] }).재거짓, false);
});

test('화면 행동 실패를 밝힌 정직한 답은 통과한다', () => {
  const receipts = [실패한화면행동(), 화면관찰];
  const reply = '계산기 창을 앞으로 가져오지 못해 버튼 조작은 하지 않았어요.';
  assert.equal(완료주장검증({ reply, receipts, 자리종류: 주변자리 }).일치, true);
  assert.equal(절대재검증({ reply, receipts }).재거짓, false);
});

test('단순 현재 화면 읽기는 행동 성공 계보를 요구하지 않는다', () => {
  const v = 완료주장검증({
    reply: '지금 화면에 보이는 숫자는 3,179입니다.', receipts: [화면관찰],
    자리종류: { 파일: [], 화면: 주변자리.화면 },
  });
  assert.equal(v.일치, true);
});
