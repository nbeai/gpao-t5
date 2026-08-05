// L3 · **화면 손 · 행동 (CU C)** — 첫 손. 눌렀는지가 아니라 **됐는지**로 판정한다.
//
// ── 왜 관찰 손과 나눠 두나 ──────────────────────────────────────────────
// `desktop.screen` 은 읽기(`read`)다. 행동은 아니다. 권한 종류는 **손 단위로 판정**되므로
// (`toolActionKind`), 한 손에 합치면 읽기와 행동이 같은 등급을 받는다 —
// 읽기가 행동 등급으로 올라가 카드가 늘거나, 행동이 읽기로 새거나 둘 중 하나다.
// 정본 §4.1 이 `observe` 와 `act` 를 나눈 이유가 그것이다.
//
// ── C 는 넷만 받는다 ────────────────────────────────────────────────────
// 계획 §5.1: 클릭·타이핑을 **일부러 뺐다.** 반대시험 A14(*"dispatch 성공, 화면 변화 없음
// → 성공 영수증 0"*)가 CU 에서 제일 어려운 요구인데 **화면은 대조 기준이 없다**
// (시계·애니메이션으로 늘 조금씩 변한다). 그런데 이 넷은 대조가 자명하다:
//
//     focus         frontmost 값
//     scroll        스크롤 위치
//     move·resize   창 좌표
//     launch·quit   프로세스 존재
//
// **가장 어려운 계약을 가장 쉬운 대상에서 먼저 세운다.** 여기서 A14 가 "전후 값 비교 한 줄"로
// 서면, D(클릭·입력)부터는 같은 계약을 어려운 대상에 적용하는 일이 된다.
//
// ── 정본 §7 의 다섯 상태 ────────────────────────────────────────────────
//   requested → resolved → dispatched → effect_observed → goal_verified
// **`dispatched` 만으로 성공을 만들지 않는다.** 이 파일의 전부가 그 한 줄이다.

/** C 가 받는 넷. 여기 없는 것은 **없다고 정직하게 말한다**(있는 척도 조용한 실패도 아니다). */
const 받는행동 = new Set(['focus', 'scroll', 'move', 'resize', 'launch', 'quit']);

/**
 * **무엇을 보면 됐는지 아나** — 행동마다 대조할 값이 다르다.
 *
 * 이 표가 C 의 알맹이다. 여기 없는 행동은 **대조할 값이 없다는 뜻**이고,
 * 대조할 값이 없으면 성공을 주장할 수 없다 — 그래서 애초에 안 받는다.
 */
const 대조할값 = {
  focus: (본것) => ({ frontmost: 본것?.frontmost?.name ?? null }),
  scroll: (본것) => ({ 스크롤: 본것?.scroll ?? null }),
  move: (본것) => ({ 창자리: JSON.stringify(본것?.windows?.[0]?.bounds ?? null) }),
  resize: (본것) => ({ 창자리: JSON.stringify(본것?.windows?.[0]?.bounds ?? null) }),
  launch: (본것) => ({ 앱들: (본것?.apps ?? []).length, frontmost: 본것?.frontmost?.name ?? null }),
  quit: (본것) => ({ 앱들: (본것?.apps ?? []).length, frontmost: 본것?.frontmost?.name ?? null }),
};

const 같은가 = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * **됐는가는 "바뀌었나"가 아니라 "목표 상태인가"다**(라이브 2026-08-05 에 잡음).
 *
 * 처음엔 전후가 같으면 무조건 실패로 냈다. 그러자 **이미 앞에 있는 크롬을 앞으로 띄워 달라**는
 * 요청에서 *"화면이 안 바뀌었어요"* 가 나갔다 — **됐는데 안 됐다고 한 것**이고,
 * 조용한 0 의 거울상을 오늘 두 번째로 밟은 것이다.
 *
 * 정본 §7 이 이미 적어 뒀다: *"변화가 없어도 정상인 행동은 사전에 정의된 verification
 * contract 로 확인한다."* 그러니 행동마다 **무엇이면 목표 도달인지**를 여기 적는다.
 * 목표 상태를 말할 수 없는 행동(스크롤·창 옮기기)만 **변화**로 판정한다 —
 * 거기서는 "얼마나"를 우리가 모르기 때문이다.
 *
 * @returns {true|false|null}  null = 목표를 정의할 수 없다(변화로 판정한다)
 */
function 목표도달(행동, args, 후) {
  const 대상 = String(args?.app ?? '').trim().toLowerCase();
  if (!대상) return null;
  const 앞 = String(후?.frontmost ?? '').toLowerCase();
  if (행동 === 'focus' || 행동 === 'launch') {
    // 이름이 딱 같지 않아도 된다 — 사용자는 "크롬"이라 하고 OS 는 "Google Chrome"이라 한다.
    return Boolean(앞) && (앞.includes(대상) || 대상.includes(앞));
  }
  if (행동 === 'quit') return !(앞.includes(대상) || 대상.includes(앞));
  return null;
}

/**
 * @param {{drivers?:Array<object>}} deps 화면 슬롯에서 온 드라이버 목록
 */
