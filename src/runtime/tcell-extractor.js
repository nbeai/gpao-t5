// L3 · T-cell 추출기 (TG-3, 명세 §7·§8 + 감사 2026-07-29) — 모델은 가설을 제안하고 OS 가 강제한다.
//
// 계약(감사 반영):
//  · 모델 입력은 **검증을 통과한 모델 가독 관찰만**이다. containsSecret 이나 schema 손상 관찰은
//    modelReadable 플래그가 true 여도 들어가지 않는다(플래그 하나를 믿지 않는 이중 방어).
//  · 모델 출력은 **임의 JSON 으로 취급**한다. 어떤 모양이 와도 던지지 않고 격리 결과로 돌아간다.
//  · 시간초과 타이머는 finally 에서 반드시 해제한다(누수가 프로세스를 20초 붙잡았다 — 실측).
//  · 정규식은 판단이 아니라 **깨우기 신호**다. 기존 detectCandidate 결과도 wake 입력으로만 쓴다.
//  · 명시적 사용자 지시는 그 범위의 확인이다(원칙 0-A-1·명세 §0.1) — 같은 범위를 다시 묻지 않는다.
import { makeTCellCandidate, validateTCell } from '../kernel/l5-growth/tcell-core.js';
import { validateObservationEvent } from '../kernel/l0-evidence/tcell-observation.js';
import { TCELL_RELATIONS } from '../kernel/l5-growth/t-sphere.js';

const BUNDLE_CAP = 12; // 명세 §7.3 — 추출 입력은 대화 전체가 아니라 제한된 묶음이다

const 문자열배열 = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0) ? v : null);

// 한국어 어미는 **토큰마다** 벗긴다 — 문장 끝만 처리하면 "않는다" 와 "않습니다" 가 갈린다(실측).
const 어미 = /(습니다|ㅂ니다|입니다|합니다|하십시오|하세요|한다|는다|은다|ㄴ다|했다|해요|하죠|이다|예요|에요|다|요)$/;
const 조사 = /(으로|로|에서|에게|한테|까지|부터|은|는|이|가|을|를|의|와|과|도|만)$/;

