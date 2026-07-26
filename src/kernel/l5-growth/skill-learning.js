// L5 · SkillCandidate Lifecycle (P6-17 Slice-2). TaskTrace→PatternCandidate→Replay 흐름(§6.10 DefaultTarget)을
// **명시적 상태 기계**로 일반화한다. 절대 경계(헌법·auto-memory, broad memory narrow influence):
//   - **스킬은 자동 실행 권한이 없다.** 추천(candidate)은 실행이 아니다. 외부 행동은 그대로 AuthorityGrant(A2).
//   - **replay 통과 + 사용자 확인 전에는 영향 0.** admitted 되기 전 어떤 candidate도 라우터·계획에 영향 없음.
//   - **"추천" ≠ "설치/승격".** 발견·제안은 관찰이고, 승격(admitted)만 영향 자격을 준다. replay 실패는 rejected.
//
// 상태: detected → candidate → replay_required → approved → admitted | rejected.
//   detected  : 반복 신호에서 막 발견됨(관찰만).
//   candidate : 사용자에게 추천으로 표면화됨(실행 아님, 영향 0).
//   replay_required : 사용자가 관심을 보여 replay 검증이 필요함.
//   approved  : 사용자 확인 + replay 통과(승격 직전).
//   admitted  : 활성 스킬 — 영향 가능. **단, 자동 실행 아님(외부 행동은 여전히 A2).**
//   rejected  : 사용자 거절 또는 replay 실패 — 영향 0 영구.

export const SKILL_STATES = Object.freeze(['detected', 'candidate', 'replay_required', 'approved', 'admitted', 'rejected']);

/** 스킬 후보 생성(state='detected', 영향 0). steps/trigger는 관찰된 반복 작업(사용자 언어). */
export function makeSkillCandidate(p) {
  return {
    id: p.id,
    state: 'detected',
    label: p.label ?? (p.tool ? `${p.tool} 반복 작업` : '반복 작업'),
    trigger: p.trigger ?? '',          // 어떤 발화/신호에서 반복이 감지됐나
    steps: p.steps ?? [],              // 반복된 작업 단계(사용자 언어)
    tool: p.tool ?? null,              // 주 도구(외부 전송이면 실행 시 A2 상속 — 스킬이 우회 못 함)
    fromTraceIds: p.fromTraceIds ?? [],
    userConfirmed: false,
    replayPassed: false,
    rejectedReason: null,
    createdAt: p.now ?? 0,
  };
}

/**
 * 반복 TaskTrace에서 스킬 후보를 감지한다(자동 승격 아님 — detected 상태만). 같은 도구가 2회 이상
 * 반복되면 반복 작업 신호로 본다. 결정적(모델 아님). 없으면 null.
 * @param {Array<{id:string,tool:string|null,requestText:string}>} traces
 * @param {{id:string, now?:number}} [opts]
 */
export function detectSkillCandidate(traces, opts = {}) {
  const byTool = new Map();
  for (const t of traces ?? []) {
    if (!t?.tool) continue;
    const arr = byTool.get(t.tool) ?? [];
    arr.push(t);
    byTool.set(t.tool, arr);
  }
  let best = null;
  for (const [tool, arr] of byTool) {
    if (arr.length >= 2 && (!best || arr.length > best.arr.length)) best = { tool, arr };
  }
  if (!best) return null;
  const steps = [...new Set(best.arr.map((t) => t.requestText).filter(Boolean))];
  return makeSkillCandidate({
    id: opts.id,
    tool: best.tool,
    trigger: best.arr[0].requestText ?? '',
    steps,
    fromTraceIds: best.arr.map((t) => t.id),
    now: opts.now,
  });
}

// ── 상태 전이(순수). 잘못된 상태에서의 전이는 안전한 no-op 또는 {ok:false}. ──

/** 추천으로 표면화(detected → candidate). 추천은 실행이 아니다 — 영향 0 유지. */
export function surfaceCandidate(sk) {
  if (sk.state !== 'detected') return sk;
  return { ...sk, state: 'candidate' };
}

/** 사용자가 관심을 보임(candidate → replay_required). replay 없이는 다음으로 못 간다. */
export function markReplayRequired(sk) {
  if (sk.state !== 'candidate') return sk;
  return { ...sk, state: 'replay_required' };
}

/**
 * ReplayCase — 승격 전 **기본 구조 확인**(실제 실행이 아님). 트리거·단계가 형식상 온전한가만 결정적으로 본다.
 * 통과해야 승격(approved)으로 갈 수 있다. 통과가 곧 실행 권한은 아니다.
 * @returns {{ok:boolean, reason?:string}}
 */
