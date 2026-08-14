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
  // 지움은 대상 경로가 결과에 남으면 실제로 일어난 것이다(휴지통 계약은 손이 지킨다).
  if (action === 'delete') return typeof receipt?.result?.path === 'string';

  // ── **옮김은 자리가 둘인 일이다** (F-108 · 2026-08-13) ────────────────────
  //
  // 예전엔 여기서도 `result.path` 를 찾았다. 그런데 손은 그 칸을 안 낸다 —
  // `local-file.js:1134` 의 `move` 는 `{ from, to }` 를, `:1241` 의 `bulk_move` 는
  // `{ from, to, moved, skipped, remainingSource }` 를 낸다. 그리고 `bulk_move` 는
  // **action 이름부터** 옛 열거(`move`·`delete`)에 없었다. 두 겹으로 안 맞았다.
  //
  // 손이 옳다. 옮김은 **어디서 어디로**인 일이고 `path` 한 칸으로는 그걸 못 말한다.
  // 계약이 손의 실제 모양을 따라간다 — 이 저장소가 이미 배운 것이다:
  // *"손이 스스로 쥔 것이 있으면 그것을 쓴다. 커널은 빈 자리만 메운다."*
  //
  // 사용자 자리에서 무슨 일이 났나: *"다운로드 폴더 유형별로 정리해줘"* — 위 주석이
  // 이 조항의 존재 이유로 박아 둔 바로 그 실측이다. 파일은 진짜로 옮겨지고, 원장은
  // 성공이라 적고, 출구 검증은 *"정리했어요"* 를 통과시키는데 **완료로는 안 기록됐다.**
  // 그래서 다음 턴의 *"아까 그거 이어줘"* 에 T5 가 끝난 일을 다시 하려 든다.
  //
  // **「돌긴 돌았다」는 한 일이 아니다** — 묶음은 실제로 옮겨진 것이 하나라도 있어야 한다.
  // `path` 도 계속 받는다 — 옛 계약을 깨지 않는다. 새로 받는 것은 손이 **실제로 내는** `to` 다.
  if (action === 'move') {
    const r = receipt?.result ?? {};
    return (typeof r.to === 'string' && r.to.length > 0)
      || (typeof r.path === 'string' && r.path.length > 0);
  }
  if (action === 'bulk_move') {
    return Array.isArray(receipt?.result?.moved) && receipt.result.moved.length > 0;
  }
  // copy(F-120)도 자리가 둘인 일이다 — 손이 내는 것은 { from, to, originalUntouched }.
  // 여기 없으면 F-108 그대로 재발한다: 사본은 진짜로 생겼는데 완료로 안 세져
  // 다음 턴 "아까 그거 이어줘"가 끝난 복사를 다시 한다(감시자 검문이 착수 전에 잡음).
  if (action === 'copy') {
    return typeof receipt?.result?.to === 'string' && receipt.result.to.length > 0;
  }
  // bulk_copy(F-120 표본 2)는 bulk_move 와 같은 계약 — 실제로 생긴 사본이 하나는 있어야 한다.
  if (action === 'bulk_copy') {
    return Array.isArray(receipt?.result?.copied) && receipt.result.copied.length > 0;
  }
  return false;
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
