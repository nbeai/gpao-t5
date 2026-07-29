// L3 · T-cell 추출기 (TG-3, 명세 §7·§8 + 감사 2026-07-29) — 모델은 가설을 제안하고 OS 가 강제한다.
//
// 계약(감사 반영):
//  · 모델 입력은 **검증을 통과한 모델 가독 관찰만**이다. containsSecret 이나 schema 손상 관찰은
//    modelReadable 플래그가 true 여도 들어가지 않는다(플래그 하나를 믿지 않는 이중 방어).
//  · 모델 출력은 **임의 JSON 으로 취급**한다. 어떤 모양이 와도 던지지 않고 격리 결과로 돌아간다.
//  · 시간초과 타이머는 finally 에서 반드시 해제한다(누수가 프로세스를 20초 붙잡았다 — 실측).
//  · 정규식은 판단이 아니라 **깨우기 신호**다. 기존 detectCandidate 결과도 wake 입력으로만 쓴다.
//  · 명시적 사용자 지시는 그 범위의 확인이다(원칙 0-A-1·명세 §0.1) — 같은 범위를 다시 묻지 않는다.
import { makeTCellCandidate, validateTCell, PRINCIPLE_TYPES } from '../kernel/l5-growth/tcell-core.js';
import { validateObservationEvent, looksLikeSecret } from '../kernel/l0-evidence/tcell-observation.js';
import { TCELL_RELATIONS } from '../kernel/l5-growth/t-sphere.js';
import { isFactAtom, atomVocabularyLines } from '../kernel/l1-intent/fact-atoms.js';

const BUNDLE_CAP = 12; // 명세 §7.3 — 추출 입력은 대화 전체가 아니라 제한된 묶음이다

const 문자열배열 = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0) ? v : null);

// 문장 정규화·근접도는 **L1 단일 자리**에서 온다(추출기·admission·저장소가 같은 열쇠를 쓴다).
import { normalizeStatement, statementAffinity } from '../kernel/l1-intent/statement-text.js';

