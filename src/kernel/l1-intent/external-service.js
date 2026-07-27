// L1 · 외부 자료에 닿는 현실 (P5-B-0.5)
//
// 오너 지시(2026-07-27, 원문):
//   "사용자가 외부 서비스 연결 의도를 말하면, T5는 미연결 상태를 막다른 길로 답하지 않고,
//    현재 가능한 연결 경로를 확인하고, 사용자 상황에 맞는 가장 자연스러운 방법으로 연결을 돕는다."
//
// **말귀를 intent 분류기로 축소하지 않는다**(오너 지시). 처음 만든 판은 "노션·구글 키워드면
// 브라우저를 제안" 이었다. 그건 두 번 틀린다:
//   · 목록에 없는 서비스(드롭박스·카페24·잔디)에는 아무 현실도 안 준다 → 또 막다른 답
//   · 같은 단어라도 의도가 다르다("구글에 연결하고 싶어" vs "어제 구글에서 본 기사")
//     — 그 판단은 모델이 할 일이지 정규식이 할 일이 아니다.
//
// 그래서 **판정하지 않고 현실만 공급한다**:
//   ① 지금 이 손들로 외부 자료에 닿는 길이 무엇인가   (서비스와 무관하다 — 웹으로 사는 건 다 같다)
//   ② 선언된 서비스들의 연결 상태는 어떤가             (연결됨 / 연결하면 가능 / 준비 중)
// 어느 서비스 얘기인지, 한 번만 볼 건지 계속 쓸 건지, 어느 길이 자연스러운지는 **모델이 고른다.**
//
// 라이브 실측(2026-07-27)이 왜 필요한지 보여줬다. "너 내 노션 볼 수 있어?" 에 T5 가
//   "…비공개 노션은 내가 임의로 들어가서 볼 수 없어. **내용을 복사해서 붙여주면**…"
// 이라고 답했다. 그때 `browser.observe` 는 **실행 가능**이었다 — 사용자가 이미 로그인해 둔
// 화면을 열면 되는데 복붙을 시켰다. 금지문이 부족해서가 아니라 **현실이 없어서**다.

/**
 * **지금 있는 손으로 외부 자료에 닿는 길.** 서비스별로 다르지 않다 — 그래서 커넥터가 늘어도
 * 여기는 안 바뀌고, 목록에 없는 서비스에도 그대로 쓸 수 있다.
 *
 * "복사해서 붙여주세요"는 **이 목록이 전부 비었을 때만** 남는 최후의 수단이다.
 * @param {{connectedTools?:Array}} selfState
 * @returns {string[]} 사용자 말로 된 경로들
 */
export function reachingHands(selfState = {}) {
  // **경로 문장을 쓰지 않는다.** 처음엔 "브라우저로 그 화면을 열어서 볼 수 있다(로그인해 둔
  // 화면이면 그대로 보인다)" 같은 문장을 줬는데, 라이브 답변 네 줄이 그 목록과 거의 1:1 이었다 —
  // 모델이 판단한 게 아니라 **내 목록을 번역한 것**이다. 그게 템플릿이고, 오너가 금지한 것이다.
  //
  // 그래서 **사실만** 남긴다: 내 손이 아닌 곳의 자료에도 닿을 수 있는 손이 무엇인가.
  // 각 손이 무엇을 하는지는 이미 능력 문장(readyTools)이 말한다 — 여기서 또 설명하지 않는다.
  // 어떻게 쓸지, 어느 순서로 갈지는 모델이 정한다.
  const 밖으로닿는손 = ['browser.observe', 'browser.act', 'web.collect', 'local.terminal', 'local.locate', 'local.file'];
  return (selfState.connectedTools ?? [])
    .filter((t) => t.executable && 밖으로닿는손.includes(t.id))
    .map((t) => {
      // **선언된 한계는 이름과 함께 다닌다.** fast_chat 턴엔 능력 문장이 안 실려서, 이름만 보면
      // 모델이 빈 자리를 상상으로 메운다(실측: "로그인돼 있으면 볼 수 있다" — 거짓). 다른 손이
      // 덮는 한계(coveredBy)는 여기 안 싣는다 — 그건 그 손이 말한다.
      const 한계 = (t.limits ?? []).find((l) => !l.coveredBy)?.says;
      return {
        label: t.label ?? t.id,
        ...(t.operatorFact ? { operation: t.operatorFact } : {}),
        ...(한계 ? { limit: 한계 } : {}),
      };
    });
}

/**
 * 선언된 서비스들의 **연결 상태 표.** 어느 서비스 얘기인지 우리가 맞히지 않는다 — 표를 주고
 * 모델이 고르게 한다. 사용자가 부르는 말(별칭)도 함께 줘야 모델이 이름을 맞출 수 있다.
 * @param {Array} connectors @param {{connectedTools?:Array}} selfState
 */
