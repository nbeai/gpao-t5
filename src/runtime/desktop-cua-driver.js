import { 거절인가, 거절사유 } from './desktop-driver-answer.js';
// L3 · **화면 슬롯의 두 번째 드라이버 — cua-driver (MCP stdio)**
//
// 오너 결정(2026-08-05): cua-driver 로 가고 T5 층은 우리가 만든다. **임베디드 모드.**
//
// ── 왜 갈아타나 ─────────────────────────────────────────────────────────
// **크로스 플랫폼이 요구다**(오너: *"PC 운영체제가 무엇이든 상관없이 작동해야겠지"*).
// Peekaboo 는 macOS 전용이다. cua-driver 는 platform-macos 37K줄 · windows 32K줄 ·
// linux 33K줄로 **셋 다 실물**이다(감사 2026-08-05).
//
// ── 왜 임베디드인가 ─────────────────────────────────────────────────────
// `EMBEDDING.md` 원문: *"macOS TCC 는 실행 파일 경로가 아니라 **책임 프로세스**에 귀속한다.
// 서명된 앱이 자식을 spawn 하면 그 자식의 TCC 검사는 **그 앱의** 권한으로 답한다."*
//
//   Standalone   `CuaDriver.app` 을 따로 깔고 그 앱에 권한 → **사용자가 앱을 하나 더 깐다**(§15 마찰)
//   임베디드     T5 가 spawn 하고 **T5 의 권한을 물려받는다** → 앱 하나 · 승인 한 번
//
// 그래서 `mcp --direct` 로 띄운다. 실물이 그 사실을 스스로 밝힌다 —
// `check_permissions` 가 `source.attribution: "host"` 를 낸다.
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

/**
 * **드라이버를 어떻게 띄우는가** — 인자와 환경을 한 자리에 둔다.
 * 밖에서 잴 수 있어야 "껐다"가 주장이 아니라 사실이 된다.
 */
