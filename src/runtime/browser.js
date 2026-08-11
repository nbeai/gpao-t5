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
// **프로필이 둘이다**(2026-08-11 · 이 슬라이스). 하나로는 두 요구를 못 채운다:
//   ⓐ 격리(`isolated` · **기본값**)  매번 새 임시 자리 · 헤드리스 · 끝나면 삭제.
//                                    시험·측정이 서로를 오염시키지 않아야 해서 이쪽이 기본이다.
//   ⓑ 영속(`persistent`)             **같은 자리를 재사용**한다. 사람이 한 번 로그인해 두면
//                                    다음 회차에 따라온다. 로그인하려면 사람이 봐야 하므로
//                                    헤드리스가 아니다.
// 어느 쪽으로 봤는지는 **영수증에 찍는다**(`profileKind()`). 사용자가 "로그인된 걸로 봤나"를
// 알 수 있어야 하고, 그게 없어서 실측에서 거짓 약속이 두 번 나왔다.
//
// ── ⚠ 그 "별도 결정"이 났다 (오너 결정 2026-08-06 · BUTLER §9 D2) ──────────────
// **사용자 브라우저를 쓴다. 전용 프로필을 만들지 않는다.**
//
// 근거는 사용자 비용이다 — 사장님이 이미 로그인해 둔 브라우저가 **0번(대체 불가·이미 익숙)** 이고,
// 전용 프로필을 만들면 거기 다시 로그인해야 해서 **2번**이 된다. 그리고 T5 가 자격증명을
// 하나도 안 쥐게 되므로 커넥터 카탈로그의 `쥐는것: 없음`(§7.2)이 그때만 참이 된다.
//
// **아직 구현하지 않았다.** 이 줄은 결정의 기록이고 코드는 여전히 임시 프로필이다 —
// 사용자의 로그인된 브라우저를 T5 가 모는 것은 되돌리기 어려운 자리라 그 자체가 한 슬라이스다
// (BUTLER 4단계). 그때 함께 서야 하는 것:
//   · 사용자가 쓰는 창을 뺏지 않는다(CU 계열 G 와 같은 규율)
//   · 로그인 벽 뒤 화면은 **관찰**이고, 거기서 나가는 행동은 헌장 넷을 그대로 탄다
//   · 쿠키·세션을 T5 저장소로 복사하지 않는다 — 브라우저가 계속 소유한다
//
// **이 문단을 지우려면 4단계를 구현한 뒤에 지운다.** 지금 지우면 결정이 사라진다.
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHostManners } from './host-manners.js';

// ── 켰으면 끈다 ─────────────────────────────────────────────────────────────
// **실측 2026-08-11**: 헤드리스 크롬이 다섯 개 떠 있었고 가장 오래된 것이 39분째였다.
// 원인은 하나다 — 끄는 경로(`close`)가 **놀 때(idle)만** 불렸고, 그 타이머는 `unref` 라
// 노드가 먼저 나가면 영영 안 온다. 그리고 채점기는 `process.exit()` 로 나간다.
// macOS 에서 자식은 부모를 따라 죽지 않으므로, 그 순간 크롬은 고아가 되어 남는다.
//
// 그래서 **명부와 종료 훅**을 둔다. 손이 하나 서면 명부에 오르고, 프로세스가 나갈 때
// 명부를 그대로 비운다. 훅은 한 번만 건다(손이 여럿이어도 훅은 하나).
const 살아있는손 = new Set();
let 훅걸림 = false;

/** 지금 이 프로세스가 켜 둔 브라우저 수. 검사와 진단이 같은 값을 본다. */
export function 살아있는브라우저수() { return 살아있는손.size; }
/** 종료 훅이 실제로 걸렸나. 「걸었다고 적어 두기」가 아니라 기계 사실이다. */
export function 종료훅걸렸나() { return 훅걸림; }

/** 명부에 있는 것을 전부 끈다. **동기다** — `exit` 훅에서는 비동기가 안 돈다. */
export function 브라우저전부끄기() {
  for (const 끄기 of [...살아있는손]) { try { 끄기(); } catch { /* 이미 죽음 */ } }
  살아있는손.clear();
}

function 훅걸기() {
  if (훅걸림) return;
  훅걸림 = true;
  process.on('exit', 브라우저전부끄기);
  // 신호는 **한 번만 받고 되쏜다**(표준 관용구). 리스너를 달면 노드의 기본 종료가 없어지므로,
  // 우리 몫만 치우고 같은 신호를 다시 올려 원래대로 돌려준다. 다른 데서 이미 받고 있으면
  // 그쪽이 끝을 맡는다 — 남의 종료 절차를 가로채지 않는다.
  for (const 신호 of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(신호, () => {
      브라우저전부끄기();
      if (process.listenerCount(신호) === 0) process.kill(process.pid, 신호);
    });
  }
}

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

