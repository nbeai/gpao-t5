// L3 · Automation Engine — in-process scheduler tick(최소). 실제 cron/daemon은 P6 후속.
// 실행 가능한 job만 실행한다. 취소·만료·완료는 실행 0(몰래 실행 금지). 결과는 job.executions(원장)에.
import { isJobRunnable, jobExpired, appendAutomationLedger, resolveAfterRun } from '../kernel/l5-growth/automation.js';
import { toolActionKind } from '../kernel/l2-plan/action-plan.js';
import { classifyTier } from '../kernel/l2-plan/authority.js';
import { blockedReceipt } from '../kernel/l0-evidence/tool-receipt.js';
import { TIER } from '../kernel/contracts.js';

/**
 * @param {object[]} jobs   ScheduledJob 목록(변경됨 — state·executions 갱신)
 * @param {{tools:object, selfState:object, now:number}} ctx
 * @returns {Promise<Array<{jobId:string, receipt:object}>>} 이번 tick에 실행된 것
 */
export async function tickAutomation(jobs, ctx) {
  const { tools, selfState, now } = ctx;
  const ran = [];
  for (const job of jobs) {
    // 만료된 scheduled는 실행하지 않고 expired로 정직하게 남긴다(재승인 필요).
    if (job.state === 'scheduled' && jobExpired(job, now)) {
      job.state = 'expired';
      continue;
    }
    if (!isJobRunnable(job, now)) continue; // 취소/완료/만료/미도달은 실행 0

    // **되돌릴 수 없는 행동(A3)은 사람 없이 실행하지 않는다.** tick 에는 확인해 줄 사람이 없다.
    // 승인은 "이 일을 반복해도 좋다"는 뜻이지 "삭제·결제·게시를 무인으로 해도 좋다"가 아니다.
    // 실제로 샜다: 턴이 삭제를 승인 카드로 막았는데, 같은 삭제가 자동화 후보로 저장돼 tick 에서
    // 그대로 실행됐다. 도구가 아니라 **행동 종류**로 판정한다(승인 경로와 같은 함수).
    const kind = toolActionKind({ toolId: job.action.tool, args: job.action.args, selfState });
    if (classifyTier({ kind }) === TIER.A3) {
      const rec = blockedReceipt(
        `${job.action.tool} 자동 실행`,
        job.action.tool,
        '되돌리기 어려운 일이라 자동으로는 하지 않았어요.',
        '지금 확인해 주시면 이번 것만 실행할게요.',
      );
      appendAutomationLedger(job, rec);
      job.state = 'paused'; // 조용히 사라지지 않는다 — 사용자가 다시 켜거나 취소한다
      continue;
    }

    const rec = await tools.run(job.action.tool, job.action.args ?? {}, selfState);
    appendAutomationLedger(job, rec); // AutomationLedger(§8) — ToolReceipt 계약, 세션 원장과 분리

    // 상태·다음 실행 계획을 순수 전이 함수로 결정(P6-4): 성공 리셋 / permanent 즉시 포기 / transient 백오프.
    const next = resolveAfterRun(job, rec.failureState, now);
    job.state = next.state;
    job.failureCount = next.failureCount;
    if (next.nextRunAt !== undefined) job.nextRunAt = next.nextRunAt;
    ran.push({ jobId: job.id, receipt: rec });
  }
  return ran;
}
