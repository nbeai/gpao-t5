const BACKENDS = [
  { backend: 'ssh', pattern: /\bssh\b|원격\s*(?:서버|호스트)|remote\s+(?:server|host)/i },
  { backend: 'docker', pattern: /\bdocker\b|\bpodman\b|컨테이너|container/i },
  { backend: 'cloud', pattern: /cloud\s+(?:sandbox|workspace)|클라우드\s*(?:샌드박스|작업공간)/i },
  { backend: 'hpc', pattern: /\bhpc\b|\bslurm\b|\bsingularity\b|\bapptainer\b|클러스터/i },
];

export function assessBackendDemand(runs = []) {
  const signals = [];
  for (const run of runs) {
    const source = [run.request, ...(run.events ?? []).flatMap((event) => (
      event.type === 'tool_started' ? [event.payload?.args?.command] : []
    ))].filter(Boolean).join('\n');
    for (const candidate of BACKENDS) {
      if (candidate.pattern.test(source)) signals.push({
        runId: run.runId, backend: candidate.backend, evidence: 'request_or_tool_call',
      });
    }
  }
  return { required: signals.length > 0, inspectedRuns: runs.length, signals };
}
