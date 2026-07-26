// L3 · 브라우저 표면 (P2-10) — **URL 읽기로 닿지 않는 화면을 실제로 본다.**
//
// 왜: `web.collect` 는 HTML 을 받아 읽는다. 자바스크립트로 그려지거나 탭·더보기·스크롤 뒤에 있는
// 내용은 애초에 HTML 에 없다. 실측(2026-07-27): 네이버 검색 페이지는 3,022자를 읽었지만 플레이스
// 링크는 0개였다 — 그 카드는 JS 가 그린다. 우리 손이 닿지 않는 자리가 있다는 뜻이다.
//
// **의존성 0을 지킨다**(§17). Playwright·Puppeteer 를 쓰지 않는다 — 시스템에 이미 있는 Chrome 을
// CDP(DevTools Protocol)로 붙는다. Node 24 의 전역 WebSocket 이면 충분하다.
//
// **사이트 파서를 만들지 않는다**(절대원칙 4). "네이버 리뷰 수집기"가 아니다.
// 우리가 아는 것은 화면의 **일반 구조**뿐이다 — 무엇이 보이는가, 얼마나 남았는가, 무엇을 누를 수
// 있는가. 탭·더보기는 접근성 트리의 역할(role)에서 나온다. 사이트 이름은 이 파일에 없다.
//
// **오너 브라우저를 건드리지 않는다.** 격리된 임시 프로필로 헤드리스 실행한다 — 로그인 세션·쿠키를
// 빌려 쓰지 않는다(로그인 우회 금지). 사용자 프로필 활용은 별도 결정이 필요한 사안이다.
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHostManners } from './host-manners.js';

/** 시스템에 설치된 브라우저를 찾는다. 없으면 없는 대로 — 없는 손을 있다고 하지 않는다. */
export const BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 동기 탐지 — descriptor 조립이 동기다. 없으면 **선언조차 하지 않는다**(선언 ⊆ 손). */
export function findBrowserSync(candidates = BROWSER_CANDIDATES) {
  for (const p of candidates) {
    try { accessSync(p, constants.X_OK); return p; } catch { /* 다음 후보 */ }
  }
  return undefined;
}

/** @returns {Promise<string|undefined>} 실행 가능한 브라우저 경로 */
export async function findBrowser(candidates = BROWSER_CANDIDATES, access) {
  const { access: fsAccess, constants } = access ?? await import('node:fs/promises')
    .then(async (m) => ({ access: m.access, constants: (await import('node:fs')).constants }));
  for (const p of candidates) {
    try { await fsAccess(p, constants.X_OK); return p; } catch { /* 다음 후보 */ }
  }
  return undefined;
}

