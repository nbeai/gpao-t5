// L3 · 사이트에 대한 예의 (P2-11) — **429 를 우리가 만들지 않는다.**
//
// 실측(2026-07-27): 내가 같은 네이버 플레이스 주소를 하루에 열 번 넘게 다시 열었다. 결과는
// `HTTP 429` — 서버가 우리 IP 를 제한했다. **사이트 탓이 아니라 우리 절제 부족이다.**
// 그 뒤로는 사용자가 주소를 직접 줘도 못 읽는다. 우리가 문을 스스로 닫은 것이다.
//
// **우회가 아니라 예의다.** UA 위장·헤드리스 숨기기·IP 우회는 하지 않는다. 429 는 서버가 정직하게
// 보낸 신호이고, 우리가 할 일은 물러서는 것이다.
//
// 세 가지만 한다. 사이트별 규칙은 없다 — 어느 호스트에나 같은 예의를 지킨다.
//   ① 같은 곳에 연달아 묻지 않는다(최소 간격)
//   ② 한 번 읽은 것은 다시 읽지 않는다(짧은 캐시) ← 오늘 내가 어긴 것
//   ③ 429/503 을 받으면 쉰다(지수 백오프, Retry-After 를 존중)

const MIN_INTERVAL_MS = 1_200;   // 같은 호스트에 이보다 자주 묻지 않는다
const CACHE_TTL_MS = 10 * 60_000; // 같은 주소를 10분 안에 다시 열지 않는다
const BASE_COOL_MS = 30_000;      // 429 첫 번째 — 30초 쉰다
const MAX_COOL_MS = 15 * 60_000;  // 아무리 길어도 15분

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return String(url ?? ''); } };

/**
 * @param {{minIntervalMs?:number, cacheTtlMs?:number, now?:() => number, sleep?:Function}} [opts]
 */
export function makeHostManners(opts = {}) {
  const minIntervalMs = opts.minIntervalMs ?? MIN_INTERVAL_MS;
  const cacheTtlMs = opts.cacheTtlMs ?? CACHE_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const lastAt = new Map();     // host → 마지막으로 물어본 시각
  const coolUntil = new Map();  // host → 이때까지는 쉰다
  const strikes = new Map();    // host → 연속 429 횟수(지수 백오프용)
  const cache = new Map();      // url → { at, value }

  return {
    /** 최근에 읽은 것이 있으면 그대로 쓴다 — **다시 열지 않는 것이 가장 확실한 예의다.** */
    cached(url) {
      const hit = cache.get(url);
      if (!hit) return undefined;
      if (now() - hit.at > cacheTtlMs) { cache.delete(url); return undefined; }
      return { value: hit.value, ageMs: now() - hit.at };
    },
    remember(url, value) { cache.set(url, { at: now(), value }); },

    /** 지금 이 호스트는 쉬는 중인가 — 남은 밀리초(0이면 물어봐도 된다). */
    coolingMs(url) {
      const until = coolUntil.get(hostOf(url)) ?? 0;
      return Math.max(until - now(), 0);
    },

    /** 최소 간격을 지킨다. 연달아 물어야 하면 그만큼 기다린다. */
    async pace(url) {
      const host = hostOf(url);
      const since = now() - (lastAt.get(host) ?? 0);
      if (since < minIntervalMs) await sleep(minIntervalMs - since);
      lastAt.set(host, now());
    },

    /** 429/503 을 받았다 — 물러선다. Retry-After 가 있으면 그 말을 따른다. */
    noteRateLimited(url, retryAfterSec) {
      const host = hostOf(url);
      const n = (strikes.get(host) ?? 0) + 1;
      strikes.set(host, n);
      const fromServer = Number(retryAfterSec) > 0 ? Number(retryAfterSec) * 1000 : 0;
      const backoff = Math.min(BASE_COOL_MS * (2 ** (n - 1)), MAX_COOL_MS);
      coolUntil.set(host, now() + Math.max(fromServer, backoff));
      return this.coolingMs(url);
    },

    /** 잘 읽혔다 — 그동안의 제재 기록을 지운다(영원히 의심하지 않는다). */
    noteOk(url) {
      const host = hostOf(url);
      strikes.delete(host);
      coolUntil.delete(host);
    },
  };
}

/** 얼마나 기다려야 하는지를 **사람 말로**. 내부 밀리초를 사용자에게 보여주지 않는다. */
export function waitPhrase(ms) {
  if (ms <= 0) return '';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}초쯤`;
  return `${Math.ceil(sec / 60)}분쯤`;
}
