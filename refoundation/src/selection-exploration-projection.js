import { createHash } from 'node:crypto';

const clone = (value) => structuredClone(value);
const publicHandle = (kind, value) => `${kind}_${createHash('sha256')
  .update(`${kind}\0${String(value)}`).digest('hex').slice(0, 24)}`;

export function projectSelectionExplorations(events = []) {
  const branches = new Map();
  for (const event of events) {
    if (event.type === 'selection_exploration_opened') {
      branches.set(event.explorationId, { explorationId: event.explorationId,
        state: 'open', anchor: clone(event.anchor), messages: [], runs: [],
        apply: { state: 'not_requested' }, openedAt: event.recordedAt });
    }
    const branch = branches.get(event.explorationId);
    if (!branch) continue;
    if (event.type === 'selection_side_message_appended') branch.messages.push({
      sideMessageId: event.sideMessageId, role: event.role, content: event.content,
      runId: event.runId ?? null, recordedAt: event.recordedAt,
    });
    if (event.type === 'selection_side_run_started') {
      branch.state = 'answering'; branch.runs.push({ runId: event.runId,
        state: 'running', recordedAt: event.recordedAt });
    }
    if (event.type === 'selection_side_run_settled') {
      const run = branch.runs.find((item) => item.runId === event.runId);
      if (run) Object.assign(run, { state: event.state, settledAt: event.recordedAt });
      branch.state = event.state === 'completed' ? 'open' : event.state;
    }
    if (event.type === 'selection_exploration_closed') {
      branch.state = 'closed'; branch.closedAt = event.recordedAt;
    }
  }
  return [...branches.values()].map(clone);
}

export function projectSelectionExplorationPublic(branch) {
  if (!branch) return null;
  return { schema: 't5.selection-exploration-public.v1',
    handle: publicHandle('side', branch.explorationId), state: branch.state,
    anchor: { handle: publicHandle('selection', branch.anchor.anchorId),
      quote: branch.anchor.quote, sourceRole: branch.anchor.sourceRole },
    messages: branch.messages.map((message) => ({
      handle: publicHandle('side_message', message.sideMessageId),
      role: message.role, content: message.content, recordedAt: message.recordedAt,
    })),
    apply: { state: branch.apply?.state ?? 'not_requested' } };
}
