// F-113 ·5-4 — 화면 행동의 제출 사실과 사용자 목적 달성을 섞지 않는다.
// 실모델 Calculator 7×8 라이브의 보존 원장을 축약한 공용 선빨강이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 화면관찰 = {
  intended: 'desktop.screen 실행',
  actualCall: { tool: 'desktop.screen', args: { action: 'observe', app: '계산기' } },
  result: { 본창: { app: '계산기', 제목: '계산기' } },
  failureState: 'none', lifecycle: 'delivered', userSafeSummary: '계산기 화면을 봤어요.',
};
const 실패클릭 = (label, id) => ({
  intended: 'desktop.act 실행',
  actualCall: {
    tool: 'desktop.act',
    args: { action: 'click', app: '계산기', 대상: { id, label }, 기대: { 요소: id, 값: label } },
  },
  failureState: 'failed', lifecycle: 'failed',
  userSafeSummary: '했어요. 다만 그 결과를 화면에서 확인하지는 못했어요.',
  진행: { 단계: 'dispatched', 판정: 'unknown' },
  다음수단: [{ 방법: 'observe', 왜: '지금 실제 상태를 보고 됐는지부터 확인한다' }],
});
const 실패들 = [
  실패클릭('지우기', 's4:2'), 실패클릭('7', 's4:5'), 실패클릭('곱하기', 's4:8'),
  실패클릭('8', 's4:6'), 실패클릭('등호', 's4:20'),
];
const 자리 = { 파일: ['ZoomLauncher', 'files', 'state'], 화면: [{ label: '계산기' }] };

test('failed 화면 행동의 dispatched/unknown과 observe 다음 손이 원장→모델까지 살아 간다', async () => {
  const runner = new ToolRunner({
    'desktop.act': {
      async handler() {
        return {
          failed: true,
          userSafeSummary: '했어요. 확인은 못 했어요.',
          진행: { 단계: 'dispatched', 판정: 'unknown', 근거: 'effect.unverifiable' },
          다음수단: [{ 방법: 'observe', 왜: '지금 실제 상태를 본다' }],
        };
      },
    },
  });
  const rec = await runner.run('desktop.act', { action: 'click' }, {
    connectedTools: [{ id: 'desktop.act', executable: true }],
  });
  assert.deepEqual(rec.진행, { 단계: 'dispatched', 판정: 'unknown', 근거: 'effect.unverifiable' },
    '드라이버에 제출된 unknown이 단순 실패로 떨어졌다');
  assert.deepEqual(rec.다음수단?.map((x) => x.방법), ['observe'],
    'unknown은 재클릭이 아니라 재관찰이 다음 손이어야 한다');
  assert.doesNotMatch(String(rec.nextSafeAction ?? ''), /다시 시도/,
    '모르는 채 다시 누르면 중복 실행이다');

  const tc = buildTaskContext({
    intent: interpret('계산기에서 눌러'),
    selfState: buildSelfState({
      model: { id: 'beai5-stub' },
      connections: [{ id: 'desktop.act', connected: true, executable: true }],
    }),
    receipts: [rec],
  });
  const exchange = tc.turnExchange?.[0] ?? {};
  assert.equal(exchange.진행?.판정, 'unknown', '원장에만 남고 모델 입력에서 진행 사실이 사라졌다');
  assert.deepEqual(exchange.다음수단?.map((x) => x.방법), ['observe'], '다음 손이 모델에게 도달하지 않았다');
});

test('미확인 click이 남았으면 무관한 파일 자리가 첫 되부름을 소비하지 않는다', () => {
  const v = 완료주장검증({
    reply: '지금 계산기 화면에 보이는 최종 결과는 3,179',
    receipts: [화면관찰, ...실패들], 자리종류: 자리,
  });
  assert.equal(v.일치, false);
  assert.match(String(v.모델에게), /desktop\.act\|click/,
    `더 강한 미해결 행동 대신 무관한 자리 공백이 왔다: ${v.모델에게}`);
  assert.doesNotMatch(String(v.모델에게), /파일 자리는 안 봤다/);
});

test('한 번 보정한 답이라도 미확인 화면 행동 위의 낡은 값은 통과하지 않는다', () => {
  const v = 완료주장검증({
    reply: '파일은 안 봤고, 지금 계산기 화면에 보이는 최종 결과는 3,179',
    receipts: [화면관찰, ...실패들], 자리종류: 자리, 이미돌려줬나: true,
  });
  assert.equal(v.일치, false, '단일 되부름 비용 계약이 거짓 결과 통과권이 됐다');
  assert.match(String(v.모델에게), /desktop\.act\|click/);
});

test('단순히 현재 화면 숫자를 묻는 읽기 요청은 그대로 통과한다', () => {
  const v = 완료주장검증({
    reply: '지금 계산기 화면에 보이는 숫자는 3,179입니다.',
    receipts: [화면관찰], 자리종류: { 파일: [], 화면: [{ label: '계산기' }] },
  });
  assert.equal(v.일치, true, '현재 화면 읽기까지 목적 수행 검증으로 막으면 과강제다');
});

test('확인된 행동 뒤 fresh 56은 통과한다', () => {
  const 된클릭 = 실패들.map((r) => ({
    ...r, failureState: 'none', lifecycle: 'delivered',
    result: { 단계: 'goal_verified', 행동: 'click', 확인방법: '드라이버 판정 + fresh observation' },
    userSafeSummary: '그렇게 했어요. 실제로 그렇게 된 것까지 확인했어요.',
  }));
  const v = 완료주장검증({
    reply: '지금 계산기 화면의 최종 결과는 56입니다.',
    receipts: [...된클릭, 화면관찰], 자리종류: { 파일: [], 화면: [{ label: '계산기' }] },
  });
  assert.equal(v.일치, true, '실제 성공 경로까지 막으면 반대 방향의 거짓이다');
});
