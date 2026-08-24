export function makeWorkTransitionTool({ store, sessionId, runId = null, stopProcesses = async () => {} } = {}) {
  if (!store || !sessionId) throw new TypeError('work store and session are required');
  return {
    name: 'work_transition',
    informationAlwaysVisible: true,
    informationFamily: 'continuity',
    description: 'Classify each admitted message by user meaning, separately from execution scheduling. revise_current_work changes the current scope, method, or result. extend_current_work keeps the same Work and adds a stage or deliverable. start_independent_work starts a separate purpose. cancel_current_work stops the current Work. Use within_current_work unless the meaning requires an independent Work, or the user requires the current result delivered before an extension. The runtime executes your structured decision; it does not interpret the user wording.',
    parameters: { type: 'object', properties: {
      decisions: { type: 'array', minItems: 1, items: { type: 'object', properties: {
        meaning: { type: 'string', enum: [
          'revise_current_work', 'extend_current_work', 'start_independent_work', 'cancel_current_work',
        ] },
        schedule: { type: 'string', enum: [
          'within_current_work', 'after_current_delivery', 'independent_work', 'stop',
        ] },
        cancelCurrent: { type: 'boolean' },
      }, required: ['meaning', 'schedule', 'cancelCurrent'],
      additionalProperties: false } },
    }, required: ['decisions'], additionalProperties: false },
    async execute(args = {}) {
      const classified = []; const pending = await store.pendingInputs(sessionId);
      if ((args.decisions ?? []).length !== pending.length) throw new Error('one decision per pending input is required');
      for (const [index, decision] of (args.decisions ?? []).entries()) {
        const state = await store.read(); const input = state.inputs.find((item) => (
          item.inputId === pending[index].inputId && item.state === 'admitted'
        ));
        if (!input) throw new Error('work input is not pending');
        let current = state.works.filter((work) => work.sessionId === sessionId && work.status === 'active').at(-1)
          ?? state.works.filter((work) => work.sessionId === sessionId).at(-1);
        if (!current) throw new Error('active work not found');
        if (decision.meaning !== 'start_independent_work' && current.status !== 'active') {
          await store.setStatus({ workId: current.workId, expectedRevision: current.revision, status: 'active' });
        }
        if (decision.meaning === 'start_independent_work') {
          if (current.status === 'active') await store.setStatus({ workId: current.workId, expectedRevision: current.revision,
            status: decision.cancelCurrent ? 'cancelled' : 'paused' });
          if (decision.cancelCurrent) await stopProcesses();
          current = await store.create({ sessionId, sourceMessageId: input.messageId });
        }
        const revision = await store.classifyInput({ inputId: input.inputId,
          meaning: decision.meaning, schedule: decision.schedule,
          workId: current.workId, expectedRevision: current.revision });
        if (decision.meaning === 'cancel_current_work') {
          await stopProcesses();
          const cancellationRunId = runId ?? 'model-classified-cancel';
          await store.claimExecution({ workId: current.workId, revision: revision.revision,
            runId: cancellationRunId });
          await store.claimInputExecution({ inputId: input.inputId, runId: cancellationRunId });
          await store.settle({ workId: current.workId, revision: revision.revision,
            outcome: 'cancelled', runId: cancellationRunId });
          await store.completeInputExecution({ inputId: input.inputId, runId: cancellationRunId });
        }
        if (decision.schedule === 'within_current_work' && runId) {
          await store.claimExecution({ workId: current.workId, revision: revision.revision, runId });
          await store.claimInputExecution({ inputId: input.inputId, runId });
        }
        classified.push({ inputId: input.inputId, meaning: decision.meaning, schedule: decision.schedule,
          workId: current.workId, revision: revision.revision });
      }
      const relinquished = classified.some((item) => item.meaning === 'start_independent_work'
        || item.meaning === 'cancel_current_work');
      return { state: 'classified', classified,
        ...(relinquished ? { deactivatedTools: ['work_completion'], workOwnershipRelinquished: true } : {}) };
    },
  };
}
