// L5 · 제어면 — **ReplayCase 생산과 실행**(결정문 §11).
//
// 오래 비어 있던 자리다. `makeReplayCase()` 와 `transitionCell()` 은 정의만 있고 생산 소비자가
// 없어서, 갓 뽑힌 원리가 M1 에서 영원히 멈췄다. 그래서 성장이 사용자에게 닿은 적이 없다.
//
// **replay 는 외부 행동을 실행하지 않는다**(§11.3). 실행할 것이 애초에 없다 — admission 은 순수
// 함수이고, 원리가 "언제 성립하고 언제 성립하지 않는가"는 그 함수를 다시 돌려 보면 답이 나온다.
// 재현의 재료는 §0-C-2 에서 만든 **결합된 원자**다: 경계 절이 OS 사실 어휘에 묶여 있으면, 그 원자를
// 사실로 실체화한 턴을 만들 수 있다. 결합이 없는 절은 재현할 수 없다 — 그런 원리는 M1 에 남는다.
// (그게 결합을 만든 이유다. 문장 완전 일치로 되돌리면 재현도 같이 무너진다.)
import { randomUUID } from 'node:crypto';
import { makeReplayCase } from './tcell-replay.js';
import { admitPrinciples } from '../l1-intent/tcell-admission.js';
import { FACT_ATOMS, isFactAtom } from '../l1-intent/fact-atoms.js';
import { influenceCeilingFor } from './tcell-core.js';
import { ADMISSION_STAGES } from '../l1-intent/turn-facts.js';

/** 실행 기록 종류 — 승격 관문(`EVIDENCE_KINDS.execution`)이 이 값만 인정한다. */
export const REPLAY_EXECUTION_KIND = 'replay_execution';

const 문자열 = (v) => (typeof v === 'string' && v ? v : null);

/** 결합된 절만 재현 재료가 된다 — `{text, atom}` 중 실재하는 원자를 가진 것. */
function 결합절(arr, binding = {}) {
  const out = [];
  for (const c of Array.isArray(arr) ? arr : []) {
    const text = typeof c === 'string' ? c : 문자열(c?.text);
    if (!text) continue;
    const atom = isFactAtom(c?.atom) ? c.atom : (isFactAtom(binding[text]) ? binding[text] : null);
    if (atom) out.push({ text, atom });
  }
  return out;
}

/** 원자 하나를 **이번 턴 사실**로 실체화한다(문구의 단일 원천은 FACT_ATOMS). */
function 사실화(atom, ref) {
  return { fact: FACT_ATOMS[atom].fact, atom, ref, window: 'previous_turn' };
}

/**
 * 세포 하나에서 재현 사례를 만든다. **근거는 세포가 실제로 가진 관찰 참조**다 —
 * 지어낸 참조를 쓰면 `validateReplayCase` 가 "재현이 아니라 상상"이라고 막는다.
 *
 * @param {object} cell M1 후보
 * @returns {{cases:object[], gaps:string[]}} 만들지 못한 종류는 `gaps` 로 정직하게 나온다
 */
export function produceReplayCases(cell) {
  const refs = (cell?.trace?.observationRefs ?? []).filter((r) => 문자열(r));
  const cases = [];
  const gaps = [];
  if (!refs.length) return { cases, gaps: ['positive', 'negative', 'boundary'] };
  const binding = (cell?.binding && typeof cell.binding === 'object') ? cell.binding : {};
  const 유효 = 결합절(cell?.boundary?.validWhen, binding);
  const 무효 = 결합절(cell?.boundary?.invalidWhen, binding);

  // positive — 유효 조건이 성립한 턴에서 원리가 실제로 입장하는가.
  if (유효.length) {
    cases.push(makeReplayCase({
      kind: 'positive', sourceRefs: [...refs],
      inputFacts: { facts: 유효.map((c) => 사실화(c.atom, refs[0])), stage: ADMISSION_STAGES[0] },
      expected: { mustHold: ['admitted'], mustNotHappen: ['rejected'] },
    }));
  } else gaps.push('positive');

  // negative — 무효 조건이 성립한 턴에서는 **들어오지 않아야** 한다.
  if (무효.length) {
    cases.push(makeReplayCase({
      kind: 'negative', sourceRefs: [...refs],
      inputFacts: { facts: 무효.map((c) => 사실화(c.atom, refs[0])), stage: ADMISSION_STAGES[0] },
      expected: { mustHold: ['rejected'], mustNotHappen: ['admitted'] },
    }));
  } else gaps.push('negative');

  // boundary — **아무 사실도 켜지지 않은 턴.** 조건을 못 만난 원리가 그냥 들어오면 그건 경계가
  // 없는 것이다. 유효 조건이 있는 원리만 이 사례가 의미를 갖는다.
  if (유효.length) {
    cases.push(makeReplayCase({
      kind: 'boundary', sourceRefs: [...refs],
      inputFacts: { facts: [], stage: ADMISSION_STAGES[0] },
      expected: { mustHold: ['rejected'], mustNotHappen: ['admitted'] },
    }));
  } else gaps.push('boundary');

  // authority — **계획·값 역할을 여는 원리만** 이 사례를 갖는다. 권한 등급이 올라간 턴(A2)에서
  // 유효 조건이 성립해도 들어오지 않아야 한다 — 학습이 새 권한을 만들지 않는다는 것을 재현으로
  // 못 박는 자리다(§12 금지 3항).
  //
  // 맥락 역할만 여는 원리에는 이 사례를 만들지 않는다. 그런 원리는 A2 턴에 실려도 계획을 못 바꾸므로
  // "거절돼야 한다"는 기대 자체가 틀렸고, 억지로 넣으면 **옳은 동작을 실패로 기록**하게 된다.
  // `minimumSuiteGaps` 도 행동과 연결된 원리(execution/automation/authority/workflow)에만 요구한다.
  const 계획역할 = (cell?.authority?.allowedInfluence ?? []).some((r) => r === 'plan_hint' || r === 'default_value');
  if (유효.length && 계획역할) {
    cases.push(makeReplayCase({
      kind: 'boundary', sourceRefs: [...refs],
      inputFacts: {
        facts: 유효.map((c) => 사실화(c.atom, refs[0])),
        authority: { actionTier: 'A2', tierKnown: true, tierSource: 'plan' },
        stage: ADMISSION_STAGES[1] ?? 'post_plan',
      },
      expected: { mustHold: ['rejected'], mustNotHappen: ['admitted'] },
      authority: true,
    }));
  }

  return { cases, gaps };
}

