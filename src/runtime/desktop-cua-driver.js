import { 거절인가, 거절사유 } from './desktop-driver-answer.js';
import { 그림크기재기 } from './image-size.js';
// L3 · **화면 슬롯의 두 번째 드라이버 — cua-driver (MCP stdio)**
//
// 오너 결정(2026-08-05): cua-driver 로 가고 T5 층은 우리가 만든다.
//
// ── 왜 갈아타나 ─────────────────────────────────────────────────────────
// **크로스 플랫폼이 요구다**(오너: *"PC 운영체제가 무엇이든 상관없이 작동해야겠지"*).
// Peekaboo 는 macOS 전용이다. cua-driver 는 platform-macos 37K줄 · windows 32K줄 ·
// linux 33K줄로 **셋 다 실물**이다(감사 2026-08-05).
//
// ── 어떤 모드로 띄우나 — **임베디드가 아니다**(2026-08-07 오너 결정 · 이 주석 정정 2026-08-11) ─
// 처음엔 임베디드(`mcp --direct`)로 갔다. 근거는 `EMBEDDING.md` 의
// *"macOS TCC 는 실행 파일 경로가 아니라 **책임 프로세스**에 귀속한다"* 였고, 앱을 하나 더
// 깔지 않아도 되는 것이 이득이었다.
//
// **그 이득을 접었다.** `--direct` 의 정의가 *"on macOS this explicitly accepts host TCC
// attribution"* 이라, T5 를 띄운 프로세스(개발 기계에서는 셸)의 권한을 빌려 쓴다 —
// 회차마다 권한이 흔들렸고 사장님 컴퓨터에서는 *"터미널이 화면을 기록하려 합니다"* 가 떴다.
// 지금은 `args: ['mcp']` 뿐이고(아래 `기동인자`), 드라이버가 스스로
// `open -n -g -a CuaDriver --args serve` 로 데몬을 띄워 프록시한다. TCC 는
// `com.trycua.driver` 번들에 붙어 안 흔들린다. **코드가 정본이고 이 주석이 낡았었다.**
//
// ── 텔레메트리 ──────────────────────────────────────────────────────────
// **기본값이 켜짐이다**(실물 확인: `Telemetry: enabled (source: default)`).
// PostHog 로 세션·도구 사용 사실이 나간다. 화면 내용은 안 나가고 그쪽 검사가 그걸 강제한다
// (금지 목록에 screenshot·window_title·clipboard·typed_text 등이 박혀 있다).
//
// **그래도 우리가 끈다.** 보내는 게 우리가 아니어도 **띄운 것이 우리면 원인은 우리**이고,
// 사용자 컴퓨터에서 사용자 모르게 밖으로 나가는 것은 헌장 ③ 이 걸리는 자리다.
// 이름으로 껐다고 믿지 않는다 — 기동 인자에 박고, 그 인자를 검사가 잰다.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * **드라이버를 어떻게 띄우는가** — 인자와 환경을 한 자리에 둔다.
 * 밖에서 잴 수 있어야 "껐다"가 주장이 아니라 사실이 된다.
 */
/**
 * **사장님이 지금 브라우저 이야기를 하고 있나.**
 *
 * 크롬 동의 시트를 우리가 누르는 자리에서만 쓴다 — 그 누름은 *로그인해 둔 브라우저를 여는 것*
 * 이라 **시킨 자리에서만** 해야 한다(BUTLER §B self-grant 금지).
 *
 * **모르면 아니다.** 발화가 없으면(자동 실행·예약) 안 연다 — 모르는 것을 허락으로 읽지 않는다.
 * 낱말 목록으로 세운다: 사용자가 브라우저를 부르는 말은 몇 개 안 되고, 넓게 잡으면
 * 그게 곧 self-grant 다. 못 잡으면 사장님이 한 번 더 말하면 된다 — **틀리는 쪽이 안전한 쪽**이다.
 */
export function 브라우저이야기인가(발화) {
  const 말 = String(발화 ?? '').toLowerCase();
  if (!말.trim()) return false;
  return /브라우저|크롬|chrome|edge|엣지|브레이브|brave|사파리|safari|탭|사이트|웹\s*페이지|웹페이지|인터넷|주소창|url|http|\.com|\.co\.kr|네이버|구글|google|유튜브|youtube/.test(말);
}

export function 기동인자({ binPath, 기존프로필허용: _프로필 = false }) {
  return {
    bin: binPath,
    // **`--direct` 를 뺐다**(오너 결정 2026-08-07 · 장착을 공식대로).
    //
    // 그 플래그의 정의가 *"on macOS this **explicitly accepts host TCC attribution**"* 이다 —
    // T5 를 띄운 프로세스의 권한을 빌려 쓴다. 개발 기계에서는 Claude Code 셸의 권한이 있어
    // 되는 것처럼 보였고, 사장님 컴퓨터에서는 *"터미널이 화면을 기록하려 합니다"* 가 뜬다.
    // **이틀간 권한이 회차마다 흔들린 뿌리가 이것이다.**
    //
    // 빼면 드라이버가 스스로 `open -n -g -a CuaDriver --args serve` 로 데몬을 띄우고
    // 프록시한다(실측). TCC 는 `com.trycua.driver` 번들에 붙어 안 흔들린다.
    //
    // **`--grant existing-profile` 은 `serve` 쪽 인자다.** 데몬을 우리가 안 띄우니 여기서
    // 줄 수 없다 — 브라우저 프로필 붙이기는 장착이 선 뒤에 다시 본다(노드 A ① 재개).
    args: ['mcp'],
    env: {
      ...process.env,
      // **기본이 켜짐이라 명시적으로 끈다.**
      CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
      CUA_TELEMETRY_ENABLED: '0',   // 옛 이름도 함께(둘 다 읽는다)
    },
  };
}

/** 권한 값 → 우리 어휘. **모르는 값은 안 된 쪽으로**(모름은 확인 쪽이다). */
const 권한말 = (v) => (v === true ? 'granted' : 'denied');

/**
 * **누가 맨 앞인가 — 정본이 정한 축 하나로만 고른다** (정본 대조 2026-08-11).
 *
 * `describe list_windows` 원문:
 *   *"z_index (integer or null; higher values are closer to the front; **null means stacking
 *     order is unavailable and callers must not infer one**). … To select a frontmost candidate,
 *     **take the maximum integer z_index**; if every value is null, **use an explicit fallback
 *     instead of relying on array order**."*
 *
 * 우리는 정확히 그 금지된 폴백을 쓰고 있었다 —
 * `(얕은것.apps).find(a=>a.active) ?? (얕은것.apps)[0]`. 뒤의 `[0]` 이 배열 순서다.
 * 그리고 `describe get_accessibility_tree` 는 `active`·`frontmost` 를 **보장한다고 적지 않는다**
 * (문장 자체가 없다) — 그것을 첫 축으로 세운 것도 문서 밖이었다.
 *
 * 그래서 순서를 뒤집는다: **① 최대 z_index → ② 드라이버가 밝힌 `active` → ③ 모른다(null).**
 * 배열 순서는 어느 자리에서도 안 쓴다. 모르면 `frontmost` 칸을 아예 안 만든다 —
 * **지어낸 앞 창이 「앞으로 띄웠어요」의 근거가 되는 자리**가 여기다(F: 자기보고 거짓).
 *
 * @param {Array<{층?:number|null, pid?:number, app?:string}>} 창들  `observe` 가 만든 창 목록
 * @param {Array<object>} 앱들  `get_accessibility_tree` 의 `apps`
 * @returns {{name:string|null, bundleId:string|null, pid:number|null}|null}
 */
export function 맨앞앱(창들 = [], 앱들 = []) {
  const 맨앞 = (Array.isArray(창들) ? 창들 : [])
    .filter((w) => Number.isFinite(w?.층))
    .reduce((a, b) => (a == null || b.층 > a.층 ? b : a), null);
  const 목록 = Array.isArray(앱들) ? 앱들 : [];
  if (맨앞) {
    const 앱 = 목록.find((a) => Number.isInteger(a?.pid) && Number(a.pid) === Number(맨앞.pid)) ?? null;
    return {
      name: 앱?.name ?? 맨앞.app ?? null,
      bundleId: 앱?.bundle_id ?? null,
      pid: Number.isInteger(맨앞.pid) ? 맨앞.pid : (앱?.pid ?? null),
    };
  }
  // z 가 **하나도** 없다 = 쌓임 순서를 모른다. 명시적 폴백은 드라이버가 스스로 밝힌 `active` 뿐이고,
  // 그것도 없으면 **모른다**. 여기서 `[0]` 을 집으면 그 순간 거짓 frontmost 가 만들어진다.
  const 밝힌것 = 목록.find((a) => a?.active === true) ?? null;
  return 밝힌것
    ? { name: 밝힌것.name ?? null, bundleId: 밝힌것.bundle_id ?? null, pid: 밝힌것.pid ?? null }
    : null;
}

/**
 * MCP stdio 한 줄 클라이언트. **여기서 판정하지 않는다** — 부르고 결과를 옮긴다.
 * 가르는 것은 손(`desktop-tool` · `desktop-act-tool`)의 일이다.
 */
