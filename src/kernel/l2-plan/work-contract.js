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

/**
 * **완료는 "새 파일이 생겼다"가 아니라 "요청한 파일 상태 변화가 일어났다"이다.**
 *
 * 오너 라이브 실측(2026-08-03): "다운로드 폴더 유형별로 정리해줘"에 T5 는 완료 계약을
 * `write` 영수증 하나로 잡았다. 정리의 정답은 `move` 인데 계약에도 강제 목록에도 `write`
 * 밖에 없어서, 모델이 낼 수 있는 유일한 write 가 **쓰레기 로그 파일**이었다. 그게 계약을
 * 충족시켜 "완료"가 됐고 정리는 하나도 안 됐다.
 * 사용자의 목표("폴더가 정리된 상태")를 대리지표("파일 하나가 생김")로 바꿔친 것이다.
 *
 * `move`·`delete` 도 사용자 자료의 상태를 바꾼 **실제 결과**다. digest 는 write 만 내므로
 * 결과 신분은 작업별로 본다 — 없는 증거를 요구하면 되는 일도 미충족으로 남는다.
 */
function isDeliverableWork(receipt) {
  if ((receipt?.failureState ?? 'none') !== 'none') return false;
  if (receipt?.actualCall?.tool !== 'local.file') return false;
  const action = receipt?.actualCall?.args?.action;
  if (action === 'write') {
    return typeof receipt?.result?.path === 'string' && typeof receipt?.result?.digest === 'string';
  }
  // 옮김·지움은 대상 경로가 결과에 남으면 실제로 일어난 것이다(휴지통 계약은 손이 지킨다).
  return (action === 'move' || action === 'delete') && typeof receipt?.result?.path === 'string';
}
const isSuccessfulWrite = isDeliverableWork;

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
  if (!refs.length || !plan?.completionContract || !plan?.completionContractRef || !plan?.workRef) return receipt;
  return {
    ...receipt,
    deliverableRefs: [...new Set(refs)],
    workRef: plan.workRef,
    completionContract: structuredClone(plan.completionContract),
    completionContractRef: plan.completionContractRef,
  };
}

/**
 * 파일 산출물은 같은 계약 신분이 결합된 성공 local.file write 영수증으로만 충족된다.
 * 다른 도구의 digest, 읽기 영수증, 무관한 파일 쓰기는 산출물 신분이 아니다.
 */
export function unsatisfiedDeliverables(plan, receipts = []) {
  return (plan?.deliverables ?? []).filter((wanted) => {
    if (wanted?.kind !== 'file') return true;
    return !receipts.some((receipt) => isSuccessfulWrite(receipt)
      && receipt.workRef === plan?.workRef
      && receipt.completionContractRef === plan?.completionContractRef
      && receipt.deliverableRefs?.includes(wanted.id));
  });
}
