// L3 · ToolRunner — 도구 실행 런타임. 실행 가능 게이트를 통과한 것만 실제 호출한다.
// 결과는 항상 ToolReceipt 로 기록한다(못 쓴 도구를 쓴 척 금지). 진단면은 diagnosticTrace 로 분리.
import { receipt, blockedReceipt } from '../kernel/l0-evidence/tool-receipt.js';

/**
 * **다음 턴에 이어야 할 대상은 도구가 낸다.** `previewOf(args)` 와 같은 모양의 계약이다.
 *
 * 예전엔 커널(working-state.js)이 `if (tool === 'web.collect') … if (tool === 'local.file') …`
 * 로 도구 이름을 알아봤다. 이미 세 번 새어 본 패턴이다 — 새 도구가 생기면 커널을 고쳐야 하고,
 * 안 고치면 그 도구만 조용히 다음 턴으로 안 이어진다(실제로 `local.locate` 가 그랬다).
 * P5 에서 채널·외부 API·MCP·CLI 가 붙으면 같은 누수가 그만큼 커진다.
 *
 * 그래서 **영수증에 실어 보낸다.** 영수증이 진실이고, 자기 결과를 아는 건 도구뿐이다.
 * 커널은 이제 도구 이름을 모른다 — `receipt.subject` 를 그대로 얹기만 한다.
 * 계약을 안 낸 도구는 이어지지 않을 뿐 아무것도 깨지 않는다(조용한 실패가 아니라 조용한 미참여).
 */
function withSubject(rec, tool) {
  let s;
  try { s = tool.subjectOf?.(rec); } catch { return rec; }
  // 최소 계약만 확인한다 — 무엇으로 이어갈지(key), 어떤 종류인지(kind), 사람이 부를 이름(label).
  if (!s || !s.key || !s.kind || !s.label) return rec;
  return { ...rec, subject: s };
}
import { isToolExecutable } from '../kernel/l0-evidence/self-state.js';
import { assertWebEvidence } from '../kernel/l2-plan/web-tool.js';
import { FAILURE } from '../kernel/contracts.js';

export class ToolRunner {
  /**
   * @param {Record<string, {handler: (args:*) => Promise<*>}>} tools
   */
  constructor(tools = {}) {
    this.tools = tools;
  }

  /**
   * @param {string} toolId
   * @param {*} args
   * @param {import('../kernel/contracts.js').SelfStateSnapshot} selfState
   * @returns {Promise<import('../kernel/contracts.js').ToolReceipt>}
   */
  async run(toolId, args, selfState) {
    const intended = `${toolId} 실행`;

    // 1) SelfState 실행 가능 게이트: 목록에 있어도 executable=false 면 호출하지 않는다.
    if (!isToolExecutable(selfState, toolId)) {
      return blockedReceipt(
        intended,
        toolId,
        `${toolId} 은 아직 실행 준비가 안 됐어요.`,
        `${toolId} 연결/권한을 준비하면 이어서 할 수 있어요.`,
      );
    }

    const tool = this.tools[toolId];
    if (!tool || typeof tool.handler !== 'function') {
      return blockedReceipt(intended, toolId, `${toolId} 을 지금 사용할 수 없어요.`);
    }

    // 2) 실제 호출. 실패는 failureState 로 정직하게, 원인은 진단면으로 분리.
    try {
      const out = await tool.handler(args);
      // 출처 원장 필수 도구(웹 등)는 계약을 런타임이 강제한다 — handler 관례에 맡기지 않는다(감사 보정 1).
      // 출처 없는 성공·내용 담은 실패는 계약 위반이므로 failed로 떨어뜨린다("못 본 걸 본 척" 차단).
      if (tool.sourceLedgerRequired) {
        try {
          assertWebEvidence(out);
        } catch (e) {
          return receipt({
            intended,
            actualCall: { tool: toolId, args },
            failureState: FAILURE.FAILED,
            userSafeSummary: '출처를 확인하지 못해 결과를 신뢰할 수 없어요.',
            diagnosticTrace: { reason: e?.message },
            nextSafeAction: '출처가 있는 방법으로 다시 시도할까요?',
          });
        }
      }
      if (out && out.blocked) {
        return receipt({
          intended,
          actualCall: { tool: toolId, args },
          failureState: FAILURE.BLOCKED,
          // 어떤 종류로 막혔는지(사이트 차단·로그인벽·범위 밖…)를 잃지 않는다 — 다음 계단을 그걸로 정한다.
          fetchState: out.fetchState,
          scopeState: out.scopeState,
          surfaceRequest: out.surfaceRequest,
          userSafeSummary: out.userSafeSummary ?? `${toolId} 대상이 접근을 막았어요.`,
          diagnosticTrace: out.diagnosticTrace,
          nextSafeAction: out.nextSafeAction ?? '공개 자료/대체 경로로 이어갈까요?',
        });
      }
      // transient 실패(재시도 여지) — handler가 정직한 사용자면 메시지와 함께 알린다. blocked(permanent)와 분리.
      if (out && out.failed) {
        return receipt({
          intended,
          actualCall: { tool: toolId, args },
          failureState: FAILURE.FAILED,
          userSafeSummary: out.userSafeSummary ?? `${toolId} 실행에 실패했어요.`,
          diagnosticTrace: out.diagnosticTrace,
          nextSafeAction: out.nextSafeAction ?? '잠시 후 다시 시도할까요?',
        });
      }
      return withSubject(receipt({
        intended,
        actualCall: { tool: toolId, args },
        result: out?.result ?? out,
        failureState: FAILURE.NONE,
        // 출처 근거를 원장에 함께 남긴다(P6-2). 웹 도구는 sources 없이 성공을 반환하지 못한다.
        sources: out?.sources,
        userSafeSummary: out?.userSafeSummary ?? `${toolId} 실행 완료.`,
      }), tool);
    } catch (err) {
      return receipt({
        intended,
        actualCall: { tool: toolId, args },
        failureState: FAILURE.FAILED,
        userSafeSummary: `${toolId} 실행 중 문제가 있었어요.`, // 내부 오류 비노출
        diagnosticTrace: { message: err?.message, stack: err?.stack },
        nextSafeAction: '잠시 후 다시 시도할까요?',
      });
    }
  }
}
