// 표면 · 진행 중인 턴의 계측 장부 (HRT-ST-001 두 번째 추출)
//
// 왜 파일이 따로 있나: 이 36줄은 `makeServer` 안에 있었지만 **바깥에서 아무것도 안 쓴다** —
// store 도 model 도 env 도 만지지 않는 순수한 덩어리였다. 그런데 살아 있는 표(Map)와
// `let` 하나를 들고 있어서 라우트 사이를 그냥 떠다녔고, 계측과 무관한 다듬기가 같은 파일을
// 건드릴 때마다 함께 흔들렸다.
//
// 이 추출은 **행동 보존**이다. 계측값도, 저장 형식도, 사건 이름도 바꾸지 않는다.
// 옮기면서 두 자리만 형태가 바뀌었고 둘 다 "가변 상태를 파일 밖으로 내보내려면 함수여야
// 한다"는 같은 이유다:
//   · `processHasMeasuredTurn` (let)          → `nextProcessWarmth()`   읽고 곧바로 세우는 두 줄이었다
//   · `cleanExpiredTimings()` + `.get()`      → `find()`                늘 붙어 다니던 두 줄이었다
//
// **여기 원문·답변·도구 인자는 들어오지 않는다.** 계측기는 시간과 종류만 안다.

/** 계측 항목의 수명. 완료 뒤에도 화면 투영 보고를 받을 만큼만 보존한다. */
const 기본만료ms = 10 * 60_000;

export function makeTurnTimingRegistry({ expiresMs = 기본만료ms } = {}) {
  // P90-2: 브라우저 표시 보고는 서버 사실과 다른 단조 시계를 쓴다. 살아 있는 계측기와 결합하되
  // 원문·답변·도구 인자는 이 표에 들어오지 않는다.
  const activeTurnTimings = new Map();
  let processHasMeasuredTurn = false;

  const timingPathKind = (toolId) => {
    if (toolId === 'agent.delegate' || String(toolId).startsWith('agent.')) return 'agent';
    if (String(toolId).startsWith('local.')) return 'local';
    if (String(toolId).startsWith('web.') || String(toolId).startsWith('browser.')) return 'web';
    return 'unknown';
  };
  const timingPathClass = (kinds) => {
    const known = [...kinds].filter((kind) => kind !== 'unknown');
    if (!known.length) return kinds.size ? 'unknown' : 'chat';
    return new Set(known).size === 1 && !kinds.has('unknown') ? known[0] : 'mixed';
  };
  const withTimingEntry = (entry, task) => {
    const run = entry.queue.catch(() => {}).then(task);
    entry.queue = run.catch(() => {});
    return run;
  };
  const observeTiming = (entry, task) => {
    if (!entry || entry.failed) return undefined;
    try { return task(); }
    catch (error) {
      entry.failed = true;
      console.error('[turn-timing:diagnostic]', error?.message ?? error);
      return undefined;
    }
  };
  const cleanExpiredTimings = () => {
    const now = Date.now();
    for (const [id, entry] of activeTurnTimings) {
      if (entry.expiresAt < now) activeTurnTimings.delete(id);
    }
  };

  return {
    /**
     * 이 프로세스에서 턴을 처음 재는가(cold) 아닌가(warm).
     * 읽는 순간 세운다 — 예전에도 두 줄이 붙어 있었고, 그 사이에 다른 일이 낀 적이 없다.
     */
    nextProcessWarmth() {
      const warmth = processHasMeasuredTurn ? 'warm' : 'cold';
      processHasMeasuredTurn = true;
      return warmth;
    },
    /** 진행 중인 턴 하나를 장부에 올린다. 항목 모양은 옮기기 전과 같다. */
    open(measurementId, { timing, processWarmth, sessionWarmth }) {
      const entry = {
        timing,
        pathKinds: new Set(),
        processWarmth,
        sessionWarmth,
        expiresAt: Date.now() + expiresMs,
        persisted: false,
        failed: false,
        queue: Promise.resolve(),
      };
      activeTurnTimings.set(measurementId, entry);
      return entry;
    },
    /** 만료된 것을 걷어낸 뒤 찾는다 — 두 줄이 늘 붙어 있었으므로 하나로 둔다. */
    find(measurementId) {
      cleanExpiredTimings();
      return activeTurnTimings.get(measurementId);
    },
    timingPathKind,
    timingPathClass,
    withTimingEntry,
    observeTiming,
  };
}