export function serviceStatus(connectors = [], selfState = {}) {
  return connectors.map((c) => {
    const 도구들 = (selfState.connectedTools ?? []).filter((t) => t.connector === c.id);
    const connected = 도구들.some((t) => t.executable);
    return {
      label: c.label ?? c.id,
      aliases: c.aliases ?? [],
      connected,
      // P5-B-1A: 이 컴퓨터에서 **직접 확인한** 흔적. 결과가 없으면 필드도 없다 —
      // 확인 안 한 것을 확인했다고 말하지 않기 위해서다(시각이 그 근거다).
      ...(c.localSignsResult?.length ? { localSigns: c.localSignsResult, lastCheckedAt: c.lastCheckedAt } : {}),
      ...(connected ? {} : (() => {
        const reason = 도구들[0]?.reason ?? (c.connected ? 'error' : 'needs_connection');
        // **연결 흐름이 없는데 "연결하면 가능"이라고 말하게 하지 않는다**(오너 금지).
        // planned = 손도 연결 흐름도 없는 상태다. connectable = 연결하면 실제로 된다.
        // 이 구분이 문구에서 사라지면 T5 가 못 지킬 약속을 하게 된다(§16-B).
        const 연결가능 = reason !== 'planned';
        return {
          reason,
          connectable: 연결가능,
          jobsWhenConnected: 연결가능 ? (c.userJobs ?? []) : [],
          plannedJobs: 연결가능 ? [] : (c.userJobs ?? []),
          ...(연결가능 && c.setupGuide ? { setupGuide: c.setupGuide } : {}),
        };
      })()),
    };
  });
}

/**
 * 한 서비스의 **연결 경로들.** 오너 지시(2026-07-28): 모델이 판단할 수 있으려면 판단할 현실이
 * 있어야 한다 — 판단을 대신 하는 규칙이 아니라.
 *
 * **전부 선언에서 파생한다.** 어느 길이 나은지, 무엇을 골라야 하는지는 여기서 정하지 않는다.
 * 사실만 준다: 이 방식이 무엇이고 · T5 가 실행할 수 있는지 · 사용자가 해야 할 일이 무엇인지.
 *
 * @param {object} c 커넥터 선언
 * @param {{executableKinds?:string[]}} p 이 런타임이 실행할 수 있는 방식(런타임에서 온다 — 여기서 짐작하지 않는다)
 * @returns {Array<{kind:string, executable:boolean, userAction:string, needs?:string[]}>}
 */
export function connectionPaths(c = {}, { executableKinds = [] } = {}) {
  const 됨 = new Set(executableKinds);
  const 흔적 = new Map((c.localSignsResult ?? []).map((s) => [s.kind ?? s.label, s]));
  return (c.authMethods ?? []).map((m) => {
    const executable = 됨.has(m.kind);
    // **사용자가 해야 하는 최소 행동.** 선언에서 나온다 — 서비스 이름으로 갈라지지 않는다.
    let userAction = 'none';
    let needs;
    if (!executable) userAction = 'unavailable';
    else if (m.kind === 'api_key') {
      userAction = 'secret_input';
      needs = (m.fields ?? []).map((f) => f.label ?? f.name);
    } else if (m.kind === 'mcp' && m.url) {
      // 원격은 로그인 동의가 붙는다. 이미 붙어 있으면 사용자가 할 일은 없다.
      userAction = c.connected ? 'none' : 'consent_once';
    } else if (m.kind === 'cli') {
      // 이 컴퓨터에서 이미 확인한 것이 있으면 그 사실을 쓴다(짐작하지 않는다).
      const 본것 = 흔적.get('cli');
      userAction = 본것 && 본것.found === false ? 'install' : 'none';
    }
    return {
      kind: m.kind,
      executable,
      userAction,
      ...(needs?.length ? { needs } : {}),
      ...(m.command ? { command: m.command } : {}),
    };
  });
}

/**
 * 모델 앞에 놓을 외부 현실. **판정이 아니라 사실이다** — 어느 서비스인지, 어느 길이 맞는지는
 * 여기서 정하지 않는다.
 * @param {{connectors?:Array, selfState?:object, executableKinds?:string[]}} p
 * @returns {{reach:string[], services:Array}|undefined} 줄 것이 없으면 undefined(빈 블록 금지)
 */
export function externalReality({ connectors = [], selfState = {}, executableKinds = [] } = {}) {
  const reach = reachingHands(selfState);
  const services = serviceStatus(connectors, selfState).map((s, i) => {
    const paths = connectionPaths(connectors[i], { executableKinds });
    return paths.length ? { ...s, paths } : s;
  });
  if (!reach.length && !services.length) return undefined;
  return { reach, services };
}
