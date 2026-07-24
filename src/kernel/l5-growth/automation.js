// L5 · Automation (P6-3). GrowthCandidate → 승인 → ScheduledJob → tick 실행 → ToolReceipt/원장 → 취소/만료.
// 핵심 원칙(깊은 감사):
//   1. 자동화는 절대 몰래 실행하지 않는다. 2. 후보는 실행이 아니다(승인 전 영향 0).
//   3. 승인된 자동화도 권한 범위·만료·취소·원장 기록을 가진다.
//   4. 외부 전송은 승인 범위(A2)를 유지한다. 5. 실패·차단·만료·취소는 원장에 정직하게 남는다.
//   (Hermes cron 단일 job 엔진 원리 흡수 — relay/daemon/config는 복제하지 않는다.)

export const JOB_STATES = Object.freeze(['scheduled', 'paused', 'cancelled', 'completed', 'expired', 'failed']);

// 반복 신호(자동화 후보 감지). 특정 대화 전용이 아니라 일반 언어 범주. 모델이 뒷단에서 정교화.
const RECURRENCE_SIGNAL = /매주|매일|매번|매달|정기|자동으로|주기적|스케줄|예약해|예약 ?해/;

/**
 * 자동화 후보 감지(자동 생성 아님 — 후보만). 반복 신호 + 실행 가능한 action이 있을 때.
 * @param {string} text
 * @param {{tool:string, args?:*}|null} [action]
 * @returns {{kind:'automation', statement:string, action:object|null}|null}
 */
export function detectAutomationCandidate(text, action = null) {
  const t = String(text ?? '').trim();
  if (!RECURRENCE_SIGNAL.test(t)) return null;
  return { kind: 'automation', statement: t, action };
}

/** GrowthCandidate 생성(승인 전 — 실행 아님, 영향 0). */
export function makeGrowthCandidate({ candidateId, statement, action, dedupKey }) {
  return { candidateId, kind: 'automation', statement, action: action ?? null, dedupKey, approved: false };
}

/**
 * 후보 승인 → ScheduledJob. grantScope(범위·만료)와 external(외부 전송 승인 경계)을 가진다.
 * @param {object} candidate
 * @param {{id:string, grantScope?:object, nextRunAt?:number, intervalMs?:number, external?:boolean, now?:number}} opts
 * @returns {object} ScheduledJob
 */
export function approveAutomation(candidate, opts) {
  const now = opts.now ?? 0;
  return {
    id: opts.id,
    action: candidate.action, // {tool, args}
    statement: candidate.statement,
    state: 'scheduled',
    createdAt: now,
    nextRunAt: opts.nextRunAt ?? now,
    intervalMs: opts.intervalMs, // 있으면 반복, 없으면 1회
    grantScope: opts.grantScope ?? { kind: 'persist' },
    external: opts.external ?? false, // 외부 전송 자동화는 승인 경계(A2)를 유지
    executions: [], // 실행 원장(ToolReceipt)
  };
}

/** 만료 여부(grantScope.expiresAt 지남). */
export function jobExpired(job, now) {
  return Boolean(job.grantScope?.expiresAt && now > job.grantScope.expiresAt);
}

/**
 * 지금 실행 가능한가. scheduled + 미만료 + nextRunAt 도달. 취소·완료·만료는 실행 금지(몰래 실행 0).
 * @param {object} job
 * @param {number} now
 */
export function isJobRunnable(job, now) {
  if (job.state !== 'scheduled') return false;      // 취소/완료/만료/일시정지는 실행 안 함
  if (jobExpired(job, now)) return false;           // 만료된 승인은 실행 안 함(재승인 필요)
  return (job.nextRunAt ?? 0) <= now;
}

/** 취소(되돌리기). 이후 tick에서 실행되지 않는다. */
export function cancelJob(job) {
  return { ...job, state: 'cancelled' };
}

/**
 * tick 트리거 경계(§8.3) — tick은 사용자 행동이 아니라 **런타임 이벤트**다. 일반 사용자가 누르는
 * 버튼처럼 tick을 돌릴 수 없다. §1.5 InboundEventGate와 동일 계약으로 `trusted_runtime_event`만 admit한다.
 * (`automation_trigger`는 게이트 대상 외부 이벤트라 tick 트리거가 아니다 — 여기선 불허.)
 * @param {{source?:string}} trigger
 * @returns {boolean}
 */
export function admitTickTrigger(trigger) {
  return trigger?.source === 'trusted_runtime_event';
}

/**
 * AutomationLedger — 자동화 실행 진실 원장(§8). 세션 TruthLedger와 **분리된** job별 원장이다.
 * 자동화는 세션 밖 백그라운드에서 돌기 때문에 세션 원장에 섞지 않는다. 실행 기록은 TruthLedger와
 * 동일한 ToolReceipt 계약을 쓴다(성공·실패·차단을 정직하게). 원장 추가는 이 함수로만 한다.
 * @param {object} job   ScheduledJob (executions = AutomationLedger)
 * @param {import('../contracts.js').ToolReceipt} receipt
 * @returns {import('../contracts.js').ToolReceipt}
 */
export function appendAutomationLedger(job, receipt) {
  job.executions.push(receipt);
  return receipt;
}