export function makeMcpStdio({ binPath, timeoutMs = 12_000, spawnImpl = spawn, 기존프로필허용 = false }) {
  let 아이 = null; let 다음id = 1; let 버퍼 = '';
  const 기다리는것 = new Map();

  const 띄우기 = () => {
    if (아이) return 아이;
    const { bin, args, env } = 기동인자({ binPath, 기존프로필허용 });
    아이 = spawnImpl(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    // **자식이 부모의 수명을 잡지 않는다**(스윕 5번 · 재현 3문맥 2026-08-09: step6 러너 R2·R3
    // 매달림 + F-54 검사가 게이트를 1시간 25분 매달았다 — 셋 다 측정은 끝났는데 프로세스가
    // 안 죽었다). 원인은 spawn 한 자식과 그 stdio 파이프가 이벤트 루프를 ref 하는 것이다.
    // `끄기()` 는 예전부터 있었지만 **아무도 안 불렀고**, 안 불러도 새지 않아야 맞다 —
    // 명시적 정리(아래 close)와 unref 를 **둘 다** 둔다. 한쪽만 두면 부르는 걸 잊는 순간
    // 같은 사고가 돌아온다. unref 는 우리 일이 끝났을 때만 종료를 허락하는 것이지 자식을
    // 죽이는 게 아니다 — 도는 동안의 동작은 그대로다(서버는 포트가 루프를 잡는다).
    try { 아이.unref?.(); 아이.stdout?.unref?.(); 아이.stderr?.unref?.(); 아이.stdin?.unref?.(); }
    catch { /* 주입된 가짜 spawn 은 unref 가 없다 — 검사 경로를 막지 않는다 */ }
    아이.stdout.on('data', (d) => {
      버퍼 += d;
      const 줄들 = 버퍼.split('\n');
      버퍼 = 줄들.pop() ?? '';
      for (const 줄 of 줄들) {
        if (!줄.trim()) continue;
        try {
          const m = JSON.parse(줄);
          const 대기 = 기다리는것.get(m.id);
          if (대기) { 기다리는것.delete(m.id); 대기(m); }
        } catch { /* 프로토콜 밖 출력은 버린다 — 진단면이지 결과가 아니다 */ }
      }
    });
    아이.on('exit', () => { 아이 = null; for (const [, f] of 기다리는것) f({ error: { message: 'exit' } }); 기다리는것.clear(); });
    return 아이;
  };

  const 보내기 = (method, params) => new Promise((resolve, reject) => {
    const p = 띄우기();
    const id = 다음id++;
    const 시계 = setTimeout(() => { 기다리는것.delete(id); reject(new Error('timeout')); }, timeoutMs);
    기다리는것.set(id, (m) => { clearTimeout(시계); m.error ? reject(new Error('mcp')) : resolve(m.result); });
    p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  let 준비 = null;
  const 준비되기 = () => {
    준비 ??= 보내기('initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'gpao-t5', version: '0' },
    });
    return 준비;
  };

  return {
    async call(name, args = {}) {
      await 준비되기();
      const r = await 보내기('tools/call', { name, arguments: args });
      return r?.structuredContent ?? r?.content ?? r ?? {};
    },
    /**
     * **조각 그대로 준다** — `call` 은 `structuredContent` 만 주고 나머지를 버린다.
     * 화면 증거(`image/png`)는 그 밖에 있어서, 잘라 버리면 있는 것을 없다고 하게 된다.
     */
    async 조각들(name, args = {}) {
      await 준비되기();
      const r = await 보내기('tools/call', { name, arguments: args });
      return Array.isArray(r?.content) ? r.content : [];
    },
    /**
     * **구조와 그림을 한 번에.** `call` 은 구조만, `조각들` 은 조각만 준다 —
     * 그런데 `get_window_state` 는 **둘 다 낸다**(계약: *"returns BOTH the element tree
     * and a screenshot — ground on both"*). 두 번 부르면 두 번 걷고 두 번 찍는다.
     */
    async 구조와조각(name, args = {}) {
      await 준비되기();
      const r = await 보내기('tools/call', { name, arguments: args });
      return {
        구조: r?.structuredContent ?? r?.content ?? r ?? {},
        조각: Array.isArray(r?.content) ? r.content : [],
      };
    },
    끄기() { try { 아이?.kill(); } catch { /* 이미 죽었으면 그만이다 */ } 아이 = null; 준비 = null; },
  };
}


/**
 * 화면 슬롯 드라이버. **계약은 `desktop-native-driver` 와 같다** —
 * `id` · `status` · `observe` · `act`. 슬롯을 안 고치고 갈아끼우는 것이 이 파일의 목적이다.
 *
 * @param {{binPath?:string, mcp?:{call:Function}}} deps  `mcp` 주입 시 그것을 쓴다(검사용).
 */
export function makeCuaDriver(deps = {}) {
  // **사용자가 이미 로그인해 둔 브라우저에 붙어도 되는가**(CU-④). 밝힐 때만 참이다 —
  // 말 없이 브라우저 접근 권한을 얻지 않는다. 배선이 이 값을 준다(`live-context`).
  const 기존프로필허용 = deps.기존프로필허용 === true;
  // 한 번 붙으면 그 뒤로는 다시 안 붙는다 — **재연결마다 크롬이 동의 시트를 띄우는데
  // 드라이버가 한국어 시트를 못 읽는다**(`consent_ui.rs` 가 "remote debugging" 을 찾는다).
  // 오너 결정(2026-08-06): *"연결을 한 번 맺고 유지한다."* 드라이버가 상주하니 조건이 선다.
  const 붙은브라우저 = new Set();
  // 픽셀 좌표도 요소 토큰과 같은 **관측 신분**을 가져야 한다. 그림을 실제로 낸 관찰만
  // 여기에 들어오며, 행동은 그 불투명 스냅샷 신분과 같은 창·pid·그림을 다시 확인한다.
  const 그림스냅샷들 = new Map();
  const 그림해시 = (그림) => createHash('sha256').update(String(그림?.base64 ?? 그림 ?? '')).digest('hex');
  const 그림기록 = (그림, 창, 크기) => {
    if (!그림?.base64 || 창?.id == null || 창?.pid == null) return null;
    const 해시 = 그림해시(그림);
    const 신분값 = `px:${해시.slice(0, 24)}`;
    그림스냅샷들.set(신분값, { 해시, 창: Number(창.id), pid: Number(창.pid), 크기 });
    while (그림스냅샷들.size > 8) 그림스냅샷들.delete(그림스냅샷들.keys().next().value);
    return 신분값;
  };
  const 브라우저세션 = 'gpao-t5';
  // ── **세션은 명시적으로 열고 닫는다** (정본 정면대조 2026-08-11) ─────────────────
  //
  // `start_session`·`end_session`·`escalate_session`·`get_session_state` — 전 소스 grep **0건**
  // 이었다. 우리는 `session:'gpao-t5'` 를 `browser_prepare`·`get_browser_state` 두 곳에만 실어
  // **암묵 생성**하고 아무도 안 끝냈다. 정본이 그 자리를 정확히 적어 뒀다:
  //   *"A cursor is shown only for a declared session — call this (**or pass `session` on your
  //     first action**) to opt in. … End it with `end_session` (**or let the idle-TTL reclaim
  //     it**)."*
  // 즉 지금 배선도 세션을 만들기는 한다 — 다만 **선언한 적이 없고 끝낸 적도 없어서**
  // 정책(`capture_scope`)이 우리 것이 아니고 회수가 idle-TTL 에 맡겨져 있었다.
  //
  // **범위를 여기서 넘기지 않는다.** 다른 호출(`list_windows`·`get_window_state`·행동들)에
  // `session` 을 새로 얹지 않는다 — 얹는 순간 그 호출들이 세션 스코프 심사를 받게 되고,
  // `auto` 는 **window 스코프로 시작해 데스크톱 도구를 잠근다**(정본: *"auto starts window-only
  // and requires explicit escalation before desktop tools"*). 지금 되는 것이 막히면 안 된다는
  // 지시가 있어, **이미 세션을 쓰던 자리(브라우저)만** 정본 순서로 세운다.
  // `escalate_session` 은 **일부러 안 부른다** — 한 번 올리면 그 세션은 되돌릴 수 없고
  // (*"escalation permanently switches that session to desktop scope"*), 우리는 창 스코프로
  // 충분하다.
  let 세션열림 = false;
  // ⚠ 이 한 줄의 **모양**을 봉인이 문다(`cu-node4` — 허가가 드라이버에서 프로세스까지 가는지를
  // 소스 문자열로 대조한다). 줄을 쪼개면 배선이 살아 있어도 빨개진다 — 한 줄로 둔다.
  // `spawnImpl` 은 수명 봉인이 실드라이버를 띄우며 자식을 지켜보려고 지난다(검사 주입).
  const mcp = deps.mcp ?? makeMcpStdio({ binPath: deps.binPath, 기존프로필허용: deps.기존프로필허용 === true, ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}) });
  const 세션열기 = async () => {
    if (세션열림) return;                     // idempotent 지만 왕복을 낭비하지 않는다
    // 못 열려도 하던 일을 막지 않는다 — 예전 배선(암묵 생성)이 그대로 받는다.
    await mcp.call('start_session', { session: 브라우저세션, capture_scope: 'auto' })
      .catch(() => null);
    세션열림 = true;
  };

  return {
    id: 'cua',
    label: '화면 관찰·조작(cua)',
    needs: [],

    /**
     * **화면도 「볼 수 있는 자리」다** (F-54 · 오너 최우선 · PM 승인 2026-08-09).
     *
     * 원장 확정: 모델의 재료에서 화면은 능력 목록에만 있고 현실 사실로는 0 이었다 —
     * "볼 수 있는 자리" 명부가 전부 파일시스템이라, 화면에만 있는 출처(카드사 페이지)가
     * 존재한다는 사실이 어디에도 안 실렸고 사다리 전환이 6/6+1 로 0 이었다.
     * locate 의 `places()` 와 **같은 계약**을 화면 손이 갖는다(두 벌이 아니라 두 손).
     *
     * **폭 동결(PM 조건 1)**: 앱명·창 제목**만** · 앞 창부터 **최대 5개** · **내용(본문·
     * 필드값·픽셀)은 절대 싣지 않는다.** 이 경계가 곧 계약이고, 봉인이 이 폭을 문다.
     * 못 보면 null — 없는 화면을 지어내지 않는다(조용히 생략).
     */
    async places() {
      const t0 = Date.now();
      const 목록 = await mcp.call('list_windows', { on_screen_only: true }).catch(() => null);
      if (!Array.isArray(목록?.windows)) return null;
      const 이미 = new Set();
      const 창들 = [];
      for (const w of 목록.windows) {
        const 라벨 = [w?.title, w?.app_name].filter((x) => typeof x === 'string' && x.trim())
          .join(' — ').slice(0, 80);
        if (!라벨 || 이미.has(라벨)) continue;
        이미.add(라벨);
        창들.push({ label: 라벨, kind: 'screen' });
        if (창들.length >= 5) break; // 폭 동결 — 앞 창부터 5개
      }
      return 창들.length ? { 창들, 걸린ms: Date.now() - t0 } : null;
    },

    /**
     * **띄운 것은 걷고, 연 세션은 닫는다**(스윕 5번 + 정본 세션 사다리).
     * 러너·검사처럼 수명이 있는 쪽이 명시적으로 부를 문이다 — unref 가 새는 것을 막고,
     * 이것은 **끝났음을 지금 선언**한다(둘 다 있어야 한다).
     * *"End a session declared with `start_session`: removes its agent cursor, stops any
     *   recording it owns, and clears its per-session config."*
     * 안 닫으면 idle-TTL 이 회수할 때까지 커서·설정·녹화가 남는다 — 사용자 화면의 것이다.
     */
    async close() {
      if (세션열림) {
        세션열림 = false;
        await mcp.call('end_session', { session: 브라우저세션 }).catch(() => null);
      }
      붙은브라우저.clear();
      try { mcp.끄기?.(); } catch { /* 이미 죽었으면 그만 */ }
    },

    async status() {
      const p = await mcp.call('check_permissions', {});
      return {
        platform: 'unknown',            // 드라이버가 밝히면 그때 채운다 — 지어내지 않는다
        backend: { id: 'cua', ready: true },
        permissions: {
          accessibility: 권한말(p?.accessibility),
          screenRecording: 권한말(p?.screen_recording),
        },
        capabilities: ['observe', 'elements', 'act'],
        // **책임 귀속을 그대로 옮긴다.** 임베디드가 실제로 섰는지 밖에서 볼 수 있어야 한다
        // (F-30 이 못 갈랐던 그 값이다 — 이제 드라이버가 스스로 밝힌다).
        ...(p?.source ? { 귀속: p.source } : {}),
      };
    },

    /**
     * **됐는지 판정한다 — 우리가 전후를 추측하지 않는다**(CU F).
     *
     * `verify_state` 는 우리가 A14 로 세운 문장을 그대로 갖고 있다:
     *   *"Predicate results are satisfied, unsatisfied, or unknown; unknown never implies
     *    success. Accessibility projections are conservative: absence remains unknown
     *    unless the observed search domain is proven exhaustive."*
     * 게다가 `stable_samples`·`timeout_ms` 로 **상태가 가라앉을 때까지 기다린다** —
     * 우리 전후 대조가 창 관리자보다 먼저 찍어 **없는 실패**를 만들던 자리가 여기서 닫힌다.
     *
     * `include_screenshot` 은 안 받는다. 그림은 *"uninterpreted visual evidence for a
     * multimodal caller"* 인데 **우리 모델 길이 아직 글자만 나른다** — 못 쓰는 것을 받아
     * 비용만 쓰지 않는다. 길이 열리면 그때 켠다.
     */
    async verify(기대 = {}) {
      const 라벨 = String(기대.라벨 ?? '').trim();
      const 본것 = await mcp.call('get_accessibility_tree', {}).catch(() => null);
      const 창들 = 본것?.windows ?? [];
      const 창 = 창들.find((w) => Number(w?.window_id ?? w?.id) === Number(기대.창)) ?? 창들[0] ?? null;
      const pid = Number.isInteger(창?.pid) ? 창.pid : 본것?.frontmost?.pid;
      // **pid 와 window_id 는 둘 다 필수다**(스키마 `required`). 하나라도 빠지면
      // `invalid_arguments` 로 떨어지고, 그건 "확인 못 했다"가 아니라 **우리가 잘못 부른 것**이다.
      // 창 목록을 날것으로 부르면 키가 `window_id` 다 — `id` 만 보다가 실제로 빠뜨렸다.
      const 창id = Number(창?.window_id ?? 창?.id);
      if (!Number.isInteger(pid) || !Number.isInteger(창id)) {
        return { 판정: 'unknown', 근거: 'no_window' };
      }
      // 신분이 없으면 **요소 판정은 안 한다** — 아무 요소나 확인해 달라고 하면 엉뚱한 것을
      // 확인한다. 다만 **그림은 받는다**: 못 보는 자리야말로 눈이 필요한 자리다(아래).
      const 인자 = 라벨 ? {
        pid,
        window_id: 창id,
        expect: [{
          element: {
            selector: { label_contains: 라벨, ...(기대.역할 ? { role: String(기대.역할) } : {}) },
            // 값을 말했으면 값을 재고, 안 말했으면 **있느냐**를 잰다.
            // 값 없이 `value_equals: ''` 를 보내면 "빈 값이냐"를 묻는 것이 되어 늘 안 맞는다.
            ...(기대.값 === undefined || 기대.값 === null
              ? { exists: true }
              : { value_equals: String(기대.값) }),
          },
        }],
        // 눌린 값이 화면에 반영되는 데 시간이 걸린다. **두 번 같은 값을 봐야** 인정한다.
        stable_samples: 2,
        timeout_ms: 2000,
      } : null;
      const r = 인자 ? await mcp.call('verify_state', 인자).catch(() => null) : null;
      // 응답 칸은 **`status`** 다(실측 2026-08-05 — `result` 로 읽다가 전부 unknown 이 됐다).
      // 못 판정한 이유는 드라이버가 `unknown_reason` 으로 밝히니 그대로 옮긴다.
      const 술어 = r?.predicates?.[0];
      const 답 = 라벨 ? String(r?.status ?? 술어?.status ?? 'unknown') : 'unknown';
      const 판정 = ['satisfied', 'unsatisfied'].includes(답) ? 답 : 'unknown';
      const 근거 = 라벨 ? (술어?.unknown_reason ?? r?.code ?? null) : 'no_selector';
      // **모를 때만 화면을 받는다**(CU F-2 · 계획 §6.2 "마지막 수단").
      // 됐다/안 됐다가 나온 자리에는 그림이 필요 없고, 비용도 화면 노출도 공짜가 아니다.
      // 실물이 이 자리를 정확히 말해 준다 — `unknown_reason: "observation_unavailable"`,
      // 즉 **접근성으로는 못 보는 값**이다. 그때가 눈이 필요한 때다.
      if (판정 !== 'unknown' || typeof mcp.조각들 !== 'function') return { 판정, 근거 };
      let 그림;
      try {
        // **그림만 받을 때는 창이 있느냐만 묻는다.** 요소 신분이 없어도 그 창은 찍힌다 —
        // 계산기 표시창처럼 접근성에 없는 값은 **눈으로만** 확인되고, 그게 이 칸의 이유다.
        // 이 호출의 `satisfied` 는 "창이 있다"는 뜻일 뿐이고 **판정으로 쓰지 않는다**(위에서 정했다).
        const 그림인자 = 인자 ?? {
          pid, window_id: 창id, expect: [{ window: { exists: true } }],
          stable_samples: 1, timeout_ms: 800,
        };
        const 조각 = await mcp.조각들('verify_state', { ...그림인자, include_screenshot: true });
        const 이미지 = (조각 ?? []).find((x) => x?.type === 'image' && x?.data);
        if (이미지) 그림 = { mime: String(이미지.mimeType ?? 'image/png'), base64: String(이미지.data) };
      } catch { 그림 = undefined; }   // **그림은 덤이지 조건이 아니다** — 없어도 판정은 그대로다
      return { 판정, 근거, ...(그림 ? { 그림 } : {}) };
    },

    async observe(args = {}) {
      // **가벼운 것과 무거운 것이 나뉘어 있다**(실물 확인 2026-08-05):
      //   `get_accessibility_tree`  앱·창 목록 + 좌표·z순서 — 가볍다
      //   `get_window_state`        창 하나의 AX 하위트리 + **번호로 누를 수 있는 요소** — 무겁다
      // 원문이 그렇게 말한다: *"For the full AX subtree of a single window (with interactive
      // element indices you can click by), use `get_window_state` instead."*
      // 그래서 요소는 **필요할 때만** 가져온다 — 창 목록만 필요한 턴에 무거운 것을 부르지 않는다.
      // **창 목록은 `list_windows` 다**(비교군 `_select_capture_target` 을 읽고 고침 2026-08-06).
      // 거기에만 `z_index`(앞뒤) · `is_on_screen`(화면 밖) · `bounds`(자리) 가 있다.
      // `get_accessibility_tree` 를 주 목록으로 쓰던 동안 우리는 **앞뒤도 화면 밖도 몰랐고**,
      // 그래서 숨은 창을 열다 20초 timeout 을 냈다.
      // **거르기는 드라이버에게 맡긴다**(흡수 ①). 실측: `on_screen_only` 하나로
      // 창 117개 → 12개, 103ms → 3ms. 손으로 거르다 숨은 창을 열어 20초를 썼다.
      // **다만 앱·제목을 지목했으면 전부 본다** — 사용자가 그 창을 말했으니
      // 최소화돼 있어도 그것을 봐야 한다.
      const 지목함 = Boolean(String(args?.app ?? '').trim() || String(args?.창제목 ?? '').trim()
        || args?.window != null);
      const 목록 = await mcp.call('list_windows', 지목함 ? {} : { on_screen_only: true }).catch(() => null);
      const 얕은것 = await mcp.call('get_accessibility_tree', {});
      const 날것창 = (목록?.windows ?? (Array.isArray(목록) ? 목록 : null)) ?? 얕은것?.windows ?? [];
      const 창들 = 날것창.map((w) => ({
        id: w.window_id ?? w.id, title: w.title ?? '', app: w.app_name ?? w.app, pid: w.pid,
        보임: w.is_on_screen !== false,
        // **어느 화면(Space)에 있나**(2026-08-07 · 오너 질책 뒤 밟음).
        // 풀스크린 창은 별도 Space 를 만들고, 그러면 다른 창이 그리로 밀린다.
        // 그때 AX 트리는 그 창을 못 잡고(`ax_window_unresolved`) `bring_to_front` 도 안 통한다 —
        // **`list_windows` 가 처음부터 이 사실을 줬는데 우리가 0곳에서도 안 읽었다.**
        // 이게 없으면 사람도 모델도 *"가려졌나"* 로만 추측한다(하루를 그렇게 썼다).
        ...(w.on_current_space === false ? { 같은화면: false } : {}),
        ...(w.on_current_space === true ? { 같은화면: true } : {}),
        // 앞뒤 순서 — 큰 값이 앞이다. 없으면 목록 순서를 쓴다.
        층: Number.isFinite(w.z_index) ? w.z_index : null,
        // **창 자리를 싣는다.** 없으면 창 밖(Dock)도, 스크롤 위로 벗어난 것(y=-5081)도
        // 안 걸러지고, 그러면 "마지막 메시지"가 뒤바뀐다(라이브 2026-08-06 · 사진 대조).
        ...(w.bounds ? {
          bounds: {
            x: w.bounds.x, y: w.bounds.y,
            w: w.bounds.w ?? w.bounds.width, h: w.bounds.h ?? w.bounds.height,
          },
        } : {}),
      }));

      // **앞에서부터 줄 세운다** — 앞 창은 맨 위다(비교군과 같은 계약).
      창들.sort((x, y) => (y.층 ?? -1) - (x.층 ?? -1));
      // **앞 앱은 정렬한 창에서 고른다**(정본 `list_windows` — 최대 z_index). 배열 순서 금지.
      const 앞앱 = 맨앞앱(창들, 얕은것?.apps ?? []);
      let 요소 = null; let 스냅샷 = null; let 그림스냅샷값 = null; let 본창 = null; let 못읽은이유값 = null; let 화면사실값 = null; let 올려야할길값 = null; let 앞세워읽음값 = false; let 그림값 = null; let 그림크기값 = null; let 탭들값 = null; let 동의안내값 = null; let 얕게걷기지연 = null;
      if (args?.scope === 'window') {
        // 어느 창인가 — 모델이 지목했으면 그것, 아니면 앞 창.
        //
        // **앱 이름으로도 고를 수 있어야 한다**(계열 G · 라이브 2026-08-06):
        // 앞 창만 볼 수 있으면 *"옆에서 같이 한다"* 가 말뿐이 된다 — 일하려면 매번
        // 앞으로 가져와야 하고, 그건 사용자 것을 뺏는 것이다.
        const 앱이름 = String(args?.app ?? '').trim().toLowerCase();
        // **사용자는 앱이 아니라 대화창 이름을 말한다** — `정영현` 처럼. 그 축을 준다.
        const 제목 = String(args?.창제목 ?? '').trim().toLowerCase();
        // **정확 일치가 부분 일치를 이긴다**(비교군 `_match_windows_for_app` 그대로).
        // *"`Code` 를 물었는데 앞에 있다는 이유로 `Visual Studio Code` 가 잡히면 안 된다."*
        // 순서: 창이름 정확 → 앱별칭 정확 → 창이름 부분 → 앱별칭 부분.
        // 앱 목록은 **창 이름으로 못 찾을 때만** 부른다(실측 472ms 짜리다).
        let 앱것 = [];
        if (앱이름) {
          앱것 = 창들.filter((w) => String(w.app ?? '').trim().toLowerCase() === 앱이름);
          if (!앱것.length) {
            const { apps } = await mcp.call('list_apps', {}).catch(() => ({ apps: [] }));
            const 별칭 = (a) => [String(a.name ?? ''), String(a.bundle_id ?? ''), String(a.app_name ?? ''),
              String(a.launch_path ?? '').split('/').pop().replace(/\.app$/i, '')]
              .map((x) => x.trim().toLowerCase()).filter(Boolean);
            const 켜진앱 = (apps ?? []).filter((a) => a?.running !== false && Number.isInteger(a?.pid));
            const 정확pid = new Set(켜진앱.filter((a) => 별칭(a).includes(앱이름)).map((a) => a.pid));
            앱것 = 창들.filter((w) => 정확pid.has(w.pid));
            if (!앱것.length) {
              앱것 = 창들.filter((w) => String(w.app ?? '').toLowerCase().includes(앱이름));
            }
            if (!앱것.length) {
              const 부분pid = new Set(켜진앱
                .filter((a) => 별칭(a).some((x) => x.includes(앱이름) || 앱이름.includes(x)))
                .map((a) => a.pid));
              앱것 = 창들.filter((w) => 부분pid.has(w.pid));
            }
          }
        }
        if (제목) {
          const 제목것 = (앱것.length ? 앱것 : 창들)
            .filter((w) => String(w.title ?? '').toLowerCase().includes(제목));
          if (제목것.length) 앱것 = 제목것;
        }
        // **이름 축이 하나로는 모자란다**(라이브 2026-08-06): 모델이 `KakaoTalk` 라고 물었는데
        // 창 이름은 `카카오톡` 뿐이라 못 찾았고, 우리는 **앞 창으로 떨어져 Claude 창을 보여 줬다.**
        // 앱 목록에는 bundle id·앱 파일 이름이 있다 — 거기서 pid 를 얻어 창과 잇는다.
        if (앱이름 && !앱것.length) {
          const { apps } = await mcp.call('list_apps', {}).catch(() => ({ apps: [] }));
          const 축 = (a) => [String(a.name ?? ''), String(a.bundle_id ?? ''),
            String(a.launch_path ?? '').split('/').pop().replace(/\.app$/i, '')]
            .map((x) => x.toLowerCase()).filter(Boolean);
          const 맞는앱 = (apps ?? []).filter((a) => 축(a).some((x) => x === 앱이름
            || x.includes(앱이름) || 앱이름.includes(x)));
          const pid들 = new Set(맞는앱.map((a) => a.pid).filter((x) => Number.isInteger(x)));
          앱것 = 창들.filter((w) => pid들.has(w.pid));
        }
        // **보이는 창만 고른다.** 라이브(2026-08-06): 카톡 pid 의 창이 7개였는데 보이는 건
        // 하나였고, 우리가 첫 창(안 보이는 다른 대화)을 열어 **20초 timeout** 이 났다.
        // 안 보이는 창은 사용자가 지금 보고 있는 것이 아니다.
        // **보이는 것 우선, 없으면 안 보이는 것도.** 지목한 창이 최소화돼 있을 수 있으니
        // 버리지는 않되(그러면 영영 못 본다), 보이는 것이 있으면 그것부터다 —
        // 숨은 창을 열다 20초를 쓴 자리다.
        if (앱것.length > 1) {
          const 보이는것 = 앱것.filter((w) => w.보임);
          if (보이는것.length) 앱것 = 보이는것;
        }
        // **이름 없는 판때기는 선택지가 아니다**(실측 2026-08-07 · 배송 확인 중).
        // 계산기 창이 다섯으로 잡혀 T5 가 되물었다 — 넷은 1470×33 메뉴바였고 진짜 계산기는
        // 하나(230×408 · 제목 `계산기`)였다. 사용자가 말하는 창은 언제나 **이름이 있는 창**이고
        // 이름 없는 것은 메뉴바·팔레트·그림자다. A02 는 옳다 — **후보를 잘못 세우면
        // 규율이 옳게 작동해도 되묻는다.** 이름 있는 것이 하나도 없으면 안 거른다(볼 것을 안 버린다).
        if (앱것.length > 1) {
          const 이름있는것 = 앱것.filter((w) => String(w.title ?? '').trim());
          if (이름있는것.length) 앱것 = 이름있는것;
        }
        if (제목 && 앱것.length > 1) {
          const 정확 = 앱것.filter((w) => String(w.title ?? '').trim().toLowerCase() === 제목);
          if (정확.length) 앱것 = 정확;
        }
        // **여럿이면 임의로 안 연다**(A02). 엉뚱한 대화를 읽고 그것을 사실로 말하게 된다.
        if (앱것.length > 1 && args?.window == null) {
          return {
            ...(앞앱 ? { frontmost: 앞앱 } : {}),
            windows: 창들,
            // **가를 축을 함께 싣는다** (정본 정면대조 2026-08-11).
            //
            // `describe list_windows` 가 창마다 주는 것: `window_id · pid · app_name · title ·
            // bounds · z_index · is_on_screen · space_ids · current_space_id · on_current_space`.
            // 우리는 그걸 **다 읽어 놓고**(위 `창들`) 후보에는 `{window,title,app}` 셋만 올렸다.
            // 그래서 무제목 창이 넷인 카톡에서 모델에게 간 것이 `카카오톡 · (제목 없음)` ×4 다 —
            // **축이 없어서가 아니라 안 실어서** 고를 수가 없었다(§8 카톡 빨강).
            // 정본에는 「무제목 창은 후보가 아니다」 같은 규칙이 없다. 가르는 것은 이 넷이다.
            창을골라야함: 앱것.map((w) => ({
              window: w.id, title: w.title, app: w.app,
              ...(w.bounds ? { bounds: w.bounds } : {}),
              층: w.층,                       // z_index — 큰 값이 앞. null 이면 "모른다"이지 뒤가 아니다
              보임: w.보임,                    // is_on_screen
              ...(w.같은화면 === false ? { 같은화면: false } : {}),
              ...(w.같은화면 === true ? { 같은화면: true } : {}),
            })),
          };
        }
        // **못 찾으면 앞 창으로 떨어지지 않는다.** 그건 오대상 관찰이고,
        // 모델은 지목한 앱을 봤다고 믿은 채 남의 창 내용으로 답한다.
        if ((앱이름 || 제목) && !앱것.length && args?.window == null) {
          return {
            ...(앞앱 ? { frontmost: 앞앱 } : {}),
            windows: 창들,
            그앱없음: `'${args.창제목 ?? args.app}' 을(를) 가진 창을 못 찾았어요`,
            후보: [...new Set(창들.map((w) => w.app).filter(Boolean))].slice(0, 12),
          };
        }
        const 대상 = 창들.find((w) => w.id === args?.window)
          ?? 앱것[0] ?? 창들[0] ?? null;
        if (대상) {
          const 창상태인자 = {
            window_id: 대상.id, pid: 대상.pid,
            // **조용한 절단을 드라이버 쪽에서도 막는다.** 안 주면 Electron 앱이 수백 개를 낸다
            // (그쪽 주석도 같은 말을 한다). 우리 `요소창` 이 그 위에서 다시 문을 단다.
            max_elements: Number(args?.최대요소) > 0 ? Number(args.최대요소) : 400,
            // **찾기·깊이도 드라이버가 한다**(흡수 ①). 우리가 129개를 40개씩 넘겨보던 자리다.
            ...(String(args?.찾는말 ?? '').trim() ? { query: String(args.찾는말).trim() } : {}),
            ...(Number(args?.깊이) > 0 ? { max_depth: Number(args.깊이) } : {}),
            // **볼 일 없는 화면은 안 찍는다.** 기본값이 `true` 라, 안 끄면 매 관찰마다
            // 화면을 찍고 우리는 그걸 버린다 — 그 지연만 낸다. 계약이 이 최적화를 말한다:
            // *"Set false to skip the grab … the cheap path when you're just re-indexing
            // before an element ax action."* 행동 전 재관찰이 정확히 그 자리다.
            ...(args?.그림없이 === true ? { include_screenshot: false } : {}),
          };
          // **드라이버가 고치는 법을 알려주면 따라 한다**(흡수 ②).
          //
          // 밟은 사실(2026-08-06): 메모 창을 읽으려는데 요소가 0개였다. 드라이버는 이유와
          // 고칠 값을 **함께** 주고 있었다 — `window_owner_pid_mismatch` · `owner_pid: 31490` ·
          // *"Re-call with pid=31490"*(macOS 가 샌드박스 패널을 별도 프로세스로 띄운다).
          // 우리는 그걸 버리고 "요소 0개"라고 했고, 모델은 **"권한이 막혔다"** 고 지어냈다.
          //
          // **한 번만 따라 한다** — 무한히 되묻지 않는다.
          // **읽다가 터져도 눈이 남아 있다**(F-41). timeout 이 곧 실패가 아니다 —
          // 카톡 대화창은 AX 로 20초를 써도 못 낸다.
          // **트리와 그림을 한 번에 받는다**(노드 ① · 2026-08-06).
          //
          // `call` 은 `structuredContent` 만 집고 `content` 를 버린다 — 그림이 거기 있다.
          // 그래서 화면에 찍힌 값(계산기 표시창처럼 트리에 없는 것)을 영영 못 읽었다.
          // 실측: `조각들('get_window_state')` **928ms → 111,056B**. 이미 오고 있었다.
          // **터지면 다시 안 부른다.** AX 가 20초를 넘기는 창에서 여기가 터지면 아래 `call` 로
          // 한 번 더 걸었다 — 같은 창을 두 번 걷고 두 번 기다린다(실측 40초). 결과는 같다.
          let 트리터짐 = false;
          let 한번에 = args?.그림없이 === true || typeof mcp.구조와조각 !== 'function'
            ? null
            : await mcp.구조와조각('get_window_state', 창상태인자).catch((e) => {
              트리터짐 = true;
              못읽은이유값 = `읽기가 끝나지 않았어요 — ${String(e?.message ?? e).slice(0, 120)}`;
              return null;
            });
          if (한번에) {
            const 이미지 = (한번에.조각 ?? []).find((x) => x?.type === 'image' && x?.data);
            if (이미지) {
              그림값 = { mime: String(이미지.mimeType ?? 'image/png'), base64: String(이미지.data) };
              그림크기값 = Number(이미지.width) > 0
                ? { w: Number(이미지.width), h: Number(이미지.height) }
                : 그림크기재기(String(이미지.data));
            }
          }
          // ── **깊이 제한 폴백**(F-53 방 선택 · PM 승인 2026-08-09) ─────────────────
          //
          // 실측(오너 창): 카톡 목록에서 AX 전체 걷기가 **20초 타임아웃**으로 죽었고
          // (드라이버 원문: *"AX tree walk for pid=1048 timed out after 20 s … re-call with a
          // depth-limited scan"*), 요소가 0~18개로만 보였다. 그래서 모델은 방 이름을 못 찾고
          // label 로 헛짚었다 — 두 달간 "방을 못 연다"의 정체다. 깊이를 제한하면 트리가
          // **살아난다**: 같은 창에서 요소 11개 + 목표 행의 토큰(`s0000001c:5`)이 나왔고,
          // 그 토큰으로 방이 열렸다(오대상 0).
          //
          // 새 능력이 아니다 — **손이 이미 볼 수 있는 것을 못 보고 있었다.**
          // 발동 조건은 기계 사실 둘: ① 트리가 터졌다 ② 트리는 왔는데 요소가 0개다.
          // 상한 근거(실측값 그대로): `max_depth 12`(목표 행이 잡힌 깊이) ·
          // `max_elements 60`(목록 한 화면 분량 — 400은 타임아웃을 부른 그 값이다).
          // **한 번만 더 걷는다** — 같은 창을 두 번 걷고 두 번 기다리는 병(실측 40초)을 안 만든다.
          const 얕게걷기 = async () => {
            const t0 = Date.now();
            const r = await mcp.구조와조각('get_window_state', {
              ...창상태인자, max_elements: 60, max_depth: 12,
            }).catch(() => null);
            얕게걷기지연 = { 걸린ms: Date.now() - t0, 요소수: (r?.구조?.elements ?? []).length };
            return r;
          };
          const 트리비었나 = (구조) => !Array.isArray(구조?.elements) || 구조.elements.length === 0;
          if (typeof mcp.구조와조각 === 'function' && args?.그림없이 !== true
            && (트리터짐 || 트리비었나(한번에?.구조))) {
            const 다시 = await 얕게걷기();
            if (!트리비었나(다시?.구조)) {
              트리터짐 = false;
              못읽은이유값 = null;                 // 얕게 걸으니 읽혔다 — 못 읽은 것이 아니다
              한번에 = 다시;
              if (!그림값) {
                const 이 = (다시.조각 ?? []).find((x) => x?.type === 'image' && x?.data);
                if (이) {
                  그림값 = { mime: String(이.mimeType ?? 'image/png'), base64: String(이.data) };
                  그림크기값 = Number(이.width) > 0
                    ? { w: Number(이.width), h: Number(이.height) }
                    : 그림크기재기(String(이.data));
                }
              }
            }
          }
          let st = 한번에?.구조 ?? (트리터짐 ? null : await mcp.call('get_window_state', 창상태인자).catch((e) => {
            // **터진 것은 "없는 것"이 아니다**(계열 C). 말없이 0개로 넘기면 모델이 이유를
            // 지어낸다 — 라이브에서 *"권한이 막혔다"* 가 그렇게 나왔다.
            못읽은이유값 = `읽기가 끝나지 않았어요 — ${String(e?.message ?? e).slice(0, 120)}`;
            return null;
          }));
          if (st?.code && !Array.isArray(st?.elements)) {
            const 고칠pid = Number(st.owner_pid);
            if (Number.isInteger(고칠pid) && 고칠pid > 0 && 고칠pid !== 창상태인자.pid) {
              st = await mcp.call('get_window_state', { ...창상태인자, pid: 고칠pid });
            }
            if (st?.code && !Array.isArray(st?.elements)) {
              // **왜 못 읽었는지는 사실이다.** 안 올리면 모델이 이유를 지어낸다.
              못읽은이유값 = `${st.code}${st.suggestion ? ` — ${st.suggestion}` : ''}`;
            }
          }
          // **판정을 그대로 올린다**(흡수 ② · 비교군 `_text_response` 계약).
          // 실물은 요소를 비워 주면서 **왜 비웠는지**(`degraded_reason`)와
          // **무엇을 하면 되는지**(`escalation.recommended`)를 함께 준다.
          // 그걸 버렸더니 T5 가 *"권한이 막혔다"* 고 지어냈다 — 권한 문제가 아니었다.
          if (st?.degraded === true && !못읽은이유값) {
            못읽은이유값 = String(st.degraded_reason ?? 'degraded')
              + (st.screenshot_error?.code ? ` · ${st.screenshot_error.code}` : '');
          }
          if (st?.escalation && typeof st.escalation === 'object') 올려야할길값 = st.escalation;
          // **손이 준 사실을 버리지 않는다**(PM 판정 2026-08-07).
          //
          // cua 는 매 응답에 *"지금 상태가 이렇고 다음은 이렇게 하라"* 를 전부 적어 준다.
          // 우리는 `degraded_reason` 한 줄만 뽑아 모델에게 **실패**로 넘겼다. 실물:
          // ```
          // escalation.reason  "the screenshot in this response IS the requested window,
          //                     but background input (including px) is refused …"
          // background_input   routes 셋 다 refused · reason "off_space_or_ax_unresolved"
          // ```
          // **그림은 맞고 입력만 거부된다**를 드라이버가 정확히 말하는데 그걸 버렸다.
          // 커널은 이 글을 읽어 판정하지 않는다 — 손이 밝힌 것을 **사실로 옮길 뿐**이다.
          화면사실값 = (() => {
            const 것 = {};
            const 막힌길 = (st?.background_input?.routes ?? []).filter((r) => r?.status === 'refused');
            if (막힌길.length) {
              것.조작막힘 = true;
              것.조작막힌이유 = [...new Set(막힌길.map((r) => r.reason).filter(Boolean))].join(' · ');
              것.막힌길 = 막힌길.map((r) => r.route).filter(Boolean);
            }
            // 관찰은 되는데 조작만 막힌 경우 — **"못 읽는다"와 완전히 다른 상태다.**
            if (/screenshot[^.]*IS the requested window/i.test(String(올려야할길값?.reason ?? ''))) {
              것.그림은요청한창이맞다 = true;
            }
            if (st?.screenshot_error?.code) 것.그림못찍은이유 = st.screenshot_error.code;
            // **어느 화면에 있는지는 원인 그 자체다.** 풀스크린 창이 별도 Space 를 만들면
            // 다른 창이 그리로 밀리고, 그때 AX 는 창을 못 잡는다 — 하루를 *"가려졌나"* 로 썼다.
            if (대상?.같은화면 === false) {
              것.다른화면에있다 = true;
              것.말 = '그 창은 지금 보고 있는 화면(Space)이 아니라 **다른 화면에 있어요**'
                + `${것.조작막힘 ? ' — 화면은 볼 수 있지만 조작은 그 화면으로 넘어가야 해요.' : '.'}`;
            }
            return Object.keys(것).length ? 것 : null;
          })();

          // **알려준 사다리를 실제로 탄다**(흡수 ③).
          //
          // 오너: *"사용자가 지시하면 **알아서 자동으로** 수행해야 당연한 거잖아."*
          // 드라이버가 *"앞으로 가져오면 볼 수 있다"* 고 알려주는데 안 하면,
          // T5 는 정직하지만 **일을 못 끝낸다** — 사용자는 "읽어줘"라고 했다.
          //
          // 비교군 계약 그대로다: 배경이 기본, **신호가 오면** 앞으로,
          // 그리고 `bring_to_front:false` 처럼 **이전 앱으로 되돌린다** —
          // 깜빡임만 남고 사용자 화면은 그대로다.
          // **넓히려다 되돌렸다**(2026-08-07). 글자가 0이면 무조건 앞세우게 바꿨는데,
          // 진짜 원인은 **창이 다른 Space 에 있는 것**이었다(`space=[1]` · 현재 22).
          // `bring_to_front` 는 Space 를 넘는다는 보장이 없고 설명서가 `This DOES steal
          // foreground` 라고 못박는다 — 사용자 화면을 뺏는 것은 최후다.
          // 드라이버가 `escalation` 으로 *"앞으로 가져오면 된다"* 고 말할 때만 올라간다.
          // **여기 있던 자동 앞세우기를 걷었다**(PM 조건 2 · 2026-08-07).
          //
          // `SKILL.md`: *"An optional escalation is a **harness instruction, never an
          // automatic retry**."* 그리고 `bring_to_front` 설명서: *"**This DOES steal
          // foreground**."* 우리는 드라이버 신호를 보고 **커널이 자동으로** 올렸다 —
          // 계약이 금지한 자리이고, 오너 화면을 계속 뺏었다(오늘 실측에서 `앞세움: true`
          // 가 매번 나왔고, 오너가 *"내가 작업중이라 카톡이 뒤로 밀린다"* 고 말했다).
          //
          // **자동을 버리는 게 아니다.** 오너 규율 *"사용자가 지시하면 알아서 자동으로"* 는
          // 그대로다 — 다만 **화면을 뺏을지 정하는 것은 커널이 아니라 모델**이다.
          // `올려야할길` 은 사실로 계속 실린다(아래 반환값). 모델이 필요하면 손으로 올린다.
          //
          // 걷어도 되는 이유: **그림 배선이 섰다**(`1cf79eb`). 트리가 비어도 드라이버가
          // *"the screenshot in this response IS the requested window"* 라고 말하고
          // 그 그림이 이제 모델까지 간다 — 계산기를 다른 Space 에서 3/3 읽은 그 길이다.
          // **브라우저 창이면 탭도 본다**(CU-④). 사용자는 *"그 화면 읽어줘"* 라고 하지
          // *"CDP 로 읽어줘"* 라고 하지 않는다 — 어느 길로 읽는지는 우리 일이다.
          // 로그인해야 보이는 자리가 여기서 열린다(카드사·배달앱·플레이스).
          if (기존프로필허용 && /chrome|chromium|edge|brave|크롬/i.test(String(대상.app ?? ''))) {
            try {
              // **세션을 먼저 선언한다**(정본 순서: `start_session` → 작업 → `end_session`).
              // 예전엔 `browser_prepare` 가 `session` 을 실어 암묵 생성했다 — 정본이 그것도
              // 허용하지만("or pass session on your first action"), 그러면 `capture_scope` 를
              // 우리가 안 고른 것이 되고 닫는 자리도 없다.
              await 세션열기();
              if (!붙은브라우저.has(대상.pid)) {
                const 붙이기 = () => mcp.call('browser_prepare', {
                  pid: 대상.pid, window_id: 대상.id, session: 브라우저세션,
                  strategy: { kind: 'existing_profile' },
                });
                let 붙음 = await 붙이기();
                // **우리가 시트를 누르지 않는다 — 그 시트는 뜨지 않는다**(스윕 2번 (a) ·
                // PM 승인 2026-08-09 · 프로브 실측). 여기 있던 클릭 갈래를 걷었다.
                //
                // 걷은 근거(사람 개입 0 · 우리 클릭 0 조건에서 벤더에 직접 물었다 —
                // 원본: evidence/step6-compare-2026-08-09/M1-재측정-f54/시트프로브-원본.txt):
                //   browser_prepare{strategy:'existing_profile'} →
                //     status: "refused" · code: "browser_consent_required"
                //     "existing-profile attachment in standard mode requires
                //      --grant existing-profile or an embedding authorization host"
                //     legacy_approval_enabled: false
                // **드라이버는 시트를 띄우지 않고 요청 자체를 거절한다.** 우리 코드가 기다리던
                // 한국어 *"원격 디버깅을 허용하시겠습니까?"* 는 이 경로에서 뜨지 않으므로
                // 그 클릭은 **도달 불가 코드**였다 — "걷으면 한국어 시트에서 막힌다"는 우려는
                // 실측으로 기각됐다(막는 것은 시트가 아니라 grant 다).
                //
                // ⛔ **다시 만들지 않는다.** BROWSER.md 가 못박는다 —
                // *"never click a similar-looking prompt yourself."* 비슷하게 생긴 것을 눌러
                // 엉뚱한 것을 승인하는 사고를 막으려고 드라이버가 **일부러** 거절하는 것이고,
                // 우리가 그 안전장치를 우회하던 자리였다. 정본 경로는 `--grant existing-profile`
                // (데몬 장착) 또는 embedding authorization host 다.
                // 부재 봉인이 이 자리를 지킨다(test/a1-browser-opens-only-when-asked).
                if (붙음?.action) 붙은브라우저.add(대상.pid);
                // **첫 동의는 사용자의 행동이다 — 사용자가 알아야 한다**(PM 조건 2 · 2026-08-09).
                // 승인 UI 는 사람의 것이고(우리가 안 누른다) 크롬은 이 기계에서 **한 번** 묻는다.
                // 그 거절을 조용한 실패로 두면 사용자는 *"왜 탭을 못 보지"* 만 남고 자기가 할 수
                // 있는 한 걸음을 모른다 — F-52(한계의 이유와 다음 길을 함께 말한다)의 사촌 자리다.
                else if (붙음?.status === 'refused') {
                  동의안내값 = '크롬이 "원격 디버깅을 허용하시겠습니까?"를 한 번 물어요 —'
                    + ' 허용을 눌러 주시면 그다음부터는 탭까지 볼 수 있어요.';
                }
              }
              const 브 = await mcp.call('get_browser_state', {
                pid: 대상.pid, window_id: 대상.id, session: 브라우저세션,
              });
              if (Array.isArray(브?.tabs)) {
                탭들값 = 브.tabs.map((t) => ({ id: t.tab_id, title: t.title, url: t.url }));
              }
            } catch { 탭들값 = null; }
          }
          스냅샷 = st?.snapshot_id ?? null;
          // **무엇을 봤는지 남긴다.** 같은 앱 창이 여럿일 수 있고, 안 적으면
          // 다음 걸음이 어느 창 이야기인지 모른다.
          // **pid 도 적는다.** 다음 걸음(스크롤·키·붙여넣기)이 그걸 요구한다 —
          // 안 적어 두면 손이 창은 짚고도 pid 를 못 실어 드라이버가 거절한다(실측 2026-08-06).
          본창 = {
            id: 대상.id, app: 대상.app, title: 대상.title ?? '',
            ...(대상.pid != null ? { pid: 대상.pid } : {}),
            ...(대상.bounds ? { bounds: 대상.bounds } : {}),
            ...(대상.같은화면 === false ? { 같은화면: false } : {}),
            ...(대상.같은화면 === true ? { 같은화면: true } : {}),
          };

          // **AX 가 답을 못 주는 대상이 있다** — 메모 본문은 트리에 없고, 카톡 대화창은
          // 20초를 넘긴다. 앞세워도 안 풀린다. 그때 **눈으로 본다**(F-41).
          // 커널은 그림을 읽지 않는다 — 모델이 본다(F-2 통로 그대로).
          // **잘 읽혔으면 안 받는다** — 비용도 화면 노출도 공짜가 아니다.
          // **못 찍는다고 이미 말했으면 또 시도하지 않는다.** 그 한 번이 20초다.
          //
          // **어느 손으로 찍는지는 실물이 정했다**(2026-08-06 · 카톡 창 13637/pid 4340):
          //   `get_window_state(include_screenshot: true)`  20,114ms → **그림 없음**
          //   `zoom(window_id, pid, x1..y2)`                 3,223ms → image/jpeg 67,492B
          // 드라이버가 이유도 글로 말한다 — *"AX tree walk for pid=4340 timed out after 20 s …
          // then **act by pixel (x,y) off the screenshot** if the tree stays unusable."*
          // `include_screenshot` 은 **트리 걷기와 한 몸이라 같이 죽는다.** 그래서 따로 찍는다.
          const 그림도안됨 = Boolean(st?.screenshot_error);
          const 테 = 대상.bounds;
          if (!(st?.elements ?? []).length && !그림도안됨 && 테 && typeof mcp.조각들 === 'function') {
            try {
              const 조각 = await mcp.조각들('zoom', {
                window_id: 대상.id, pid: 대상.pid,
                // **창 좌상단이 0,0 인 스크린샷 픽셀**이다 — 화면 절대 좌표가 아니다.
                // 계약: *"a window region (x1,y1)–(x2,y2) **in screenshot pixel coordinates**"*.
                // 화면 절대 좌표를 주면 **창 위쪽만** 담긴다(실측: 500×707, 비율이 안 맞았다).
                // 창 픽셀은 Retina 에서 논리 크기의 2배다 — 넉넉히 주면 드라이버가 자른다.
                // 실측(2026-08-06): 0,0~w*2,h*2 로 주니 500×768 · 창 비율과 일치 ·
                // **입력칸과 전송 버튼까지** 담겼다. 그 전에는 모델이 입력칸을 못 보고 추측했다.
                x1: 0, y1: 0, x2: 테.w * 2, y2: 테.h * 2,
              });
              const 이미지 = (조각 ?? []).find((x) => x?.type === 'image' && x?.data);
              if (이미지) {
                그림값 = { mime: String(이미지.mimeType ?? 'image/jpeg'), base64: String(이미지.data) };
                // **모델이 짚을 자다.** 창 크기와 다르다(zoom 은 20% 패딩 + 500px 축소).
                // MCP 조각에는 크기가 없다(실측: `data·mimeType·type` 뿐) — 봉투에서 읽는다.
                그림크기값 = Number(이미지.width) > 0
                  ? { w: Number(이미지.width), h: Number(이미지.height) }
                  : 그림크기재기(String(이미지.data));
                그림스냅샷값 = 그림기록(그림값, 본창, 그림크기값);
              }
              // **그림 크기가 창과 다른 것은 정상이다.** `zoom` 계약이 그렇다 —
              // *"cropped JPEG … with **20% padding** added on each side. The output image is
              // **at most 500 px wide**."* 그래서 559×859 창이 500×707 로 온다.
              // 잘린 게 아니라 패딩+축소다. 그리고 그 좌표는 `from_zoom` 으로 되돌린다(아래 act).
            } catch { 그림값 = null; }
          }
          요소 = (st?.elements ?? []).map((e) => ({
            // **번호로 누른다**(som). 좌표로 찍으면 무엇을 눌렀는지 원장에 남길 수가 없다.
            id: e.element_token ?? (e.index != null ? String(e.index) : e.id),
            번호: e.index, 토큰: e.element_token, 스냅샷,
            type: e.type ?? e.role, role: e.role, subrole: e.subrole,
            label: e.label ?? e.title ?? e.name ?? '', value: e.value,
            bounds: e.bounds ?? e.frame ?? {}, isEnabled: e.enabled !== false,
            창: 대상.id, pid: 대상.pid,
          }));
        }
      }

      return {
        ...(앞앱 ? { frontmost: 앞앱 } : {}),
        windows: 창들,
        ...(요소 ? { elements: 요소 } : {}),
        // **무엇을 봤는지 남긴다** — 같은 앱 창이 여럿일 수 있고, 안 적으면
        // 다음 걸음이 어느 창 이야기인지 모른다(계열 G).
        ...(본창 ? { 본창 } : {}),
        ...(못읽은이유값 ? { 못읽은이유: 못읽은이유값 } : {}),
        ...(올려야할길값 ? { 올려야할길: 올려야할길값 } : {}),
        ...(앞세워읽음값 ? { 앞세워읽음: true } : {}),
        ...(화면사실값 ? { 화면사실: 화면사실값 } : {}),
        ...(그림값 ? { 그림: 그림값 } : {}),
        ...(그림크기값 ? { 그림크기: 그림크기값 } : {}),
        ...(그림스냅샷값 ? { 그림스냅샷: 그림스냅샷값 } : {}),
        ...(탭들값?.length ? { 탭들: 탭들값 } : {}),
        ...(동의안내값 ? { 동의안내: 동의안내값 } : {}),
        // 폴백이 돌았는가·얼마 걸렸는가(진단면 · PM 조건). 안 돌면 칸을 안 만든다.
        ...(얕게걷기지연 ? { 얕게걷기: 얕게걷기지연 } : {}),
      };
    },

    async act(요청) {
      const 행동 = String(요청?.행동 ?? '');
      const 요청대상 = 요청?.대상 ?? {};

      // **보는 손이 찾은 창을 하는 손도 찾아야 한다**(오너 계획서 ③ · 라이브 2026-08-06).
      //
      // `desktop.screen` 은 `창제목` 으로 창을 정확히 고른다 — 사용자는 앱이 아니라 **대화창
      // 이름**을 말하기 때문이다(`정영현`·`TNT`). 그런데 `act` 는 그 축을 아예 안 봤다:
      // `대상.창`·`대상.pid` 가 없으면 **앱 이름**만 찾았다. 카카오톡은 한 pid 가 창 열 개를
      // 가지니 앱만으로는 어느 창인지 알 수 없고, 드라이버가 옳게 거절한다 —
      //   `scroll` → *"Missing required integer field: pid"*
      //   `press_key` → *"pid 4340 owns 6 other eligible top-level window(s)"*
      // 스키마는 이미 *"screen 에서 이걸로 골랐으면 여기에도 똑같이 줘라"* 고 약속하고 있었다.
      // **약속만 하고 안 지킨 것은 우리다.** 두 손이 같은 축으로 창을 좁힌다.
      //
      // 직접 준 창 신분이 언제나 이긴다 — 찾은 것으로 덮어쓰지 않는다.
      const 창이름 = String(요청?.창제목 ?? 요청대상.창제목 ?? '').trim().toLowerCase();
      let 대상 = 요청대상;
      if (창이름 && (요청대상.창 ?? 요청대상.window) == null && !Number.isInteger(요청대상.pid)) {
        const 창들 = (await mcp.call('list_windows', {}).catch(() => ({})))?.windows ?? [];
        const 축 = (w) => String(w.title ?? w.window_title ?? '').trim().toLowerCase();
        // **정확 일치가 부분 일치를 이긴다** — 관찰이 쓰는 규칙 그대로다.
        const 정확 = 창들.filter((w) => 축(w) === 창이름);
        const 걸린것 = 정확.length ? 정확 : 창들.filter((w) => 축(w).includes(창이름));
        // 여럿이면 **앞에 있는 것**을 고른다(관찰이 보여 준 것이 그것이다). 하나도 없으면
        // 아무 창이나 건드리지 않는다 — 빈 채로 두면 아래 손들이 알아서 막힌다.
        const 고른것 = [...걸린것].sort((a, b) => Number(b.is_on_screen ?? 0) - Number(a.is_on_screen ?? 0)
          || Number(b.z_index ?? 0) - Number(a.z_index ?? 0))[0];
        if (고른것) {
          대상 = {
            ...요청대상,
            창: 고른것.window_id,
            pid: 고른것.pid,
            // 스크롤·클릭이 창 가운데를 짚을 때 쓴다 — 자리가 없으면 형제 창 모호성으로 거절된다.
            ...(요청대상.bounds ? {} : { bounds: 고른것.bounds }),
          };
        }
      }

      // **앱 이름을 pid 로 바꾼다.** 실물이 `pid` 를 받는다(`bring_to_front`·`kill_app` 필수).
      // 라이브에서 `app` 을 보내다 `Missing required integer field: pid` 로 전부 실패했다 —
      // 검사는 초록이었다(가짜 MCP 가 인자를 안 봤다). **가짜가 실물의 필수 인자를 안 재면
      // 계약이 아니라 모양만 지킨다.**
      /**
       * **앱 하나를 고른다 — 못 고르면 고르지 않는다.**
       *
       * 축이 셋이다. 셋째가 없어서 라이브에서 `Calculator` 가 안 잡혔다(2026-08-05):
       * OS 표시 이름은 `계산기` 인데 사용자와 모델은 `Calculator` 라고 쓴다. 둘을 잇는 것은
       * **앱 파일 이름**(`/System/Applications/Calculator.app`)이고, 이건 추측이 아니라 기계 사실이다.
       *
       * 그리고 **여럿이면 안 고른다**(A02). 예전 `.find()` 는 앞엣것을 임의로 집었다 —
       * 손 바깥에는 A02 를 세워 두고 손 안쪽에 그대로 남아 있던 자리다.
       *
       * @returns {Promise<{pid:number}|{골라야함:Array}|null>}
       */
      // **창을 가리키는 이름은 하나다.** 손은 요소 신분과 같은 말(`창`)로 깔고, 이 아래 손들은
      // `window` 로 읽고 있었다 — 그래서 손이 *"n.BEAI 창"* 을 정확히 짚어 줘도 `focus` 는
      // *"창이 여러 개라 모르겠다"* 로 되물었다(라이브 2026-08-06). 한 자리에서 합친다.
      const 짚은창 = 대상.창 ?? 대상.window;
      const 앱고르기 = async ({ 켜진것만 = false } = {}) => {
        if (Number.isInteger(대상.pid)) return { pid: 대상.pid };
        const 이름 = String(대상.app ?? '').trim().toLowerCase();
        if (!이름) return null;
        const { apps } = await mcp.call('list_apps', {});
        // **`list_apps` 는 낡는다**(실측 2026-08-05): `launch_app` 이 pid 41816 을 주고
        // `ps` 로도 살아 있는데 1.5초 뒤에도 `{pid:0, running:false}` 라고 답했다.
        // 창 목록은 WindowServer 에서 와서 정확했다 — **지금 떠 있는 창의 주인**을 축으로 더한다.
        // 한 곳이 낡았다고 "못 찾았다"로 끝내지 않는다.
        const 창주인 = 켜진것만 ? await 창에서앱들() : [];
        // **켜기와 앞으로 띄우기는 찾는 대상이 다르다.** 켜기는 꺼진 앱도 찾아야 하고
        // (pid 로 거르면 "켜 줘"를 받을 수가 없다), 띄우기는 **켜진 것만** 이어야 한다 —
        // pid 없는 항목을 집으면 드라이버가 `window_target_not_found` 로 거절한다(내 회귀 · 라이브 5차).
        const 목록것 = (apps ?? []).filter((a) => (켜진것만 ? Number.isInteger(a?.pid) && a.pid > 0 : true));
        // 낡은 목록의 이름(`Calculator`)과 살아 있는 창의 이름(`계산기`)을 **pid 로 잇는다** —
        // 사용자가 어느 쪽 이름을 쓰든 같은 앱에 닿는다.
        const 이름보태기 = (w) => {
          const 같은 = (apps ?? []).find((a) => String(a.bundle_id ?? '') && (
            String(a.name ?? '') === String(w.name ?? '')
            || String(a.launch_path ?? '').split('/').pop().replace(/\.app$/i, '') === String(w.name ?? '')
            || Number(a.pid) === Number(w.pid)));
          return 같은 ? { ...같은, ...w } : w;
        };
        const 후보들 = [...목록것];
        for (const w of 창주인.map(이름보태기)) {
          if (!후보들.some((a) => Number(a.pid) === Number(w.pid))) 후보들.push(w);
        }
        const 축 = (a) => [
          String(a.name ?? ''),
          String(a.bundle_id ?? ''),
          // `/System/Applications/Calculator.app` → `Calculator`
          String(a.launch_path ?? '').split('/').pop().replace(/\.app$/i, ''),
        ].map((x) => x.toLowerCase()).filter(Boolean);
        // **정확히 맞는 것이 먼저다.** 부분 일치를 먼저 보면 `메모` 가 `메모 도우미` 를 문다.
        const 정확 = 후보들.filter((a) => 축(a).includes(이름));
        const 걸린것 = 정확.length ? 정확
          : 후보들.filter((a) => 축(a).some((x) => x.includes(이름) || 이름.includes(x)));
        if (!걸린것.length) return null;
        if (걸린것.length > 1) {
          return { 골라야함: 걸린것.map((a) => ({ app: a.name, pid: a.pid, bundle: a.bundle_id })) };
        }
        // 찾은 앱을 통째로 준다 — 켜는 쪽은 **앱 파일 이름**이 필요하고(표시 이름으로는 cua 가
        // 못 받는다) 켜져 있는지도 알아야 한다.
        return { pid: 걸린것[0].pid, 앱: 걸린것[0] };
      };
      const pid찾기 = async () => (await 앱고르기({ 켜진것만: true }))?.pid ?? null;
      /** 창 id 로 그 창 주인의 pid. 창 목록이 창마다 pid 를 싣는다(실측 2026-08-05). */
      /** 지금 떠 있는 창들의 주인 앱. **`list_apps` 가 낡았을 때의 다른 눈이다.** */
      const 창에서앱들 = async () => {
        const 본것 = await mcp.call('get_accessibility_tree', {}).catch(() => null);
        const 창들 = 본것?.windows ?? (Array.isArray(본것) ? 본것 : []);
        const 본pid = new Map();
        for (const w of 창들) {
          const pid = Number(w?.pid);
          if (!Number.isInteger(pid) || pid <= 0 || 본pid.has(pid)) continue;
          본pid.set(pid, { name: w.app_name ?? w.app ?? '', pid, running: true });
        }
        return [...본pid.values()];
      };

      const 창의pid = async (windowId) => {
        // **관찰이 쓰는 그 호출을 그대로 쓴다** — 창 목록을 두 곳에서 다르게 가져오면
        // 언젠가 한쪽만 바뀌고 그때 조용히 어긋난다.
        const 본것 = await mcp.call('get_accessibility_tree', {}).catch(() => null);
        const 창들 = 본것?.windows ?? (Array.isArray(본것) ? 본것 : []);
        const w = 창들.find((x) => Number(x?.window_id ?? x?.id) === Number(windowId));
        return Number.isInteger(w?.pid) ? w.pid : null;
      };

      // ── **드라이버 확인은 한 자리에서, 한 규칙으로 받는다** (1단계 빼는 걸음 · 2026-08-08) ──
      //
      // 예전엔 focus(`activated`)·launch(`launch_state`)에만 특수 표식을 붙였고, move·resize 는
      // 우리 전후 대조로 갔다 — 벤더는 `set_window_frame` 을 *"returns confirmed only after
      // geometry readback"* 으로 이미 확인해 주는데, 우리 대조가 창 관리자보다 먼저 찍어
      // **없는 실패**를 만들었다(그 병만 네 번). 0.14 행동 계약이 `effect` 로 통일됐으니
      // 특수 표식 대신 그 계약을 읽는다.
      //
      // **누르는 것(클릭·입력)은 여기서 안 받는다** — 계약 원문: *"These fields describe the
      // actuator; they do not declare the user's task complete."* 누르기의 판정은 모델이
      // 선언한 의미 효과이고, 그건 `verify_state`(손 쪽)가 받는다.
      const 행동이곧목표 = new Set(['focus', 'launch', 'quit', 'move', 'resize']);
      // ── **성공 칸은 정본이 정의한 것만 쓴다** (정본 정면대조 2026-08-11) ──────────
      //
      // 여기 있던 두 칸은 **어느 문서에도 없다.** `cua-driver dump-docs` 전문 검색:
      //   `exact_window_effect`  0건 · `activated`(행동 결과 칸)  0건 · `focused_window_id` 0건
      // 스키마에도 없다. 우리가 라이브 응답 한 번을 보고 **이름을 지어 성공 칸으로 세운 것**이고,
      // 그 칸 하나 때문에 「앞으로 띄웠어요 vs 전·후 frontmost 동일」이 두 번 났다(§2 계측기).
      //
      // 정본이 정한 어휘는 하나다(`SKILL.md` — Read action facts):
      //   `confirmed` … publishable value readback or window-change evidence
      //   `partial`   … only delivery.delivered_count was delivered
      //   `unverifiable` · `suspected_noop` · `refused`
      // 그리고 `describe bring_to_front` 가 이 손을 콕 집어 못박는다 —
      //   *"success means the exact ordinary macOS window was **independently verified** as the
      //    focused window and first in WindowServer layer-0 order. **Request acceptance alone is
      //    reported as a partial result, never as activation.**"*
      //
      // 그래서 `confirmed` 만 확인으로 받는다. `partial` 은 **수락**이지 성공이 아니므로
      // 확인 표식을 안 붙이고 **부분결과로 표시만 한다** — 위층이 그때 상태를 다시 관측한다
      // (`SKILL.md:339` *"After any action, keep using verify_state or a fresh state snapshot
      //  for the actual task postcondition."*).
      //
      // `launch_state` 는 남긴다 — 그건 `describe launch_app` 이 명시하는 칸이다
      // (*"launch_state distinguishes whether the request was sent, the process is running,
      //   and a window is ready"*). 문서 밖 칸이 아니다.
      const 드라이버확인 = (r) => {
        if (!r || typeof r !== 'object' || r.확인됨 === true) return r;
        if (r.effect === 'confirmed') return { ...r, 확인됨: true, 근거: 'effect.confirmed' };
        if (r.launch_state?.process_running === true) {
          return { ...r, 확인됨: true, 근거: 'launch_state.process_running' };
        }
        // **수락은 성공이 아니다.** 정본이 그 말을 그대로 쓴다("partial result, never as activation").
        if (r.effect === 'partial') return { ...r, 부분결과: true };
        return r;
      };
      // 요소를 짚는 값과 창을 가리키는 값 — **한 자리에서 만든다**(계열 A).
      const 짚기 = () => ({
        ...(대상.토큰 ? { element_token: 대상.토큰 }
          : 대상.번호 != null ? { element_index: 대상.번호 }
            : 짚은자리(대상) ?? {}),
        ...(대상.스냅샷 ? { snapshot_id: 대상.스냅샷 } : {}),
      });
      const 전달 = () => ({
        ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
      });

      // **창 신분은 한 자리에서 붙인다** — 손마다 조립하면 반드시 어딘가 빠진다.
      //
      // 오늘 하루에 세 번 났다(2026-08-06): `scroll`(창·pid·자리 없음 → 거절) ·
      // `type_text`(창·pid 없음 → 앞 창에 친다) · `set_value`(pid 없음 →
      // *"Missing required integer field: pid"*). 마지막 것이 오너의 ④ 를 막았다 —
      // 손은 입력칸을 정확히 짚고도 *"실행하지 못했어요"* 로 끝냈다.
      //
      // 손이 준 인자가 이긴다(그 손이 더 잘 아는 경우가 있다). 없을 때만 채운다.
      // 사다리가 `delivery_mode` 를 얹는 자리 — 표의 손을 하나하나 고치지 않는다.
      let 덧인자 = {};
      const 창실어부르기 = (이름, 인자 = {}) => mcp.call(이름, {
        ...(대상.창 ? { window_id: 대상.창 } : {}),
        ...(대상.pid ? { pid: 대상.pid } : {}),
        ...인자,
        ...덧인자,
      });
      // **여기서 판정하지 않는다.** 부르고 결과만 낸다 — 됐는지는 손이 전후로 가른다.
      const 표 = {
        focus: async () => {
          // **창 id 는 그 자체로 신분이다.** 앱 이름이 없다고 거절하면, 모델이 정확히 그 창을
          // 짚어 줘도 못 띄운다 — 라이브에서 `focus window:14213` 이 그렇게 실패했다.
          const 창만 = 짚은창 && !대상.app && !Number.isInteger(대상.pid);
          // cua `bring_to_front` 는 **pid 를 반드시 받는다**(창 id 만 주면 거절한다).
          // 창 목록이 창마다 pid 를 실어 주니 거기서 가져온다 — 추측이 아니라 기계 사실이다.
          const 창pid = 창만 ? await 창의pid(짚은창) : null;
          const 고른것 = 창만 ? (창pid != null ? { pid: 창pid } : null) : await 앱고르기({ 켜진것만: true });
          // **여럿이면 부르지 않는다** — 어느 것이냐고 되묻는 것이 실패보다 정직하다(A02).
          if (고른것?.골라야함) return { 골라야함: 고른것.골라야함 };
          const pid = 고른것?.pid ?? null;
          // pid 도 창 id 도 없으면 **부르지 않는다.** 빈 인자로 부르면 드라이버가 알아서
          // 아무 창이나 띄울 수도 있고, 그건 오대상 실행이다.
          if (pid == null && !짚은창) throw new Error('대상 앱을 못 찾았다');
          const r = await mcp.call('bring_to_front', {
            ...(pid != null ? { pid } : {}), ...(짚은창 ? { window_id: 짚은창 } : {}),
          });

          // **드라이버가 모호하면 실행하지 않고 후보를 돌려준다**(실물 확인 2026-08-05:
          // Finder 창이 여럿이라 `candidates` 만 왔고 앞 앱은 안 바뀌었다).
          // 그건 실패가 아니라 **"어느 것이냐"** 다 — A02 와 같은 규율이고, 우리도 같은 답을 해야 한다.
          // 실패로 뭉개면 모델이 "안 된다"고 하고, 성공으로 뭉개면 거짓 성공이 된다.
          if (Array.isArray(r?.candidates) && r.candidates.length) {
            // **가를 축을 정본 자리에서 채운다** (정본 정면대조 2026-08-11).
            //
            // `candidates` 는 문서에 없는 칸이라(dump-docs 0건) 무엇이 실려 오는지 보장이 없다.
            // 축은 **문서가 보장하는 자리**에서 가져온다 — `describe list_windows` 가 창마다
            // `bounds · z_index · is_on_screen · on_current_space` 를 준다고 적어 뒀다.
            // 되묻는 갈래는 드물게만 지나므로 여기서 한 번 더 부르는 값이 있다.
            const 창표 = new Map(((await mcp.call('list_windows', {}).catch(() => null))?.windows ?? [])
              .map((w) => [Number(w?.window_id), w]));
            const 후보 = r.candidates.map((c) => {
              const w = 창표.get(Number(c.window_id)) ?? {};
              return {
                window: c.window_id, title: c.title ?? w.title ?? '',
                app: c.app_name ?? c.app ?? w.app_name ?? '',
                보임: (c.is_on_screen ?? w.is_on_screen ?? c.visible) !== false,
                층: Number.isFinite(w.z_index) ? w.z_index : null,
                ...(w.bounds ? {
                  bounds: {
                    x: w.bounds.x, y: w.bounds.y,
                    w: w.bounds.w ?? w.bounds.width, h: w.bounds.h ?? w.bounds.height,
                  },
                } : {}),
                ...(w.on_current_space === false ? { 같은화면: false } : {}),
                ...(w.on_current_space === true ? { 같은화면: true } : {}),
              };
            });
            // **안 보이는 창은 고를 것이 아니다.** 계산기 하나에 숨은 창이 넷 딸려 와서
            // *"창이 여러 개라 알 수 없어요"* 가 나갔다(라이브 2026-08-05) — 보이는 건 하나뿐이었다.
            // 고를 수 없는 것을 고르라고 하는 건 고를 수 있는 척하는 것이다.
            let 보이는것 = 후보.filter((c) => c.보임);
            // **다른 화면(Space)의 창도 고를 것이 아니다** — `focus` 갈래가 이 축을 안 봤다.
            // `bring_to_front` 는 Space 를 넘는다는 보장이 없고, 넘어가면 사용자 화면이 통째로
            // 바뀐다. 같은 화면에 있는 것이 있으면 그것부터다. 하나도 없으면 안 거른다
            // (`on_current_space` 를 안 준 드라이버에서 후보를 통째로 없애지 않는다).
            const 같은화면것 = 보이는것.filter((c) => c.같은화면 !== false);
            if (같은화면것.length) 보이는것 = 같은화면것;
            if (보이는것.length === 1) {
              return mcp.call('bring_to_front', {
                window_id: 보이는것[0].window, ...(pid != null ? { pid } : {}),
              });
            }
            return { 골라야함: 보이는것.length ? 보이는것 : 후보 };
          }
          // **여기서 판정하지 않는다.** 드라이버가 `effect` 로 말하고(정본 어휘 다섯),
          // 표식은 아래 `드라이버확인` 한 자리가 붙인다. 그리고 그 표식이 붙어도
          // **위층(손)이 행동 뒤 상태를 다시 관측해** 목표 도달을 가른다(`SKILL.md:339`).
          // 예전 이 자리 주석은 `verified:true`·`focused_window_id` 를 근거로 적었는데
          // **둘 다 문서에 없는 이름**이었다(dump-docs 0건).
          return r;
        },
        // **켜기는 "켜졌나"로 확인한다 — "앞에 떴나"가 아니다.**
        // cua 는 켜고도 일부러 앞으로 안 올린다(`self_activation_suppressed`). 그걸 앞으로
        // 재면 켜기는 영원히 실패로 찍힌다 — 라이브에서 사용자가 "직접 누르세요"를 들은 자리다.
        launch: async () => {
          const 고른것 = await 앱고르기();
          if (고른것?.골라야함) return { 골라야함: 고른것.골라야함 };
          // **이미 켜져 있으면 켜는 일은 끝난 일이다.** 다시 켜면 켜지지도 않고(이미 있다)
          // 우리 전후 대조는 "안 변했다"로 읽어 실패로 찍는다 — 라이브에서 그렇게 났다.
          if (고른것?.앱?.running === true || 고른것?.앱?.pid != null) {
            return { 확인됨: true, 근거: 'list_apps.running', pid: 고른것.앱.pid, name: 고른것.앱.name };
          }
          // cua `launch_app` 은 **앱 파일 이름**을 받는다(`계산기` 로는 못 켠다).
          // 우리가 아는 이름이 있으면 그걸 쓰고, 모르는 앱이면 사용자가 말한 그대로 켜 본다 —
          // 우리가 아는 것만 켤 수 있는 건 아니다.
          const 켤이름 = 고른것?.앱
            ? (String(고른것.앱.launch_path ?? '').split('/').pop().replace(/\.app$/i, '') || 고른것.앱.name)
            : 대상.app;
          // 켜졌는지는 드라이버가 `launch_state` 로 밝힌다 — 표식은 `드라이버확인` 이 붙인다.
          return mcp.call('launch_app', { name: 켤이름 });
        },
        quit: async () => {
          const pid = await pid찾기();
          if (pid == null) throw new Error('대상 앱을 못 찾았다');
          return mcp.call('kill_app', { pid });
        },
        move: () => mcp.call('set_window_frame', { window_id: 짚은창, ...(요청?.값 ?? {}) }),
        resize: () => mcp.call('set_window_frame', { window_id: 짚은창, ...(요청?.값 ?? {}) }),
        // **어느 창에, 어디를, 어느 쪽으로.** 셋 중 하나만 빠져도 안 굴러간다(실측 2026-08-06):
        //   pid 없음 → *"Missing required integer field: pid"*
        //   direction 없음 → *"Missing required string field: direction"*
        //   자리 없음 → `refused` · `same_pid_keyboard_ambiguity`
        //     *"pid 4340 owns 6 other eligible top-level window(s) … could mutate a sibling window"*
        // 마지막 것은 **옳은 거절**이다 — 형제 창을 건드릴 수 있으니 안 한 것이다.
        // 자리를 주면 풀린다. 창 가운데를 찍는다.
        scroll: () => {
          const 값 = 요청?.값;
          const 말 = typeof 값 === 'string' ? { 방향: 값 } : (값 ?? {});
          const 가 = 가운데(대상.bounds);
          return 창실어부르기('scroll', {
            ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
            ...가,
            // **"이전 대화 보여줘"는 위로 올리라는 말이다.** 안 정해 주면 아무 데도 안 간다.
            direction: String(말.방향 ?? 말.direction ?? 'up'),
            clicks: Number(말.양 ?? 말.clicks ?? 5),
            ...(말.x != null || 말.y != null ? { x: 말.x ?? 가.x, y: 말.y ?? 가.y } : {}),
          });
        },
        // **번호·토큰으로 누른다 — 좌표는 마지막 수단이다.**
        // 좌표로 찍으면 그 사이에 화면이 밀렸을 때 다른 것을 누르고도 모른다(A04 가 겨눈 자리).
        click: () => 창실어부르기('click', {
          // 토큰 → 번호 → **눈으로 본 자리** → 요소 테두리 가운데. 순서가 곧 근거의 세기다.
          ...(대상.토큰 ? { element_token: 대상.토큰 }
            : 대상.번호 != null ? { element_index: 대상.번호 }
              : 짚은자리(대상) ?? 가운데(대상.bounds)),
          ...(대상.스냅샷 ? { snapshot_id: 대상.스냅샷 } : {}),
          ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
        }),
        // **어느 창에 치는지 들고 간다.** 안 실으면 앞 창에 친다 — 사용자가 보던 창에
        // 글자가 들어간다(계열 G · 옆에서 같이 한다, 뺏지 않는다).
        type: () => 창실어부르기('type_text', {
          text: String(요청?.값 ?? ''),
          ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
        }),
        // `set_value` — 네이티브 메뉴를 안 열고 값을 직접 넣는다. 메뉴를 열면 포커스를 뺏는다.
        // **마우스·키보드로 되는 모든 것**(흡수 ④). 드라이버에는 이미 다 있었다 —
        // 우리가 여덟만 쓰고 있었다. 신분(토큰·창·pid)은 위에서 한 벌로 온다.
        double_click: () => 창실어부르기('double_click', { ...짚기(), ...전달() }),
        right_click: () => 창실어부르기('right_click', { ...짚기(), ...전달() }),
        drag: () => 창실어부르기('drag', {
          ...(대상.pid ? { pid: 대상.pid } : {}), ...(대상.창 ? { window_id: 대상.창 } : {}),
          ...(요청?.값 ?? {}),
        }),
        // **Enter·Tab·Esc·방향키** — 메시지 보내기가 이것이다.
        press_key: () => 창실어부르기('press_key', { key: String(요청?.값 ?? ''), ...짚기(), ...전달() }),
        // `cmd+s` 처럼 앱마다 있는 표준 길.
        hotkey: () => 창실어부르기('hotkey', { keys: String(요청?.값 ?? ''), ...전달() }),
        // **앱 메뉴가 가장 안정적인 조작 경로다** — 좌표도 토큰도 안 낡는다.
        menu: () => 창실어부르기('invoke_menu', {
          path: Array.isArray(요청?.값) ? 요청.값 : String(요청?.값 ?? '').split('>').map((x) => x.trim()),
          ...전달(),
        }),
        copy: () => mcp.call('clipboard_read', { include_text: true }),
        paste: () => 창실어부르기('clipboard_write', { text: String(요청?.값 ?? '') }),
        wait: async () => {
          const 초 = Math.min(Math.max(Number(요청?.값) || 1, 0), 30);
          await new Promise((z) => { setTimeout(z, 초 * 1000); });
          return { ok: true, waited_s: 초 };
        },
        // **놓을 요소가 없으면 키보드로 친다**(라이브 2026-08-06 · 손과 눈의 마지막 조각).
        //
        // 모델이 화면을 보고 입력칸을 좌표로 눌렀는데(`{x:210,y:820}`) 글자를 못 넣었다 —
        // `set_value` 는 **요소에 값을 놓는 손**이라 좌표에는 놓을 데가 없다.
        // 사람이 하는 그대로다: 눌러서 커서를 두고, 키보드로 친다.
        // **글자를 넣는다 = 눌러서 커서를 두고 친다.**
        //
        // 요소를 짚었으면 값을 바로 놓는다(`set_value` — 배경에서 되고 확인도 된다).
        //
        // 자리를 짚었으면 **먼저 눌러 커서를 두고** 친다. 드라이버도 같은 일을 한다 —
        // *"Pass x,y (no element_index) and the tool **pixel-clicks there to establish real
        // renderer focus, then types**."* 그런데 우리가 직접 눌러야 하는 이유가 있다:
        // **`type_text` 는 `from_zoom` 을 안 받는다**(인자 목록에 없다). 우리가 모델에게 주는
        // 그림은 `zoom` 산출물이므로 그 좌표는 `click(from_zoom)` 으로만 되돌릴 수 있다.
        // 그래서 **눌러서 커서를 두는 것은 `click` 이 하고, 치는 것은 `type_text` 가** 한다.
        //
        // 실측(2026-08-06): `focus → type → return` 을 다 실행했는데 화면이 그대로였다 —
        // 커서가 입력칸에 없었다. 순서를 모델에게 맡기면 계속 틀린다. **한 손에 묶는다.**
        set_value: async () => {
          if (대상.토큰 || 대상.번호 != null) {
            return 창실어부르기('set_value', {
              ...(대상.토큰 ? { element_token: 대상.토큰 } : { element_index: 대상.번호 }),
              value: String(요청?.값 ?? ''),
              ...(대상.스냅샷 ? { snapshot_id: 대상.스냅샷 } : {}),
            });
          }
          const 자리 = 짚은자리(대상);
          if (자리) {
            await 창실어부르기('click', 자리);
            await new Promise((z) => { setTimeout(z, 120); });
            return 창실어부르기('type_text', { text: String(요청?.값 ?? '') });
          }
          // 자리도 요소도 없다 — 커서가 어디 있는지 **우리가 모른다.** 치되 그 사실을 남긴다.
          const 낸것 = await 창실어부르기('type_text', { text: String(요청?.값 ?? '') });
          return { ...(낸것 ?? {}), 커서자리: true };
        },
      };
      const 부르기 = 표[행동];
      if (!부르기) throw new Error('그 행동은 이 드라이버가 안 받는다');

      // **좌표로 짚으면 먼저 좌표계를 세운다.**
      //
      // `from_zoom` 은 *"방금 zoom 을 부른 pid"* 에만 유효하다. 관찰에서 찍은 것은 그 턴
      // 안에서도 안 살아 있다 — 실측(2026-08-06): *"from_zoom=true but no zoom context
      // for pid 4340. **Call zoom first.**"* 그래서 행동 직전에 같은 영역을 다시 찍는다.
      // 늘 창 전체(0,0~w×2,h×2)를 찍으므로 **관찰 때와 같은 자**다.
      // 요소 신분이 있으면 언제나 그것이 좌표보다 이긴다. 좌표 계보 검사는 오직
      // 요소 신분이 전혀 없는 픽셀 폴백에만 건다.
      const 좌표만줌 = !대상.토큰 && 대상.번호 == null && !대상.id;
      const 짚음 = 좌표만줌 ? 짚은자리(대상) : null;
      const 좌표신분 = 짚음 ? 그림스냅샷들.get(String(대상.스냅샷 ?? '')) : null;
      if (짚음 && (!좌표신분
        || 좌표신분.창 !== Number(대상.창)
        || 좌표신분.pid !== Number(대상.pid)
        || !(Number(좌표신분.크기?.w) > 0) || !(Number(좌표신분.크기?.h) > 0)
        || Number(짚음.x) < 0 || Number(짚음.y) < 0
        || Number(짚음.x) >= Number(좌표신분.크기?.w)
        || Number(짚음.y) >= Number(좌표신분.크기?.h))) {
        return { effect: 'refused', code: 'pixel_snapshot_required' };
      }
      if (짚음) {
        // 테두리는 **손이 줬으면 그걸**, 없으면 **창 목록에서** 가져온다 —
        // 모델이 안 준다고 좌표계를 못 세우면, 볼 줄은 아는데 만질 줄을 모르게 된다.
        const 테 = 대상.bounds ?? (await mcp.call('list_windows', { on_screen_only: false })
          .then((r) => (r?.windows ?? []).find((w) => w.window_id === 대상.창)?.bounds)
          .catch(() => null));
        const 가로 = Number(테?.w ?? 테?.width ?? 0);
        const 세로 = Number(테?.h ?? 테?.height ?? 0);
        if (!대상.창 || typeof mcp.조각들 !== 'function' || !(가로 > 0) || !(세로 > 0)) {
          return { effect: 'refused', code: 'pixel_snapshot_required' };
        }
        const 조각 = await mcp.조각들('zoom', {
          window_id: 대상.창, ...(대상.pid ? { pid: 대상.pid } : {}),
          x1: 0, y1: 0, x2: 가로 * 2, y2: 세로 * 2,
        }).catch(() => null);
        const 이미지 = (조각 ?? []).find((x) => x?.type === 'image' && x?.data);
        if (!이미지 || 그림해시(String(이미지.data)) !== 좌표신분.해시) {
          return { effect: 'refused', code: 'stale_pixel_snapshot' };
        }
      }

      let 낸것 = await 부르기();

      // **거절이 길을 함께 주면 그 길로 간다**(라이브 2026-08-06 · 오너의 ④ 마지막 칸).
      //
      // 드라이버는 이렇게 거절한다 — `same_pid_keyboard_ambiguity` ·
      // *"process-scoped key events cannot be proven to reach window 14963 and could mutate a
      // sibling window. Use … **delivery_mode:"foreground"**."* 옳은 거절이고, **푸는 법도 말한다.**
      // 우리는 `observe` 에서만 이 사다리를 탔다(흡수 ③). 행동에서 안 타서 T5 가
      // *"키보드 입력이 막혀 있어서"* 라고 답하고 사용자에게 떠넘겼다 — 막힌 적이 없다.
      //
      // 규율은 읽기와 같다: **잠깐 앞세우고, 하고, 이전 앱으로 되돌린다**(계열 G).
      // **한 번만 탄다** — 그래도 안 되면 거절 그대로다.
      let 앞세워함 = false;
      // **문구를 읽어 고르지 않는다**(계열 E). 실물은 `recommended: 'accessibility'` 를 주면서
      // 정작 길은 `reason` 안에 적어 준다(*"or delivery_mode:\"foreground\""*). 문자열을 물면
      // 드라이버가 말을 바꿀 때마다 조용히 끊긴다. **구조로 잰다** —
      // 거절이고 사다리가 딸려 왔으면, 우리가 가진 마지막 수단으로 **한 번만** 더.
      //
      // **그런데 드라이버는 조용히 실패하기도 한다**(노드 ⑥ · 2026-08-06). 카톡 방 목록에서
      // 대화방을 여는 데 다섯 칸을 밟았는데 `escalation` 은 **한 번도 안 왔다**:
      //   AX press → `confirmed`(value_readback) · 방 안 열림
      //   AX/픽셀 double, 픽셀 click 배경 → `unverifiable` · 방 안 열림
      //   **픽셀 double + `delivery_mode:'foreground'` → 열렸다**
      // 배달은 했으니 `unverifiable` 이 정직한 답이다. 그래서 **거절만 보면 영영 못 오른다.**
      // 비교군 프롬프트도 같은 말을 한다 — *"unverifiable … re-capture and check yourself
      // before deciding it worked"* · *"do not conclude 'cua-driver can't drive this app' —
      // climb the ladder."* 확인이 안 되는 것도 **오를 이유**다.
      const 못박았나 = 낸것?.effect === 'refused'
        || (낸것?.effect === 'unverifiable' && 짚은자리(대상) != null);
      if (못박았나 && (대상.pid || 대상.창)) {
        const 본것 = await mcp.call('get_accessibility_tree', {}).catch(() => null);
        // **되돌릴 곳도 같은 축으로 고른다**(정본 `list_windows` — 최대 z_index → `active` → 모른다).
        // 예전엔 `apps.find(a=>a.active)` 하나였다. 그 칸은 계약이 보장한 적이 없다.
        const 앞앱 = 맨앞앱(
          (본것?.windows ?? []).map((w) => ({
            층: Number.isFinite(w?.z_index) ? w.z_index : null,
            pid: w?.pid,
            app: w?.app_name ?? w?.app,
          })),
          본것?.apps ?? [],
        );
        const 되돌릴pid = Number(앞앱?.pid);
        const 앞세움 = await mcp.call('bring_to_front', {
          ...(대상.pid ? { pid: 대상.pid } : {}), ...(대상.창 ? { window_id: 대상.창 } : {}),
        }).catch(() => null);
        if (앞세움) {
          앞세워함 = true;
          await new Promise((z) => { setTimeout(z, 150); });
          덧인자 = { delivery_mode: 'foreground' };
          낸것 = await 부르기();
          덧인자 = {};
          if (Number.isInteger(되돌릴pid) && 되돌릴pid > 0 && 되돌릴pid !== 대상.pid) {
            await mcp.call('bring_to_front', { pid: 되돌릴pid }).catch(() => null);
          }
        }
      }

      // **한 자리에서 가른다.** 손마다 따로 막다가 `click` 에서 또 샜다(라이브 2026-08-05).
      // **읽는 자리는 하나다**(계열 B) — `desktop-driver-answer.js`.
      //
      // **거절은 던지지 않고 네 갈래 모양으로 돌려준다**(F-53 원인 2층 · 2026-08-09).
      // 예전엔 여기서 throw 해 위층(desktop-act-tool)의 거절 갈래가 **영영 못 봤다** —
      // 일반 catch 로 떨어져 사유가 삼켜지고 'not_dispatched'(틀림)가 됐다. 발신 시험의
      // 방 열기 3연속 실패가 정확히 이 경로다(실사유: "Either element_index + window_id
      // or x + y must be provided" — label 만으로는 못 누른다는 드라이버 계약).
      // 위층은 이 모양(effect:'refused')을 이미 읽는다 — 던지면 계약이 죽는다.
      if (거절인가(낸것)) return { effect: 'refused', code: 거절사유(낸것) };
      // 행동 자체가 목표인 것만 — 사다리(앞세움 재시도)까지 끝난 최종 답에 붙인다.
      if (행동이곧목표.has(행동)) 낸것 = 드라이버확인(낸것);
      return 앞세워함 ? { ...낸것, 앞세워함: true } : 낸것;
    },
  };
}

