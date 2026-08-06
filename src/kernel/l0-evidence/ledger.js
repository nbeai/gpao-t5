// L0 · Truth Ledger — 도구 실행 원장. 사용자 답변은 이 원장 기준으로
// "확인한 것 / 확인 못한 것 / 추정"을 분리한다(계획서 §5.4).
import { FAILURE } from '../contracts.js';

/**
 * **이 걸음은 확인된 사실인가.** 영수증이 스스로 `delivered` 라고 적혀 있고, 호출했고,
 * 실패하지 않았고, 결과가 실제로 왔다.
 *
 * 넷 중 하나만 빠져도 확인이 아니다. 특히 `result === undefined`(lifecycle `attempting`)는
 * 실패는 아니지만 **아직 아무것도 확인되지 않은** 상태다 — 손이 아무것도 반환하지 않으면
 * userSafeSummary 는 기본 문구로 채워져 겉보기엔 성공 문장이 된다.
 *
 * `lifecycle` 을 **함께** 보는 이유: `receipt()` 는 `r.lifecycle ?? deriveLifecycle(...)` 이라
 * 호출자가 수명주기를 직접 말할 수 있다. 그래서 "결과는 들어 있는데 스스로 attempting 이라
 * 적힌" 영수증이 만들어질 수 있고, 파생 조건만 보면 원장이 그걸 확인으로 세면서 영수증이
 * 스스로 아니라고 적은 것을 맞다고 우기게 된다.
 *
 * 이 정의를 함수로 꺼낸 이유: 기다리는 동안 흘리는 사실과 최종 답의 "확인한 것" 목록이
 * **같은 정의**를 써야 한다. 두 곳에서 따로 판정하면 같은 턴에서 두 개의 진실을 보게 된다.
 * @param {import('../contracts.js').ToolReceipt} rec
 */
export function 확인된사실(rec) {
  return Boolean(rec
    && rec.lifecycle === 'delivered'
    && rec.failureState === FAILURE.NONE
    && rec.actualCall
    && rec.result !== undefined
    // **성공은 관찰된 실제 효과다**(정본 §S2 필수 계약 ③).
    //
    // 손이 `applied` 라는 기계 사실을 내면 그것이 이 판정을 이긴다. `local.terminal` 의
    // probe 는 **쓰기가 막힌 채 도는 확인**이라 exit 0 이어도 아무것도 안 바뀐다. 그런데
    // 여기서는 lifecycle·failureState·result 만 봐서 통과시켰고, 사용자면 문장은
    // "확인만 했어요"인데 **원장은 confirmed 로 세었다** — 한 턴에 두 진실이 섰다.
    //
    // 실측(2026-08-03, 헤르메스 대조): 명령이 `2>/dev/null || true` 로 실패를 삼켜 exit 0 이
    // 나오자 원장에 "실행했어요 · failureState:none" 이 남았다. 디스크는 그대로였고
    // 모델은 그 거짓 기록 위에서 다음을 판단했다. **원장이 거짓이면 셀프후드도 말귀도
    // 그 위에 못 선다.**
    //
    // 칸이 아예 없는 손(파일·웹 등)은 영향받지 않는다 — 없는 것을 false 로 읽으면
    // 실제로 한 일까지 미확인이 되어 원장이 반대 방향으로 거짓이 된다.
    && rec.result?.applied !== false);
}

/**
 * receipt 목록을 확인/미확인/추정으로 투영한다. 사용자면(userSafeSummary)만 노출한다.
 * 순수 함수 — 세션 전체 원장이든 이번 턴 receipt 목록이든 같은 규칙으로 투영한다.
 * @param {import('../contracts.js').ToolReceipt[]} entries
 * @returns {{confirmed:string[], unconfirmed:string[], estimated:string[]}}
 */
export function projectReceipts(entries) {
  const confirmed = [];
  const unconfirmed = [];
  const estimated = [];
  for (const e of entries) {
    if (확인된사실(e)) {
      confirmed.push(e.userSafeSummary);
    } else if (e.failureState !== FAILURE.NONE) {
      // blocked/failed/timeout = 확인 못 함. 추정으로 메우지 않는다.
      // **이 줄을 읽는 것은 모델이다.** `nextSafeAction` 은 표면이 사용자에게 보여 주는
      // 문장이라(`server.js` `recoverable_error`) *"…그 폴더를 열어 주시면 바로 볼게요"* 처럼
      // **사용자에게 시키는 말**이 들어 있다. 그것이 그대로 모델의 다음 행동이 되어
      // T5 가 할 수 있는 일을 사장님께 되물었다(판 5판 ⑫ 0/3 · 노드 R 셋째 갈래).
      //
      // 손이 모델용 길(`모델다음`)을 주면 그것이 이긴다. 안 주면 예전 그대로다 —
      // **한 자리에서 갈라야** 손이 늘 때마다 다시 새지 않는다.
      // 손이 **실제로 쥔 다음 수**가 있으면 그것이 이긴다(`다음수단` — tool-receipt 계약).
      // 없을 때만 사람용 문장을 쓴다.
      const 길 = (e.다음수단 ?? []).map((x) => x?.왜 ?? x?.방법).filter(Boolean).slice(0, 3);
      const 다음 = 길.length ? `이어서 할 수 있는 것: ${길.join(' · ')}` : e.nextSafeAction;
      unconfirmed.push(e.userSafeSummary + (다음 ? ` — ${다음}` : ''));
    } else {
      // 호출 없이 모델 지식으로만 답한 경우 = 추정으로 정직하게 분리.
      estimated.push(e.userSafeSummary);
    }
  }
  return { confirmed, unconfirmed, estimated };
}

export class TruthLedger {
  constructor() {
    /** @type {import('../contracts.js').ToolReceipt[]} */
    this.entries = [];
  }

  /** @param {import('../contracts.js').ToolReceipt} rec */
  append(rec) {
    this.entries.push(rec);
    return rec;
  }

  /** 세션 전체 원장 투영(감사 표면용). 턴 응답은 이번 턴 receipt 만 투영한다. */
  project() {
    return projectReceipts(this.entries);
  }
}