// ── 칸이 무엇인지는 **요소가 말한다** ────────────────────────────────────────
// 문구 목록("검색"·"비밀번호"·"보내기")으로 가르지 않는다 — 그건 영어·아이콘·다른 말에
// 늘 뚫리고, 화면 문구로 등급을 정하는 것은 A10 위반이다(`desktop-act-tool.js` 가 같은 이유로
// 같은 결론에 닿았다). 대신 **표준이 이미 정해 둔 구조**를 읽는다: 요소 종류(type)·역할(role)·
// 자동완성 힌트(autocomplete)·감싼 폼의 method.
//
// **페이지 안에서는 판정하지 않는다.** 스크립트는 사실만 떠 오고, 가르는 것은 여기 노드다 —
// 안에서도 가르면 같은 규칙이 두 벌이 되고, 한쪽만 고치는 날이 온다(1축).

/** 요소 하나에서 뜰 **사실**. 관찰 스크립트와 짚기 스크립트가 이 한 조각을 나눠 쓴다. */
const 요소사실뜨기 = `(el) => {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const form = el.closest('form');
  return {
    있나: true,
    태그: String(el.tagName || '').toLowerCase(),
    type: String(el.getAttribute('type') || '').toLowerCase(),
    role: String(el.getAttribute('role') || '').toLowerCase(),
    autocomplete: String(el.getAttribute('autocomplete') || '').toLowerCase(),
    편집가능: el.isContentEditable === true,
    읽기전용: el.readOnly === true || el.disabled === true || el.getAttribute('aria-readonly') === 'true',
    보임: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden',
    폼: form ? {
      method: String(form.getAttribute('method') || 'get').toLowerCase(),
      role: String(form.getAttribute('role') || '').toLowerCase(),
    } : null,
  };
}`;

/** ref 하나의 사실을 뜬다. **없으면 없다고 답한다** — 못 읽은 것을 자동으로 흘리지 않는다. */
export const 요소사실스크립트 = (ref) => `(() => {
  const el = document.querySelector('[data-t5-ref=${JSON.stringify(String(ref))}]');
  if (!el) return { 있나: false };
  return (${요소사실뜨기})(el);
})()`;

/** 그 요소를 **짚는다**(포커스). 좌표가 아니라 ref 다. 커서 자리에 치는 길은 열지 않는다. */
const 짚기스크립트 = (ref) => `(() => {
  const el = document.querySelector('[data-t5-ref=${JSON.stringify(String(ref))}]');
  if (!el) return 'gone';
  try { el.focus({ preventScroll: false }); } catch (e) { return 'gone'; }
  if (document.activeElement !== el && !el.contains(document.activeElement)) return 'no_focus';
  return 'ok';
})()`;

// 비밀값을 담으라고 **브라우저 표준이 이미 표시해 둔** 자동완성 힌트들. 헌장 ①·④ 의 자리다.
const 비밀힌트 = /(^|\s)(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp|cc-exp-month|cc-exp-year|cc-name)(\s|$)/;
// 글자를 받는 input type. **화이트리스트다** — 모르는 종류는 글자칸이 아니다(fail-closed).
const 글자받는type = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number']);

/**
 * 이 칸이 무엇인가. `secure`·`file`·`search`·`text`·`unknown`·`gone`.
 * **모름은 `text` 로 흘리지 않는다** — 모르면 `unknown` 이고, `unknown` 은 손이 물러나는 자리다.
 */
export function 칸종류(f) {
  if (!f?.있나) return 'gone';
  const type = String(f.type ?? '').toLowerCase();
  const role = String(f.role ?? '').toLowerCase();
  if (type === 'password' || 비밀힌트.test(` ${String(f.autocomplete ?? '').toLowerCase()} `)) return 'secure';
  if (type === 'file') return 'file';
  const 검색폼 = f.폼?.role === 'search';
  if (type === 'search' || role === 'searchbox' || (검색폼 && (f.태그 === 'input' || f.편집가능 === true))) return 'search';
  if (f.편집가능 === true) return 'text';
  if (f.태그 === 'textarea') return 'text';
  if (f.태그 === 'input' && 글자받는type.has(type)) return 'text';
  return 'unknown';
}