/** 요소의 가운데 좌표 — cua 의 `click` 은 좌표를 받는다(요소 id 가 아니다). */
/**
 * **잘렸나** — 창을 찍었는데 창이 다 안 담겼는지 **재서** 안다.
 *
 * 밟은 사실(2026-08-06). `zoom` 으로 559×859 창을 찍었더니 500×707 이 왔다
 * (비율 0.707 vs 0.651). **아래가 잘렸고 입력칸이 거기 있었다.** 요청 영역을 바꿔도
 * 같은 위쪽만 왔다. 모델은 정확히 *"입력창이 잘려 있어서 좌표를 못 짚는다"* 고 말했다.
 *
 * 문구로 짐작하지 않는다 — **비율을 잰다.** 못 재면 잘렸다고 하지 않는다(모르면 있던 길).
 */
export function 잘렸나(창 = null, 그림 = null) {
  const cw = Number(창?.w); const ch = Number(창?.h);
  const iw = Number(그림?.w); const ih = Number(그림?.h);
  if (![cw, ch, iw, ih].every((n) => Number.isFinite(n) && n > 0)) return false;
  return Math.abs((iw / ih) - (cw / ch)) > 0.02;
}

/**
 * **눈으로 본 자리** — 화면에서 읽은 좌표를 그대로 쓴다.
 *
 * AX 를 안 내주는 창이 있다(카톡 `n.BEAI 사일런트서비스` — 요소 0개). 거기서는 토큰이
 * 영영 안 나오고, 그러면 우리 손은 **화면을 보고도 아무것도 못 만진다.**
 * 드라이버가 길을 이미 말했다: *"act by pixel (x,y) off the screenshot."*
 * 눈이 있으면 그 자리를 짚을 수 있어야 한다 — 그게 손과 눈이다(오너 2026-08-06).
 */
function 짚은자리(대상 = {}) {
  const x = Number(대상.x); const y = Number(대상.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // **어느 자로 잰 좌표인지 함께 말한다.** 우리가 모델에게 주는 그림은 언제나 `zoom` 산출물이고
  // (AX 로 못 읽는 창의 유일한 눈이다), `zoom` 은 20% 패딩을 붙이고 500px 로 줄인다.
  // 그러니 모델이 그 그림을 보고 말하는 좌표는 **zoom 이미지 좌표**다.
  // 계약이 그 되돌림을 이미 준다 — *"`from_zoom`: set true after a zoom call to auto-translate
  // zoom-image pixel coordinates to full-window space."* 우리가 계산하지 않는다.
  return { x: Math.round(x), y: Math.round(y), from_zoom: true };
}

function 가운데(b = {}) {
  const x = Number(b.x ?? 0); const y = Number(b.y ?? 0);
  const w = Number(b.w ?? b.width ?? 0); const h = Number(b.h ?? b.height ?? 0);
  return { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
}
