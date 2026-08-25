import { createHash, randomBytes } from 'node:crypto';

function productionHandle({ runId }) {
  return `paused_${createHash('sha256').update(String(runId)).update('\0')
    .update(randomBytes(32)).digest('hex').slice(0, 32)}`;
}

export function makePausedWorkScope({ store, runId, makeHandle = productionHandle } = {}) {
  if (!store || !runId) throw new TypeError('paused work scope identity is required');
  const byHandle = new Map(); const byWorkId = new Map(); let sequence = 0;
  async function candidates({ sessionId, conversation } = {}) {
    const state = await store.read(); const entries = conversation?.entries ?? []; const projected = [];
    for (const work of state.works.filter((item) => item.sessionId === sessionId && item.status === 'paused').slice(-8)) {
      const source = entries.find((entry) => entry.messageId === work.sourceMessageId);
      const title = String(source?.message?.content ?? '').trim().slice(0, 160); if (!title) continue;
      let record = byWorkId.get(work.workId);
      if (!record) {
        sequence += 1; const handle = String(makeHandle({ runId, sequence }));
        if (!/^paused_[A-Za-z0-9_-]{8,80}$/u.test(handle) || byHandle.has(handle)) {
          throw new Error('invalid or duplicate paused work handle');
        }
        record = { handle, workId: work.workId, revision: work.revision };
        byHandle.set(handle, record); byWorkId.set(work.workId, record);
      }
      projected.push({ handle: record.handle, title,
        lastActivity: source?.recordedAt ?? null, sourceKind: 'conversation' });
    }
    return projected;
  }
  async function resolve(handle) {
    const record = byHandle.get(String(handle ?? ''));
    if (!record) throw new Error('paused work target handle is unknown');
    const state = await store.read(); const work = state.works.find((item) => item.workId === record.workId);
    if (!work || work.status !== 'paused' || work.revision !== record.revision) {
      throw new Error('paused work target handle is stale');
    }
    return { workId: work.workId, revision: work.revision };
  }
  return { candidates, resolve };
}
