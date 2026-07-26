// L1 · LLM-ready Task Context Packet (모델 입력 계약, §11)
// 계약들이 모델에게 전달되는 최종 형태. "사실·경계"를 주고 "판단·문장"은 모델에 남긴다.
// 지시문 장문 주입이 아니다(T3 tool-path-briefing 실증 원리). 무관한 사실을 나열하지 않는다.
import { selfStateSummary } from '../l0-evidence/self-state.js';
import { sameSiteLinks } from '../l0-evidence/working-state.js';

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

/**
 * P2-9 · 외부 표면 상태 — **무엇을 요청했고, 무엇을 읽었고, 무엇을 못 읽었는가.**
 *
 * 큰 분류 체계를 만들지 않는다(routeKind 11개·surfaceType 12개 금지 — 발화에서 예측하는 분류기는
 * 오늘 걷어낸 것과 같은 병이다). `surfaceAction` 은 **실제로 한 일**의 사후 기록 하나뿐이다.
 *
 * **못 읽은 것은 실패가 아니다.** failureState 는 그대로 'none' 이다 — 페이지는 읽었다.
 * 왜 더 못 읽었는지는 `web.collect` 의 **능력 문장**이 말한다(브라우저로 열어 버튼·탭·스크롤을
 * 다루는 손이 없다). 능력 부재를 실패로 기록하면 T5 가 "막혔다"고 말하게 되고, 그건
 * P2-8 에서 고친 것과 정면으로 충돌한다.
 */
export function surfaceOf(receipt) {
  if (receipt?.actualCall?.tool !== 'web.collect') return undefined;
  if ((receipt.failureState ?? 'none') !== 'none') return undefined; // 실패는 여기서 말하지 않는다
  const read = receipt.sources?.[0];
  if (!read?.sourceUrl) return undefined;
  const via = receipt.result?.foundVia;
  const pick = (c) => (typeof c === 'string' ? c : c?.url);
  return {
    action: receipt.result?.surfaceAction ?? (via ? 'search_then_read' : 'read_url'),
    requested: via?.query ?? receipt.actualCall?.args?.request,
    read: {
      url: read.sourceUrl,
      title: read.title || receipt.result?.title,
      chars: (receipt.result?.markdown ?? '').length, // 얼마나 읽었는지 — "보이는 만큼"의 근거
    },
    notRead: {
      // 그 사이트 안에 있는데 열지 않은 곳 = **다음에 갈 수 있는 경로**
      onPage: sameSiteLinks(read.sourceUrl, receipt.result?.links),
      // 검색이 준 다른 후보. 찾던 곳이 여기 없으면 **검색이 못 찾은 것**이지 막힌 게 아니다.
      fromSearch: (via?.candidates ?? []).map(pick).filter((u) => u && u !== read.sourceUrl).slice(0, 4),
    },
  };
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

  // SOUL 말투 — 매 턴 고정 접두에 얹힌다(캐시에 붙는다).
  if (p.voice) packet.voice = p.voice;

  // 3축: 응답 표면(웹/텔레그램/슬랙). 방 id·정책·도구명은 싣지 않는다 — 라벨과 성질만.
  if (p.surface) packet.surface = p.surface;

  // 실행 결과가 있으면 사실로만 덧붙인다(진단면 제외 — userSafeSummary 만).
  if (p.receipts && p.receipts.length) {
    packet.evidenceFacts = p.receipts.map((r) => ({
      intended: r.intended,
      failureState: r.failureState,
      // P2-8: **주소를 직접 받아 읽은 것**과 **검색해서 찾아 읽은 것**을 구분한다.
      // 실측(2026-07-27): 모델이 "부오상회 을지로점 **네이버 플레이스**"를 요청했는데 우리가 검색해서
      // 나온 블로그를 읽고 failureState=none 으로 성공 기록했다. 모델은 플레이스를 못 받았다는 것만
      // 알고 이유를 몰라 "검색 수집이 제한돼서"라고 **추측**했다 — 우리가 안 알려줬기 때문이다.
      // 불일치 탐지기(토큰 휴리스틱)를 만들지 않는다. 그건 다음에 또 어긋난다(절대원칙 8).
      // 사실만 준다: 무엇을 찾으려 했고, 무엇을 읽었고, 안 읽은 후보가 무엇인가. 판단은 모델이 한다(§24).
      surface: surfaceOf(r),
      summary: r.userSafeSummary, // diagnosticTrace 는 절대 넣지 않는다
      // 결과의 **알맹이**도 준다. 요약만 주면 모델이 "목록을 붙여달라"고 되묻는다(실측: 파일 목록을
      // 실제로 읽어 놓고 "도구가 없어 못 본다"고 답했다). 진단면은 여전히 안 넣는다.
      data: compactResult(r.result),
    }));
  }

  return packet;
}
