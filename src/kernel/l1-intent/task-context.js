// L1 · LLM-ready Task Context Packet (모델 입력 계약, §11)
// 계약들이 모델에게 전달되는 최종 형태. "사실·경계"를 주고 "판단·문장"은 모델에 남긴다.
// 지시문 장문 주입이 아니다(T3 tool-path-briefing 실증 원리). 무관한 사실을 나열하지 않는다.
import { selfStateSummary } from '../l0-evidence/self-state.js';

/**
 * 도구 결과에서 **사용자면 데이터**만 압축해 뽑는다. 통째로 넣으면 프롬프트가 폭주하고,
 * 안 넣으면 모델이 실행 결과를 못 보고 되묻는다. 진단·내부 구조는 애초에 receipt 에 없다.
 */
export function compactResult(result, maxChars = 1200) {
  if (result == null || typeof result !== 'object') return undefined;
  const json = JSON.stringify(result);
  if (!json || json === '{}') return undefined;
  return json.length > maxChars ? `${json.slice(0, maxChars)}…(생략)` : json;
}

/** 지금 시각·시간대·지역 — OS 가 아는 사실. 모델이 "오늘"을 알아야 오늘 일을 할 수 있다. */
export function nowFacts(clock = () => new Date()) {
  const d = clock();
  let timeZone; let locale;
  try {
    const opt = Intl.DateTimeFormat().resolvedOptions();
    timeZone = opt.timeZone; locale = opt.locale;
  } catch { /* 알 수 없으면 안 싣는다 — 지어내지 않는다 */ }
  let local;
  try {
    local = new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'full', timeStyle: 'short', timeZone,
    }).format(d);
  } catch { local = d.toISOString(); }
  return { iso: d.toISOString(), local, timeZone, locale };
}

/**
 * @param {Object} p
 * @param {import('../contracts.js').IntentPacket} p.intent
 * @param {import('../contracts.js').SelfStateSnapshot} p.selfState
 * @param {string[]} [p.admittedContext]
 * @param {Array<{role:string,text:string}>} [p.recentTurns]  같은 대화의 최근 발화(사람이 읽는 말만)
 * @param {import('../contracts.js').ActionPlan} [p.plan]
 * @param {import('../contracts.js').ToolReceipt[]} [p.receipts]
 * @returns {import('../contracts.js').TaskContextPacket}
 */
export function buildTaskContext(p) {
  const { intent, selfState } = p;
  const summary = selfStateSummary(selfState);

  // 사실만. 요청과 무관한 사실은 넣지 않는다(§11 규칙).
  const selfStateFacts = {
    model: summary.model,
    modelAuthState: summary.modelAuthState,
    // Phase 2-2 다이어트(§11 "무관한 사실을 나열하지 않는다"): 능력 **설명 문장**은 도구를 실제로
    // 쓰는 턴이나 능력을 물어본 턴에만. 인사 한 마디에 설명서를 통째로 실으면 모델이 그걸 읽고
    // 번호 목록으로 되읊는다(실측). 가벼운 턴에는 도구 **이름만** 준다 — 과장 금지는 이름만으로도 선다.
    readyTools: intent.answerMode === 'fast_chat' && !p.selfhoodDetail
      ? (summary.ready ?? [])
      : (summary.readyCapabilities ?? summary.ready),
    // 한계(무엇을 연결하면 되는지)는 그 도구가 걸리는 턴에서만 쓸모 있다. 잡담에는 소음이다.
    limits: intent.answerMode === 'fast_chat' && !p.selfhoodDetail ? [] : summary.limits,
  };

  const authorityFacts = {
    boundary: intent.authorityBoundary,
    autoAllowed: p.plan ? p.plan.autoAllowed : [],
    needsApproval: p.plan ? p.plan.needsApproval.map((g) => g.action) : [],
    forbidden: p.plan ? p.plan.forbidden : [],
  };

  const packet = {
    // P-ID-1: 자기인지. identity 는 매 턴(짧게), selfhoodDetail 은 물어봤을 때만(문서에서 꺼낸 대목).
    identity: p.identity,
    capabilityCounts: p.capabilityCounts,
    selfhoodDetail: p.selfhoodDetail,
    currentRequest: intent.currentRequest, // 원문 보존
    // Phase 2-1: 같은 대화의 최근 발화. 이게 없으면 매 턴이 단발이라 방금 한 말을 기억하지 못하고
    // 말투도 턴마다 다시 골라진다(실측: 이름을 기억하겠다고 답한 다음 턴에 모른다고 했다).
    recentTurns: p.recentTurns ?? [],
    // 모델이 스스로 찾을 수 있는가 — 사실이므로 알려준다. 모르면 "못 한다"고 답해 버린다.
    nativeSearch: Boolean(p.nativeSearch),
    // 어느 provider 인가 — 모델 계열별 운영 보정을 고르는 데만 쓴다(정체성은 안 바뀐다).
    modelProviderId: p.modelProviderId,
    // 막힌 것이 있을 때 다음 계단(사다리). 지시가 아니라 **지금 쓸 수 있는 길**이라는 사실이다.
    recoveryHint: p.recoveryHint,
    // 자기 파악 세 번째 축(운용 상태) — 실제 기록만. 모델 추정은 넣지 않는다(오염 방지).
    workingState: p.workingState,
    // **지금 언제, 어디인가.** OS 는 이걸 안다. 안 주면 모델은 "오늘"이 언제인지 몰라 되묻거나
    // 엉뚱한 날짜로 답한다(실측: "미국 기준 오늘인 7월 26일을 말씀하신 거라면…").
    // 지역도 마찬가지 — 사실이 없으니 "어느 지역이요?"를 매번 물었다. 규칙이 아니라 사실이 부족했다.
    now: p.now ?? nowFacts(),
    selfStateFacts,
    admittedContext: p.admittedContext ?? [],
    authorityFacts,
    answerMode: intent.answerMode,
    // 방법·언어는 모델에 열어둔다(§10.2). 이 문자열은 지시문이 아니라 규칙 표식이다.
    naturalness: 'method_and_language_open',
  };

  // 실행 결과가 있으면 사실로만 덧붙인다(진단면 제외 — userSafeSummary 만).
  if (p.receipts && p.receipts.length) {
    packet.evidenceFacts = p.receipts.map((r) => ({
      intended: r.intended,
      failureState: r.failureState,
      summary: r.userSafeSummary, // diagnosticTrace 는 절대 넣지 않는다
      // 결과의 **알맹이**도 준다. 요약만 주면 모델이 "목록을 붙여달라"고 되묻는다(실측: 파일 목록을
      // 실제로 읽어 놓고 "도구가 없어 못 본다"고 답했다). 진단면은 여전히 안 넣는다.
      data: compactResult(r.result),
    }));
  }

  return packet;
}