/** 의미 비교용 정규화 — 문자열이 달라도 같은 뜻이면 중복이다(§8 중복 수렴). */
export function normalizeStatement(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.,!?~"'`()[\]{}·:;]/g, ' ')
    .replace(/\b(the|a|an|is|are)\b/g, ' ')
    .split(/\s+/)
    .map((t) => {
      let x = t.replace(어미, '');
      if (!x) x = t;              // 어미만으로 된 토큰은 그대로 둔다
      const y = x.replace(조사, '');
      return y || x;
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** 두 문장의 의미 근접도(0..1) — 정규화 토큰 자카드. 외부 의존 없이 결정적이다. */
export function statementAffinity(a, b) {
  const A = new Set(normalizeStatement(a).split(' ').filter(Boolean));
  const B = new Set(normalizeStatement(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** 모델 입력 자격 — 플래그 하나가 아니라 schema 검증 + 비밀 없음 + 가독 셋 모두. */
function 모델에게줄수있나(o) {
  if (o?.privacy?.modelReadable !== true) return false;
  if (o?.privacy?.containsSecret === true) return false; // 표식이 있으면 플래그와 무관하게 차단
  return validateObservationEvent(o).ok;                 // schema 손상 관찰은 입력이 아니다
}

/** 관찰 묶음 키 — 프로젝트·주제·신호군별로 나눈다(§8: 아무 관찰이나 한 통에 담지 않는다). */
export function groupKeyOf(o) {
  const project = o?.anchor?.project ?? o?.anchor?.workspace ?? '무소속';
  const subject = o?.anchor?.subject ?? o?.anchor?.surface ?? '일반';
  const signal = o?.signal?.valence === 'correction' ? '정정'
    : o?.signal?.valence === 'failure' ? '실패' : '성공';
  return `${project}//${subject}//${signal}`;
}

/**
 * 관찰들을 묶음 단위로 나눈다 — 각 묶음이 하나의 EvidenceBundle 후보다.
 * 자격 없는 관찰(비밀·손상·비가독)은 어느 묶음에도 들어가지 않는다.
 * @returns {Map<string, object[]>}
 */
export function groupObservations(observations = []) {
  const groups = new Map();
  for (const o of Array.isArray(observations) ? observations : []) {
    if (!모델에게줄수있나(o)) continue;
    const k = groupKeyOf(o);
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  return groups;
}

/** @returns {{id:string, activeTarget:string, observations:object[], existingCandidates:object[], authorityFacts:object, requiredOutputFields:string[], tokenBudget:number, explicitInstruction:object|null}} */
export function buildEvidenceBundle({
  id, activeTarget = '', observations = [], existingCandidates = [],
  explicitInstruction = null, tokenBudget = 4000,
} = {}) {
  const 통과 = (Array.isArray(observations) ? observations : []).filter(모델에게줄수있나);
  return {
    id: id ?? `bundle-${통과.length}`,
    activeTarget,
    observations: 통과.slice(-BUNDLE_CAP), // 최신 우선, 명세 상한
    existingCandidates: (Array.isArray(existingCandidates) ? existingCandidates : [])
      .map((c) => ({ id: c?.id, statement: c?.principle?.statement ?? c?.statement ?? '' })),
    authorityFacts: {
      note: '성숙도·통계는 권한이 아니다. 현재 요청이 항상 우선한다.',
      // 명시적 지시가 있으면 그 범위는 이미 확인된 것이다(원칙 0-A-1).
      explicitInstructionScope: explicitInstruction?.scope ?? null,
    },
    requiredOutputFields: ['decision', 'principle', 'boundary', 'trace'],
    tokenBudget,
    explicitInstruction,
  };
}

/**
 * 깨우기 신호 — **판단이 아니다.** 추출을 돌릴 가치가 있는지만 본다.
 * 기존 정규식 경로(detectCandidate 결과)도 여기서 하나의 입력으로 축소된다(§16 TG-3).
 * @param {object[]} observations
 * @param {{regexHit?:object|null}} [opts] detectCandidate(text) 결과를 그대로 넣는다
 */
export function wakeSignal(observations = [], opts = {}) {
  const obs = Array.isArray(observations) ? observations : [];
  const 정정 = obs.filter((o) => o?.type === 'user_correction').length;
  const 실패 = obs.filter((o) => o?.signal?.valence === 'failure').length;
  const 정규식 = Boolean(opts?.regexHit); // 판단이 아니라 신호 하나
  return { wake: 정정 >= 1 || 실패 >= 2 || 정규식, 정정, 실패, 정규식 };
}

/** 기존 후보들과의 관계 판정(§8 relation 수렴) — 같은 중심이면 새 세포를 만들지 않는다. */
export function relateToExisting(statement, existingCandidates = []) {
  let best = { kind: null, id: null, affinity: 0 };
  for (const c of Array.isArray(existingCandidates) ? existingCandidates : []) {
    const a = statementAffinity(statement, c?.statement ?? '');
    if (a > best.affinity) {
      const kind = a >= 0.8 ? 'same_center' : a >= 0.5 ? 'refines' : null;
      best = { kind, id: c?.id ?? null, affinity: a };
    }
  }
  return best.kind && TCELL_RELATIONS.includes(best.kind) ? best : { kind: null, id: null, affinity: best.affinity };
}

/**
 * 추출 1회 — **절대 던지지 않는다.**
 * @returns {Promise<{decision:string, candidate?:object, quarantined?:object, relation?:object, errors?:string[], modelFailed?:boolean}>}
 */
export async function extractCandidate({ model, bundle, now = 0, timeoutMs = 20_000 } = {}) {
  if (!bundle?.observations?.length) return { decision: 'insufficient_evidence' };

  let raw;
  let timer = null;
  try {
    raw = await Promise.race([
      Promise.resolve(model?.respond?.({ tcellExtract: bundle }, { effort: 'medium' })),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); }),
    ]);
  } catch {
    return { decision: 'insufficient_evidence', modelFailed: true };
  } finally {
    if (timer) clearTimeout(timer); // **누수 금지** — 즉답이어도 타이머가 프로세스를 붙잡지 않는다
  }

  try {
    let out;
    try { out = typeof raw === 'string' ? JSON.parse(raw) : (raw?.json ?? raw); } catch { out = null; }
    if (!out || typeof out !== 'object' || Array.isArray(out)) return { decision: 'insufficient_evidence', modelFailed: true };

    if (out.decision !== 'candidate') {
      const ok = ['insufficient_evidence', 'duplicate', 'contradiction'].includes(out.decision);
      return { decision: ok ? out.decision : 'insufficient_evidence' };
    }

    const stmt = typeof out.principle?.statement === 'string' ? out.principle.statement.trim() : '';
    if (!stmt) return { decision: 'insufficient_evidence' };

    // 의미 중복·관계 수렴(§8): 문자열이 달라도 같은 중심이면 새 세포를 만들지 않는다.
    const rel = relateToExisting(stmt, bundle.existingCandidates);
    if (rel.kind === 'same_center') return { decision: 'duplicate', relation: rel };

    // sourceRefs 는 **번들 안 관찰의 참조만**(§7.2) — 밖의 사실을 낸 후보는 격리.
    const 번들참조 = new Set(bundle.observations.flatMap((o) => [...(o.receiptRefs ?? []), o.id]));
    const refs = 문자열배열(out.trace?.observationRefs) ?? [];
    const 밖 = refs.filter((r) => !번들참조.has(r));

    // 명시적 사용자 지시는 그 범위의 확인이다 — 같은 범위를 다시 확인받지 않는다(원칙 0-A-1).
    const 명시확인됨 = Boolean(bundle.explicitInstruction?.scope) && (out.suggestedRadius ?? 'task') !== 'global';

    const cell = makeTCellCandidate({
      principle: {
        statement: stmt,
        type: typeof out.principle?.type === 'string' ? out.principle.type : undefined,
        hypothesisConfidence: 0, // 모델이 준 confidence 는 받지 않는다(권한이 아니다)
      },
      center: {
        point: typeof out.center?.point === 'string' ? out.center.point : '',
        axis: typeof out.center?.axis === 'string' ? out.center.axis : '',
        horizontalSignals: 문자열배열(out.center?.horizontalSignals) ?? [],
      },
      boundary: {
        validWhen: 문자열배열(out.boundary?.validWhen) ?? [],
        invalidWhen: 문자열배열(out.boundary?.invalidWhen) ?? [],
        needsReviewWhen: 문자열배열(out.boundary?.needsReviewWhen) ?? [],
        mustNotOverride: 문자열배열(out.boundary?.mustNotOverride) ?? ['현재 요청'],
      },
      trace: { observationRefs: refs, corrections: [] },
      // 한 사례 전역화 차단: suggestedRadius 는 제안일 뿐 — 상한은 validateTCell 이 강제한다.
      geometry: { radius: ['turn', 'task'].includes(out.suggestedRadius) ? out.suggestedRadius : 'task', depth: 0, sphereStability: 0 },
      authority: {
        allowedInfluence: ['none'],
        // 명시 지시 범위 안이면 재확인 후보로 강등하지 않는다(마찰 금지). 추정은 그대로 확인 필요.
        requiresUserConfirmation: !명시확인됨,
        prohibitedActionKinds: [],
      },
      anchor: { createdAt: now, lastObservedAt: now },
    });

    const v = validateTCell(cell);
    if (밖.length) {
      return {
        decision: 'candidate', relation: rel,
        quarantined: { ...v.cell, state: 'quarantined', authority: { ...v.cell.authority, allowedInfluence: ['none'] } },
        errors: [`번들 밖 참조: ${밖.join(',')}`],
      };
    }
    return v.ok
      ? { decision: 'candidate', candidate: v.cell, relation: rel }
      : { decision: 'candidate', quarantined: v.cell, relation: rel, errors: v.errors };
  } catch (e) {
    // 어떤 모양의 출력에도 추출기가 죽지 않는다 — 기본 대화·성장 어느 것도 막지 않는다.
    return { decision: 'insufficient_evidence', modelFailed: true, errors: [e?.message ?? String(e)] };
  }
}
