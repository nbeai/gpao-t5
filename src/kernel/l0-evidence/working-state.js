// L0 · 운용 상태 (P2-7 2축) — 자기 파악의 **세 번째 축**.
//
// 자기 파악 = 나는 누구인가(정체성) + 무엇을 할 수 있는가(능력) + **지금 이 대화에서 어디까지 왔는가**.
// 앞의 둘은 §6.30 에서 만들었고 세 번째가 비어 있었다. 그래서 이런 일이 났다(오너 실사용):
//   턴1: 네이버 플레이스를 읽고 팔식당을 분석했다
//   턴2: "리뷰 내용들 읽어보고" → **책 리뷰 쓰는 방법**을 검색해 요약했다
//
// **receipt 가 진실이다.** 이 파일은 별도 저장소가 아니라 영수증에서 파생되는 **얇은 뷰**다.
// 모델의 추정·요약을 상태로 저장하면 그 추정이 다음 턴의 "사실"이 되어 오염이 누적된다.
// 우리가 남기는 것은 영수증이 말한 것뿐이다.
//
// **대상을 잇는 것만큼 푸는 것이 중요하다.** 잇기만 하면 모델이 엉뚱한 페이지를 한 번 읽었을 때
// 그게 현재 대상으로 고착되고, 이후 모든 턴이 그 오염을 물려받는다(절대원칙 §0: 틀린 사실을 주면
// 모델을 오염시킨다). 푸는 방법은 **규칙이 아니라 사실**이다 — "아니 그거 말고" 같은 말을 정규식으로
// 잡지 않는다(§24: 규칙으로 굳히면 모델이 멍청해진다). 대신 **몇 턴 전에 다뤘는지를 정확히 말한다.**
// 안 쓰이면 "방금"에서 내려오고, 더 안 쓰이면 뷰에서 사라진다. 런타임은 대상을 고집하지 않는다.

const MAX_SUBJECTS = 5;
const MAX_LINKS = 8;
// 이번 턴·직전 턴에 다룬 것만 "방금"이다. 그 뒤로는 배경 사실로 내려온다(고집 금지).
const CURRENT_WITHIN_TURNS = 1;
// 이만큼 안 쓰이면 뷰에서 내린다 — 옛 대상이 영원히 현재인 척하지 않는다.
const FORGET_AFTER_TURNS = 8;
// 실측(6턴 실사용): 이 블록은 492~558자였다. 그 두 배를 상한으로 둔다 — 이 뷰가 프롬프트를
// 삼키면 정작 대화 이력이 밀려난다. 넘치면 **오래된 것부터** 버린다.
export const MAX_FACTS_CHARS = 1200;

/** 그 페이지에서 이어갈 수 있는 **같은 사이트 안의 길**만. 광고·외부 링크는 길이 아니다. */
export function sameSiteLinks(pageUrl, links = []) {
  let host;
  try { host = new URL(pageUrl).hostname; } catch { return []; }
  const out = [];
  const seen = new Set();
  for (const l of links) {
    const url = typeof l === 'string' ? l : l?.url;
    if (!url || seen.has(url)) continue;
    let u;
    try { u = new URL(url); } catch { continue; }
    if (u.hostname !== host) continue;
    if (u.href === pageUrl || u.href === `${pageUrl}#`) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/**
 * 영수증 하나 → 다음 턴에 필요한 **최소 사실**. 없는 것은 만들지 않는다.
 * 도구 종류마다 "대상"의 모양이 다르다 — 웹은 주소, 파일은 경로, 세션은 찾은 제목.
 * @returns {{key:string, kind:string, label:string, detail?:string, links?:string[]}|null}
 */
function subjectFrom(receipt) {
  const tool = receipt?.actualCall?.tool;
  const args = receipt?.actualCall?.args ?? {};
  if (tool === 'web.collect') {
    const src = receipt.sources?.[0];
    if (!src?.sourceUrl) return null;
    return {
      key: src.sourceUrl,
      kind: 'web',
      label: src.title || receipt.result?.title || src.sourceUrl,
      detail: src.sourceUrl,
      // **그 페이지에서 갈 수 있는 곳**도 남긴다. 이게 없으면 모델은 "읽었다"는 것만 알고 다음
      // 페이지로 못 간다 — 실측: 팔식당을 읽고도 리뷰 주소를 몰라 "리뷰"를 검색해 엉뚱한 블로그를
      // 읽었다. 그 페이지에 리뷰 링크가 있었는데 우리가 안 줬다. 이게 브라우징이다.
      links: sameSiteLinks(src.sourceUrl, receipt.result?.links),
    };
  }
  if (tool === 'local.file') {
    const path = receipt.result?.path ?? args.path;
    if (!path) return null;
    return { key: `file:${path}`, kind: 'file', label: String(path) };
  }
  if (tool === 'session.search') {
    const hits = (receipt.result?.hits ?? []).filter((h) => h?.title);
    if (!hits.length) return null;
    return {
      key: `search:${args.query ?? args.request ?? ''}`,
      kind: 'session',
      label: hits.map((h) => h.title).slice(0, 3).join(', '),
    };
  }
  return null;
}

/**
 * 이번 턴의 영수증을 이전 뷰 위에 얹는다. **성공한 실행만** 대상이 된다 —
 * 못 한 것은 대상이 아니라 "막힌 것"이다(실패 결과를 사실로 올리면 모델을 오염시킨다).
 * @param {object|null} prevState 이전 운용 상태(세션에 없으면 null 로 온다 — 실측에서 터졌다)
 * @param {{receipts?:Array, pendingApprovals?:string[], blocked?:string}} turn
 */
export function deriveWorkingState(prevState, turn = {}) {
  const prev = prevState ?? {};
  const turnNo = (prev.turnNo ?? 0) + 1;
  const receipts = turn.receipts ?? [];

  // 이번 턴에 실제로 다룬 대상들(성공분만).
  const fresh = [];
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') !== 'none') continue;
    const s = subjectFrom(r);
    if (s) fresh.push({ ...s, lastTurn: turnNo });
  }

  // 새 것이 앞, 오래된 것은 뒤로. 같은 대상을 다시 다루면 **최신 정보로 갱신**되고 앞으로 나온다.
  const merged = [];
  const seen = new Set();
  for (const s of [...fresh, ...(prev.subjects ?? [])]) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    // 오래 안 쓰인 대상은 내린다 — 옛것이 영원히 "현재"인 척하지 않는다.
    if (turnNo - s.lastTurn > FORGET_AFTER_TURNS) continue;
    merged.push(s);
    if (merged.length >= MAX_SUBJECTS) break;
  }

  // 막힌 것: 이번 턴에 막혔으면 갱신, 아니면 이전 것을 이어간다(다음 턴에도 다음 길을 기억한다).
  // 다만 이번 턴에 뭔가 성공했으면 막힘은 푼다 — 되는 길을 찾았는데 "막혔다"고 남기면 거짓이다.
  const blocked = turn.blocked ?? (fresh.length ? undefined : prev.blocked);

  return {
    turnNo,
    subjects: merged,
    pendingApprovals: turn.pendingApprovals?.length ? turn.pendingApprovals : prev.pendingApprovals,
    blocked,
  };
}

