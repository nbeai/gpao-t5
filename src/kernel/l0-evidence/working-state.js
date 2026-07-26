// L0 · 운용 상태 (P2-6b) — 자기 파악의 **세 번째 축**.
//
// 자기 파악 = 나는 누구인가(정체성) + 무엇을 할 수 있는가(능력) + **지금 이 대화에서 어디까지 왔는가**.
// 앞의 둘은 §6.30 에서 만들었고 세 번째가 비어 있었다. 그래서 이런 일이 났다(오너 실사용):
//   턴1: 네이버 플레이스를 읽고 팔식당을 분석했다
//   턴2: "리뷰 내용들 읽어보고" → **책 리뷰 쓰는 방법**을 검색해 요약했다
// 모델은 "나에게 web.collect 가 있다"는 건 알았지만 "방금 내가 팔식당 페이지를 읽었다"는
// 자기 상태를 몰랐다. 그래서 자기 도구를 엉뚱하게 썼다.
//
// **경계(중요)**: 여기에는 **실제로 일어난 기록만** 넣는다. 모델의 추정·요약을 상태로 저장하면
// 그 추정이 다음 턴의 "사실"이 되어 오염이 누적된다. 우리가 남기는 것은 영수증이 말한 것뿐이다.

const MAX_ITEMS = 5;
const MAX_LINKS = 8;

/** 그 페이지에서 이어갈 수 있는 **같은 사이트 안의 길**만. 광고·외부 링크는 길이 아니다. */
function sameSiteLinks(pageUrl, links = []) {
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

/** 영수증에서 **실제로 다룬 것**만 골라낸다. 추정하지 않는다 — 없으면 없는 것이다. */
function subjectsFrom(receipts = []) {
  const read = [];
  const files = [];
  const found = [];
  for (const r of receipts) {
    if (!r || (r.failureState ?? 'none') !== 'none') continue; // 못 한 것은 상태가 아니다
    const tool = r.actualCall?.tool;
    if (tool === 'web.collect') {
      const src = r.sources?.[0];
      if (src?.sourceUrl) {
        // **그 페이지에서 갈 수 있는 곳**도 함께 남긴다. 이게 없으면 모델은 "읽었다"는 것만 알고
        // 다음 페이지로 못 간다 — 실측: 팔식당을 읽고도 리뷰를 못 찾아 "리뷰"를 검색해 엉뚱한
        // 블로그를 읽었다. 그 페이지에 리뷰 링크가 있었는데 우리가 안 줬다. 이게 브라우징이다.
        read.push({
          title: src.title || r.result?.title || src.sourceUrl,
          url: src.sourceUrl,
          links: sameSiteLinks(src.sourceUrl, r.result?.links),
        });
      }
    } else if (tool === 'local.file') {
      const path = r.result?.path ?? r.actualCall?.args?.path;
      if (path) files.push(String(path));
    } else if (tool === 'session.search') {
      for (const h of r.result?.hits ?? []) if (h?.title) found.push({ title: h.title, sessionId: h.sessionId });
    }
  }
  return { read, files, found };
}

/**
 * 이번 턴의 기록을 이전 상태 위에 얹는다. 새 것이 앞에 오고, 오래된 것은 밀려난다.
 * @param {object} prev 이전 운용 상태(없으면 빈 상태)
 * @param {{receipts?:Array, pendingApprovals?:string[], blocked?:string}} turn
 */
export function updateWorkingState(prevState, turn = {}) {
  // 세션에 아직 상태가 없으면 null 로 온다(기본값 인자로는 안 잡힌다 — 실측에서 터졌다).
  const prev = prevState ?? {};
  const { read, files, found } = subjectsFrom(turn.receipts ?? []);
  const dedupe = (list, key) => {
    const seen = new Set();
    return list.filter((x) => {
      const k = typeof x === 'string' ? x : x[key];
      if (seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, MAX_ITEMS);
  };
  return {
    // 방금 읽은 자료 — "그 페이지", "리뷰", "거기" 가 무엇인지 여기서 나온다.
    read: dedupe([...read, ...(prev.read ?? [])], 'url'),
    files: dedupe([...files, ...(prev.files ?? [])]),
    found: dedupe([...found, ...(prev.found ?? [])], 'title'),
    // 지금 멈춰 있는 것(승인 대기·막힌 경로). 다음 턴이 "그거 해줘"라고 할 때 필요하다.
    pendingApprovals: turn.pendingApprovals?.length ? turn.pendingApprovals : prev.pendingApprovals,
    blocked: turn.blocked ?? prev.blocked,
  };
}

/**
 * 모델에게 줄 **사실 문장**. 지시가 아니라 "지금 이 대화가 어디까지 왔는지"의 기록이다.
 * 비어 있으면 아무 것도 만들지 않는다(없는 상태를 지어내지 않는다).
 */
export function workingStateFacts(stateOrNull) {
  const state = stateOrNull ?? {};
  const lines = [];
  const last = state.read?.[0];
  if (last) {
    lines.push(`방금 읽은 자료: ${last.title} (${last.url})`);
    // 이어서 볼 수 있는 곳. 사용자가 "리뷰 봐줘" 하면 여기서 고르면 된다(검색으로 도망가지 않게).
    if (last.links?.length) lines.push(`그 페이지에서 이어갈 수 있는 곳: ${last.links.join(' , ')}`);
  }
  if (state.read?.length > 1) {
    lines.push(`그 전에 읽은 것: ${state.read.slice(1).map((r) => r.title).join(', ')}`);
  }
  if (state.files?.length) lines.push(`이번 대화에서 다룬 파일: ${state.files.join(', ')}`);
  if (state.found?.length) lines.push(`찾아 둔 지난 대화: ${state.found.map((f) => f.title).join(', ')}`);
  if (state.pendingApprovals?.length) lines.push(`승인을 기다리는 일: ${state.pendingApprovals.join(', ')}`);
  if (state.blocked) lines.push(`막혔던 것: ${state.blocked}`);
  return lines.length ? lines.join('\n') : undefined;
}
