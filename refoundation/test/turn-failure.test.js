import test from 'node:test';
import assert from 'node:assert/strict';

import { userSafeTurnFailure } from '../src/turn-failure.js';

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
  assert.match(failure.text, /요청을 처리하는 중/u);
  assert.doesNotMatch(JSON.stringify(failure), /터미널|provider secret raw detail/u);
});

test('같은 도구 무진전 반복은 사용자에게 정지와 회복 경로로 보인다', () => {
  const failure = userSafeTurnFailure(Object.assign(new Error('same call'), {
    reason: 'repeated_tool_call_without_progress',
  }));
  assert.equal(failure.code, 'repeated_method_stopped');
  assert.match(failure.text, /반복.*멈췄/u);
  assert.match(failure.nextSafeAction, /대화 상태.*다른 방법/u);
});

test('동일 도구 실패·Run 사용량 상한은 모델 변경이 아니라 정확한 중단 이유를 말한다', () => {
  for (const reason of ['repeated_tool_failure_without_progress', 'tool_failure_budget_exceeded', 'run_resource_budget_exceeded']) {
    const failure = userSafeTurnFailure(Object.assign(new Error('raw'), { reason }));
    assert.match(failure.text, /멈췄/u);
    assert.doesNotMatch(JSON.stringify(failure), /다른 모델/u);
  }
});