/** CDP 한 세션. 의존성 없이 전역 WebSocket 으로 말한다. */
function cdpConnection(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const waiting = new Map();
  const ready = new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = (e) => rej(new Error(`CDP 연결 실패: ${e?.message ?? 'unknown'}`));
  });
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  return {
    ready,
    send(method, params = {}, sessionId) {
      return new Promise((res, rej) => {
        const id = ++seq;
        const timer = setTimeout(() => { waiting.delete(id); rej(new Error(`CDP 응답 없음: ${method}`)); }, 20_000);
        waiting.set(id, (m) => { clearTimeout(timer); res(m); });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { try { ws.close(); } catch { /* 이미 닫힘 */ } },
  };
}

/**
 * 화면에서 **일반적으로** 읽어낼 것들. 사이트를 모르는 채로 본다.
 * - 보이는 본문과 그 길이
 * - 얼마나 더 남았는가(스크롤) ← "전부 봤다"고 말하지 않게 하는 근거
 * - 무엇을 누를 수 있는가(탭·더보기·같은 사이트 링크) ← 다음에 필요한 조작
 * 이 스크립트는 페이지 안에서 돈다. 사이트별 선택자가 아니라 **역할(role)과 구조**만 본다.
 */
const OBSERVE_SCRIPT = `(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const label = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  const here = location.origin;
  const actionable = [];
  let n = 0;
  for (const e of document.querySelectorAll('a,button,[role="tab"],[role="button"],[aria-expanded]')) {
    if (!vis(e)) continue;
    const t = label(e);
    if (!t) continue;
    const role = e.getAttribute('role') || (e.tagName === 'A' ? 'link' : e.tagName.toLowerCase());
    const href = e.tagName === 'A' ? e.href : undefined;
    // 다른 사이트로 나가는 링크는 조작 대상이 아니다(관찰 중인 화면을 벗어난다).
    if (href && !href.startsWith(here)) continue;
    // 폼 제출은 상태를 바꾼다 — 이 슬라이스의 브라우저는 보기 위한 것이다.
    if (e.type === 'submit' || e.closest('form')?.method?.toLowerCase() === 'post') continue;
    const ref = 'e' + (++n);
    e.setAttribute('data-t5-ref', ref);
    actionable.push({ ref, role, text: t, expanded: e.getAttribute('aria-expanded') ?? undefined, href });
    if (actionable.length >= 40) break;
  }
  const de = document.scrollingElement || document.documentElement;
  return {
    title: document.title,
    url: location.href,
    // **텍스트는 화면에 보이는 만큼이 아니라 지금 DOM 에 있는 전부다**(innerText 의 성질).
    // 그래서 "본 범위"는 픽셀이 아니라 **글자 기준**으로 말해야 한다 — 픽셀로 말하면
    // "1%만 봤다"면서 문서 전체를 설명하는 모순이 난다(라이브에서 실제로 그랬다).
    // 스크롤이 의미를 갖는 것은 **아직 DOM 에 없는 것**(무한스크롤·지연 로딩)뿐이다.
    text: (document.body?.innerText || '').slice(0, 12000),
    textTotal: (document.body?.innerText || '').length,
    scroll: { y: Math.round(de.scrollTop), viewport: Math.round(de.clientHeight), total: Math.round(de.scrollHeight) },
    actionable,
  };
})()`;

/**
 * 브라우저 손. **하나의 인스턴스를 재사용**하고, 놀면 스스로 닫는다(좀비 금지).
 * @param {{browserPath?:string, headless?:boolean, port?:number, idleMs?:number, launch?:Function}} [deps]
 */
export function makeBrowser(deps = {}) {
  // P2-11: web.collect 와 **같은 예의를 공유한다.** 손이 둘인데 한쪽만 절제하면 소용없다 —
  // 같은 IP 로 나가므로 429 도 함께 맞는다(실측: 내가 web.collect 로 만든 제한에 브라우저도 걸렸다).
  const manners = deps.manners ?? makeHostManners();
  const port = deps.port ?? 9412;
  const idleMs = deps.idleMs ?? 120_000;
  let proc; let conn; let profileDir; let sessionId; let idleTimer;

  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { close().catch(() => {}); }, idleMs);
    idleTimer.unref?.();
  };

  async function close() {
    clearTimeout(idleTimer);
    conn?.close(); conn = undefined; sessionId = undefined;
    proc?.kill(); proc = undefined;
    if (profileDir) { await rm(profileDir, { recursive: true, force: true }).catch(() => {}); profileDir = undefined; }
  }

  async function ensure() {
    if (conn && sessionId) { touch(); return; }
    const browserPath = deps.browserPath ?? await findBrowser();
    if (!browserPath) throw Object.assign(new Error('no_browser'), { noBrowser: true });
    profileDir = await mkdtemp(join(tmpdir(), 'gpao-t5-browser-'));
    proc = (deps.launch ?? spawn)(browserPath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      ...(deps.headless === false ? [] : ['--headless=new']),
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--mute-audio',
    ], { stdio: 'ignore' });

    let version;
    for (let i = 0; i < 40 && !version; i += 1) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
      catch { await sleep(250); }
    }
    if (!version) { await close(); throw new Error('브라우저가 뜨지 않았어요'); }
    conn = cdpConnection(version.webSocketDebuggerUrl);
    await conn.ready;
    const { result: target } = await conn.send('Target.createTarget', { url: 'about:blank' });
    const { result: sess } = await conn.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    sessionId = sess.sessionId;
    await conn.send('Page.enable', {}, sessionId);
    await conn.send('Runtime.enable', {}, sessionId);
    touch();
  }

  async function evaluate(expression) {
    const { result } = await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '페이지 스크립트 실패');
    return result?.result?.value;
  }

  return {
    /** 지금 이 컴퓨터에 브라우저가 있는가 — 없으면 **선언하지 않는다**(없는 손 금지). */
    async available() { return Boolean(deps.browserPath ?? await findBrowser()); },

    /** 지금 이 호스트가 쉬는 중이면 남은 시간(ms). 도구가 이걸 보고 시도조차 안 한다. */
    coolingMs(url) { return manners.coolingMs(url); },

    /** 주소를 열고 화면을 본다. 렌더가 끝날 때까지 기다린다(고정 대기 아님). */
    async open(url, { settleMs = 900, maxWaitMs = 12_000 } = {}) {
      await ensure();
      await manners.pace(url); // 같은 곳에 연달아 묻지 않는다
      await conn.send('Page.navigate', { url }, sessionId);
      // 본문이 더 안 자랄 때까지 기다린다 — 사이트마다 렌더 시점이 다르므로 고정 대기는 거짓말이 된다.
      let last = -1; const until = Date.now() + maxWaitMs;
      while (Date.now() < until) {
        await sleep(settleMs);
        const n = await evaluate('(document.body?.innerText||"").length').catch(() => 0);
        if (n > 0 && n === last) break;
        last = n;
      }
      return evaluate(OBSERVE_SCRIPT);
    },

    /** 지금 화면을 다시 본다(조작 뒤 확인용). */
    async snapshot() { await ensure(); return evaluate(OBSERVE_SCRIPT); },

    /**
     * 화면을 내린다. **얼마나 내려갔고 왜 멈췄는지**를 돌려준다 — "끝까지 봤다"의 근거가 된다.
     *
     * 스크롤은 사용자가 요청한 읽기 범위 안에서 자동 진행한다(매번 승인받지 않는다, 오너 지시).
     * 대신 **한도와 중단 조건**을 둔다:
     *   · 횟수 상한(기본 5) · 시간 상한(기본 20초)
     *   · **더 안 나오면 멈춘다** — 두 번 연속 새 내용이 없으면 끝이거나 막힌 것이다.
     *     대량 수집으로 흐르지 않게 하는 장치이자, 차단 조짐에서 스스로 물러나는 장치다.
     */
    async scroll({ times = 1, maxMs = 20_000 } = {}) {
      await ensure();
      const cap = Math.max(1, Math.min(Number(times) || 1, 5));
      const until = Date.now() + maxMs;
      let stopped = 'reached_requested';
      let done = 0;
      let lastLen = (await evaluate('(document.body?.innerText||"").length').catch(() => 0)) ?? 0;
      let quiet = 0;
      for (let i = 0; i < cap; i += 1) {
        if (Date.now() > until) { stopped = 'time_limit'; break; }
        const atEnd = await evaluate(`(() => { const d = document.scrollingElement||document.documentElement;
          return d.scrollTop + d.clientHeight >= d.scrollHeight - 2; })()`).catch(() => false);
        if (atEnd) { stopped = 'reached_bottom'; break; }
        await evaluate('(document.scrollingElement||document.documentElement).scrollBy(0, window.innerHeight * 0.9)');
        await sleep(700); // 더 불러오는 화면(무한스크롤)에 시간을 준다
        done += 1;
        const len = (await evaluate('(document.body?.innerText||"").length').catch(() => 0)) ?? 0;
        // 새 내용이 안 나온다 = 끝이거나 막혔다. 어느 쪽이든 **더 밀어붙이지 않는다.**
        quiet = len > lastLen ? 0 : quiet + 1;
        lastLen = len;
        if (quiet >= 2) { stopped = 'no_new_content'; break; }
      }
      const view = await evaluate(OBSERVE_SCRIPT);
      return { ...view, scrolled: done, stopped };
    },

    /**
     * 관찰에서 얻은 ref 만 누른다. 화면에 없던 것은 누르지 않는다.
     *
     * **누를 수 있는 것을 구조로 좁힌다**(오너 지시: "탭, 더보기, 스크롤 정도로 제한"):
     * 탭(role=tab)과 펼침(aria-expanded)뿐이다. 링크는 여기서 안 누른다 — 주소를 알고 있으니
     * `open(href)` 로 가면 되고, 그게 "무엇을 열었는지"가 원장에 주소로 남아 더 정직하다.
     * 단어 목록("결제·주문"을 막자)이 아니라 **역할**로 좁혔다 — 사이트를 몰라도 통한다.
     * 입력·전송은 이 슬라이스에 아예 없다(만들지 않았으므로 실수로도 못 한다).
     */
    async click(ref) {
      await ensure();
      const ok = await evaluate(`(() => {
        const el = document.querySelector('[data-t5-ref=${JSON.stringify(ref)}]');
        if (!el) return 'gone';
        const role = el.getAttribute('role');
        const isTab = role === 'tab';
        const isExpander = el.hasAttribute('aria-expanded');
        if (!isTab && !isExpander) return 'not_observational';
        el.click();
        return 'ok';
      })()`);
      if (ok === 'gone') return { clicked: false, reason: 'gone' };
      if (ok === 'not_observational') return { clicked: false, reason: 'not_observational' };
      await sleep(1200); // 탭 전환·더보기 펼침에 시간을 준다
      return { clicked: true, ...(await evaluate(OBSERVE_SCRIPT)) };
    },

    close,
  };
}
