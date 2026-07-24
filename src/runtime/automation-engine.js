// L3 · Automation Engine — in-process scheduler tick(최소). 실제 cron/daemon은 P6 후속.
// 실행 가능한 job만 실행한다. 취소·만료·완료는 실행 0(몰래 실행 금지). 결과는 job.executions(원장)에.
import { isJobRunnable, jobExpired, appendAutomationLedger } from '../kernel/l5-growth/automation.js';

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

    if (rec.failureState !== 'none') {
      // 실패·차단은 정직하게. 반복 job은 다음 실행 여지, 1회 job은 failed.
      job.state = job.intervalMs ? 'scheduled' : 'failed';
    } else if (job.intervalMs) {
      job.state = 'scheduled';
    } else {
      job.state = 'completed'; // 1회 실행 완료
    }
    if (job.intervalMs) job.nextRunAt = now + job.intervalMs;
    ran.push({ jobId: job.id, receipt: rec });
  }
  return ran;
}
