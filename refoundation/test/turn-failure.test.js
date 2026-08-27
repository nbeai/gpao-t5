import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRuntimeFailureEnvelope, userSafeTurnFailure } from '../src/turn-failure.js';

test('이미지 입력 미지원은 터미널 관용구가 아니라 모델·원인·다음 행동을 말한다', () => {
  const failure = userSafeTurnFailure(Object.assign(new Error('internal detail'), {
    reason: 'image_input_unsupported', provider: 'upstage', modelId: 'solar-pro4',
  }));
  assert.equal(failure.code, 'model_image_input_unsupported');
  assert.match(failure.text, /Upstage · solar-pro4/u);
  assert.match(failure.text, /이미지 입력/u);
  assert.match(failure.nextSafeAction, /다른 모델/u);
  assert.doesNotMatch(JSON.stringify(failure), /터미널|internal detail/u);
});

test('알 수 없는 실패도 모델과 터미널을 한 원인처럼 뭉치지 않는다', () => {
  const failure = userSafeTurnFailure(new Error('provider secret raw detail'));
  assert.match(failure.text, /준비 단계/u);
  assert.doesNotMatch(JSON.stringify(failure), /터미널|provider secret raw detail/u);
});

test('provider 400은 일정 같은 사용자 분야를 추측하지 않고 응답 생성 실패 사실만 말한다', () => {
  const failure = userSafeTurnFailure(Object.assign(new Error('No tool call found for call SECRET'), {
    status: 400, code: 'http_400',
  }), null, { requestPreserved: true, modelState: 'response_failed', toolStarted: 0, toolCompleted: 0 });
  assert.equal(failure.envelope.failure.stage, 'model_response');
  assert.equal(failure.envelope.effect.state, 'none');
  assert.equal(failure.envelope.recovery.automaticRetryAllowed, false);
  assert.match(failure.text, /응답을 만드는 단계/u);
  assert.match(failure.text, /확인하거나 변경한 항목은 없/u);
  assert.match(failure.nextSafeAction, /요청.*보존/u);
  assert.doesNotMatch(JSON.stringify(failure), /일정|날씨|SECRET|No tool call/u);
});

test('도구 시작 뒤 결과를 모르면 외부 효과를 unknown으로 보존하고 자동 반복을 금지한다', () => {
  const envelope = makeRuntimeFailureEnvelope(Object.assign(new Error('socket closed'), {
    failureStage: 'tool_execution', code: 'tool_transport_lost',
  }), { requestPreserved: true, modelState: 'completed', toolStarted: 2, toolCompleted: 1,
    evidenceState: 'partial', effectState: 'unknown' });
  const failure = userSafeTurnFailure(Object.assign(new Error('socket closed'), {
    failureStage: 'tool_execution', code: 'tool_transport_lost',
  }), null, { requestPreserved: true, modelState: 'completed', toolStarted: 2, toolCompleted: 1,
    evidenceState: 'partial', effectState: 'unknown' });
  assert.equal(envelope.failure.stage, 'tool_execution');
  assert.equal(envelope.effect.state, 'unknown');
  assert.equal(envelope.recovery.resumable, false);
  assert.equal(envelope.recovery.automaticRetryAllowed, false);
  assert.match(failure.text, /실제로 반영됐는지는 확인/u);
  assert.match(failure.text, /자동으로 반복하지 않았/u);
});

test('같은 도구 무진전 반복은 사용자에게 정지와 회복 경로로 보인다', () => {
  const failure = userSafeTurnFailure(Object.assign(new Error('same call'), {
    reason: 'repeated_tool_call_without_progress',
  }));
  assert.equal(failure.code, 'repeated_method_stopped');
  assert.match(failure.text, /반복.*멈췄/u);
  assert.match(failure.nextSafeAction, /대화 상태.*다른 방법/u);
});

test('검증된 runaway는 호출 수가 아니라 차단 영수증 후 고집으로 설명한다', () => {
  const failure = userSafeTurnFailure({ reason: 'verified_resource_runaway' });
  assert.equal(failure.code, 'verified_repeated_method_stopped');
  assert.match(failure.text, /같은 결과.*차단 영수증/u);
  assert.doesNotMatch(failure.text, /token|turn|tool|Resource/u);
});

test('동일 도구 실패·Run 사용량 상한은 모델 변경이 아니라 정확한 중단 이유를 말한다', () => {
  for (const reason of ['repeated_tool_failure_without_progress', 'tool_failure_budget_exceeded', 'run_resource_budget_exceeded']) {
    const failure = userSafeTurnFailure(Object.assign(new Error('raw'), { reason }));
    assert.match(failure.text, /멈췄/u);
    assert.doesNotMatch(JSON.stringify(failure), /다른 모델/u);
  }
});
