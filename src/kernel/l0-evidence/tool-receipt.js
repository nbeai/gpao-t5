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
    result: r.result,
    failureState,
    // 실행·전달 수명주기. 승인 상태는 여기 아니라 AuthorityGrant에 있다.
    lifecycle,
    // 출처 근거(P6-2 Slice-2). 웹 도구는 출처 없이 "확인"을 주장하지 못한다 — Truth Ledger 연결.
    sources: r.sources,
    userSafeSummary: r.userSafeSummary,
    diagnosticTrace: r.diagnosticTrace,
    nextSafeAction: r.nextSafeAction,
    // 막힌 **종류**(사이트 차단·로그인벽·범위 밖…). 다음 계단을 이걸로 정한다(P2-6 사다리).
    // 진단 원문이 아니라 분류값이라 사용자면 판단에 써도 안전하다.
    fetchState: r.fetchState,
    // 이 일을 마치려면 **사용자에게 열어 줘야 하는 표면**(예: 비밀 입력창).
    // 커널은 종류만 안다 — 무엇을 묻는지·어떤 서비스인지는 도구가 채운다(previewOf 와 같은 계약).
    // 비밀값이 여기 담기면 원장에 남는다. **요청만 담고 값은 절대 담지 않는다.**
    surfaceRequest: r.surfaceRequest,
    scopeState: r.scopeState,
  };
}

/**
 * 실행 불가·차단된 도구의 receipt. actualCall 은 null(호출한 척 금지).
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
    diagnosticTrace: diagnosticTrace ?? { tool: toolId, reason: 'not_executable' },
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
