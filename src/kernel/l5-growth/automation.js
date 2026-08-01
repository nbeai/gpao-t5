// L5 · Automation. GrowthCandidate and field-level AutomationJob commands.
// 핵심 원칙(깊은 감사):
//   1. 자동화는 절대 몰래 실행하지 않는다. 2. 후보는 실행이 아니다(승인 전 영향 0).
//   3. 승인된 자동화도 권한 범위·만료·취소·원장 기록을 가진다.
//   4. 외부 전송은 승인 범위(A2)를 유지한다. 5. 실패·차단·만료·취소는 원장에 정직하게 남는다.
//   (Hermes cron 단일 job 엔진 원리 흡수 — relay/daemon/config는 복제하지 않는다.)

import { classifyRetry } from '../l2-plan/tool-descriptor.js';
import { containsSensitiveValue } from '../l0-evidence/sensitive-text.js';

export const JOB_STATES = Object.freeze(['scheduled', 'paused', 'cancelled', 'completed', 'expired', 'failed']);

// 신뢰성 기본값(P6-4). 무한 재전송·즉시 재시도 폭주를 막는다.
export const DEFAULT_MAX_ATTEMPTS = 5;      // transient 실패 재시도 상한 → 초과 시 정직하게 failed
export const BACKOFF_BASE_MS = 1_000;       // 백오프 기준(지수)
export const BACKOFF_CAP_MS = 3_600_000;    // 백오프 상한(1시간) — 무한정 벌어지지 않게

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
 * W1·AC-1 재대조 R2b · **자동화 후보도 기억과 같은 민감 경계를 지난다.**
 * statement 는 사용자 발화 원문이고 action.args 는 계약상 `*`(임의 구조)다 — 어느 쪽이든
 * 민감값이 있으면 durable(automation.json)로 두지 않는다. 기억 저장선의 `기억저장가능`
 * (server.js)과 같은 공용 경계(containsSensitiveValue) 하나를 쓴다(두 진실 금지).
 *
 * W1 감사 보완(Codex 2026-08-02): 첫 판은 최상위 문자열만 봐서 `{auth:{password}}`·
 * `{headers:["Bearer …"]}` 가 통과했다 — 반대시험을 계약(`args?: *`)이 아니라 구현 모양에서
 * 뽑은 실수. 지금은 **구조 전체를 순회**한다: 중첩 object·배열, 키 이름까지. 순환은 한 번만
 * 방문하고, 깊이 상한을 넘는 구조는 **다 봤다고 말할 수 없으므로 저장 불가**로 닫는다
 * (못 본 것을 안전하다고 말하지 않는다 — fail-closed).
 */
const 인자순회최대깊이 = 32;

// 키 이름이 곧 라벨인 구조(`{password: "..."}`)는 텍스트 경계가 못 본다 — 값이 맨 값이기
// 때문이다. 파일 손의 SECRET_NAMES 와 같은 원리로 **구조의 이름**을 본다(임의 낱말 추측 아님).
const 민감키 = /^(password|passwd|pass|pw|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth|credential|credentials|비밀번호|암호|인증키)$/i;

/** 이 가지 안에 **비어 있지 않은 값**이 하나라도 있는가(라벨 아래 지킬 것이 실재하는가). */
function 값이있나(value, depth, seen) {
  if (typeof value === 'string') return value.trim().length >= 4;
  if (typeof value === 'number' || typeof value === 'bigint') return true;
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value) || depth > 인자순회최대깊이) return false;
  seen.add(value);
  return 자식들(value).some((v) => 값이있나(v, depth + 1, seen));
}

/** 컨테이너의 자식 값들. object·배열만 보면 Map·Set 이 통째로 순회에서 빠진다. */
function 자식들(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.keys(), ...value.values()];
  if (value instanceof Set) return [...value];
  return Object.values(value);
}

function 인자에민감값(value, depth, seen) {
  if (typeof value === 'string') return containsSensitiveValue(value);
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;      // 순환 — 이미 본 가지다
  if (depth > 인자순회최대깊이) return true; // 못 본 깊이를 안전하다고 말하지 않는다
  seen.add(value);
  // 키가 라벨인 구조는 **라벨과 값이 떨어지지 않게** 본다. 값이 컨테이너여도 마찬가지다 —
  // 아래로 내려가면 라벨을 잃은 맨 값이 되어 텍스트 경계가 못 잡는다(S 공정감시 실측).
  const 엔트리 = value instanceof Map ? [...value.entries()]
    : (Array.isArray(value) || value instanceof Set) ? [] : Object.entries(value);
  for (const [k, v] of 엔트리) {
    if (민감키.test(String(k)) && 값이있나(v, depth + 1, new WeakSet())) return true;
  }
  return 자식들(value).some((v) => 인자에민감값(v, depth + 1, seen));
}

