const PROVIDER_LABEL = Object.freeze({
  openai: 'OpenAI', anthropic: 'Claude', gemini: 'Gemini',
  upstage: 'Upstage', chatgpt_oauth: 'ChatGPT 계정',
});

function modelLabel(error, connection) {
  const provider = error?.provider ?? connection?.provider;
  const modelId = error?.modelId ?? connection?.modelId;
  const name = PROVIDER_LABEL[provider] ?? provider ?? '현재 모델';
  return modelId ? `${name} · ${modelId}` : name;
}

export function userSafeTurnFailure(error, connection = null) {
  const label = modelLabel(error, connection);
  if (error?.reason === 'repeated_tool_call_without_progress') return {
    code: 'repeated_method_stopped',
    text: '같은 방법으로 진전 없이 반복되어 이번 작업을 멈췄어요.',
    nextSafeAction: '대화 상태를 다시 준비하거나 다른 방법으로 새로 요청해 주세요.',
  };
  if (error?.reason === 'repeated_tool_failure_without_progress') return {
    code: 'repeated_method_failure_stopped',
    text: '같은 방법이 같은 이유로 두 번 실패해 더 이상 화면 조작을 넓히지 않고 멈췄어요.',
    nextSafeAction: '이미 확인한 상태는 보존했습니다. 실패한 입력 대상을 고친 뒤 그 지점부터 다시 진행해야 해요.',
  };
  if (error?.reason === 'tool_failure_budget_exceeded') return {
    code: 'failed_method_budget_stopped',
    text: '여러 방법이 연속으로 실패해 안전한 작업 범위를 넘기기 전에 멈췄어요.',
    nextSafeAction: '실패 원인과 마지막으로 확인된 상태를 기준으로 한 가지 복구 방법만 다시 선택해야 해요.',
  };
  if (error?.reason === 'run_resource_budget_exceeded') return {
    code: 'run_resource_budget_stopped',
    text: '이번 작업이 책임 있게 사용할 수 있는 모델 왕복·도구·사용량 범위를 넘어 멈췄어요.',
    nextSafeAction: '현재까지 확인한 결과는 대화에 보존했습니다. 범위를 나누거나 실패 지점부터 새 작업으로 이어가야 해요.',
  };
  if (error?.reason === 'required_completion_receipt_missing') return {
    code: 'scheduled_completion_receipt_missing',
    text: '예약 작업이 실제 목적 달성 영수증을 남기지 않아 성공으로 처리하지 않았어요.',
    nextSafeAction: '자동화 상태에서 실행 근거와 남은 작업을 확인한 뒤 다시 실행해야 해요.',
  };
  if (error?.reason === 'image_input_unsupported') return {
    code: 'model_image_input_unsupported',
    text: `현재 선택한 ${label} 연결에서는 이미지 입력을 사용할 수 없어요.`,
    nextSafeAction: '이미지 입력을 지원하는 다른 모델을 선택한 뒤 다시 요청해 주세요.',
  };
  if (error?.status === 401 || error?.status === 403) return {
    code: 'model_authentication_failed',
    text: `${label} 연결을 인증하지 못했어요.`,
    nextSafeAction: '설정에서 해당 모델 연결을 다시 확인해 주세요.',
  };
  if (error?.status === 429) return {
    code: 'model_rate_limited',
    text: `${label}의 사용량 제한으로 지금 요청을 처리하지 못했어요.`,
    nextSafeAction: '잠시 후 다시 시도하거나 다른 모델을 선택해 주세요.',
  };
  return {
    code: 'turn_processing_failed',
    text: '요청을 처리하는 중 문제가 생겨 이번 작업을 끝내지 못했어요.',
    nextSafeAction: '이 대화에 남은 실패 원인과 마지막 확인 상태를 보고 같은 지점부터 다시 시도해 주세요.',
  };
}
