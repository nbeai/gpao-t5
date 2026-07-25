// L2 · PersonalTool (2.0-C-1). 사용자가 채팅 흐름에서 준비하는 개인용 실행 수단.
// 최상위 기준(헌법): 사용자를 덜 헤매게 — 메뉴가 아니라 작업 흐름 안에서 준비하고 원래 작업으로 돌아온다.
// 핵심 경계(깊은 감사): 등록됨 ≠ 실행 가능. 실행 테스트를 통과하기 전에는 executable=false(사용 가능처럼
//   보이지 않는다). 실패하면 이유와 다음 안전 행동을 정직하게 남긴다. 죽은 버튼·가짜 성공 금지.
// 실제 외부 실행/OAuth는 후속 — 이 슬라이스는 준비 흐름(등록·상태·테스트 게이트·복귀)까지다.

export const PERSONAL_KINDS = Object.freeze(['script', 'web', 'api', 'mcp']);
export const TEST_STATES = Object.freeze(['untested', 'passed', 'failed']);

// 채팅에서 "이거 쓸 수 있게 준비해줘 / 추가·등록·연결해줘" 감지(일반 신호, 사례 하드코딩 아님).
const PREPARE_SIGNAL = /(쓸 ?수 ?있게|사용할 수 있게).*(준비|해줘)|(도구|이거|이것|이 기능).*(준비|추가|등록|연결)|(준비|추가|등록|연결)해\s*줘/;
// 종류 힌트(있으면 카드에 반영, 없으면 사용자에게 확인).
const KIND_HINT = [
  [/스크립트|script|파이썬|python|셸|bash/i, 'script'],
  [/웹|web|사이트|크롤|스크래핑|url/i, 'web'],
  [/api|엔드포인트|endpoint|웹훅|webhook/i, 'api'],
  [/mcp/i, 'mcp'],
];

/**
 * 개인 도구 준비 요청 감지 → 후보(자동 등록 아님).
 * @returns {{label:string, kind:string|null, requestText:string}|null}
 */
export function detectPersonalToolRequest(text) {
  const t = String(text ?? '').trim();
  if (!PREPARE_SIGNAL.test(t)) return null;
  let kind = null;
  for (const [re, k] of KIND_HINT) { if (re.test(t)) { kind = k; break; } }
  return { label: t.slice(0, 40), kind, requestText: t };
}

/**
 * 개인 도구 등록(테스트 전). executable=false로 시작한다.
 * @param {{id:string, label:string, kind?:string, config?:object, now?:number}} p
 */
export function definePersonalTool(p) {
  return {
    id: p.id,
    label: p.label ?? p.id,
    owner: 'personal',
    kind: PERSONAL_KINDS.includes(p.kind) ? p.kind : 'script',
    config: p.config ?? {},
    toolKind: p.kind === 'web' ? 'read' : p.kind === 'api' ? 'send' : 'organize',
    testState: 'untested',
    testError: null,
    createdAt: p.now ?? 0,
  };
}

// 종류별 최소 필수 설정(테스트 프로브가 검사). 없으면 실패 사유가 된다.
const REQUIRED_CONFIG = { script: 'path', web: 'url', api: 'endpoint', mcp: 'server' };

/**
 * 실행 테스트 프로브(이 슬라이스: 필수 설정 완비 검사 — 실제 외부 실행/OAuth는 후속).
 * 정직하게 pass/fail + 실패 사유·다음 안전 행동을 준다. 외부 부작용 없음.
 * @returns {{ok:boolean, reason?:string, nextSafeAction?:string}}
 */
export function runProbe(tool) {
  const need = REQUIRED_CONFIG[tool.kind];
  if (need && !tool.config?.[need]) {
    return {
      ok: false,
      reason: `${labelForKind(tool.kind)} 준비가 덜 됐어요(${need} 필요).`,
      nextSafeAction: `${need} 값을 채우면 다시 테스트할 수 있어요.`,
    };
  }
  return { ok: true };
}

function labelForKind(kind) {
  return { script: '스크립트', web: '웹 도구', api: 'API', mcp: '개인 MCP' }[kind] ?? '도구';
}

/** 테스트 결과를 상태에 반영(순수). 통과해야 executable이 된다. */
export function applyProbe(tool, probe, now = 0) {
  if (probe.ok) return { ...tool, testState: 'passed', testError: null, testedAt: now };
  return { ...tool, testState: 'failed', testError: { reason: probe.reason, nextSafeAction: probe.nextSafeAction }, testedAt: now };
}

/** 등록됨 ≠ 실행 가능: 테스트 통과분만 실행 가능. */
export function isPersonalExecutable(tool) {
  return tool.testState === 'passed';
}