export function replaySkill(sk) {
  if (!sk || !String(sk.trigger ?? '').trim()) return { ok: false, reason: '트리거가 비어 있어요.' };
  if (!Array.isArray(sk.steps) || sk.steps.length === 0) return { ok: false, reason: '단계가 비어 있어요.' };
  if (sk.steps.some((s) => !String(s ?? '').trim())) return { ok: false, reason: '빈 단계가 있어요.' };
  return { ok: true };
}

/**
 * 승격 승인(replay_required → approved). **사용자 확인 + replay 통과 둘 다** 있어야 한다.
 * replay 실패면 rejected로 떨어뜨린다(영향 0). 코드가 게이트를 강제한다.
 * @param {object} sk
 * @param {{userConfirmed?:boolean, replayResult?:{ok:boolean,reason?:string}}} approval
 * @returns {{ok:boolean, sk:object, reason?:string}}
 */
export function approveSkill(sk, approval = {}) {
  if (sk.state !== 'replay_required') return { ok: false, sk, reason: 'not_ready' };
  if (!approval.userConfirmed) return { ok: false, sk, reason: 'needs_user_confirm' };
  if (!approval.replayResult?.ok) {
    return { ok: false, sk: rejectSkill(sk, `replay_failed:${approval.replayResult?.reason ?? ''}`), reason: 'replay_failed' };
  }
  return { ok: true, sk: { ...sk, state: 'approved', userConfirmed: true, replayPassed: true } };
}

/** 승격 확정(approved → admitted). 활성 스킬 — 영향 가능하되 자동 실행 아님. */
export function admitSkill(sk) {
  if (sk.state !== 'approved') return { ok: false, sk, reason: 'not_approved' };
  return { ok: true, sk: { ...sk, state: 'admitted' } };
}

/** 거절/실패(→ rejected). 어느 비종료 상태에서도 가능. 영향 0 영구. */
export function rejectSkill(sk, reason = 'rejected') {
  return { ...sk, state: 'rejected', rejectedReason: reason };
}

// ── 영향/권한 게이트(소비 지점) ──

/** 이 스킬이 행동(계획·추천)에 영향을 줄 자격이 있는가. **admitted + 확인 + replay 통과만.** */
export function canInfluence(sk) {
  return sk?.state === 'admitted' && sk?.userConfirmed === true && sk?.replayPassed === true;
}

/** 스킬이 **스스로 외부 행동을 자동 실행**할 수 있는가 → 언제나 false. 외부 행동은 항상 AuthorityGrant(A2). */
export function canAutoExecute() {
  return false;
}

// ── 소비 지점: 승격된 스킬이 실제로 대화를 바꾼다 (Phase 0-4) ──
//
// 이전까지 canInfluence 는 **화면 표시에만** 쓰였다. 감지→후보→replay→승인→admitted 를 다 거쳐도
// 대화는 그대로였다 — 상태 기계만 있고 효과가 없었다. 계획서 v3.0 Phase 7 이 규정한 효과는
// "다음 같은 요청에서 **질문이 줄어든다**"이다. 여기가 그 지점이다.
//
// 경계(불변): 스킬은 **영향만** 준다. 외부 행동은 여전히 AuthorityGrant(A2)를 받는다 —
// canAutoExecute() 는 계속 false 다. 스킬이 승인 게이트를 우회하지 못한다.

/** 발화가 이 스킬의 트리거와 맞는가(보수적 — 애매하면 안 맞다고 본다). */
function triggerMatches(trigger, text) {
  const t = String(text ?? '').trim();
  const trig = String(trigger ?? '').trim();
  if (!t || trig.length < 2) return false;
  if (t.includes(trig) || trig.includes(t)) return true;
  // 트리거의 핵심 낱말이 충분히 겹치면 같은 일로 본다.
  const words = trig.split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return false;
  const hit = words.filter((w) => t.includes(w)).length;
  return hit / words.length >= 0.6;
}

/**
 * 이번 발화에 쓸 수 있는 승격된 스킬을 찾는다. **admitted + 확인 + replay 통과만**(canInfluence).
 * @param {Array<Object>} skills @param {string} text
 * @returns {Object|null}
 */
export function applicableSkill(skills, text) {
  return (skills ?? []).find((sk) => canInfluence(sk) && triggerMatches(sk.trigger, text)) ?? null;
}

/**
 * 스킬이 계획에 주는 영향(사실만). 도구를 정해 주므로 "무엇으로 할까요"를 다시 묻지 않는다.
 * 실행 권한은 건드리지 않는다 — tool 이 외부 전송이면 그대로 A2 를 받는다.
 * @param {Object|null} sk
 */
export function skillInfluence(sk) {
  if (!sk || !canInfluence(sk)) return null;
  return {
    skillId: sk.id,
    label: sk.label,
    tool: sk.tool ?? null,          // 계획이 쓸 도구(승인 경계는 도구 종류가 정한다)
    steps: sk.steps ?? [],          // 모델에게 줄 "지난번엔 이렇게 했다" 사실
  };
}
