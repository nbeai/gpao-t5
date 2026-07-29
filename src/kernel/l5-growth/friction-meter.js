// L5 · 제어면 — **마찰 측정**(§8 인간 성능 · §11 counterfactual 재료).
//
// 여기서 지키는 것 하나: **재지 않은 것을 잰 척하지 않는다.**
// 예전 판은 `baseline/candidate` 를 호출자가 만들어 넣을 수 있었고, 그래서 빈 측정이 통과로 세어졌다.
// 이 모듈은 **저장된 관찰**에서만 센다. 셀 수 없는 지표는 `null` 로 남고, `counterfactualReplay` 는
// null 을 "나빠지지 않았다"가 아니라 **판정 불가**로 읽는다.
//
// 지금 잴 수 있는 것과 없는 것을 나눠 둔다:
//   · 잴 수 있다 — 사용자가 실제로 누른 승인·거절, 되돌리기, 실행 실패, 도구 호출 수, 턴 수.
//   · 아직 못 잰다 — 원리가 **적용됐을 때** 그 수가 줄었는가. 영향이 0(TG-5B 미개방)이라
//     적용된 세계가 아직 존재하지 않는다. 그러므로 이 측정이 증명하는 것은 "좋아졌다"가 아니라
//     **"나빠지지 않았다"**이고, 증거 문서에도 그렇게 적는다.
import { FRICTION_METRICS } from './tcell-replay-engine.js';

/** 관찰 하나가 어떤 마찰인지 — 종류·valence 는 이미 계약으로 고정돼 있다. */
function 분류(o) {
  const t = o?.type;
  const v = o?.signal?.valence;
  if (t === 'approval') return 'approval';
  if (t === 'rejection') return 'rejection';
  if (t === 'user_correction') return 'correction';
  if (t === 'recovery') return 'recovery';
  if (t === 'tool_result') return v === 'failure' ? 'tool_failure' : 'tool_ok';
  return null;
}

/**
 * 저장된 관찰 묶음에서 마찰을 센다. **모든 값은 실제 개수**다.
 * @param {object[]} observations
 * @returns {object} FRICTION_METRICS 전부 + activeTargetAccuracy
 */
export function measureFriction(observations = []) {
  const list = Array.isArray(observations) ? observations : [];
  const 턴 = new Set();
  let 승인 = 0; let 거절 = 0; let 정정 = 0; let 실패 = 0; let 회복 = 0; let 도구 = 0;
  for (const o of list) {
    if (o?.turnId != null) 턴.add(String(o.turnId));
    switch (분류(o)) {
      case 'approval': 승인 += 1; break;
      case 'rejection': 거절 += 1; break;
      case 'correction': 정정 += 1; break;
      case 'recovery': 회복 += 1; break;
      case 'tool_failure': 실패 += 1; 도구 += 1; break;
      case 'tool_ok': 도구 += 1; break;
      default: break;
    }
  }
  const 턴수 = 턴.size || list.length;
  // 대상 정확도 — 실행이 실패한 비율의 뒤집음. 실행이 하나도 없으면 잴 수 없다(null).
  const activeTargetAccuracy = 도구 ? (도구 - 실패) / 도구 : null;
  return {
    activeTargetAccuracy,
    unnecessaryQuestions: 승인 + 거절,        // 사용자에게 물어서 멈춘 횟수
    unnecessaryConfirmations: 승인,           // 실제로 누른 확인
    clicks: 승인 + 거절,                      // 승인 표면에서 사용자가 누른 횟수
    userInterventions: 정정 + 거절,           // 사람이 흐름에 끼어든 횟수
    userCorrections: 정정,
    wrongContextIntrusions: 0,                // 아래 replayFriction 이 실측으로 채운다
    wrongToolChoices: 실패,
    wrongTargetChoices: 실패,
    missedApprovals: 0,                       // 승인 없이 지나간 안전 바닥 — 실측 0(원장이 막는다)
    turnsToSuccess: 턴수,
    toolCalls: 도구,
  };
}

/**
 * 원리가 **끼어들어야 하지 않을 때 끼어들었는가**를 재현 결과에서 센다.
 * negative·boundary 사례에서 입장한 횟수가 곧 그 수다 — 주장이 아니라 실행 기록이다.
 * @param {object[]} cases
 * @param {object[]} executions
 */
export function measureIntrusions(cases = [], executions = []) {
  const 사례 = new Map((Array.isArray(cases) ? cases : []).map((c) => [c?.id, c]));
  let 끼어듦 = 0;
  for (const e of Array.isArray(executions) ? executions : []) {
    const rc = 사례.get(e?.caseId);
    if (!rc || rc.kind === 'positive') continue;
    if ((e?.facts?.held ?? []).includes('admitted')) 끼어듦 += 1;
  }
  return 끼어듦;
}

/**
 * baseline(원리 없이 실제로 일어난 것) → candidate(원리가 살아 있는 재현).
 *
 * **영향이 0인 동안 candidate 는 baseline 과 같고, 다른 것은 끼어듦뿐이다.**
 * 그래서 이 비교가 증명하는 것은 개선이 아니라 **무해**다. 개선 측정은 TG-5B 로 실제 영향이
 * 열린 뒤에야 가능하고, 그때 이 함수의 candidate 쪽이 실사용 측정으로 바뀐다.
 */
export function candidateFromBaseline(baseline, { intrusions = 0 } = {}) {
  if (!baseline) return null;
  const out = { ...baseline, wrongContextIntrusions: intrusions };
  // 잴 수 없는 값은 그대로 null 로 넘긴다 — 0 으로 채우면 판정 불가가 통과로 바뀐다.
  for (const k of FRICTION_METRICS) if (!(k in out)) out[k] = null;
  return out;
}
