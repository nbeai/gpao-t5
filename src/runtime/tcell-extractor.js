// L3 · T-cell 추출기 (TG-3, 명세 §7·§8) — 모델은 가설을 제안하고, OS 가 검증·강제한다.
// 입력은 전체 대화가 아니라 제한된 EvidenceBundle(모델 가독 관찰만). 출력은 구조화 JSON 하나.
// insufficient_evidence 는 실패가 아니라 **정상 결과**다. 모델 실패·시간초과는 조용히
// 빈 결과로 — 기본 대화를 절대 막지 않는다. 정규식은 판단이 아니라 깨우기 신호로만 쓴다.
import { makeTCellCandidate, validateTCell } from '../kernel/l5-growth/tcell-core.js';

const BUNDLE_CAP = 30; // 관찰 상한 — 추출 입력이 대화 전체가 되지 않게

/** @returns {import('../kernel/l0-evidence/tcell-observation.js').ObservationEvent[]} 제한 묶음 */
export function buildEvidenceBundle({ id, activeTarget = '', observations = [], existingCandidates = [], tokenBudget = 4000 } = {}) {
  return {
    id: id ?? `bundle-${observations.length}`,
    activeTarget,
    // privacy: 모델 가독 관찰만, 최신 우선 상한(§7.3 — 원문 하강은 sourceRefs 로만).
    observations: observations.filter((o) => o?.privacy?.modelReadable === true).slice(-BUNDLE_CAP),
    existingCandidates: existingCandidates.map((c) => ({ id: c.id, statement: c.principle?.statement ?? '' })),
    authorityFacts: { note: '성숙도·통계는 권한이 아니다. 현재 요청이 항상 우선한다.' },
    requiredOutputFields: ['decision', 'principle', 'boundary', 'trace'],
    tokenBudget,
  };
}

/** 깨우기 신호(§8: 정규식 감지는 wake 로 축소) — 판단이 아니라 "추출을 돌릴 가치" 힌트만. */
export function wakeSignal(observations = []) {
  const 정정 = observations.filter((o) => o?.type === 'user_correction').length;
  const 실패 = observations.filter((o) => o?.signal?.valence === 'failure').length;
  return { wake: 정정 >= 1 || 실패 >= 2, 정정, 실패 };
}

/**
 * 추출 1회 — 절대 던지지 않는다.
 * @returns {{decision:string, candidate?:object, quarantined?:object, errors?:string[]}}
 */
export async function extractCandidate({ model, bundle, now = 0, timeoutMs = 20_000 } = {}) {
  if (!bundle?.observations?.length) return { decision: 'insufficient_evidence' };
  let raw;
  try {
    raw = await Promise.race([
      model.respond({ tcellExtract: bundle }, { effort: 'medium' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
  } catch {
    return { decision: 'insufficient_evidence', modelFailed: true }; // 실패가 대화·성장을 막지 않는다
  }
  let out;
  try { out = typeof raw === 'string' ? JSON.parse(raw) : (raw?.json ?? raw); } catch { out = null; }
  if (!out || typeof out !== 'object') return { decision: 'insufficient_evidence', modelFailed: true };
  if (out.decision !== 'candidate') {
    const ok = ['insufficient_evidence', 'duplicate', 'contradiction'].includes(out.decision);
    return { decision: ok ? out.decision : 'insufficient_evidence' };
  }
  // OS 검증(§7.2): sourceRefs 는 **번들 안 관찰의 참조만** — 밖의 사실을 낸 후보는 격리.
  const 번들참조 = new Set(bundle.observations.flatMap((o) => [...(o.receiptRefs ?? []), o.id]));
  const refs = Array.isArray(out.trace?.observationRefs) ? out.trace.observationRefs : [];
  const 밖 = refs.filter((r) => !번들참조.has(r));
  // 중복(§8): 기존 후보와 같은 문장이면 새로 만들지 않는다.
  const stmt = String(out.principle?.statement ?? '').trim();
  if (stmt && bundle.existingCandidates.some((c) => c.statement === stmt)) return { decision: 'duplicate' };
  const cell = makeTCellCandidate({
    principle: { statement: stmt, type: out.principle?.type, hypothesisConfidence: 0 },
    center: out.center, boundary: out.boundary,
    trace: { observationRefs: refs, corrections: [] },
    // 한 사례 전역화 차단: suggestedRadius 는 제안일 뿐 — 상한(task)은 validateTCell 이 강제.
    geometry: { radius: ['turn', 'task'].includes(out.suggestedRadius) ? out.suggestedRadius : 'task', depth: 0, sphereStability: 0 },
    anchor: { createdAt: now, lastObservedAt: now },
  });
  const v = validateTCell(cell);
  if (밖.length) {
    return { decision: 'candidate', quarantined: { ...v.cell, state: 'quarantined', authority: { ...v.cell.authority, allowedInfluence: ['none'] } }, errors: [`번들 밖 참조: ${밖.join(',')}`] };
  }
  return v.ok ? { decision: 'candidate', candidate: v.cell } : { decision: 'candidate', quarantined: v.cell, errors: v.errors };
}
