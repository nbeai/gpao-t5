// L3 · robots.txt 실제 확인 (Phase 0 감사 보정).
//
// 결함: 수집기는 `robotsCheck` 가 **주입됐을 때만** robots 를 봤고 라이브는 주입하지 않았다.
// 그래서 테스트는 초록인데 라이브에서는 robots 검사가 한 번도 돌지 않았고, 능력 문장은
// "수집을 막은 페이지는 읽지 못한다"고 말했다 — 안 하는 일을 한다고 말한 것이다(절대원칙 1).
//
// 계약:
//   · robots.txt 가 없거나 못 읽으면 **허용**으로 본다(표준 해석). 못 읽었다고 사용자를 막지 않는다.
//   · 5xx 는 보수적으로 금지로 본다(사이트가 아프면 긁지 않는다).
//   · 같은 origin 은 한 번만 받아 온다(같은 대화에서 여러 페이지를 읽을 때 매번 치지 않게).
//   · 의존성 0 — 직접 판다.

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * robots.txt 본문 → `*` 그룹의 규칙 목록. 표준대로 가장 긴 일치가 이긴다.
 * **연속된 User-agent 줄은 한 그룹이다**(RFC 9309 §2.2.1). 이걸 안 지키면 현실의 robots.txt 대부분에서
 * 규칙을 통째로 잃는다 — 실제로 구글 robots.txt 를 넣었더니 규칙 0개가 나왔고, 그러면 "수집을 막은
 * 페이지는 읽지 못한다"는 능력 문장이 라이브에서 거짓이 된다(합성 fixture 로만 테스트한 대가다).
 */
export function parseRobots(text) {
  const rules = [];
  let inStar = false;       // 지금 읽는 그룹이 `*` 를 포함하는가
  let groupOpen = false;    // 규칙 줄을 만난 뒤인가(만나면 다음 User-agent 는 새 그룹이다)
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (groupOpen) { inStar = false; groupOpen = false; } // 새 그룹 시작
      if (value === '*') inStar = true;                     // 연속 UA 는 OR — 하나라도 `*` 면 우리 그룹
      continue;
    }
    if (key !== 'disallow' && key !== 'allow') continue;     // Sitemap·Crawl-delay 등은 그룹을 닫지 않는다
    groupOpen = true;
    if (!inStar) continue;
    if (key === 'disallow') {
      if (value) rules.push({ allow: false, path: value });  // 빈 Disallow 는 "전부 허용"
    } else if (value) {
      rules.push({ allow: true, path: value });
    }
  }
  return rules;
}

/** robots 경로 패턴(`*` 와일드카드, `$` 끝맞춤)을 정규식으로. 표준이 정의한 두 가지만 쓴다. */
function patternToRegExp(path) {
  const escaped = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return escaped.endsWith('\\$') ? new RegExp(`^${escaped.slice(0, -2)}$`) : new RegExp(`^${escaped}`);
}

/**
 * 규칙 목록으로 경로 판정. 일치하는 것 중 **가장 긴 규칙**이 이기고, 같으면 Allow 가 이긴다.
 * `*`·`$` 를 못 읽으면 `Disallow: /*.pdf$` 같은 흔한 규칙을 그냥 통과시킨다(실측에서 그랬다).
 */
export function robotsAllows(rules, pathname) {
  let best = null;
  for (const r of rules) {
    if (!patternToRegExp(r.path).test(pathname)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/**
 * origin 별 robots.txt 를 실제로 받아 판정하는 함수를 만든다.
 * @param {{fetchImpl?:Function, timeoutMs?:number, ttlMs?:number, now?:()=>number}} [deps]
 * @returns {(url:string)=>Promise<boolean>}
 */
export function makeRobotsCheck(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? 5000;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const now = deps.now ?? (() => Date.now());
  const cache = new Map(); // origin → { rules|null, at }

  return async function robotsCheck(url) {
    let target;
    try { target = new URL(url); } catch { return true; } // 주소가 이상하면 여기서 막지 않는다(입력 검증의 몫)
    const cached = cache.get(target.origin);
    if (cached && now() - cached.at < ttlMs) {
      return cached.rules ? robotsAllows(cached.rules, target.pathname) : cached.allowed;
    }

    let rules = null;
    let allowed = true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${target.origin}/robots.txt`, { redirect: 'follow', signal: controller.signal });
      } finally { clearTimeout(timer); }
      if (res?.status >= 500) allowed = false;              // 사이트가 아프면 긁지 않는다
      else if (res?.status === 200) rules = parseRobots(await res.text());
      // 404·403 등 = robots 없음 → 허용
    } catch { /* 네트워크 실패 → 허용(못 읽었다고 사용자를 막지 않는다) */ }

    cache.set(target.origin, { rules, allowed, at: now() });
    return rules ? robotsAllows(rules, target.pathname) : allowed;
  };
}
