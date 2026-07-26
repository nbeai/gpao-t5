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
  // 로컬: 범위 밖이면 **범위를 넓히자고 제안**한다(그냥 실패로 끝내지 않는다 — §22 로컬 지배력).
  out_of_scope: { rung: 'ask_user', requestScope: true, why: '제 작업 폴더 밖이에요' },
  needs_auth: { rung: 'ask_user', why: '연결이 필요해요' },
};

/**
 * 이번 실패에서 다음에 무엇을 할지 정한다.
 * @param {Array<{failureState?:string, fetchState?:string, diagnosticTrace?:object, userSafeSummary?:string}>} receipts
 * @returns {{rung:string, useModelSearch?:boolean, requestScope?:boolean, why?:string}|null}
 */
export function nextRung(receipts = []) {
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') === 'none') continue;
    const key = r.fetchState ?? r.scopeState ?? r.failureState;
    const step = LADDER[key];
    if (step) return { ...step, from: key };
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
    case 'ask_user':
      return step.requestScope
        ? `${step.why}. 그 폴더를 제 작업 범위에 넣어 주시면 바로 볼 수 있어요.`
        : `${step.why}. 화면 내용을 붙여 주시면 이어서 정리할게요.`;
    case 'retry':
      return `${step.why}. 다시 한 번 해볼게요.`;
    default:
      return undefined;
  }
}
