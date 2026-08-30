const PROVIDER_LABEL = Object.freeze({
  openai: 'OpenAI', anthropic: 'Claude', gemini: 'Gemini',
  upstage: 'Upstage', chatgpt_oauth: 'ChatGPT 계정',
});

const KNOWN_STAGES = new Set([
  'runtime_setup', 'model_request', 'model_response', 'tool_execution',
  'effect_verification', 'result_preparation', 'surface_publication', 'delivery',
]);

function modelLabel(error, connection) {
  const provider = error?.provider ?? connection?.provider;
  const modelId = error?.modelId ?? connection?.modelId;
  const name = PROVIDER_LABEL[provider] ?? provider ?? '현재 모델';
  return modelId ? `${name} · ${modelId}` : name;
}

function failureStage(error, facts) {
  if (KNOWN_STAGES.has(error?.failureStage)) return error.failureStage;
  if (facts.deliveryState && facts.deliveryState !== 'not_started') return 'delivery';
  if (facts.resultState && facts.resultState !== 'none') return 'surface_publication';
  if (facts.effectState === 'unknown') return 'effect_verification';
  if ((facts.toolStarted ?? 0) > (facts.toolCompleted ?? 0)) return 'tool_execution';
  if (error?.status != null || error?.name?.includes('Transport')
    || (typeof error?.code === 'string' && error.code.startsWith('http_'))) {
    return 'model_response';
  }
  if (facts.modelState && facts.modelState !== 'not_started') return 'model_response';
  return 'runtime_setup';
}

function normalizedEffectState(facts) {
  if (['none', 'unchanged', 'changed', 'unknown'].includes(facts.effectState)) return facts.effectState;
  if ((facts.toolStarted ?? 0) === 0) return 'none';
  if ((facts.toolCompleted ?? 0) < (facts.toolStarted ?? 0)) return 'unknown';
  return 'unchanged';
}

function failureCode(error) {
  const candidate = String(error?.reason ?? error?.code ?? (error?.status ? `http_${error.status}` : 'runtime_failure'));
  return /^[a-z0-9_]{1,80}$/u.test(candidate) ? candidate : 'runtime_failure';
}

export function makeRuntimeFailureEnvelope(error, facts = {}) {
  const stage = failureStage(error, facts);
  const effectState = normalizedEffectState(facts);
  const toolStarted = Math.max(0, Number(facts.toolStarted) || 0);
  const toolCompleted = Math.max(0, Number(facts.toolCompleted) || 0);
  return {
    schema: 't5.runtime-failure-envelope.v1',
    request: { preserved: facts.requestPreserved !== false },
    failure: {
      stage,
      code: failureCode(error),
      retriable: error?.retriable === true,
    },
    model: { state: facts.modelState ?? (stage === 'runtime_setup' ? 'not_started' : 'response_failed') },
    tools: { started: toolStarted, completed: toolCompleted },
    evidence: {
      state: facts.evidenceState ?? (toolCompleted > 0 ? 'partial' : 'none'),
      count: Math.max(0, Number(facts.evidenceCount) || toolCompleted),
    },
    effect: { state: effectState },
    result: { state: facts.resultState ?? 'none' },
    delivery: { state: facts.deliveryState ?? 'not_started' },
    recovery: {
      resumable: facts.requestPreserved !== false && effectState !== 'unknown',
      exactResumePoint: facts.exactResumePoint ?? stage,
      automaticRetryAllowed: false,
    },
  };
}

function factualFallback(envelope) {
  const { failure, tools, evidence, effect, request } = envelope;
  let text;
  if (failure.stage === 'model_response' || failure.stage === 'model_request') {
    text = evidence.count > 0
      ? '응답을 만드는 단계에서 중단됐어요. 앞서 확인한 내용은 보존했지만 최종 답을 만들지 못했어요.'
      : '응답을 만드는 단계에서 중단됐어요. 이번 실행에서 확인하거나 변경한 항목은 없어요.';
  } else if (failure.stage === 'tool_execution' || failure.stage === 'effect_verification') {
    text = tools.completed > 0
      ? '필요한 작업을 수행하는 중 중단됐어요. 확인이 끝난 결과는 보존했어요.'
      : '필요한 작업을 시작하는 단계에서 중단됐어요.';
  } else if (failure.stage === 'surface_publication') {
    text = '결과는 준비됐지만 대화에 안전하게 남기는 단계에서 중단됐어요.';
  } else if (failure.stage === 'delivery') {
    text = '결과 전달 단계에서 중단됐어요.';
  } else {
    text = '요청을 시작하기 위한 준비 단계에서 중단됐어요.';
  }
  if (effect.state === 'unknown') {
    text += ' 마지막 작업이 실제로 반영됐는지는 확인이 필요해 자동으로 반복하지 않았어요.';
  }
  return {
    code: failure.code === 'runtime_failure' ? 'turn_processing_failed' : failure.code,
    text,
    nextSafeAction: request.preserved
      ? '요청과 확인된 상태는 보존했습니다. 같은 대화에서 이어갈 수 있어요.'
      : '요청을 다시 알려주면 현재 상태부터 확인할게요.',
  };
}