export function 기동인자({ binPath }) {
  return {
    bin: binPath,
    // `--direct` = 임베디드. 우리(호스트)의 TCC 귀속을 쓴다.
    args: ['mcp', '--direct'],
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
 * MCP stdio 한 줄 클라이언트. **여기서 판정하지 않는다** — 부르고 결과를 옮긴다.
 * 가르는 것은 손(`desktop-tool` · `desktop-act-tool`)의 일이다.
 */
export function makeMcpStdio({ binPath, timeoutMs = 12_000, spawnImpl = spawn }) {
  let 아이 = null; let 다음id = 1; let 버퍼 = '';
  const 기다리는것 = new Map();

  const 띄우기 = () => {
    if (아이) return 아이;
    const { bin, args, env } = 기동인자({ binPath });
    아이 = spawnImpl(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
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
  const mcp = deps.mcp ?? makeMcpStdio({ binPath: deps.binPath });

  return {
    id: 'cua',
    label: '화면 관찰·조작(cua)',
    needs: [],

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
      const 앞앱 = (얕은것?.apps ?? []).find((a) => a.active) ?? (얕은것?.apps ?? [])[0] ?? null;
      const 날것창 = (목록?.windows ?? (Array.isArray(목록) ? 목록 : null)) ?? 얕은것?.windows ?? [];
      const 창들 = 날것창.map((w) => ({
        id: w.window_id ?? w.id, title: w.title ?? '', app: w.app_name ?? w.app, pid: w.pid,
        보임: w.is_on_screen !== false,
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
      let 요소 = null; let 스냅샷 = null; let 본창 = null; let 못읽은이유값 = null; let 올려야할길값 = null; let 앞세워읽음값 = false; let 그림값 = null;
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
        if (제목 && 앱것.length > 1) {
          const 정확 = 앱것.filter((w) => String(w.title ?? '').trim().toLowerCase() === 제목);
          if (정확.length) 앱것 = 정확;
        }
        // **여럿이면 임의로 안 연다**(A02). 엉뚱한 대화를 읽고 그것을 사실로 말하게 된다.
        if (앱것.length > 1 && args?.window == null) {
          return {
            ...(앞앱 ? { frontmost: { name: 앞앱.name, bundleId: 앞앱.bundle_id, pid: 앞앱.pid } } : {}),
            windows: 창들,
            창을골라야함: 앱것.map((w) => ({ window: w.id, title: w.title, app: w.app })),
          };
        }
        // **못 찾으면 앞 창으로 떨어지지 않는다.** 그건 오대상 관찰이고,
        // 모델은 지목한 앱을 봤다고 믿은 채 남의 창 내용으로 답한다.
        if ((앱이름 || 제목) && !앱것.length && args?.window == null) {
          return {
            ...(앞앱 ? { frontmost: { name: 앞앱.name, bundleId: 앞앱.bundle_id, pid: 앞앱.pid } } : {}),
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
          let st = await mcp.call('get_window_state', 창상태인자).catch((e) => {
            // **터진 것은 "없는 것"이 아니다**(계열 C). 말없이 0개로 넘기면 모델이 이유를
            // 지어낸다 — 라이브에서 *"권한이 막혔다"* 가 그렇게 나왔다.
            못읽은이유값 = `읽기가 끝나지 않았어요 — ${String(e?.message ?? e).slice(0, 120)}`;
            return null;
          });
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

          // **알려준 사다리를 실제로 탄다**(흡수 ③).
          //
          // 오너: *"사용자가 지시하면 **알아서 자동으로** 수행해야 당연한 거잖아."*
          // 드라이버가 *"앞으로 가져오면 볼 수 있다"* 고 알려주는데 안 하면,
          // T5 는 정직하지만 **일을 못 끝낸다** — 사용자는 "읽어줘"라고 했다.
          //
          // 비교군 계약 그대로다: 배경이 기본, **신호가 오면** 앞으로,
          // 그리고 `bring_to_front:false` 처럼 **이전 앱으로 되돌린다** —
          // 깜빡임만 남고 사용자 화면은 그대로다.
          if (올려야할길값?.recommended === 'foreground' && !(st?.elements ?? []).length) {
            const 되돌릴pid = Number(앞앱?.pid);
            const 앞세움 = await mcp.call('bring_to_front', { pid: 대상.pid, window_id: 대상.id })
              .catch(() => null);
            if (앞세움) {
              앞세워읽음값 = true;
              await new Promise((z) => { setTimeout(z, 250); });
              const 다시 = await mcp.call('get_window_state', 창상태인자).catch(() => null);
              if ((다시?.elements ?? []).length) { st = 다시; 못읽은이유값 = null; 올려야할길값 = null; }
              else if (다시?.degraded_reason) 못읽은이유값 = String(다시.degraded_reason);
              // **되돌린다.** 읽으려고 뺏은 것이지 가져가려고 뺏은 것이 아니다.
              if (Number.isInteger(되돌릴pid) && 되돌릴pid > 0 && 되돌릴pid !== 대상.pid) {
                await mcp.call('bring_to_front', { pid: 되돌릴pid }).catch(() => null);
              }
            }
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
                // 창 테두리 그대로 — 어림잡으면 대화창이 잘린다.
                x1: 테.x, y1: 테.y, x2: 테.x + 테.w, y2: 테.y + 테.h,
              });
              const 이미지 = (조각 ?? []).find((x) => x?.type === 'image' && x?.data);
              if (이미지) 그림값 = { mime: String(이미지.mimeType ?? 'image/jpeg'), base64: String(이미지.data) };
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
        ...(앞앱 ? { frontmost: { name: 앞앱.name, bundleId: 앞앱.bundle_id, pid: 앞앱.pid } } : {}),
        windows: 창들,
        ...(요소 ? { elements: 요소 } : {}),
        // **무엇을 봤는지 남긴다** — 같은 앱 창이 여럿일 수 있고, 안 적으면
        // 다음 걸음이 어느 창 이야기인지 모른다(계열 G).
        ...(본창 ? { 본창 } : {}),
        ...(못읽은이유값 ? { 못읽은이유: 못읽은이유값 } : {}),
        ...(올려야할길값 ? { 올려야할길: 올려야할길값 } : {}),
        ...(앞세워읽음값 ? { 앞세워읽음: true } : {}),
        ...(그림값 ? { 그림: 그림값 } : {}),
      };
    },

    async act(요청) {
      const 행동 = String(요청?.행동 ?? '');
      const 대상 = 요청?.대상 ?? {};

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

      // **확인 표식은 한 자리에서 붙인다.** 두 번 부르는 길(후보에서 하나 고르기)이 생겼는데
      // 거기에 표식을 안 붙여서, 드라이버가 `activated:true` 로 확인해 준 focus 가
      // **실패로 나갔다**(내가 낸 회귀 · 2026-08-05 라이브에서 잡음).
      const 확인붙이기 = (r) => (
        r?.exact_window_effect?.verified === true || r?.activated === true
          ? { ...r, 확인됨: true, 근거: r.code ?? 'driver_verified' }
          : r);
      // 요소를 짚는 값과 창을 가리키는 값 — **한 자리에서 만든다**(계열 A).
      const 짚기 = () => ({
        ...(대상.토큰 ? { element_token: 대상.토큰 } : 대상.번호 != null ? { element_index: 대상.번호 } : {}),
        ...(대상.스냅샷 ? { snapshot_id: 대상.스냅샷 } : {}),
      });
      const 전달 = () => ({
        ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
      });

      // **여기서 판정하지 않는다.** 부르고 결과만 낸다 — 됐는지는 손이 전후로 가른다.
      const 표 = {
        focus: async () => {
          // **창 id 는 그 자체로 신분이다.** 앱 이름이 없다고 거절하면, 모델이 정확히 그 창을
          // 짚어 줘도 못 띄운다 — 라이브에서 `focus window:14213` 이 그렇게 실패했다.
          const 창만 = 대상.window && !대상.app && !Number.isInteger(대상.pid);
          // cua `bring_to_front` 는 **pid 를 반드시 받는다**(창 id 만 주면 거절한다).
          // 창 목록이 창마다 pid 를 실어 주니 거기서 가져온다 — 추측이 아니라 기계 사실이다.
          const 창pid = 창만 ? await 창의pid(대상.window) : null;
          const 고른것 = 창만 ? (창pid != null ? { pid: 창pid } : null) : await 앱고르기({ 켜진것만: true });
          // **여럿이면 부르지 않는다** — 어느 것이냐고 되묻는 것이 실패보다 정직하다(A02).
          if (고른것?.골라야함) return { 골라야함: 고른것.골라야함 };
          const pid = 고른것?.pid ?? null;
          // pid 도 창 id 도 없으면 **부르지 않는다.** 빈 인자로 부르면 드라이버가 알아서
          // 아무 창이나 띄울 수도 있고, 그건 오대상 실행이다.
          if (pid == null && !대상.window) throw new Error('대상 앱을 못 찾았다');
          const r = await mcp.call('bring_to_front', {
            ...(pid != null ? { pid } : {}), ...(대상.window ? { window_id: 대상.window } : {}),
          });

          // **드라이버가 모호하면 실행하지 않고 후보를 돌려준다**(실물 확인 2026-08-05:
          // Finder 창이 여럿이라 `candidates` 만 왔고 앞 앱은 안 바뀌었다).
          // 그건 실패가 아니라 **"어느 것이냐"** 다 — A02 와 같은 규율이고, 우리도 같은 답을 해야 한다.
          // 실패로 뭉개면 모델이 "안 된다"고 하고, 성공으로 뭉개면 거짓 성공이 된다.
          if (Array.isArray(r?.candidates) && r.candidates.length) {
            const 후보 = r.candidates.map((c) => ({
              window: c.window_id, title: c.title ?? '', app: c.app_name ?? c.app ?? '',
              보임: (c.is_on_screen ?? c.visible) !== false,
            }));
            // **안 보이는 창은 고를 것이 아니다.** 계산기 하나에 숨은 창이 넷 딸려 와서
            // *"창이 여러 개라 알 수 없어요"* 가 나갔다(라이브 2026-08-05) — 보이는 건 하나뿐이었다.
            // 고를 수 없는 것을 고르라고 하는 건 고를 수 있는 척하는 것이다.
            const 보이는것 = 후보.filter((c) => c.보임);
            if (보이는것.length === 1) {
              return 확인붙이기(await mcp.call('bring_to_front', {
                window_id: 보이는것[0].window, ...(pid != null ? { pid } : {}),
              }));
            }
            return { 골라야함: 보이는것.length ? 보이는것 : 후보 };
          }
          // **드라이버가 스스로 검증해서 준다.** 우리 전후 추측보다 이게 낫다 —
          // `verified:true` · `focused_window_id` 까지 온다(실물 확인 2026-08-05).
          // 우리 관찰은 창 관리자가 반영하기 전에 찍힐 수 있어 **없는 실패**를 만든다.
          // 드라이버가 더 잘하는 것을 우리가 어설프게 다시 만들지 않는다.
          return 확인붙이기(r);
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
          const r = await mcp.call('launch_app', { name: 켤이름 });
          return r?.launch_state?.process_running === true
            ? { ...r, 확인됨: true, 근거: 'launch_state.process_running' }
            : r;
        },
        quit: async () => {
          const pid = await pid찾기();
          if (pid == null) throw new Error('대상 앱을 못 찾았다');
          return mcp.call('kill_app', { pid });
        },
        move: () => mcp.call('set_window_frame', { window_id: 대상.window, ...(요청?.값 ?? {}) }),
        resize: () => mcp.call('set_window_frame', { window_id: 대상.window, ...(요청?.값 ?? {}) }),
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
          return mcp.call('scroll', {
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
        click: () => mcp.call('click', {
          ...(대상.토큰 ? { element_token: 대상.토큰 } : 대상.번호 != null ? { element_index: 대상.번호 } : 가운데(대상.bounds)),
          ...(대상.스냅샷 ? { snapshot_id: 대상.스냅샷 } : {}),
          ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
        }),
        // **어느 창에 치는지 들고 간다.** 안 실으면 앞 창에 친다 — 사용자가 보던 창에
        // 글자가 들어간다(계열 G · 옆에서 같이 한다, 뺏지 않는다).
        type: () => mcp.call('type_text', {
          text: String(요청?.값 ?? ''),
          ...(대상.창 ? { window_id: 대상.창 } : {}), ...(대상.pid ? { pid: 대상.pid } : {}),
        }),
        // `set_value` — 네이티브 메뉴를 안 열고 값을 직접 넣는다. 메뉴를 열면 포커스를 뺏는다.
        // **마우스·키보드로 되는 모든 것**(흡수 ④). 드라이버에는 이미 다 있었다 —
        // 우리가 여덟만 쓰고 있었다. 신분(토큰·창·pid)은 위에서 한 벌로 온다.
        double_click: () => mcp.call('double_click', { ...짚기(), ...전달() }),
        right_click: () => mcp.call('right_click', { ...짚기(), ...전달() }),
        drag: () => mcp.call('drag', {
          ...(대상.pid ? { pid: 대상.pid } : {}), ...(대상.창 ? { window_id: 대상.창 } : {}),
          ...(요청?.값 ?? {}),
        }),
        // **Enter·Tab·Esc·방향키** — 메시지 보내기가 이것이다.
        press_key: () => mcp.call('press_key', { key: String(요청?.값 ?? ''), ...짚기(), ...전달() }),
        // `cmd+s` 처럼 앱마다 있는 표준 길.
        hotkey: () => mcp.call('hotkey', { keys: String(요청?.값 ?? ''), ...전달() }),
        // **앱 메뉴가 가장 안정적인 조작 경로다** — 좌표도 토큰도 안 낡는다.
        menu: () => mcp.call('invoke_menu', {
          path: Array.isArray(요청?.값) ? 요청.값 : String(요청?.값 ?? '').split('>').map((x) => x.trim()),
          ...전달(),
        }),
        copy: () => mcp.call('clipboard_read', { include_text: true }),
        paste: () => mcp.call('clipboard_write', { text: String(요청?.값 ?? '') }),
        wait: async () => {
          const 초 = Math.min(Math.max(Number(요청?.값) || 1, 0), 30);
          await new Promise((z) => { setTimeout(z, 초 * 1000); });
          return { ok: true, waited_s: 초 };
        },
        set_value: () => mcp.call('set_value', {
          ...(대상.토큰 ? { element_token: 대상.토큰 } : {}), value: String(요청?.값 ?? ''),
          ...(대상.스냅샷 ? { snapshot_id: 대상.스냅샷 } : {}),
        }),
      };
      const 부르기 = 표[행동];
      if (!부르기) throw new Error('그 행동은 이 드라이버가 안 받는다');
      const 낸것 = await 부르기();
      // **한 자리에서 가른다.** 손마다 따로 막다가 `click` 에서 또 샜다(라이브 2026-08-05).
      // **읽는 자리는 하나다**(계열 B) — `desktop-driver-answer.js`.
      if (거절인가(낸것)) throw new Error(거절사유(낸것));
      return 낸것;
    },
  };
}

/** 요소의 가운데 좌표 — cua 의 `click` 은 좌표를 받는다(요소 id 가 아니다). */
function 가운데(b = {}) {
  const x = Number(b.x ?? 0); const y = Number(b.y ?? 0);
  const w = Number(b.w ?? b.width ?? 0); const h = Number(b.h ?? b.height ?? 0);
  return { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
}
