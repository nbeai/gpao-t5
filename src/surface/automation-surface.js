const ACTIVE_AUTOMATION_STATES = new Set(['scheduled', 'paused', 'needs_review']);

export function projectAutomations(jobs = []) {
  return {
    active: jobs
      .filter((job) => ACTIVE_AUTOMATION_STATES.has(job.state))
      .map((job) => ({ id: job.id, label: job.name, state: job.state })),
  };
}

export function projectAgents(profiles = []) {
  return {
    active: profiles
      .filter((profile) => profile.state === 'active')
      .map((profile) => ({ id: profile.id, label: profile.name })),
  };
}

export function projectAutomationRun(run) {
  const projected = {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    scheduledFor: run.scheduledFor,
    finishedAt: run.finishedAt,
  };
  if (run.status !== 'failed' && run.status !== 'unknown') return projected;
  return {
    ...projected,
    userSafeSummary: run.status === 'unknown'
      ? '이전 실행의 마지막 상태를 확인하지 못했어요.'
      : '자동화 실행을 마치지 못했어요.',
    nextSafeAction: '원래 작업과 필요한 연결을 확인한 뒤 다시 시도해 주세요.',
  };
}
