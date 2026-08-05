// L3 · **화면 손 (CU A)** — `desktop.status` · `desktop.observe` 를 한 손으로 낸다.
//
// ── A 의 첫 계약: 조용한 0 을 "창이 없네요"로 답하지 않는다 ────────────────
//
// 밟은 사실(2026-08-05, 서명한 탐침을 직접 돌림):
// ```
// 권한(실제 probe)   화면 기록 false · 손쉬운 사용 false · 이벤트 전송 false
// 앞 앱              Google Chrome · com.google.Chrome · pid 72904   ← 권한 0으로 나온다
// 창 목록            0개                                             ← 여기서 막힌다
// ```
// **권한이 없을 때 창 목록은 예외가 아니라 빈 배열로 온다.** 그대로 결과로 쓰면
// *"창이 없네요"* 가 나가고, 그건 없는 사실을 지어내는 것이다. 파일·검색에서 이미 여러 번
// 밟은 병인데(조용한 0) GUI 는 훨씬 흔하다 — 권한·잠금·전환 중에 늘 빈다.
//
// **그래서 커널이 내용을 보고 판정하지 않는다.** 드라이버가 `status` 로 권한을 밝히고,
// 손은 그 사실을 읽어 *못 본 것*과 *볼 게 없는 것*을 가른다(심문 금지 · 손이 스스로 밝힌다).
//
// 도구를 넷으로 안 풀고 한 손의 `action` 으로 표현한다(정본 §4.1) — 매 콜 비용이 손 수에
// 비례하고(불변식 B), status/observe 는 같은 대상·같은 권한·같은 영수증 계약을 지난다.

/** 권한 값이 "됐다"인가. 모르는 값은 **안 된 쪽으로** 본다(모름은 자동이 아니라 확인 쪽이다). */
const 허용됨 = (v) => v === 'granted' || v === true;

/** 사용자가 볼 문장. 어느 권한이 왜 막혔는지는 사실이므로 숨기지 않는다. */
function 못보는이유(권한 = {}) {
  const 없는것 = [];
  if (!허용됨(권한.accessibility)) 없는것.push('손쉬운 사용');
  if (!허용됨(권한.screenRecording)) 없는것.push('화면 기록');
  return 없는것.length
    ? `창을 보려면 ${없는것.join('·')} 권한이 필요해요. 아직 허용되지 않았어요.`
    : '지금은 창을 볼 수 없어요.';
}

/**
 * @param {{drivers?:Array<object>}} deps 화면 슬롯에서 온 드라이버 목록
 */
export function makeDesktopTool(deps = {}) {
  const drivers = Array.isArray(deps.drivers) ? deps.drivers : [];
  return {
    // 읽기만 한다. 출처 원장 계약은 안 건다 — 웹 페이지가 아니라 이 컴퓨터의 현재 상태다.
    sourceLedgerRequired: false,
    async handler(args) {
      const 드라이버 = drivers[0];
      if (!드라이버) {
        // **"창이 없다"가 아니라 "볼 수 없다"다.** 백엔드가 없는 것은 이 컴퓨터의 사실이고,
        // 그걸 창의 사실로 옮기면 없는 것을 지어내는 것이다.
        return {
          blocked: true,
          userSafeSummary: '이 컴퓨터에서는 화면을 볼 수 있는 준비가 아직 안 됐어요.',
          nextSafeAction: '화면 보기를 켜면 지금 떠 있는 창을 알려드릴 수 있어요.',
          다음수단: [{ 방법: 'install_backend', 왜: '화면 관찰 백엔드가 아직 없다' }],
        };
      }

      const 상태 = await 드라이버.status();
      const 권한 = 상태?.permissions ?? {};

      // `status` 는 **권한이 없어도 막지 않는다.** 상태 조회까지 막으면 왜 막혔는지도 못 말한다.
      if (args?.action === 'status') {
        // 권한 없이도 되는 것(앞 앱)은 함께 준다 — 아는 것보다 덜 말하지 않는다.
        let 앞 = 상태?.frontmost;
        if (!앞) { try { 앞 = (await 드라이버.observe({ scope: 'app' }))?.frontmost; } catch { 앞 = undefined; } }
        return {
          result: { ...상태, ...(앞 ? { frontmost: 앞 } : {}) },
          userSafeSummary: 허용됨(권한.accessibility) && 허용됨(권한.screenRecording)
            ? '화면을 볼 준비가 돼 있어요.'
            : 못보는이유(권한),
        };
      }

      const 본것 = await 드라이버.observe(args ?? {});

      // ── 여기가 갈리는 자리다 ──────────────────────────────────────────
      // 권한이 없으면 **목록을 결과로 내지 않는다**(빈 배열도 목록이다).
      // 앞 앱은 권한 없이도 나오므로 그건 준다 — 못 본 것만 못 봤다고 한다.
      if (!허용됨(권한.accessibility) || !허용됨(권한.screenRecording)) {
        return {
          blocked: true,
          권한,
          ...(본것?.frontmost ? { frontmost: 본것.frontmost } : {}),
          userSafeSummary: 못보는이유(권한),
          nextSafeAction: '시스템 설정에서 한 번 허용해 주시면 그다음부터는 안 여쭤봐요.',
          // **이미 허용된 권한을 다시 내밀지 않는다.** 라이브에서 손쉬운 사용이 `granted` 인데도
          // 둘 다 내밀고 있었다 — 사용자는 이미 준 것을 또 주러 가고, 무엇이 진짜 막힌 건지
          // 흐려진다. 없는 사실을 지어내지 않는 규칙은 **다음 수단에도 똑같이 선다.**
          다음수단: [
            ...(허용됨(권한.accessibility) ? [] : [{ 방법: 'grant_permission', 무엇: 'accessibility', 왜: '창 목록과 요소를 읽으려면 필요하다' }]),
            ...(허용됨(권한.screenRecording) ? [] : [{ 방법: 'grant_permission', 무엇: 'screen_recording', 왜: '창 제목과 화면을 읽으려면 필요하다' }]),
          ],
        };
      }

      // 권한이 있으면 **0 은 진짜 0 이다.** 그런데 그 0 이 왜 믿을 만한지를 함께 준다 —
      // 안 주면 다음 사람이(그리고 모델이) 이 0 을 또 의심하게 된다.
      return {
        result: { ...본것, windows: 본것?.windows ?? [], 권한확인됨: true },
        userSafeSummary: (본것?.windows?.length ?? 0) > 0
          ? `지금 ${본것.frontmost?.name ?? '앞 앱'} 창 ${본것.windows.length}개가 떠 있어요.`
          : '권한은 있는데 열려 있는 창이 없어요.',
      };
    },
  };
}
