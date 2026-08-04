// L2 · **도구 실행 경계** (S6-a) — 판정이 사는 한 자리.
//
// 원리 ④(OpenClaw): 정책은 **실행 경계의 훅**에 있다. 프롬프트의 안전 문구는 권고이지 강제가 아니다.
//   `prepare → before_tool_call(거부 가능) → execute → normalize → after_tool_call → persist`
//
// ── 왜 이 파일이 생겼나 ────────────────────────────────────────────────────
// `turn.js` 는 같은 판정을 **두 벌** 돌린다: 계획 경로(`runTurn`)와 걸음 경로(`executePlan` 루프).
// 주석이 그 대가를 이미 기록하고 있다 —
//   *"`reversible:false` 로 선언된 `rm -rf` 가 **걸음 경로에서만** 자동으로 실행됐다.
//     같은 명령이 계획 경로에서는 승인을 받았다 — **한 턴 안에서 같은 행동에 두 개의 답이 나왔다**"*
//   *"여기만 빠져 있어서, 모델이 도구 호출로 전송을 고르면 **빈 대상 카드**가 떴다"*
// 그리고 재현으로 확정된 것 하나 더(F-20): **헌장 ③ 이 어느 경로로 왔느냐에 따라 갈린다.**
//
// **S6 의 성공 기준은 "경계로 옮겼다"가 아니라 "두 벌이 한 벌이 됐다"이다.**
//
// ── 이 파일의 지금 범위 (S6-a) ────────────────────────────────────────────
// **행동을 하나도 바꾸지 않는다.** 걸음 경로에 인라인으로 있던 판정을 **글자 그대로** 옮겼다.
// 회귀·돌연변이가 그대로여야 이 단계가 닫힌다. 계획 경로를 같은 자리로 넣는 것은 S6-b 다.
//
// ── 여기 오면 안 되는 것 ──────────────────────────────────────────────────
// 턴 전체를 다루는 것은 루프에 남는다 — 예산·취소·승인 반환·되묻기 반환·줄세우기.
// **훅은 판정을 돌려주고, 턴을 끝내는 것은 루프의 일이다.**
import { toolActionKind } from './action-plan.js';
import { 발화밖파괴 } from './carryover.js';
import { isKnownCounterpart } from './known-counterpart.js';

/**
 * **실행 전 판정** — 이 호출이 무슨 등급이고, 자동인가 승인인가를 정할 사실을 만든다.
 *
 * 부작용이 없다(probe 는 도구가 스스로 "돌려 보면 아는 것"을 묻는 읽기다).
 * 판정만 하고 **아무것도 실행하지 않으며 턴을 끝내지도 않는다.**
 *
 * @param {object} p
 * @param {string} p.toolId
 * @param {object} p.args              모델이 낸 인자
 * @param {object} p.selfState
 * @param {object} [p.tools]           `ctx.tools` — probe 를 가진 도구 등록부
 * @param {boolean} [p.이번이월]        앞 턴에서 넘어온 같은 일인가
 * @param {object} [p.이번발화]         `parseFileRequest` 결과 — 발화밖 파괴 판정용
 * @returns {Promise<{판정인자: object, kind: string, 판정행동: {kind: string, revocable?: boolean, needsApproval?: boolean}}>}
 */
