// L0 · ToolReceipt (Tool Execution Truth Ledger 계약, §7)
// 못 쓴 도구를 쓴 척하지 않는다. 사용자면(userSafeSummary)과 진단면(diagnosticTrace)을 분리한다.
// T3 회귀 방지: 정화가 진단면까지 덮거나, 진단이 사용자면으로 새는 두 방향 모두 막는다.
import { FAILURE, LIFECYCLE } from '../contracts.js';

/**
 * 실행·전달 수명주기 파생(Phase 5.1, §7). none|attempting|delivered|failed|abandoned.
 * 실행/전달만 — 승인(held/approved)은 AuthorityGrant 소관.
 * @param {object|null} actualCall
 * @param {import('../contracts.js').FailureState} failureState
 * @param {*} result
 */
function deriveLifecycle(actualCall, failureState, result) {
  if (!actualCall) return 'none'; // 호출 안 함(예: 실행 불가로 차단)
  if (failureState === FAILURE.NONE && result !== undefined) return 'delivered';
  if (failureState !== FAILURE.NONE) return 'failed';
  return 'attempting';
}

/**
 * @param {Object} r
 * @param {string} r.intended
 * @param {{tool:string, args?:*}|null} [r.actualCall]
 * @param {*} [r.result]
 * @param {import('../contracts.js').FailureState} [r.failureState]
 * @param {string} r.userSafeSummary
 * @param {*} [r.diagnosticTrace]
 * @param {string} [r.nextSafeAction]
 * @returns {import('../contracts.js').ToolReceipt}
 */
export function receipt(r) {
  if (!r || typeof r.intended !== 'string') throw new TypeError('receipt: intended 필수');
  if (typeof r.userSafeSummary !== 'string') throw new TypeError('receipt: userSafeSummary 필수');
  const failureState = r.failureState ?? FAILURE.NONE;
  const actualCall = r.actualCall ?? null;
  // Phase 5.1(§7): lifecycle은 실행·전달 enum만 허용. 승인 상태(approved/held 등)가 원장에 새는 것을
  // 계약 차원에서 막는다(감사 보정). 잘못된 값은 조용히 통과시키지 않고 실패로 본다.
  const lifecycle = r.lifecycle ?? deriveLifecycle(actualCall, failureState, r.result);
  if (!LIFECYCLE.includes(lifecycle)) {
    throw new TypeError(`receipt: lifecycle 은 ${LIFECYCLE.join('/')} 만 허용(받음: ${lifecycle}). 승인 상태는 AuthorityGrant 소관`);
  }
  return {
    intended: r.intended,
    actualCall,
    // **모델이 고른 호출인데 부르지 않은 것.** `actualCall` 과 나눠 둔다 — 부르지 않은 것을
    // "실제 호출"로 적으면 원장이 거짓이 되고, 그렇다고 지우면 모델은 자기가 시킨 것을
    // 다 했다고 믿은 채 답을 쓴다(조용한 축소). 값(result)은 없다.
    제안한호출: r.제안한호출,
    result: r.result,
    failureState,
    // 실행·전달 수명주기. 승인 상태는 여기 아니라 AuthorityGrant에 있다.
    lifecycle,
    // 출처 근거(P6-2 Slice-2). 웹 도구는 출처 없이 "확인"을 주장하지 못한다 — Truth Ledger 연결.
    sources: r.sources,
    userSafeSummary: r.userSafeSummary,
    diagnosticTrace: r.diagnosticTrace,
    nextSafeAction: r.nextSafeAction,
    // 실패한 손이 어디까지 갔는지에 대한 **기계 사실**. 실패 결과 원문과 진단면을
    // 이 진행 칸으로 승격하지 않고도, 제출 전 거절(refused)과 제출 뒤 미확인(unknown)을
    // 구분해 다음 손을 고를 수 있게 한다. 판정은 도구가 낸 값을 그대로 보존한다.
    진행: r.진행,
    // 같은 턴에서 실제 확인한 폴더만 싣는 읽기 범위 사실. 영구 권한도 쓰기 권한도 아니다.
    readScopeRoots: r.readScopeRoots,
    // 막힌 **종류**(사이트 차단·로그인벽·범위 밖…). 다음 계단을 이걸로 정한다(P2-6 사다리).
    // 진단 원문이 아니라 분류값이라 사용자면 판단에 써도 안전하다.
    fetchState: r.fetchState,
    // **손이 실제로 쥔 다음 수.** `nextSafeAction` 은 사람에게 하는 한 문장이고, 이건 모델이
    // 그대로 부를 수 있는 값이다(주소·창 위치). 둘은 대체재가 아니다 — 문장만 있으면
    // *"다른 데서 찾아볼게요"* 라 말하고 아무 데도 못 간다(라이브 2026-08-05).
    //
    // **실패한 영수증에도 싣는다.** 결과(`result`)를 안 싣는 계약은 그대로다 — 못 본 페이지의
    // 내용은 사실이 아니다. 그러나 *검색기가 실제로 돌려준 후보 목록*은 우리가 밟은 사실이고,
    // 그걸 같이 버려서 **다음 수가 정확히 필요한 자리에서만 다음 수가 없었다.**
    다음수단: r.다음수단,
    다른후보: r.다른후보,
    // 어디를 열어 봤고 무슨 벽이었나. 이게 없으면 다음 수가 방금 막힌 곳을 다시 가리킨다.
    막힌곳: r.막힌곳,
    // **성공했는데 무엇을 얻었나.** `failureState: none` 은 "그 손이 제 일을 했다"는 뜻이지
    // "대상의 내용을 얻었다"는 뜻이 아니다. 둘을 같은 칸으로 읽으면, 찾기만 성공한 턴에서
    // 거짓 성공 게이트가 통째로 꺼진다(§4.7 — 손이 늘 때 사라지는 방어).
    // 손이 스스로 밝힌다. 커널이 내용을 보고 판정하지 않는다(심문 금지).
    읽은상태: r.읽은상태,
    // 이 일을 마치려면 **사용자에게 열어 줘야 하는 표면**(예: 비밀 입력창).
    // 커널은 종류만 안다 — 무엇을 묻는지·어떤 서비스인지는 도구가 채운다(previewOf 와 같은 계약).
    // 비밀값이 여기 담기면 원장에 남는다. **요청만 담고 값은 절대 담지 않는다.**
    surfaceRequest: r.surfaceRequest,
    // 외부 연결 단서를 직접 확인한 읽기 결과. 어떤 도구가 확인했는지는 커널이 알 필요가 없다.
    // 후보·확인 범위만 다음 판단으로 이어지고, 설정 위치·값·비밀은 애초에 계약에 넣지 않는다.
    connectionDiscovery: r.connectionDiscovery,
    scopeState: r.scopeState,
  };
}