export function 자동화후보저장가능(candidate) {
  const statement = String(candidate?.statement ?? '');
  if (containsSensitiveValue(statement)) return false;
  return !인자에민감값(candidate?.action?.args, 0, new WeakSet());
}

/** One-record candidate command for the parent-owned store adapter. */
export function automationCandidateAddDelta(candidate) {
  if (!candidate?.candidateId) throw new TypeError('automation candidate id is required');
  if (!자동화후보저장가능(candidate)) throw new TypeError('automation candidate contains sensitive data');
  return {
    kind: 'automation_candidate.add',
    candidateId: candidate.candidateId,
    dedupKey: candidate.dedupKey ?? null,
    expected: { candidateIdAbsent: true, dedupKeyAbsent: candidate.dedupKey ?? null },
    record: structuredClone(candidate),
  };
}

/** Field-level job command; never carries or rewrites the jobs array. */
export function automationJobPatchDelta(job, changes, { reason, now }) {
  if (!job?.id) throw new TypeError('automation job id is required');
  if (!Number.isFinite(now)) throw new TypeError('automation job delta time must be finite');
  return {
    kind: 'automation_job.patch',
    jobId: job.id,
    expected: {
      state: job.state,
      updatedAt: job.updatedAt,
      nextRunAt: job.nextRunAt,
      triggerNextRunAt: job.trigger?.nextRunAt,
    },
    changes: { ...structuredClone(changes), updatedAt: now },
    reason,
  };
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
    executions: [], // v1 compatibility only; AC-3 scheduler never reads or writes this array
    // 신뢰성(P6-4): 연속 실패 카운트·재시도 상한·백오프 파라미터.
    failureCount: 0,
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: opts.backoffBaseMs ?? BACKOFF_BASE_MS,
    backoffCapMs: opts.backoffCapMs ?? BACKOFF_CAP_MS,
  };
}

/**
 * 지수 백오프 지연(ms). failureCount=1→base, 2→2·base, 3→4·base … cap에서 포화.
 * @param {number} failureCount
 * @param {{baseMs?:number, capMs?:number}} [opts]
 */
export function nextBackoffMs(failureCount, opts = {}) {
  const baseMs = opts.baseMs ?? BACKOFF_BASE_MS;
  const capMs = opts.capMs ?? BACKOFF_CAP_MS;
  const n = Math.max(1, failureCount);
  return Math.min(capMs, baseMs * 2 ** (n - 1));
}

/**
 * 실행 결과 → 다음 상태·실행 계획(순수). 백오프·포기·재예약·완료를 한곳에서 결정한다(P6-4).
 * - 성공: failureCount 리셋. 반복이면 재예약, 아니면 완료.
 * - permanent(차단·취소): 재시도로 안 풀린다 → 즉시 failed(무한 재전송 차단).
 * - transient(실패·타임아웃): 백오프 재시도. maxAttempts 도달 시 정직하게 failed.
 * @param {object} job
 * @param {import('../contracts.js').FailureState} failureState
 * @param {number} now
 * @returns {{state:string, failureCount:number, nextRunAt?:number}}
 */
export function resolveAfterRun(job, failureState, now) {
  const retry = classifyRetry(failureState);
  if (retry === 'none') {
    if (job.intervalMs) return { state: 'scheduled', nextRunAt: now + job.intervalMs, failureCount: 0 };
    return { state: 'completed', failureCount: 0 };
  }
  const failureCount = (job.failureCount ?? 0) + 1;
  if (retry === 'permanent') return { state: 'failed', failureCount };
  // transient
  if (failureCount >= (job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)) return { state: 'failed', failureCount };
  const delay = nextBackoffMs(failureCount, { baseMs: job.backoffBaseMs, capMs: job.backoffCapMs });
  return { state: 'scheduled', nextRunAt: now + delay, failureCount };
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

/** @deprecated v1 runtime compatibility until the parent switches RunLedger wiring. */
export function appendAutomationLedger(job, receipt) {
  job.executions.push(receipt);
  return receipt;
}
