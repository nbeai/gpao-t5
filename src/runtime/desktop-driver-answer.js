// **드라이버 답은 한 자리에서 읽는다** (CU-1 · 계열 B)
//
// 오늘(2026-08-05~06) 같은 병을 **네 번** 밟았다:
//   `bring_to_front` 가 `Missing required integer field: pid` 를 냈고,
//   `focus` 가 `effect:'refused'` 를 냈고,
//   `click` 이 같은 pid 거절을 냈고,
//   `set_value` 거절을 손이 또 못 알아봤다.
// 그때그때 막았더니 **다음 자리에서 또 샜다.** 그 사이 화면은 안 바뀌었는데
// T5 는 *"했어요"* 라고 말했다 — **안 나간 것을 나갔다고 한 것**이다.
//
// 그래서 읽는 자리를 **하나로** 만든다. 손도 드라이버도 여기만 본다.
// 우리 전후 추측은 **드라이버가 아무 말도 안 했을 때만** 쓴다(`값`).
//
// ── 네 가지뿐이다 ────────────────────────────────────────────────────────
//   거절     안 나갔다. 인자가 모자라거나 대상을 못 찾았다 — **우리 잘못이지 결과가 아니다**
//   골라야함  모호해서 안 했다. 실패가 아니라 되물음이다(A02)
//   확인됨    드라이버가 스스로 확인해 줬다 — 우리 추측보다 낫다
//   모름     보냈는데 확인 수단이 없다. **실패가 아니다** — 실측으로 실제로 눌린다
//
// `unverifiable` 을 거절로 보면 **눌린 것을 안 눌렀다고** 하게 된다(오늘 사진으로 확인).

/** 인자가 모자라거나 대상을 못 찾아 **안 나간** 답인가. */
export function 거절인가(r) {
  if (Array.isArray(r)) {
    return r.some((x) => /Missing required|invalid|unsupported/i.test(String(x?.text ?? '')));
  }
  return r?.effect === 'refused';
}

/** 거절 사유를 사람이 읽을 수 있게. 없는 이유를 지어내지 않는다. */
export function 거절사유(r) {
  if (Array.isArray(r)) return String(r[0]?.text ?? '드라이버가 인자를 못 받았다');
  return String(r?.code ?? '드라이버가 거절했다');
}

/**
 * 드라이버 답을 **네 갈래 중 하나**로 읽는다.
 * @param {*} r
 * @returns {{종류:'거절'|'골라야함'|'확인됨'|'모름'|'값', 근거?:string, 후보?:Array, 값?:*}}
 */
export function 드라이버답(r) {
  if (거절인가(r)) return { 종류: '거절', 근거: 거절사유(r) };
  if (Array.isArray(r?.골라야함) && r.골라야함.length) return { 종류: '골라야함', 후보: r.골라야함 };
  if (r?.확인됨 === true) return { 종류: '확인됨', 근거: r.근거 ?? 'driver_verified' };
  if (r?.effect === 'unverifiable') return { 종류: '모름', 근거: 'unverifiable' };
  return { 종류: '값', 값: r };
}
