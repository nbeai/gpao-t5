// L2 · 되게 만드는 사다리 (P2-6) — T5 의 최우선 미션은 **사용자 지시를 최대한 수행하는 것**이다.
//
// 오너 지시(2026-07-27): "된다/안 된다"만 말하지 마라. ① 가진 도구로 되는 방법을 찾고
// ② 못 하는 부분은 대안을 제시해라. 그게 동반자다. 네이버 하나 모바일로 뚫은 건 로봇이다.
//
// 그래서 실패를 **한 번의 결과**가 아니라 **사다리**로 다룬다.
//   1단 같은 도구, 다른 방법  — 주소 변환·다음 후보·인자 조정
//   2단 다른 도구            — 우리 수집이 막히면 모델 내장 검색, 로컬이 막히면 범위 확장 요청
//   3단 사용자와 함께        — 사람만 할 수 있는 최소 단계를 부탁한다(로그인·화면 붙여넣기)
//   4단 정직하게            — 무엇이 왜 막혔는지 + 지금 할 수 있는 한 가지
//
// 여기서 정하는 것은 **다음 시도의 종류**뿐이다. 실행·승인·기록은 기존 경로가 그대로 한다.

/** 실패 종류 → 다음에 밟을 계단. 도구가 늘어도 이 표는 종류로만 자란다(사례 하드코딩 금지). */
const LADDER = {
  // 웹: 사이트가 막았다 → 우리 수집 대신 모델이 자기 인프라로 찾는다(1층은 스크래핑 차단에 안 걸린다).
  robots_disallow: { rung: 'other_tool', useModelSearch: true, why: '그 사이트가 수집을 막아 두었어요' },
  login_wall: { rung: 'ask_user', useModelSearch: true, why: '로그인이 필요한 페이지예요' },
  bot_wall: { rung: 'other_tool', useModelSearch: true, why: '자동 접근을 막아 두었어요' },
  // 'blocked' 는 **모든 도구 공통** 상태다. 여기에 "주소" 같은 웹 어휘를 쓰면 파일 실패에도
  // "그 주소를 열지 못했어요"가 나간다(라이브 실측). 도구 중립으로 둔다.
  blocked: { rung: 'other_tool', useModelSearch: true, why: '그건 지금 열지 못했어요' },
  timeout: { rung: 'retry', why: '응답이 늦어요' },
  // 429/503 은 "안 되는 곳"이 아니라 **잠시 뒤면 되는 일**이다. 다른 경로로 도망가지 말고 기다린다.
  // (우리가 너무 자주 물어서 생긴 경우가 대부분이다 — 실측 2026-07-27.)
  rate_limited: { rung: 'retry', why: '너무 자주 물어봐서 그 사이트가 잠시 쉬라고 했어요' },
  // 로컬: 파일 손의 범위 밖은 **T5 의 한계가 아니다.** 그 자리를 읽는 손이 따로 있으면
  // 2단(다른 손)이지 3단(사용자에게 부탁)이 아니다. 라이브에서 이 계단을 3단으로 두는 바람에
  // "폴더를 통째로 복사해 주세요"까지 갔다(c217a0c6) — 다음 턴에 터미널로 다 읽을 수 있었다.
  //
  // **다만 손이 있을 때만 그렇게 말한다.** 없는 손을 약속하면 거짓이고, 그때는 범위를 넓혀
  // 달라고 부탁하는 것이 맞다(그건 사람만 할 수 있는 일이다 — 예전 계약 그대로 남긴다).
  out_of_scope: {
    rung: 'other_hand', needsHand: 'local.terminal',
    why: '그 자리는 파일 도구의 작업 폴더 밖이에요',
    없으면: { rung: 'ask_user', requestScope: true, why: '제 작업 폴더 밖이에요' },
  },
  needs_auth: { rung: 'ask_user', why: '연결이 필요해요' },
};

/**
 * 이번 실패에서 다음에 무엇을 할지 정한다.
 *
 * **지금 어떤 손이 있는지를 보고 정한다.** 표에 적힌 계단이라도 그 손이 없으면 그 계단은
 * 없는 것이다 — 없는 손을 약속하면 "할 수 있다"는 거짓이 사용자에게 나간다.
 * @param {Array<{failureState?:string, fetchState?:string, scopeState?:string}>} receipts
 * @param {string[]} [hands] 지금 실제로 쓸 수 있는 도구 id 들(미지정이면 판정하지 않고 표대로)
 * @returns {{rung:string, useModelSearch?:boolean, requestScope?:boolean, why?:string}|null}
 */
export function nextRung(receipts = [], hands) {
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') === 'none') continue;
    const key = r.fetchState ?? r.scopeState ?? r.failureState;
    const step = LADDER[key];
    if (!step) continue;
    const { needsHand, 없으면, ...본계단 } = step;
    // **모르면 약속하지 않는다.** 손이 있다고 확인됐을 때만 "다른 손으로 이어서"라고 말한다 —
    // 손 목록을 안 준 호출부(구형·단위 검사)는 보수적인 계단으로 간다. 없는 손을 약속하는 것이
    // 부탁하는 것보다 나쁘다: 사용자는 기다리다가 아무 일도 안 일어난 걸 알게 된다.
    if (needsHand && !(Array.isArray(hands) && hands.includes(needsHand))) {
      return { ...(없으면 ?? 본계단), from: key };
    }
    return { ...본계단, from: key };
  }
  return null;
}

/**
 * 사용자에게 보일 한 줄. **무엇이 막혔는지 + 지금 이어서 무엇을 하는지**를 함께 말한다.
 * "안 됩니다"로 끝나는 문장을 만들지 않는다(막다른 답 금지).
 */
export function rungMessage(step) {
  if (!step) return undefined;
  switch (step.rung) {
    case 'other_tool':
      return `${step.why}. 대신 제가 아는 경로로 찾아볼게요.`;
    // 2단의 로컬 판 — 한 손이 안 닿으면 **다른 손으로 내가 이어서 한다.** 사용자를 시키지 않는다.
    case 'other_hand':
      return `${step.why}. 제 다른 손으로 이어서 볼게요.`;
    case 'ask_user':
      return step.requestScope
        ? `${step.why}. 그 폴더를 제 작업 범위에 넣어 주시면 바로 볼 수 있어요.`
        : `${step.why}. 화면 내용을 붙여 주시면 이어서 정리할게요.`;
    case 'retry':
      // 시점을 정직하게(P-OP-6): 같은 턴의 같은 재시도는 지문이 막는다 — "해볼게요"라고
      // 약속해 놓고 이 턴에 안 하는 모양이 된다. 되는 것은 잠시 뒤(다음 요청)의 재시도다.
      return `${step.why}. 잠시 뒤에 다시 시도해 볼 수 있어요.`;
    default:
      return undefined;
  }
}