/**
 * 사례를 **실제로 돌린다** — 같은 `admitPrinciples` 를 같은 세포에 대해 다시 판정할 뿐이다.
 * 도구·네트워크·파일이 없다. 그래서 사용자 세계에 아무 일도 일어나지 않는다.
 *
 * @param {object} cell
 * @param {object[]} cases
 * @param {{now?:number, evidence?:Map<string,object>}} opts 근거 조회기(관찰 참조 확인용)
 * @returns {object[]} `replay_execution` 기록들 — 승격 관문이 참조로 조회한다
 */
export function executeReplayCases(cell, cases = [], { now = 0, evidence = new Map(), targetState = 'M2_replayed' } = {}) {
  // **반사실 사본**에 대해 판정한다. M1 은 정의상 영향 0 이라, 원본 그대로 돌리면 positive 사례가
  // 언제나 "성숙도 부족"으로 막힌다 — 그건 원리가 틀렸다는 뜻이 아니라 아직 승격 전이라는 뜻이다.
  // 재현이 묻는 것은 "**승격된다면** 옳게 행동하는가"이고, 그 답이 승격의 조건이다.
  // 이 사본은 메모리에만 있고 어디에도 저장되지 않는다. 실제 승격은 그대로 `transitionCell()` 만
  // 할 수 있고, 그 관문은 아래 실행 기록을 저장소로 다시 확인한다.
  // 승격은 상태만 바꾸는 게 아니라 **그 성숙도가 허용하는 역할을 함께 연다**(`applyTransition`).
  // 그러니 반사실도 같은 모양이어야 한다 — 역할 없이 돌리면 positive 는 영원히 실패한다.
  // 확인(`requiresUserConfirmation`)도 반사실에서 내린다. 재현이 묻는 것은 **행동 정확성**이지
  // 사용자 동의가 아니다 — 갓 뽑힌 후보는 늘 확인이 필요하므로, 그대로 두면 positive 사례가
  // 언제나 `user_confirmation_missing` 으로 막혀 승격이 영원히 일어나지 않는다(실측 2026-07-30).
  // **동의 관문은 사라지지 않는다.** 게시 자격 판정(`publishableIds`)이 실제 확인 원장으로 그대로
  // 막고, 그 보장은 별도 검사가 양방향으로 고정한다. 두 축을 한 관문에 겹쳐 놓지 않는다.
  const 반사실 = {
    ...cell,
    state: targetState,
    authority: {
      ...(cell?.authority ?? {}),
      allowedInfluence: influenceCeilingFor(targetState),
      requiresUserConfirmation: false,
    },
  };
  const principleStore = { get: (id) => (id === cell?.id ? 반사실 : null) };
  const evidenceStore = { get: (ref) => evidence.get(ref) ?? null };
  const out = [];
  for (const rc of Array.isArray(cases) ? cases : []) {
    const facts = rc?.inputFacts?.facts ?? [];
    const stage = rc?.inputFacts?.stage ?? ADMISSION_STAGES[0];
    let 결과;
    try {
      결과 = admitPrinciples({
        candidateIds: [cell.id], principleStore, evidenceStore,
        requestFacts: {
          facts,
          project: cell?.anchor?.project ?? null,
          subject: cell?.anchor?.subject ?? null,
          sameTurn: false,
        },
        authorityFacts: rc?.inputFacts?.authority ?? { actionTier: 'A0', tierKnown: true, tierSource: 'plan' },
        now, stage,
      });
    } catch (e) {
      out.push({
        id: randomUUID(), kind: REPLAY_EXECUTION_KIND, tcellId: cell?.id ?? null, caseId: rc?.id ?? null,
        executedAt: now, at: now, sourceRefs: [...(rc?.sourceRefs ?? [])], caseRefs: [rc?.id].filter(Boolean),
        facts: { held: [], happened: ['error'], influenceRole: null, actionKind: null, error: e?.message ?? String(e) },
      });
      continue;
    }
    const 입장했나 = (결과?.trace?.retrievedIds ?? []).includes(cell.id)
      && !(결과?.trace?.rejected ?? []).some((r) => r.id === cell.id);
    const role = (결과?.admitted ?? []).find((a) => a?.id === cell.id)?.role ?? null;
    out.push({
      id: randomUUID(), kind: REPLAY_EXECUTION_KIND, tcellId: cell.id, caseId: rc.id,
      executedAt: now, at: now,
      sourceRefs: [...(rc.sourceRefs ?? [])],
      caseRefs: [rc.id],
      facts: {
        held: [입장했나 ? 'admitted' : 'rejected'],
        happened: [입장했나 ? 'admitted' : 'rejected'],
        influenceRole: role,
        actionKind: null,
      },
    });
  }
  return out;
}