export { normalizeStatement, statementAffinity };

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
  // **자유문은 여기 한 곳에서만 모델 앞에 놓인다** — 그러므로 비밀 경계도 여기 하나다(감사 6회차 P0).
  // 관찰은 이미 `모델에게줄수있나` 로 두 겹(플래그+표식) 막혀 있었는데, 사람 발화와 지시 문면은
  // 그 경계를 지나지 않고 곧장 모델 메시지로 갔다 — **저장은 막히고 송신은 안 막히는** 비대칭.
  // 배선하는 쪽이 잊어도 새지 않게, 조립 지점에서 막는다. 판정이 아니라 안전망이다.
  const 모델앞자유문 = (t) => {
    const v = typeof t === 'string' ? t.trim() : '';
    return v && !looksLikeSecret(v) ? v : '';
  };
  const 지시문면 = 모델앞자유문(explicitInstruction?.text);
  const 지시 = explicitInstruction
    // 범위·근거 참조는 내부 열쇠라 남기되, 문면이 막히면 **내용 결합이 성립하지 않는다** →
    // `명시확인됨` 이 꺼져 재확인이 살아난다(안전한 방향으로 실패한다).
    ? { ...explicitInstruction, text: 지시문면 }
    : null;
  return {
    id: id ?? `bundle-${통과.length}`,
    activeTarget: 모델앞자유문(activeTarget),
    observations: 통과.slice(-BUNDLE_CAP), // 최신 우선, 명세 상한
    // **관계 판정의 재료를 버리지 않는다**(감사): 중심·경계·anchor 를 함께 실어 모델이
    // 같은 중심 여부를 비교할 수 있게 하고, OS 도 구조로 대조한다(§7.1 모델 역할).
    existingCandidates: (Array.isArray(existingCandidates) ? existingCandidates : []).map((c) => ({
      id: c?.id,
      statement: c?.principle?.statement ?? c?.statement ?? '',
      center: { point: c?.center?.point ?? '', axis: c?.center?.axis ?? '' },
      boundary: {
        validWhen: 문자열배열(c?.boundary?.validWhen) ?? [],
        invalidWhen: 문자열배열(c?.boundary?.invalidWhen) ?? [],
      },
      anchor: { project: c?.anchor?.project ?? null, subject: c?.anchor?.subject ?? null },
    })),
    authorityFacts: {
      note: '성숙도·통계는 권한이 아니다. 현재 요청이 항상 우선한다.',
      // 명시적 지시가 있으면 그 범위는 이미 확인된 것이다(원칙 0-A-1).
      explicitInstructionScope: explicitInstruction?.scope ?? null,
    },
    requiredOutputFields: ['decision', 'principle', 'boundary', 'trace'],
    // §0-C-2: 모델에게 OS 사실 어휘를 준다 — 자유문 경계를 여기 결합해야 admission 이 대조할 수 있다.
    factAtoms: atomVocabularyLines(),
    // **계약의 어휘도 함께 준다**(실측 2026-07-29 · OpenAI·Anthropic 직접 관측): 예전엔
    // `principle.type` 을 요구하면서 허용 종류를 알려주지 않았다. 실모델은 `operational` 같은
    // 계약 밖 종류를 냈고, 뽑아낸 원리가 **격리**됐다 — 실모델 추출이 후보를 남기지 못했다.
    // 칸이 비면 모델이 그 빈칸을 지어낸다. 강제는 그대로 OS(validateTCell)가 한다.
    principleTypes: [...PRINCIPLE_TYPES],
    tokenBudget,
    explicitInstruction: 지시,
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

const 겹침 = (A = [], B = []) => {
  const norm = (xs) => new Set(xs.map((x) => normalizeStatement(x)).filter(Boolean));
  const a = norm(A); const b = norm(B);
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/**
 * 관계 판정(§8 수렴) — **네 가지 증거를 함께 본다.** 단어 겹침 하나로 판정하지 않는다(감사).
 *   · 모델 제안(§7.1: 같은 중심의 후보 비교는 모델 몫) · 중심(center.point) · anchor(project/subject)
 *   · 경계 모순(한쪽의 validWhen 이 다른 쪽의 invalidWhen 과 겹치면 contradicts)
 * 모델 제안은 존중하되, 구조 증거가 모순을 말하면 구조가 이긴다(OS 가 강제, §7.2).
 * @param {{statement:string, center?:object, boundary?:object, anchor?:object}} cand
 * @param {object[]} existing 번들의 existingCandidates(중심·경계·anchor 포함)
 * @param {{kind?:string, targetId?:string}|null} modelProposal
 */
export function relateToExisting(cand, existing = [], modelProposal = null) {
  const c0 = typeof cand === 'string' ? { statement: cand } : (cand ?? {});
  let best = { kind: null, id: null, affinity: 0, evidence: [] };
  for (const e of Array.isArray(existing) ? existing : []) {
    const aff = statementAffinity(c0.statement, e?.statement ?? '');
    const centerAff = statementAffinity(c0.center?.point ?? '', e?.center?.point ?? '');
    const 같은자리 = Boolean(e?.anchor?.project) && e.anchor.project === (c0.anchor?.project ?? null)
      && (e?.anchor?.subject ?? null) === (c0.anchor?.subject ?? null);
    const 모순 = 겹침(c0.boundary?.validWhen, e?.boundary?.invalidWhen)
      || 겹침(c0.boundary?.invalidWhen, e?.boundary?.validWhen);
    const evidence = [];
    if (aff >= 0.8) evidence.push('statement');
    if (centerAff >= 0.6) evidence.push('center');
    if (같은자리) evidence.push('anchor');
    if (모순) evidence.push('boundary_conflict');

    let kind = null;
    if (모순) kind = 'contradicts';                       // 경계 모순은 어떤 유사도보다 앞선다
    // **중심이 같고 자리가 같고 경계가 충돌하지 않으면 같은 중심이다** — relation 이름 그대로다.
    // 문장 표현 차이는 center 가 추상하라고 있는 것이지, 새 세포를 만들 이유가 아니다.
    else if (aff >= 0.8 || (centerAff >= 0.8 && 같은자리)) kind = 'same_center';
    else if (aff >= 0.45 || centerAff >= 0.6) kind = 'refines';
    // 모델 제안 수용: 구조가 반박하지 않을 때만(§7.2 OS 강제).
    if (!kind && modelProposal?.targetId === e?.id && TCELL_RELATIONS.includes(modelProposal?.kind)
      && (aff > 0 || centerAff > 0 || 같은자리)) {
      kind = modelProposal.kind; evidence.push('model');
    }
    const score = Math.max(aff, centerAff) + (같은자리 ? 0.1 : 0);
    if (kind && score >= best.affinity) best = { kind, id: e?.id ?? null, affinity: Math.max(aff, centerAff), evidence };
  }
  return best;
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
      // §0-C-2: **비후보 결정도 관계는 돌려준다.** 모델이 "이 지시는 기존 원리의 반대"라고
      // 판정했으면(contradiction) 그 대상이 누구인지가 소비 가능한 사실이다 — 버리면
      // 의미 판정이 턴과 함께 증발하고 다음 턴 admission 이 아무것도 모른다.
      // 대상 id 는 번들의 기존 후보 안에서만 인정한다(§7.2 — 모델이 지어낸 id 는 사실이 아니다).
      const 제안 = out.relation ?? out.relatedTo ?? null;
      const 유효대상 = 제안?.targetId
        && (bundle.existingCandidates ?? []).some((c) => c?.id === 제안.targetId)
        && TCELL_RELATIONS.includes(제안?.kind);
      return {
        decision: ok ? out.decision : 'insufficient_evidence',
        relation: 유효대상 ? { kind: 제안.kind, id: 제안.targetId, evidence: ['model'] } : null,
      };
    }

    const stmt = typeof out.principle?.statement === 'string' ? out.principle.statement.trim() : '';
    if (!stmt) return { decision: 'insufficient_evidence' };

    // §0-C-2 · **의미 결합 수용** — 경계 절은 문자열 또는 {text, atom} 으로 온다.
    // atom 은 OS 사실 어휘(fact-atoms)에 있는 id 만 인정한다. 모르는 id 는 결합이 아니라 주장이다.
    const binding = {};
    const 절수용 = (arr) => {
      if (!Array.isArray(arr)) return [];
      const texts = [];
      for (const item of arr) {
        if (typeof item === 'string' && item) { texts.push(item); continue; }
        const text = typeof item?.text === 'string' && item.text ? item.text : null;
        if (!text) continue;
        texts.push(text);
        if (isFactAtom(item?.atom)) binding[text] = item.atom;
      }
      return texts;
    };
    const validWhen절 = 절수용(out.boundary?.validWhen);
    const invalidWhen절 = 절수용(out.boundary?.invalidWhen);
    const 후보경계 = { validWhen: validWhen절, invalidWhen: invalidWhen절 };
    // **anchor 는 OS 가 아는 사실이다**(§7.2) — 모델 주장이 아니라 근거 관찰에서 유도한다.
    const 근거자리 = bundle.observations[bundle.observations.length - 1]?.anchor ?? {};
    const anchor = {
      workspace: 근거자리.workspace ?? null, project: 근거자리.project ?? null,
      surface: 근거자리.surface ?? null, subject: 근거자리.subject ?? null,
    };
    // 의미 중복·관계 수렴(§8): 문장·중심·anchor·경계와 모델 제안을 함께 본다.
    const rel = relateToExisting(
      { statement: stmt, center: out.center, boundary: 후보경계, anchor },
      bundle.existingCandidates,
      out.relation ?? out.relatedTo ?? null,
    );
    if (rel.kind === 'same_center') return { decision: 'duplicate', relation: rel };

    // sourceRefs 는 **번들 안 관찰의 참조만**(§7.2) — 밖의 사실을 낸 후보는 격리.
    const 번들참조 = new Set(bundle.observations.flatMap((o) => [...(o.receiptRefs ?? []), o.id]));
    const refs = 문자열배열(out.trace?.observationRefs) ?? [];
    const 밖 = refs.filter((r) => !번들참조.has(r));

    // 명시적 사용자 지시는 **그 지시가 밝힌 범위**의 확인이다(원칙 0-A-1) — 지시가 있었다는
    // 사실만으로 아무 원리나 면제되지 않는다(감사 재현: "보고서는 목록으로" 지시로
    // "외부 전송은 묻지 않고 한다"가 면제됐다). 세 증거가 **모두** 있어야 면제한다:
    //   ① 근거 결합 — 후보 trace 가 그 지시를 기록한 관찰을 실제로 가리킨다
    //   ② 내용 결합 — 후보 문장이 지시 문면에서 나온 것이다(의미 근접)
    //   ③ 권한 경계 — 권한·자동화 종류는 명시 지시로 면제되지 않는다(A2/A3 는 authority gate)
    const 지시 = bundle.explicitInstruction;
    const 근거결합 = Boolean(지시?.observationRef) && refs.includes(지시.observationRef);
    const 내용결합 = statementAffinity(stmt, 지시?.text ?? '') >= 0.45;
    const 권한종류 = out.principle?.type === 'authority' || out.principle?.type === 'automation';
    const 명시확인됨 = Boolean(지시?.scope) && 근거결합 && 내용결합 && !권한종류
      && (out.suggestedRadius ?? 'task') !== 'global';

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
        validWhen: validWhen절,
        invalidWhen: invalidWhen절,
        needsReviewWhen: 절수용(out.boundary?.needsReviewWhen),
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
      anchor: { ...anchor, createdAt: now, lastObservedAt: now },
    });
    // §0-C-2: 원자 결합을 세포에 지속한다 — admission 이 조회할 자유문↔사실 어휘의 다리.
    // 결합의 근거는 이 추출 자체다(번들 관찰 참조가 세포 trace 에 이미 있다).
    if (Object.keys(binding).length) cell.binding = binding;

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