/**
 * 모델에게 줄 **사실 문장**. 지시가 아니라 "지금 이 대화가 어디까지 왔는지"의 기록이다.
 * 비어 있으면 아무 것도 만들지 않는다(없는 상태를 지어내지 않는다).
 *
 * 시제를 정확히 쓴다 — 방금 다룬 것만 "방금"이라고 한다. 이게 대상을 **푸는** 장치다:
 * 사용자가 화제를 바꾸면 옛 대상은 자연히 "몇 턴 전"으로 내려가고 현재를 주장하지 않는다.
 */
export function workingStateFacts(stateOrNull) {
  const state = stateOrNull ?? {};
  const turnNo = state.turnNo ?? 0;
  const subjects = state.subjects ?? [];
  // 현재 대상은 **가장 최근에 다룬 것들뿐**이다. 새 대상이 오면 이전 것은 그 즉시 물러난다 —
  // 둘 다 "방금"이라고 하면 모델이 어느 쪽이 지금 이야기인지 모른다.
  // 그리고 그 최근조차 오래됐으면(안 쓰인 턴이 쌓이면) 아무 것도 현재가 아니다(고집 금지).
  const newest = subjects.reduce((n, s) => Math.max(n, s.lastTurn), 0);
  const hasCurrent = newest > 0 && turnNo - newest <= CURRENT_WITHIN_TURNS;
  const current = hasCurrent ? subjects.filter((s) => s.lastTurn === newest) : [];
  const older = subjects.filter((s) => !current.includes(s));

  const lines = [];
  for (const s of current) {
    if (s.kind === 'web') {
      lines.push(`방금 읽은 자료: ${s.label} (${s.detail})`);
      // 이어서 볼 수 있는 곳. "리뷰 봐줘"에 검색으로 도망가지 않고 여기서 고르면 된다.
      if (s.links?.length) lines.push(`그 페이지에서 이어갈 수 있는 곳: ${s.links.join(' , ')}`);
    } else if (s.kind === 'file') {
      lines.push(`방금 다룬 파일: ${s.label}`);
    } else if (s.kind === 'session') {
      lines.push(`방금 찾은 지난 대화: ${s.label}`);
    }
  }
  if (older.length) {
    // 같은 이름이 두 번 나오면 모델은 **서로 다른 둘**로 읽는다(한 가게의 홈과 리뷰 페이지가
    // "팔식당 : 네이버(2턴 전), 팔식당 : 네이버(3턴 전)"으로 찍혔다 — 라이브 실측).
    // 배경 사실이므로 이름 기준으로 최근 것 하나만 남긴다.
    const byLabel = new Map();
    for (const s of older) if (!byLabel.has(s.label)) byLabel.set(s.label, s);
    // **현재라고 주장하지 않는다** — 몇 턴 전인지 함께 말한다. 사용자가 화제를 바꿨으면
    // 모델은 이걸 배경으로 두고 지금 발화를 따라간다.
    lines.push(`이 대화에서 앞서 다룬 것: ${[...byLabel.values()]
      .map((s) => `${s.label}(${turnNo - s.lastTurn}턴 전)`).join(', ')}`);
  }
  if (state.pendingApprovals?.length) lines.push(`승인을 기다리는 일: ${state.pendingApprovals.join(', ')}`);
  // 실패는 **결과 내용 없이** 사실로만 남긴다. 못 한 일의 내용물을 사실로 올리면 모델이 그걸
  // 답의 재료로 쓴다(실측: 엉뚱한 페이지 내용을 근거로 답했다).
  if (state.blocked) lines.push(`막혔던 것과 다음 길: ${state.blocked}`);

  if (!lines.length) return undefined;
  // 상한을 넘으면 **오래된 쪽부터** 버린다(앞줄이 현재 대상이다).
  let out = lines.join('\n');
  while (out.length > MAX_FACTS_CHARS && lines.length > 1) {
    lines.pop();
    out = lines.join('\n');
  }
  return out.length > MAX_FACTS_CHARS ? `${out.slice(0, MAX_FACTS_CHARS)}…` : out;
}
