import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { interpret } from '../src/kernel/l1-intent/intent.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';

const selfState = buildSelfState({
  model: { id: 'beai5-stub' },
  connections: [{ id: 'sample.hand', connected: true, executable: true }],
});

test('실패 손의 진행·다음수단만 영수증과 모델 문맥으로 가고 원문·진단·그림은 섞이지 않는다', async () => {
  let 옆길그림;
  const runner = new ToolRunner({
    'sample.hand': {
      async handler() {
        return {
          failed: true,
          result: { privateFailedResult: 'RESULT_MUST_NOT_TRAVEL' },
          diagnosticTrace: { stack: 'DIAGNOSTIC_MUST_NOT_TRAVEL' },
          그림: { mime: 'image/png', base64: 'IMAGE_MUST_NOT_ENTER_RECEIPT' },
          userSafeSummary: '제출했지만 효과는 확인하지 못했어요.',
          진행: { 단계: 'dispatched', 판정: 'unknown', 근거: 'effect.unverifiable' },
          다음수단: [{ 방법: 'observe', 왜: '현재 상태를 다시 본다' }],
        };
      },
    },
  });

  const rec = await runner.run('sample.hand', { action: 'change' }, selfState, {
    그림받기: (그림) => { 옆길그림 = 그림; },
  });
  assert.equal(옆길그림?.base64, 'IMAGE_MUST_NOT_ENTER_RECEIPT');
  assert.equal(rec.result, undefined);
  assert.equal(rec.그림, undefined);
  assert.equal(rec.diagnosticTrace?.stack, 'DIAGNOSTIC_MUST_NOT_TRAVEL', '진단면 자체는 원장에 보존한다');
  assert.equal(rec.진행?.판정, 'unknown');
  assert.deepEqual(rec.다음수단?.map((x) => x.방법), ['observe']);
  assert.doesNotMatch(String(rec.nextSafeAction ?? ''), /다시 시도/);

  const tc = buildTaskContext({
    intent: interpret('그 작업을 이어서 해줘'), selfState, receipts: [rec],
  });
  const exchange = tc.turnExchange?.[0] ?? {};
  assert.equal(exchange.진행?.판정, 'unknown');
  assert.deepEqual(exchange.다음수단?.map((x) => x.방법), ['observe']);
  const modelInput = JSON.stringify(tc);
  assert.doesNotMatch(modelInput, /RESULT_MUST_NOT_TRAVEL|IMAGE_MUST_NOT_ENTER_RECEIPT/);
  assert.equal(exchange.diagnosticTrace, undefined, '진단 객체를 새 진행 사실로 승격하면 안 된다');
  assert.doesNotMatch(JSON.stringify(exchange.진행), /DIAGNOSTIC_MUST_NOT_TRAVEL/);
  assert.equal(exchange.확인안됨, true, '기존 §5-3a 실패원문 표식 계약은 그대로 보존한다');
});

test('제출 전 거절과 no-op도 generic retry로 덮지 않고 손이 낸 사실을 보존한다', async () => {
  for (const 판정 of ['refused', 'no-op']) {
    const runner = new ToolRunner({
      'sample.hand': {
        async handler() {
          return {
            failed: true,
            userSafeSummary: '그 상태로 진행되지 않았어요.',
            진행: { 단계: 판정 === 'refused' ? 'not_dispatched' : 'resolved', 판정 },
            다음수단: [{ 방법: 'observe', 왜: '현재 상태를 확인한다' }],
          };
        },
      },
    });
    const rec = await runner.run('sample.hand', {}, selfState);
    assert.equal(rec.진행?.판정, 판정);
    assert.deepEqual(rec.다음수단?.map((x) => x.방법), ['observe']);
    assert.doesNotMatch(String(rec.nextSafeAction ?? ''), /잠시 후 다시 시도/);
  }
});
