// 표면 · tick 스케줄러 — **한 tick 안에서 네 기관이 서로의 실행 기회를 뺏지 않는다.**
//
// 왜 파일이 따로 있나(HRT-ST-001): 이 142줄은 `makeServer` 안에 있었지만 이미 사실상 닫혀
// 있었다 — 자동화·관찰·성장·감쇠 워커와 그 격리 상태(`관찰상태`·`성장상태`·`ticking`)를
// **바깥이 한 번도 참조하지 않았다.** 바깥과 닿는 것은 `runTrustedTick` 하나뿐이다.
// 그런데 파일을 같이 쓰는 바람에, 작은 다듬기도 승인·기억·채널·저장과 함께 흔들렸다.
//
// 이 추출은 **행동 보존**이다. 라우트 주소도, 응답 구조도, 저장 형식도, 모델 호출 수도
// 바꾸지 않는다. 옮긴 것은 자리뿐이고 규율은 원래 자리의 주석 그대로 남겼다.
import { admitTickTrigger } from '../kernel/l5-growth/automation.js';
import { observeSessions } from '../kernel/l5-growth/tcell-observe.js';
import { growTick } from '../kernel/l5-growth/tcell-grow.js';
import { applyDecay } from '../kernel/l5-growth/tcell-decay.js';
import { buildSelfState } from '../kernel/l0-evidence/self-state.js';

/**
 * @param {object} io 바깥에서 받는 것만 받는다 — 이 모듈은 store 를 만들지 않는다.
 * @param {object} io.store         세션 저장소(관찰이 읽는다)
 * @param {object} io.memStore      기억 저장소
 * @param {(fn:Function)=>Promise<*>} io.withMemory 기억 자물쇠
 * @param {(event:string, entry:*)=>Promise<*>} io.기억영수증 감쇠 사실을 원장에 남긴다
 * @param {object} io.automationRuntime
 * @param {()=>Promise<*>} io.automationReady
 * @param {(role:string)=>*} io.modelFor 역할 연결이 없으면 기본 연결로 떨어진다
 * @param {object} io.env
 * @param {object} io.tools
 * @param {()=>boolean} io.관찰꺼짐 호출마다 다시 읽는다 — 켜고 끄는 것이 실행 중에 바뀐다
 * @returns {{ runTrustedTick: (trigger:*)=>Promise<*>, 관찰상태보기: ()=>object }}
 */