/**
 * 실행 불가·차단된 도구의 receipt. actualCall 은 null(호출한 척 금지).
 *
 * **왜 안 막혔는지를 기본값으로 지어내지 않는다**(2026-08-05 밟음).
 * 예전엔 이유를 안 준 호출부에 `reason:'not_executable'` 을 채워 넣었다. 그런데 그 값은
 * `증거종류()` 가 읽는 **증거**다 — "호출이 없었다 + 실행 불가 사유 ⇒ 도구가 없는 것" 으로
 * 판정해 `tool_missing` 계단을 세운다. 그래서 여섯 호출부 중 셋이 사실과 다르게 말했다:
 *   · `approvalEligibility` 가 **이 요청만** 거절한 자리(손은 붙어 있다) ×2
 *   · 되돌릴 수 없어 **자동으로 안 한** 자리(automation-engine)
 * 결과: 모델은 *"그 일을 맡는 도구가 아직 준비되지 않았어요"* 를 받고, 손이 알려 준
 * 다음 길("작업 폴더 안에서 다시")은 그 계단에 덮여 사라졌다.
 *
 * 같은 병이 이 저장소에 이미 적혀 있다 — `file-scope.js:178`:
 *   *"어느 자리가 문제인지는 화면에도 원장 진단에도 없었다(actualCall:null,
 *     reason:'not_executable' 이 전부). 모델도 무엇을 고쳐 다시 부를지 알 수 없었다."*
 *
 * 그래서 **모르면 안 적는다.** 진짜로 손이 없는 자리는 그 사실을 직접 넘긴다.
 * 이유가 없으면 `증거종류()` 는 증거가 없다고 보고 `failureState` 로만 보수적으로 말하며,
 * 그때 **도구가 남긴 `nextSafeAction` 이 다음 길이 된다**(`다음길` 계약 그대로).
 *
 * @param {string} intended
 * @param {string} toolId
 * @param {string} userSafeSummary
 * @param {string} [nextSafeAction]
 * @param {*} [diagnosticTrace]
 */
export function blockedReceipt(intended, toolId, userSafeSummary, nextSafeAction, diagnosticTrace) {
  return receipt({
    intended,
    actualCall: null,
    failureState: FAILURE.BLOCKED,
    userSafeSummary,
    diagnosticTrace: diagnosticTrace ?? { tool: toolId },
    nextSafeAction,
  });
}

/**
 * 감사·테스트용: 사용자면 문자열에 진단면 내부값이 새지 않는지 검사한다.
 * diagnosticTrace 의 원시 문자열 조각(스택·provider 코드 등)이 userSafeSummary 에 나타나면 위반.
 * @param {import('../contracts.js').ToolReceipt} rec
 * @returns {boolean} true = 누출 있음(위반)
 */
export function leaksDiagnostics(rec) {
  if (rec.diagnosticTrace == null) return false;
  const user = rec.userSafeSummary;
  const trace = typeof rec.diagnosticTrace === 'string'
    ? rec.diagnosticTrace
    : JSON.stringify(rec.diagnosticTrace);
  // 내부용어 지표: 스택 프레임, provider 오류코드, 스키마·경로 흔적.
  const internalMarkers = [/\bat\s+\w+.*:\d+:\d+/, /\b[45]\d\d\b/, /stack/i, /\/(usr|home|Users)\//];
  for (const m of internalMarkers) {
    if (m.test(trace) && m.test(user)) return true;
  }
  return false;
}
