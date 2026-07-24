// L3 · Automation Engine — in-process scheduler tick(최소). 실제 cron/daemon은 P6 후속.
// 실행 가능한 job만 실행한다. 취소·만료·완료는 실행 0(몰래 실행 금지). 결과는 job.executions(원장)에.
import { isJobRunnable, jobExpired, appendAutomationLedger, resolveAfterRun } from '../kernel/l5-growth/automation.js';

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