export function makeDesktopActTool(deps = {}) {
  const drivers = Array.isArray(deps.drivers) ? deps.drivers : [];
  return {
    sourceLedgerRequired: false,
    async handler(args) {
      const 드라이버 = drivers[0];
      if (!드라이버) {
        return {
          blocked: true,
          userSafeSummary: '이 컴퓨터에서는 화면을 다룰 준비가 안 됐어요.',
          다음수단: [{ 방법: 'install_backend', 왜: '화면 백엔드가 없다' }],
        };
      }

      const 행동 = String(args?.action ?? '').trim();
      if (!받는행동.has(행동)) {
        // **없는 것을 없다고 말한다.** 조용히 실패하면 모델은 "했는데 안 됐다"로 읽고,
        // 있는 척하면 못 지킬 약속이 된다.
        return {
          blocked: true,
          userSafeSummary: `그건 아직 못 해요 — 지금은 창을 앞으로 띄우거나, 내리거나, 옮기거나, 앱을 켜고 끄는 것까지예요.`,
          다음수단: [{ 방법: 'observe', 왜: '무엇이 있는지 먼저 본다' }],
        };
      }

      // ── A04 · 지문이 다르면 **부르지도 않는다** ─────────────────────────
      // 관찰과 실행 사이에 화면이 바뀌었을 수 있다. 그때 옛 신분으로 실행하면
      // **다른 것을 조작한다.** 값이 안 맞으면 실행 0 이고, 다시 보라고 한다.
      const 준지문 = args?.대상?.지문;
      const 확인지문 = args?.확인지문;
      if (준지문 && 확인지문 && 준지문 !== 확인지문) {
        return {
          blocked: true,
          userSafeSummary: '그 사이에 화면이 바뀌었어요. 안전을 위해 실행하지 않았어요.',
          다음수단: [{ 방법: 'observe', 왜: '지금 화면을 다시 보고 대상을 다시 고른다' }],
        };
      }

      const 재기 = 대조할값[행동];
      let 전;
      try { 전 = 재기(await 드라이버.observe({ scope: 'screen' })); } catch { 전 = null; }

      // ── dispatched ─────────────────────────────────────────────────────
      try {
        await 드라이버.act({ 행동, 대상: { app: args?.app, window: args?.window, ...(args?.대상 ?? {}) }, 값: args?.값 });
      } catch {
        // 내부 오류는 사용자면으로 안 보낸다(진단면 분리). 실패는 실패라고 한다.
        return {
          failed: true,
          userSafeSummary: '그 동작을 실행하지 못했어요.',
          진행: { 단계: 'resolved', 전 },
          다음수단: [{ 방법: 'observe', 왜: '지금 상태를 다시 본다' }],
        };
      }

      // ── effect_observed · 여기가 A14 다 ────────────────────────────────
      let 후;
      try { 후 = 재기(await 드라이버.observe({ scope: 'screen' })); } catch { 후 = null; }

      // **먼저 목표 도달을 본다.** 변화 여부는 그다음이다 —
      // 이미 목표 상태였으면 안 바뀐 것이 정상이고, 그걸 실패로 내면 됐는데 안 됐다고 하는 것이다.
      const 도달 = 후 === null ? null : 목표도달(행동, args, 후);
      if (도달 === false) {
        return {
          failed: true,
          userSafeSummary: '실행은 했는데 원하신 상태가 되지 않았어요.',
          진행: { 단계: 'dispatched', 전, 후 },
          다음수단: [
            { 방법: 'observe', 왜: '지금 실제 상태를 보고 다시 판단한다' },
            { 방법: 'retry', 왜: '앱이 뜨는 데 시간이 걸렸을 수 있다' },
          ],
        };
      }
      if (도달 === true) {
        return {
          result: {
            단계: 'goal_verified', 행동, 전, 후,
            확인방법: Object.keys(후).join('·'),
            // **안 바뀐 것도 사실이다.** 이미 그 상태였다는 것을 숨기면 모델이 자기가 바꾼 줄 안다.
            ...(같은가(전, 후) ? { 이미그상태였다: true } : {}),
          },
          userSafeSummary: 같은가(전, 후)
            ? `${후.frontmost ?? '그 앱'} 은(는) 이미 앞에 떠 있었어요.`
            : `${후.frontmost ?? '그 창'} 을(를) 앞으로 띄웠어요.`,
        };
      }

      // 목표 상태를 말할 수 없는 행동(스크롤·창 옮기기)만 **변화**로 판정한다.
      if (전 === null || 후 === null || 같은가(전, 후)) {
        // **부르긴 했는데 아무것도 안 바뀌었다.** 이걸 성공으로 세면 사용자는 됐다고 듣고
        // 실제로는 안 된 것이다 — 거짓 성공이고, CU 에서 가장 위험한 자리다.
        return {
          failed: true,
          userSafeSummary: 전 === null || 후 === null
            ? '실행은 했는데 그 결과를 확인하지 못했어요.'
            : '실행은 했는데 화면이 안 바뀌었어요.',
          // 어디까지 갔는지는 남긴다 — 조용히 사라지면 다음 수를 못 정한다.
          진행: { 단계: 'dispatched', 전, 후 },
          다음수단: [
            { 방법: 'observe', 왜: '지금 실제 상태를 보고 다시 판단한다' },
            { 방법: 'retry', 왜: '앱이 뜨는 데 시간이 걸렸을 수 있다' },
          ],
        };
      }

      // ── goal_verified ──────────────────────────────────────────────────
      return {
        result: {
          단계: 'goal_verified',
          행동,
          전, 후,
          // 무엇을 근거로 됐다고 하는지 함께 낸다 — 이게 없으면 다음 사람이 이 성공을 못 믿는다.
          확인방법: Object.keys(후).join('·'),
        },
        userSafeSummary: 행동 === 'focus'
          ? `${후.frontmost ?? '그 창'} 을(를) 앞으로 띄웠어요.`
          : '그렇게 했어요. 화면이 실제로 바뀐 것까지 확인했어요.',
      };
    },
  };
}
