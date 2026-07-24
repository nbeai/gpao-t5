// L3 · ToolRunner — 도구 실행 런타임. 실행 가능 게이트를 통과한 것만 실제 호출한다.
// 결과는 항상 ToolReceipt 로 기록한다(못 쓴 도구를 쓴 척 금지). 진단면은 diagnosticTrace 로 분리.
import { receipt, blockedReceipt } from '../kernel/l0-evidence/tool-receipt.js';
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
          userSafeSummary: out.userSafeSummary ?? `${toolId} 대상이 접근을 막았어요.`,
          diagnosticTrace: out.diagnosticTrace,
          nextSafeAction: out.nextSafeAction ?? '공개 자료/대체 경로로 이어갈까요?',
        });
      }
      return receipt({
        intended,
        actualCall: { tool: toolId, args },
        result: out?.result ?? out,
        failureState: FAILURE.NONE,
        // 출처 근거를 원장에 함께 남긴다(P6-2). 웹 도구는 sources 없이 성공을 반환하지 못한다.
        sources: out?.sources,
        userSafeSummary: out?.userSafeSummary ?? `${toolId} 실행 완료.`,
      });
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