export function userSafeTurnFailure(error, connection = null, facts = {}) {
  const envelope = makeRuntimeFailureEnvelope(error, facts);
  const label = modelLabel(error, connection);
  let surface = null;
  if (error?.reason === 'protected_runtime_context_in_user_surface') surface = {
    code: 'protected_runtime_context_suppressed',
    text: '답에 내부 작업 정보가 섞여 그대로 표시하거나 보내지 않았어요.',
    nextSafeAction: '요청과 진행 상태는 보존했습니다.',
  };
  else if (error?.reason === 'verified_resource_runaway') surface = {
    code: 'verified_repeated_method_stopped',
    text: '같은 방법이 같은 결과만 낸 뒤 차단 영수증에도 반복되어 이번 작업을 멈췄어요.',
    nextSafeAction: '이미 확인한 상태는 보존했습니다. 다른 방법으로 이어가거나 현재 결과로 닫아야 해요.',
  };
  else if (error?.reason === 'repeated_tool_call_without_progress') surface = {
    code: 'repeated_method_stopped', text: '같은 방법으로 진전 없이 반복되어 이번 작업을 멈췄어요.',
    nextSafeAction: '대화 상태는 보존했습니다. 같은 대화에서 다른 방법으로 이어갈 수 있어요.',
  };
  else if (error?.reason === 'repeated_tool_failure_without_progress') surface = {
    code: 'repeated_method_failure_stopped',
    text: '같은 방법이 같은 이유로 두 번 실패해 더 이상 작업 범위를 넓히지 않고 멈췄어요.',
    nextSafeAction: '확인된 상태는 보존했습니다. 실패한 입력 대상을 고친 뒤 그 지점부터 이어갈 수 있어요.',
  };
  else if (error?.reason === 'tool_failure_budget_exceeded') surface = {
    code: 'failed_method_budget_stopped',
    text: '여러 방법이 연속으로 실패해 안전한 작업 범위를 넘기기 전에 멈췄어요.',
    nextSafeAction: '확인된 상태에서 한 가지 복구 방법을 선택해 이어갈 수 있어요.',
  };
  else if (error?.reason === 'run_resource_budget_exceeded') surface = {
    code: 'run_resource_budget_stopped',
    text: '이번 작업이 책임 있게 사용할 수 있는 범위를 넘어 멈췄어요.',
    nextSafeAction: '현재까지 확인한 결과는 보존했습니다. 범위를 나누거나 실패 지점부터 이어갈 수 있어요.',
  };
  else if (error?.reason === 'required_completion_receipt_missing') surface = {
    code: 'scheduled_completion_receipt_missing',
    text: '예약 작업의 실제 목적 달성 근거가 없어 성공으로 처리하지 않았어요.',
    nextSafeAction: '확인된 실행 결과와 남은 작업을 기준으로 다시 진행할 수 있어요.',
  };
  else if (error?.reason === 'image_input_unsupported') surface = {
    code: 'model_image_input_unsupported', text: `현재 선택한 ${label} 연결에서는 이미지 입력을 사용할 수 없어요.`,
    nextSafeAction: '이미지 입력을 지원하는 다른 모델을 선택한 뒤 이어갈 수 있어요.',
  };
  else if (error?.status === 401 || error?.status === 403) surface = {
    code: 'model_authentication_failed', text: `${label} 연결을 인증하지 못했어요.`,
    nextSafeAction: '설정에서 해당 모델 연결을 다시 확인해 주세요.',
  };
  else if (error?.status === 429) surface = {
    code: 'model_rate_limited', text: `${label}의 사용량 제한으로 지금 요청을 처리하지 못했어요.`,
    nextSafeAction: '요청은 보존했습니다. 잠시 후 같은 대화에서 이어갈 수 있어요.',
  };
  surface ??= factualFallback(envelope);
  return { ...surface, envelope };
}