/**
 * **글자를 쳐도 되나.** 글자는 이 컴퓨터를 벗어나지 않으므로 헌장 넷 중 ①(비밀값)만 닿는다 —
 * 보안 칸은 사람이 직접 넣고, 나머지 글자칸은 자동이다(계획서 §7: 묻는 것 넷 밖은 전부 자동).
 */
export function 타이핑판정(f) {
  const 종류 = 칸종류(f);
  if (종류 === 'gone') return { 된다: false, 이유: 'gone', 종류 };
  if (f.보임 !== true) return { 된다: false, 이유: 'not_visible', 종류 };
  if (f.읽기전용 === true) return { 된다: false, 이유: 'not_editable', 종류 };
  if (종류 === 'secure') return { 된다: false, 이유: 'secure_field', 종류 };
  if (종류 === 'file') return { 된다: false, 이유: 'file_input', 종류 };
  if (종류 === 'unknown') return { 된다: false, 이유: 'unknown_field', 종류 };
  return { 된다: true, 종류 };
}

/**
 * **엔터를 쳐도 되나.** 엔터는 글자와 다르다 — 그 순간 무언가가 밖으로 나간다.
 *
 * 검색은 상대가 없다(헌장 ③ 의 "새 상대"가 성립하지 않는다). 그래서 검색 칸의 엔터는 자동이다.
 * 그 밖은 **이 손이 안 연다** — 상대에게 나가는 걸음은 승인 카드를 갖춘 화면 손이 이미 맡고
 * 있고, 여기에 카드 없는 두 번째 길을 내면 그게 곧 헌장 ③ 의 우회로다.
 *
 * 「검색」의 판정 근거도 문구가 아니라 표준이다: `type=search` · `role=searchbox` ·
 * `role=search` 폼, 그리고 **method 가 GET 인 폼**(HTTP 명세가 안전·멱등으로 정의한 것).
 * 대화 입력칸은 대개 폼이 아예 없거나 POST 다 → 여기 안 걸린다(fail-closed).
 */