export function makeTickScheduler({
  store, memStore, withMemory, 기억영수증,
  automationRuntime, automationReady,
  deliverAutomationRuns,
  modelFor, env, tools, 관찰꺼짐,
}) {
  // 자동화 워커 — 자기 오류 경계를 갖는다. 여기서 터져도 관찰은 같은 tick 에서 계속 돈다.
  async function 자동화워커() {
    try {
      await automationReady();
      const tick = await automationRuntime.tick();
      const delivery = typeof deliverAutomationRuns === 'function'
        ? await deliverAutomationRuns(tick.runs) : { statuses: [] };
      const deliveryByRun = new Map((delivery.statuses ?? []).map((entry) => [entry.runId, entry.status]));
      return {
        ran: tick.runs.map((run) => ({
          runId: run.id, jobId: run.jobId, status: run.status,
          ...(deliveryByRun.has(run.id) ? { deliveryStatus: deliveryByRun.get(run.id) } : {}),
        })),
        claimed: tick.claimed.length,
        duplicates: tick.duplicates.length,
      };
    } catch (e) {
      console.error('[automation:tick] 실패 — 관찰과 사용자 턴은 그대로 돕니다:', e?.message ?? e);
      return { failed: true, error: e?.message ?? String(e) };
    }
  }

  // S2 · 관찰 워커. tick 과 같은 스케줄러를 쓰되 오류 경계는 따로 둔다(§4.8).
  // 연속 실패 3회면 워커만 끄고 사람 말로 남긴다 — 성장이 멈춰도 대화와 자동화는 돈다.
  const 관찰상태 = { 연속실패: 0, 격리됨: false, 마지막오류: null };
  async function 관찰워커() {
    if (관찰상태.격리됨 || 관찰꺼짐()) return null;
    try {
      const r = await withMemory(() => observeSessions({ store, memStore: memStore, now: Date.now() }));
      관찰상태.연속실패 = 0;
      return r;
    } catch (e) {
      관찰상태.연속실패 += 1;
      관찰상태.마지막오류 = e?.message ?? String(e);
      if (관찰상태.연속실패 >= 3) {
        관찰상태.격리됨 = true;
        console.error('[tcell:observe] 연속 실패로 관찰을 멈춥니다. 대화와 자동화는 그대로 돕니다.');
      }
      return { failed: true, isolated: 관찰상태.격리됨 };
    }
  }
  // S4 · 성장 워커. 관찰과 **또 다른** 오류 경계를 갖는다 — 성장이 죽어도 관찰은 계속 돈다.
  // 성장은 모델을 부르므로 실패가 더 잦다(자격·요금·형식). 그래서 격리가 더 중요하다.
  const 성장상태 = { 연속실패: 0, 격리됨: false, 마지막오류: null };
  const 성장실패사유 = new Set(['call_failed', 'call_identity_unverified', 'corrupted']);
  async function 성장워커() {
    if (성장상태.격리됨 || 관찰꺼짐()) return null;
    try {
      // **`withMemory` 로 감싸지 않는다**(계획 §4.8). 성장 워커가 자물쇠를 직접 들고 고르기·반영에만
      // 잠깐 쓴다 — 모델을 기다리는 동안 사용자의 기억 저장이 멈추면 안 된다.
      const r = await growTick({
        memStore, store, withMemory,
        // 성장은 역할 연결(growth)이 있으면 그것으로, 없으면 기본 연결로 간다(막다른 답 금지).
        // 연결 관리자가 없으면 성장 호출은 신분을 못 만들고 §4.4 에서 그대로 떨어진다.
        modelFor, now: Date.now(),
        // **OS 기계 사실 공급** — 명시 승인 도구 집합(descriptor 단일 진실). 원리를 낳은 원천
        // 턴의 영수증에 이 도구의 실행이 있으면 성장은 그 원리를 무조건 권한 접촉으로 다룬다.
        approvalTools: (buildSelfState(env, { tools }).connectedTools ?? [])
          .filter((t) => t?.needsApproval === true).map((t) => t.id).filter(Boolean),
      });
      // 성장 워커는 실패를 예외가 아니라 **사유**로 돌려준다(§4.8 격리 판정의 입력).
      // 할 일이 없어서 쉰 tick(`idle`)은 성공도 실패도 아니다 — 세지 않는다.
      if (성장실패사유.has(r?.reason)) {
        성장상태.연속실패 += 1;
        성장상태.마지막오류 = r.reason;
        if (성장상태.연속실패 >= 3) {
          성장상태.격리됨 = true;
          console.error('[tcell:grow] 연속 실패로 성장을 멈춥니다. 대화·관찰·자동화는 그대로 돕니다.');
        }
        return { failed: true, reason: r.reason, isolated: 성장상태.격리됨 };
      }
      if (r?.action) 성장상태.연속실패 = 0;
      return r;
    } catch (e) {
      성장상태.연속실패 += 1;
      성장상태.마지막오류 = e?.message ?? String(e);
      if (성장상태.연속실패 >= 3) {
        성장상태.격리됨 = true;
        console.error('[tcell:grow] 연속 실패로 성장을 멈춥니다. 대화·관찰·자동화는 그대로 돕니다.');
      }
      return { failed: true, isolated: 성장상태.격리됨 };
    }
  }

  // S5-4 · 감쇠 워커. **자동으로 돌되 되돌릴 수 있다** — 승인을 요구하지 않는 대신(자동성이
  // 의무다) 무엇이 왜 내려갔는지를 원장과 표면에 남긴다. 근거는 독립 정정 상관뿐이고,
  // 미사용·오래됨은 근거가 아니다. 실패해도 대화는 그대로 돈다.
  async function 감쇠워커() {
    if (관찰꺼짐()) return null;
    try {
      let 내린것 = [];
      await withMemory(async () => {
        const m = await memStore.load();
        if (m.corrupted) return;
        const r = applyDecay(m, { now: Date.now() });
        if (!r.decayed.length) return;
        내린것 = r.decayed;
        await memStore.save(m);
      });
      // 원장은 저장 뒤에 남긴다 — 상태가 행동의 진실이고, 원장 실패가 감쇠를 되돌리지 않는다.
      for (const d of 내린것) {
        const e = (await memStore.load()).promoted.find((x) => (x.candidateId ?? x.principleId) === d.ref);
        await 기억영수증('decayed', e ?? { candidateId: d.ref, kind: d.kind });
      }
      return { decayed: 내린것 };
    } catch (e) {
      console.error('[tcell:decay] 실패 — 대화는 그대로 돕니다:', e?.message ?? e);
      return { failed: true };
    }
  }

  // tick 실행의 단일 경로(트러스트 게이트). trusted_runtime_event만 실행한다(admitTickTrigger).
  // tick 중첩 방지(P6-4): 이전 tick이 아직 도는 중이면 새 tick은 건너뛴다 — load→save 경합·중복 실행 차단.
  let ticking = false;
  async function runTrustedTick(trigger) {
    if (!admitTickTrigger(trigger)) return { ok: false, reason: 'not_trusted', ran: [] };
    if (ticking) return { ok: true, skipped: 'in_flight', ran: [] };
    ticking = true;
    try {
      // S2 · §4.8 상호 실패 격리 — **한 tick 안에서 두 기관이 서로의 실행 기회를 뺏지 않는다.**
      // 예전에는 자동화가 먼저 예외를 던지면 관찰워커까지 도달하지 못했다(감사 P1). 각자
      // 자기 오류 경계 안에서 돌고, 실패는 숨기지 않고 결과에 실어 보낸다.
      const 자동화 = await 자동화워커();
      const 관찰 = await 관찰워커();
      // 성장은 관찰이 만든 묶음을 먹으므로 같은 tick 의 **뒤**에 온다. 실패해도 앞의 둘은 이미 끝났다.
      const 성장 = await 성장워커();
      // 감쇠는 관찰·성장이 남긴 상관 위에서 돈다 — 같은 tick 의 맨 뒤다.
      const 감쇠 = await 감쇠워커();
      return {
        ok: true,
        ran: 자동화.ran ?? [],
        ...(감쇠 ? { decay: 감쇠 } : {}),
        ...(자동화.failed ? { automation: { failed: true, error: 자동화.error } } : {}),
        ...(관찰 ? { observe: 관찰 } : {}),
        ...(성장 ? { grow: 성장 } : {}),
      };
    } finally {
      ticking = false;
    }
  }

  // 관찰 워커의 격리 상태는 **진단면으로 바깥이 읽는다**(server.tcellObserveState).
  // 사본을 준다 — 바깥이 격리를 손으로 풀 수 있으면 격리가 아니다.
  const 관찰상태보기 = () => ({ ...관찰상태 });

  return { runTrustedTick, 관찰상태보기 };
}
