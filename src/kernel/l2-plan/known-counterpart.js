// L2 · 아는 상대 (자동성 헌장 ③) — **그 상대에 한 번만 묻는다.**
//
// 헌장(design/T5-AUTONOMY-CHARTER-2026-08-03-ko.md, 오너 승인 2026-08-03):
//   "새 상대에게 첫 외부 전송 — 그 상대에 **한 번만**. 그 뒤로는 묻지 않는다."
//
// 이것이 없으면 헌장 ③ 은 "매번 묻는다"로 남는다. 판정(`decideAutoGrant`)은 `counterpartKnown`
// 을 보지만 그 사실을 **만드는 자리**가 없으면 조건이 영영 참이 되지 않기 때문이다.
//
// ── 흡수: OpenClaw `exec-approvals.ts` 의 승인 재사용 구조 ──────────────────
// 실물 코드에서 확인한 세 계약을 그대로 옮긴다(2026-08-03 조사).
//
//  1. **사람의 명시 승인에서만 durable 해진다.**
//     OpenClaw `commitExecAuthorizationLocked` 는 `allow-always` 를 `source === "explicit-approval"`
//     일 때만 커밋한다 — 모델(auto-review)은 일회 실행을 열 수 있어도 **미래를 열 수 없다.**
//     그래서 이 저장은 `input.approve` 경로에서만 일어난다. 자동으로 흘러간 전송(이미 아는 상대)은
//     아무 것도 새로 저장하지 않는다 — 저장은 사람이 처음 허락한 그 한 번에서만 생긴다.
//
//  2. **철회가 즉시 이긴다.** 사용자가 지우면 그 상대는 다시 새 상대다. 추가는 무해하지만
//     제거는 대기 중인 판단까지 되돌린다(OpenClaw `isExecApprovalPolicySnapshotCurrent` 의 비대칭).
//
//  3. **신분을 처음부터 안정적으로 정의한다.** OpenClaw 는 패턴 해시의 입력이 바뀌면
//     "every persisted exact-command grant" 가 조용히 고아가 된다고 코드에 경고를 남겼다.
//     여기서 신분은 `채널(도구 id) + 정규화된 수신자` 둘뿐이다. 본문·시각·세션은 넣지 않는다 —
//     그것들이 들어가면 같은 상대에게 두 번째 메시지를 보낼 때 다시 새 상대가 된다.
//
// ── 넣지 않은 것 ──────────────────────────────────────────────────────────
//   · 대소문자·공백 말고는 정규화하지 않는다. 전화번호 형식이나 이메일 별칭을 여기서 추측하면
//     **다른 사람을 같은 사람으로 보는 사고**가 난다. 모르는 형태는 다른 상대로 둔다(안전한 쪽).
//   · 라벨(`targetLabel`)은 신분이 아니다. 사람이 보는 이름은 바뀔 수 있고 실행 값이 진실이다.

/**
 * 상대의 안정 신분. 채널(도구 id)과 실행 대상 값 둘로만 만든다.
 * @returns {string|null} 대상이 없으면 null — 없는 상대를 아는 상대로 만들지 않는다.
 */
export function counterpartRef(toolId, target) {
  const tool = String(toolId ?? '').trim();
  const to = String(target ?? '').trim().toLowerCase();
  if (!tool || !to) return null;
  return `${tool}|${to}`;
}

/** 이 상대에게 보낸 것을 사용자가 이미 허락했는가. */
export function isKnownCounterpart(known, toolId, target) {
  const ref = counterpartRef(toolId, target);
  if (!ref) return false;
  return (known instanceof Set ? known : new Set(known ?? [])).has(ref);
}

/**
 * 사람이 승인한 전송에서 상대를 기억한다. **승인 경로에서만 부른다.**
 * @returns {boolean} 새로 기억했으면 true(원장에 남길 사실이 생겼다는 뜻).
 */
export function rememberCounterpart(known, toolId, target) {
  const ref = counterpartRef(toolId, target);
  if (!ref || !(known instanceof Set)) return false;
  if (known.has(ref)) return false;
  known.add(ref);
  return true;
}

/** 철회 — 그 상대는 다시 새 상대가 된다. 철회는 즉시 이긴다. */
export function forgetCounterpart(known, toolId, target) {
  const ref = counterpartRef(toolId, target);
  if (!ref || !(known instanceof Set)) return false;
  return known.delete(ref);
}
