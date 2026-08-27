import { createHash } from 'node:crypto';

function bytes(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function add(output, kind, value) {
  const current = output[kind] ?? { items: 0, payloadBytes: 0 };
  current.items += 1; current.payloadBytes += bytes(value); output[kind] = current;
}
function contentKinds(value, output) {
  if (Array.isArray(value)) { value.forEach((item) => contentKinds(item, output)); return; }
  if (!value || typeof value !== 'object') return;
  const type = String(value.type ?? '');
  if (['input_image', 'image_url', 'image'].includes(type) || value.inlineData || value.fileData) add(output, 'image', value);
  if (['function_call_output', 'tool_result'].includes(type) || value.functionResponse) add(output, 'tool_result', value);
  if (['function_call', 'tool_use'].includes(type) || value.functionCall) add(output, 'tool_call_history', value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') contentKinds(child, output);
}
function embeddedTransmission(value, output, scope) {
  if (Array.isArray(value)) { value.forEach((item) => embeddedTransmission(item, output, scope)); return; }
  if (!value || typeof value !== 'object') return;
  if (value.transmission?.category && ['document_candidates', 'document_excerpt'].includes(value.transmission.category)) {
    add(output, value.transmission.category, value.transmission);
    if (value.transmission.sourceWholeObserved === true) scope.completeSourcesObserved += 1;
    if (value.transmission.wholeSourceSent === false) scope.confirmedPartialSources += 1;
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') embeddedTransmission(child, output, scope);
}
function inputCategories(input, output, scope) {
  for (const item of Array.isArray(input) ? input : []) {
    const type = String(item?.type ?? ''); const role = String(item?.role ?? '');
    if (['function_call_output', 'tool_result'].includes(type) || role === 'tool') {
      add(output, 'tool_result', item);
      const encoded = item.output ?? item.content;
      if (typeof encoded === 'string') { try { embeddedTransmission(JSON.parse(encoded), output, scope); } catch { /* ordinary tool text */ } }
    }
    else if (['function_call', 'tool_use', 'reasoning'].includes(type)) add(output, 'assistant_history', item);
    else if (['assistant', 'model'].includes(role)) add(output, 'assistant_history', item);
    else if (['system', 'developer'].includes(role)) add(output, 'system_instruction', item);
    else if (role === 'user') add(output, 'user_message', item);
    else add(output, 'other_input', item);
    for (const child of Object.values(item ?? {})) if (child && typeof child === 'object') contentKinds(child, output);
  }
}
function credentialFieldCount(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + credentialFieldCount(item), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [key, child]) => sum
    + (/^(?:authorization|api_?key|access_?token|refresh_?token|client_?secret|password)$/iu.test(key) ? 1 : 0)
    + credentialFieldCount(child), 0);
}

export function makeTransmissionReceipt({ provider, model, endpoint, serializedBody,
  transportState = 'dispatch_attempted' } = {}) {
  if (!provider || !model || typeof serializedBody !== 'string') throw new TypeError('serialized provider wire is required');
  if (!['dispatch_attempted', 'response_received', 'transport_unknown'].includes(transportState)) {
    throw new TypeError('transmission transport state is invalid');
  }
  let body;
  try { body = JSON.parse(serializedBody); } catch { throw new TypeError('serialized provider wire must be JSON'); }
  const categories = {};
  const scope = { completeSourcesObserved: 0, confirmedPartialSources: 0 };
  if (body.instructions != null) add(categories, 'system_instruction', body.instructions);
  if (body.system != null) add(categories, 'system_instruction', body.system);
  if (body.systemInstruction != null) add(categories, 'system_instruction', body.systemInstruction);
  if (body.tools != null) add(categories, 'tool_definition', body.tools);
  inputCategories(body.input ?? body.messages ?? body.contents ?? [], categories, scope);
  const endpointOrigin = endpoint ? new URL(endpoint).origin : null;
  const credentialBody = { ...body }; delete credentialBody.tools;
  return {
    schema: 't5.transmission-receipt.v1', provider: String(provider), model: String(model),
    endpointOrigin, transportState,
    requestBytes: Buffer.byteLength(serializedBody, 'utf8'),
    wireSha256: createHash('sha256').update(serializedBody).digest('hex'),
    categories,
    credentialFieldsInBody: credentialFieldCount(credentialBody),
    credentialHeadersExcluded: true,
    originalLocalSourceScope: scope.completeSourcesObserved > 0 ? 'observed_complete' : 'unknown',
    wholeSourceNotSent: scope.confirmedPartialSources > 0 ? 'confirmed' : 'unknown',
  };
}

export function settleTransmissionReceipt(receipt, transportState) {
  if (receipt?.schema !== 't5.transmission-receipt.v1'
    || !['response_received', 'transport_unknown'].includes(transportState)) {
    throw new TypeError('transmission settlement is invalid');
  }
  return { ...structuredClone(receipt), transportState };
}

export function projectTransmissionReceipt(receipt) {
  if (receipt?.schema !== 't5.transmission-receipt.v1') throw new TypeError('transmission receipt is required');
  const labels = { system_instruction: 'T5 작업 지침', user_message: '사용자 요청',
    assistant_history: '대화·모델 작업 기록', tool_definition: '도구 설명', tool_result: '도구 결과',
    tool_call_history: '도구 호출 기록', image: '이미지', other_input: '기타 입력' };
  labels.document_candidates = '로컬 문서 후보'; labels.document_excerpt = '선택한 문서 일부';
  return { provider: receipt.provider, model: receipt.model, requestBytes: receipt.requestBytes,
    transportState: receipt.transportState,
    categories: Object.entries(receipt.categories).map(([kind, value]) => ({ kind,
      label: labels[kind] ?? '기타 정보', items: value.items, payloadBytes: value.payloadBytes })),
    credentialsSentInBody: receipt.credentialFieldsInBody > 0,
    wholeSourceNotSent: receipt.wholeSourceNotSent };
}
