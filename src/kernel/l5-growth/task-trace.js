// L5 · Learning-to-Workflow Promotion (P6-11). 한 번 수행한 작업을 기록(TaskTrace)하고, 반복 가능성이
// 있으면 후보(PatternCandidate)로 제안한 뒤, 사용자 승인 + replay(ReplayCase)를 거쳐 승격한다.
// 절대 경계(헌법·auto-memory): **broad memory, narrow influence** — 넓게 관찰·기록하되, 행동에 영향을 주는
//   건 승인·replay 통과한 좁은 것만. "배워간다" 느끼되 "멋대로 한다"는 안 된다. 권한 승인(A2)은 우회하지 않는다.
// 첫 슬라이스: DefaultTarget(같은 대상으로 반복 전송 → 다음부터 대상 확인 질문 축소). skill/blueprint/profile은 후속.

export const PROMOTION_TYPES = Object.freeze(['default_target', 'skill', 'automation_blueprint', 'profile_rule']);
const HUMAN_TARGET = /^#[\w가-힣_-]+$|^[\w.+-]+@[\w-]+\.[\w.-]+$|^[가-힣A-Za-z][\w가-힣_ -]{0,30}$/;

/** 한 번 수행한 작업 기록(넓게 관찰). 영향은 아직 0 — 승격돼야 행동에 반영된다. */
export function makeTaskTrace(p) {
  return {
    id: p.id,
    requestText: p.requestText ?? '',
    tool: p.tool ?? null,
    target: p.target ?? null,
    targetLabel: p.targetLabel ?? null,
    outcome: p.outcome ?? 'done',
    createdAt: p.now ?? 0,
  };
}

/**
 * DefaultTarget 후보 제안(자동 승격 아님 — 후보만). send가 대상과 함께 완료됐고, 아직 그 도구의 기본이
 * 없을 때. 반복 가능성 신호는 "대상을 명시해 보냈다"이다.
 * @param {{tool:string, target:string, promoted?:object[], proposed?:object[]}} s
 * @returns {{kind:'default_target', tool:string, target:string}|null}
 */
export function proposeDefaultTarget(s) {
  if (!s?.tool || !s?.target) return null;
  const already = (s.promoted ?? []).some((p) => p.kind === 'default_target' && p.tool === s.tool);
  if (already) return null; // 이미 기본이 있으면 다시 제안하지 않는다
  const pending = (s.proposed ?? []).some((p) => p.tool === s.tool && p.target === s.target);
  if (pending) return null;
  // scope를 명시한다(숨은 전역 영향 금지). 이 슬라이스는 global만 도달 — project/profile scope는 후속.
  return {
    kind: 'default_target',
    tool: s.tool,
    target: s.target,
    targetLabel: s.targetLabel ?? null,
    scope: 'global',
  };
}

/**
 * ReplayCase — 승격 전 **기본 형식 확인**(실제 채널 존재 검증이 아님, 그건 후속). 대상이 대상 형태
 * (#채널/이메일/이름)인가만 결정적으로 본다. 통과해야 행동에 영향을 준다.
 * @returns {{ok:boolean, reason?:string}}
 */
export function replayDefaultTarget(pattern) {
  const t = String(pattern?.targetLabel ?? pattern?.target ?? '').trim();
  if (!t) return { ok: false, reason: '대상이 비어 있어요.' };
  const valid = HUMAN_TARGET.test(t);
  return valid ? { ok: true } : { ok: false, reason: '대상 형식이 유효하지 않아요.' };
}

/** 승격(순수). replay 통과분만 호출한다. scope를 함께 보존한다(숨은 전역 영향 금지). */
export function promoteDefaultTarget(pattern, now = 0) {
  return {
    kind: 'default_target',
    tool: pattern.tool,
    target: pattern.target,
    targetLabel: pattern.targetLabel ?? null,
    scope: pattern.scope ?? 'global',
    promotedAt: now,
  };
}

/**
 * 기본 대상의 사용자 표면 투영. 실행 값과 라벨이 다르면 원시 실행 값은 내보내지 않는다.
 * 기존 사람말 대상(#채널·이메일·이름)은 호환을 위해 target도 그대로 제공한다.
 */
export function projectDefaultTarget(pattern) {
  const rawTarget = String(pattern?.target ?? '').trim();
  const targetLabel = pattern?.targetLabel
    ?? (HUMAN_TARGET.test(rawTarget) ? rawTarget : '확인된 대상');
  return {
    ...(pattern?.patternId ? { patternId: pattern.patternId } : {}),
    kind: pattern?.kind,
    tool: pattern?.tool,
    targetLabel,
    ...(targetLabel === pattern?.target ? { target: pattern.target } : {}),
    scope: pattern?.scope ?? 'global',
  };
}

/** 승격된 기본 대상 조회(좁은 영향의 소비 지점). 이 슬라이스는 global scope만 적용. 없으면 null. */
export function defaultTargetFor(promoted, tool) {
  const d = (promoted ?? []).find((p) => p.kind === 'default_target' && p.tool === tool && (p.scope ?? 'global') === 'global');
  return d?.target ?? null;
}
