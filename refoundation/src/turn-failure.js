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
    nextSafeAction: '잠시 후 다시 시도하거나, 같은 문제가 계속되면 다른 모델을 선택해 주세요.',
  };
}
