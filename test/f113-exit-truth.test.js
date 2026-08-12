// F-113 exit truth — 효과 미확인 화면 행동은 자리 조사보다 먼저 보이고,
// 단 한 번의 보정 왕복 뒤에는 같은 원장으로 재검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증, 절대재검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 미확인 = (id = 's4:5', label = '7') => ({
  failureState: 'failed',
  lifecycle: 'failed',
  actualCall: { tool: 'desktop.act', args: { action: 'click', 대상: { id, label } } },
  진행: { 단계: 'dispatched', 판정: 'unknown', 근거: 'effect.unverifiable' },
  userSafeSummary: '했어요. 다만 결과를 확인하지는 못했어요.',
});

const 확인된행동 = (id = 's4:5', label = '7') => ({
  failureState: 'none',
  lifecycle: 'delivered',
  actualCall: { tool: 'desktop.act', args: { action: 'click', 대상: { id, label } } },
  result: { 단계: 'goal_verified', 행동: 'click' },
});

test('무관한 미완료를 밝혀도 dispatched/unknown 화면 행동은 첫 원장 사실이다', () => {
  const v = 완료주장검증({
    reply: '파일은 아직 안 봤고, 화면의 최종 결과는 3,179입니다.',
    receipts: [미확인()],
    자리종류: { 파일: ['files'], 화면: [{ label: '계산기' }] },
  });
  assert.equal(v.일치, false);
  assert.match(String(v.모델에게), /desktop\.act\|click\|s4:5/);
});

test('보정 답이 같은 미확인 위에 결과를 쓰면 왕복 없는 절대 재검증이 물린다', () => {
  const v = 절대재검증({
    reply: '지금 화면의 최종 결과는 3,179입니다.', receipts: [미확인()],
  });
  assert.equal(v.재거짓, true);
  assert.match(String(v.사실), /desktop\.act\|click\|s4:5/);
});

test('효과 미확인 자체를 밝힌 답은 정직한 부분 결과로 통과한다', () => {
  const v = 완료주장검증({
    reply: '7 버튼 클릭은 효과를 확인하지 못했어요. 현재 화면은 3,179입니다.', receipts: [미확인()],
  });
  assert.equal(v.일치, true);
});

test('같은 대상의 fresh goal_verified 행동은 앞의 unknown을 회복한다', () => {
  const v = 완료주장검증({
    reply: '확인된 화면 결과를 알려드렸어요.', receipts: [미확인(), 확인된행동()],
  });
  assert.equal(v.일치, true);
});

test('다른 대상의 성공은 앞의 unknown 행동을 지우지 않는다', () => {
  const v = 완료주장검증({
    reply: '화면 행동을 다 끝냈어요.', receipts: [미확인(), 확인된행동('s4:6', '8')],
  });
  assert.equal(v.일치, false);
  assert.match(String(v.모델에게), /s4:5/);
});

test('같은 대상이어도 goal_verified가 아닌 제출 성공은 unknown을 지우지 않는다', () => {
  const 제출만 = { ...확인된행동(), result: { 단계: 'dispatched', 행동: 'click' } };
  const v = 완료주장검증({
    reply: '화면 행동을 끝냈어요.', receipts: [미확인(), 제출만],
  });
  assert.equal(v.일치, false);
  assert.match(String(v.모델에게), /s4:5/);
});
