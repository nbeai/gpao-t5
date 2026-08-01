// L2 · 작업 완료 계약. 모델은 결과 형태를 판단하고, OS 는 실제 영수증으로 완료를 판정한다.

/** 전용 판단 호출의 답을 좁은 구조 값으로 바꾼다. 사용자 문구를 분류하지 않는다. */
export function parseDeliverableJudgment(text) {
  const value = String(text ?? '').trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
    .toUpperCase();
  if (value === 'FILE') return 'file';
  if (value === 'CHAT') return 'chat';
  return null;
}

/** 모델이 고른 실제 손이 파일 작업 흐름에 닿았는지 본다. */
export function fileWorkIsInPlay(calls = []) {
  return calls.some((call) => call?.name === 'local.file' || call?.name === 'local.locate');
}

function isSuccessfulWrite(receipt) {
  return (receipt?.failureState ?? 'none') === 'none'
    && receipt?.actualCall?.tool === 'local.file'
    && receipt?.actualCall?.args?.action === 'write'
    && typeof receipt?.result?.path === 'string'
    && typeof receipt?.result?.digest === 'string';
}

/**
 * 성공한 쓰기가 어떤 완료 계약을 충족했는지 영수증에 결합한다. 변환 산출물은 원본과
 * 다른 파일이라는 도구의 기계 사실까지 있어야 결합된다. 단순히 digest 가 있다는 이유로
 * 무관한 파일 쓰기를 완료로 세지 않는다.
 */
export function bindDeliverableReceipt(plan, receipt) {
  if (!isSuccessfulWrite(receipt)) return receipt;
  const refs = (plan?.deliverables ?? []).filter((wanted) => {
    if (wanted?.kind !== 'file' || wanted?.operation !== 'write' || !wanted?.id) return false;
    if (wanted.binding === 'direct') return true;
    return wanted.binding === 'derived'
      && receipt.result?.originalUntouched === true
      && typeof receipt.result?.source === 'string'
      && receipt.result.source !== receipt.result.path;
  }).map((wanted) => wanted.id);
  return refs.length ? { ...receipt, deliverableRefs: [...new Set(refs)] } : receipt;
}

/**
 * 파일 산출물은 같은 계약 신분이 결합된 성공 local.file write 영수증으로만 충족된다.
 * 다른 도구의 digest, 읽기 영수증, 무관한 파일 쓰기는 산출물 신분이 아니다.
 */
export function unsatisfiedDeliverables(plan, receipts = []) {
  return (plan?.deliverables ?? []).filter((wanted) => {
    if (wanted?.kind !== 'file') return true;
    return !receipts.some((receipt) => isSuccessfulWrite(receipt)
      && receipt.deliverableRefs?.includes(wanted.id));
  });
}