export async function 실행전판정({ toolId, args, selfState, tools, 이번이월 = false, 이번발화 }) {
  // 등급 판정. 명령은 **돌려 봐야 아니까** 계획 때와 똑같이 probe 를 먼저 탄다.
  let 판정인자 = args;
  if (toolId === 'local.terminal' && typeof args?.command === 'string') {
    const probed = await tools?.tools?.[toolId]?.probe?.(args.command, { cwd: args.cwd });
    판정인자 = {
      ...args,
      changes: probed?.changes,
      granted: probed?.changes === true,
      probeResult: probed?.probe,
    };
  }
  const kind = toolActionKind({ toolId, args: 판정인자, selfState });
  // **판정은 계획 경로와 같은 사실 위에서 한다**(두 층이 같은 질문에 다른 답을 내면 결함이다).
  // 헌장은 종류만으로 답할 수 없다 — 되돌릴 수 있는지, 아는 상대인지가 자동을 연다.
  // 여기서 종류 하나만 넘기던 동안 `reversible:false` 로 선언된 `rm -rf` 가 걸음 경로에서만
  // 자동 실행됐다(실측 2026-08-03).
  const 손선언 = selfState?.connectedTools?.find((t) => t.id === toolId);
  // 이월이거나 이번 발화 밖 파괴면 손의 선언과 무관하게 승인으로 간다 —
  // 되돌릴 수 있어도 **지금 요청이 아니다.** 버리지 않고 사용자에게 보인다.
  const 발화밖 = 발화밖파괴({ kind, 대상: args?.path ?? args?.target }, 이번발화);
  return {
    판정인자,
    kind,
    판정행동: {
      kind,
      revocable: 손선언?.reversible,
      needsApproval: 손선언?.needsApproval || 이번이월 || 발화밖,
    },
  };
}

/**
 * **승인 면제 — 같은 질문을 두 번 하지 않는다.** (S6-b)
 *
 * 면제는 둘인데 **각 경로가 서로 다른 하나만** 읽고 있었다:
 *   `isKnownCounterpart`(헌장 ③ · 아는 상대) → 계획 경로에서만(turn.js:1324)
 *   `허락한손`(이번 요청에서 허락한 손)      → 걸음 경로에서만(turn.js:2036)
 *
 * 재현(F-20 · 기계 사실): 아는 상대인데 전송이 **다음 왕복**으로 오면(걸음 경로)
 * **카드가 다시 떴다.** 헌장 ③ 이 어느 경로로 왔느냐에 따라 갈린 것이다.
 * 두 벌 판정의 실제 대가다 — **한 벌이면 안 생긴다.**
 *
 * ── 왜 `decideAutoGrant` **앞**에서 봐야 하나 ──────────────────────────────
 * 뒤에서 `needsApproval` 만 비우면 **호출이 조용히 증발한다**(밟아서 확인).
 * 걸음 경로는 승인 분기에 들어간 뒤 카드를 못 만들면 `멈춘이유` 를 세우고 **루프를 빠져나간다**
 * — 실행 목록으로 돌아가지 않는다. 면제는 **애초에 승인 분기로 안 들어가게** 하는 것이다.
 *
 * @param {object} p
 * @param {string} p.toolId
 * @param {object} [p.판정인자]        대상이 확정된 인자(전송이면 `target` 이 여기 있다)
 * @param {Set<string>} [p.허락한손]    이번 요청에서 이미 허락받은 손
 * @param {Set<string>} [p.knownCounterparts]
 * @param {boolean} [p.전송인가]
 * @returns {{면제: boolean, 이유?: '허락한손'|'아는상대'}}
 */
export function 승인면제({ toolId, 판정인자, 허락한손, knownCounterparts, 전송인가 = false }) {
  // ① 이 요청에서 이미 허락받은 **같은 손**이면 다시 묻지 않는다.
  //    손이 다르면 다른 결정이므로 그때는 묻는다 — 면제되는 것은 같은 손뿐이다.
  if (허락한손?.has?.(toolId)) return { 면제: true, 이유: '허락한손' };
  // ② 헌장 ③ — 사용자가 전에 **이 상대**에게 보내는 것을 직접 허락했으면 같은 질문의 반복이다.
  //    대상이 확정된 뒤에만 물을 수 있다(계획 단계에서는 어디로 보낼지 아직 모른다).
  if (전송인가) {
    const 대상 = String(판정인자?.target ?? '').trim();
    if (대상 && isKnownCounterpart(knownCounterparts, toolId, 대상)) return { 면제: true, 이유: '아는상대' };
  }
  return { 면제: false };
}