export function 엔터판정(f) {
  const 칠수있나 = 타이핑판정(f);
  if (!칠수있나.된다) return 칠수있나;
  const GET폼 = Boolean(f.폼) && (f.폼.role === 'search' || String(f.폼.method ?? 'get').toLowerCase() === 'get');
  if (칠수있나.종류 !== 'search' && !GET폼) return { 된다: false, 이유: 'not_search', 종류: 칠수있나.종류 };
  return { 된다: true, 종류: 칠수있나.종류 };
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
  // **글자칸에도 ref 를 준다.** 없으면 "ref 로 짚은 칸에만 친다"는 규율이 성립할 수가 없다 —
  // 짚을 이름이 없으니 좌표로 돌아가게 되고, 그게 승인 카드 2장이 뜬 자리였다(실측 2026-08-11).
  // **판정은 여기서 안 한다.** 사실만 실어 보내고 종류는 노드가 가른다(1축).
  const 글자칸 = [];
  for (const e of document.querySelectorAll('input,textarea,[contenteditable=""],[contenteditable="true"],[role="searchbox"],[role="textbox"]')) {
    if (!vis(e)) continue;
    const ref = 'e' + (++n);
    e.setAttribute('data-t5-ref', ref);
    글자칸.push({
      ref,
      // 칸 이름은 화면이 준 것 그대로. **여기에 값(사용자가 이미 친 글)은 싣지 않는다.**
      label: (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('name') || '').trim().slice(0, 40),
      사실: (${요소사실뜨기})(e),
    });
    if (글자칸.length >= 20) break;
  }
  const de = document.scrollingElement || document.documentElement;
  return {
    글자칸,
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

/** 로그인이 남는 자리의 기본값. 세션 저장소와 **같은 뿌리**를 쓴다(자리를 새로 만들지 않는다). */
export const 기본영속프로필 = () => join(homedir(), '.local/state/gpao-t5/browser-profile');

/**
 * 브라우저 손. **하나의 인스턴스를 재사용**하고, 놀면 스스로 닫는다(좀비 금지).
 * @param {{browserPath?:string, headless?:boolean, port?:number, idleMs?:number, launch?:Function,
 *          profile?:'isolated'|'persistent', profileDir?:string,
 *          fetchImpl?:Function, connect?:Function}} [deps]
 */
export function makeBrowser(deps = {}) {
  // P2-11: web.collect 와 **같은 예의를 공유한다.** 손이 둘인데 한쪽만 절제하면 소용없다 —
  // 같은 IP 로 나가므로 429 도 함께 맞는다(실측: 내가 web.collect 로 만든 제한에 브라우저도 걸렸다).
  const manners = deps.manners ?? makeHostManners();
  const port = deps.port ?? 9412;
  const idleMs = deps.idleMs ?? 120_000;
  const 겉fetch = deps.fetchImpl ?? fetch;
  const 붙기 = deps.connect ?? cdpConnection;
  // **기본은 안전한 쪽**(오너 규율: 모르면 조여지는 쪽). 영속은 명시로만 켜진다.
  const 프로필종류 = deps.profile === 'persistent' ? 'persistent' : 'isolated';
  const 영속자리 = 프로필종류 === 'persistent' ? (deps.profileDir ?? 기본영속프로필()) : undefined;
  // 영속 자리는 사람이 한 번 로그인해야 값이 생긴다 — 헤드리스면 그 한 번이 영영 안 온다.
  const 헤드리스 = deps.headless ?? (프로필종류 === 'isolated');
  let proc; let conn; let profileDir; let sessionId; let idleTimer; let 준비중; let 명부표;

  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { close().catch(() => {}); }, idleMs);
    idleTimer.unref?.();
  };

  /** 명부에서 빼고 죽인다. **동기다** — 종료 훅이 이걸 그대로 부른다. */
  function 중단() {
    if (명부표) { 살아있는손.delete(명부표); 명부표 = undefined; }
    try { proc?.kill(); } catch { /* 이미 죽음 */ }
    proc = undefined;
  }

  async function close() {
    clearTimeout(idleTimer);
    conn?.close(); conn = undefined; sessionId = undefined;
    중단();
    // **영속 자리는 지우지 않는다** — 지우면 그게 곧 격리다(로그인이 안 남는다).
    if (프로필종류 === 'isolated' && profileDir) {
      await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
    profileDir = undefined;
  }

  async function 띄우기() {
    const browserPath = deps.browserPath ?? await findBrowser();
    if (!browserPath) throw Object.assign(new Error('no_browser'), { noBrowser: true });
    if (영속자리) { await mkdir(영속자리, { recursive: true }).catch(() => {}); profileDir = 영속자리; }
    else profileDir = await mkdtemp(join(tmpdir(), 'gpao-t5-browser-'));
    proc = (deps.launch ?? spawn)(browserPath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      ...(헤드리스 ? ['--headless=new'] : []),
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--mute-audio',
    ], { stdio: 'ignore' });
    // **켜자마자 명부에 올린다.** 아래에서 뜨기를 기다리다 실패해도 고아가 안 남게,
    // 성공 뒤가 아니라 여기다(실측된 누수 다섯 개 중 일부가 이 사이에서 났다).
    const 죽일것 = proc;
    명부표 = () => { try { 죽일것.kill(); } catch { /* 이미 죽음 */ } };
    살아있는손.add(명부표);
    훅걸기();

    let version;
    for (let i = 0; i < 40 && !version; i += 1) {
      try { version = await (await 겉fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
      catch { await sleep(250); }
    }
    if (!version) { await close(); throw new Error('브라우저가 뜨지 않았어요'); }
    conn = 붙기(version.webSocketDebuggerUrl);
    await conn.ready;
    const { result: target } = await conn.send('Target.createTarget', { url: 'about:blank' });
    const { result: sess } = await conn.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    sessionId = sess.sessionId;
    await conn.send('Page.enable', {}, sessionId);
    await conn.send('Runtime.enable', {}, sessionId);
    touch();
  }

  /**
   * **한 번에 하나만 띄운다.** 예전엔 손 둘(observe·act)이 같은 턴에 겹쳐 들어오면 각자
   * `mkdtemp` → `spawn` 을 해서 **같은 포트에 크롬 둘**이 났고, 뒤엣것은 포트를 못 잡아
   * 앞엣것에 붙었다 — 그 앞엣것을 아무도 안 껐다(누수의 두 번째 얼굴).
   */
  async function ensure() {
    if (conn && sessionId) { touch(); return; }
    준비중 ??= 띄우기().finally(() => { 준비중 = undefined; });
    return 준비중;
  }

  async function evaluate(expression) {
    const { result } = await conn.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text ?? '페이지 스크립트 실패');
    return result?.result?.value;
  }

  /** 본문이 더 안 자랄 때까지 기다린다 — 사이트마다 렌더 시점이 달라 고정 대기는 거짓말이 된다. */
  async function 정착대기({ settleMs = deps.settleMs ?? 900, maxWaitMs = deps.maxWaitMs ?? 12_000 } = {}) {
    let last = -1; const until = Date.now() + maxWaitMs;
    while (Date.now() < until) {
      await sleep(settleMs);
      const n = await evaluate('(document.body?.innerText||"").length').catch(() => 0);
      if (n > 0 && n === last) break;
      last = n;
    }
  }

  return {
    /** 지금 이 컴퓨터에 브라우저가 있는가 — 없으면 **선언하지 않는다**(없는 손 금지). */
    async available() { return Boolean(deps.browserPath ?? await findBrowser()); },

    /**
     * **어느 자리에서 보고 있나** — `isolated`(로그인 없음) / `persistent`(로그인이 남는 자리).
     * 영수증이 이걸 그대로 찍는다. 사용자가 "로그인된 걸로 봤나"를 알아야 하기 때문이다.
     */
    profileKind() { return 프로필종류; },

    /** 지금 이 호스트가 쉬는 중이면 남은 시간(ms). 도구가 이걸 보고 시도조차 안 한다. */
    coolingMs(url) { return manners.coolingMs(url); },

    /** 주소를 열고 화면을 본다. 렌더가 끝날 때까지 기다린다(고정 대기 아님). */
    async open(url, opts = {}) {
      await ensure();
      await manners.pace(url); // 같은 곳에 연달아 묻지 않는다
      await conn.send('Page.navigate', { url }, sessionId);
      await 정착대기(opts);
      return evaluate(OBSERVE_SCRIPT);
    },

    /**
     * **관찰이 준 ref 의 칸에 글자를 넣는다.** 좌표는 안 쓴다 — 마우스로 짚는 길은 이 손에 없고,
     * 그래서 "커서가 어디 있는지 모르는 채로 친다"는 자리가 애초에 생기지 않는다.
     *
     * 넣기 전에 **그 칸이 무엇인지 화면에 다시 물어본다**(터미널 probe·화면 손과 같은 규율).
     * 보안 칸·파일 칸·모르는 요소면 여기서 물러난다 — 실패가 아니라 경계다.
     */
    async type(ref, text) {
      await ensure();
      const 사실 = await evaluate(요소사실스크립트(ref));
      const 판정 = 타이핑판정(사실);
      if (!판정.된다) return { typed: false, reason: 판정.이유, kind: 판정.종류 };
      if (await evaluate(짚기스크립트(ref)) !== 'ok') return { typed: false, reason: 'gone', kind: 판정.종류 };
      // `Input.insertText` 는 **짚은 칸의 커서 자리**에 넣는다. 키를 한 자씩 흉내 내지 않으므로
      // 자동완성 목록이 가로채는 사고가 적고, 한글 조합(IME)도 그대로 들어간다.
      await conn.send('Input.insertText', { text: String(text ?? '') }, sessionId);
      await sleep(300); // 자동완성·유효성 검사가 그릴 틈
      return { typed: true, ref, kind: 판정.종류, ...(await evaluate(OBSERVE_SCRIPT)) };
    },

    /**
     * **검색을 끝내는 걸음.** 엔터만 연다 — 다른 키는 무엇이 되는지 약속할 수 없다.
     * 검색 칸이 아니면 물러난다(`엔터판정` 참조): 상대에게 나가는 걸음은 승인 카드를 갖춘
     * 화면 손이 이미 맡고 있고, 여기에 카드 없는 두 번째 길을 내지 않는다.
     */
    async press(ref, key = 'Enter') {
      await ensure();
      if (!/^(enter|return)$/i.test(String(key ?? '').trim())) {
        return { pressed: false, reason: 'key_not_opened' };
      }
      const 사실 = await evaluate(요소사실스크립트(ref));
      const 판정 = 엔터판정(사실);
      if (!판정.된다) return { pressed: false, reason: 판정.이유, kind: 판정.종류 };
      if (await evaluate(짚기스크립트(ref)) !== 'ok') return { pressed: false, reason: 'gone', kind: 판정.종류 };
      const 공통 = {
        key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        text: '\r', unmodifiedText: '\r',
      };
      await conn.send('Input.dispatchKeyEvent', { type: 'keyDown', ...공통 }, sessionId);
      await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', ...공통 }, sessionId);
      await 정착대기({ settleMs: deps.settleMs ?? 700, maxWaitMs: deps.maxWaitMs ?? 12_000 });
      return { pressed: true, ref, kind: 판정.종류, ...(await evaluate(OBSERVE_SCRIPT)) };
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
     * **누르기는 여전히 탭·더보기뿐이다** — 폼 제출·구매 버튼은 여기서 안 연다.
     * 글자는 `type` 이, 검색을 끝내는 엔터는 `press` 가 각자 자기 경계를 지고 맡는다.
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
