import { randomUUID } from 'node:crypto';

const processStartedAt = Math.trunc(Date.now() - process.uptime() * 1_000);
const activeLocalRuntimes = new Set();

function defaultPidState(pid) {
  try { process.kill(pid, 0); return 'live'; }
  catch (error) { return error?.code === 'ESRCH' ? 'definitely_dead' : 'unknown'; }
}

export function makeLocalAutomationOwner({
  runtimeId = randomUUID(), pid = process.pid, startedAt = processStartedAt,
  pidState = defaultPidState,
} = {}) {
  const owner = Object.freeze({
    runtimeId: String(runtimeId), generation: 1,
    platformIdentity: { kind: 'node_process', pid, startedAt },
  });
  return {
    owner,
    activate() { activeLocalRuntimes.add(owner.runtimeId); },
    deactivate() { activeLocalRuntimes.delete(owner.runtimeId); },
    async inspect(candidate) {
      const identity = candidate?.platformIdentity;
      if (!identity || identity.kind !== 'node_process' || !Number.isInteger(identity.pid)
        || !Number.isFinite(identity.startedAt)) return 'unknown';
      if (identity.pid === pid && identity.startedAt === startedAt) {
        return activeLocalRuntimes.has(candidate.runtimeId) ? 'live' : 'definitely_dead';
      }
      return pidState(identity.pid);
    },
  };
}
