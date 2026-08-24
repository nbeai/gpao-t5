export function makeWorkTransitionTool({ store, sessionId, runId = null, stopProcesses = async () => {} } = {}) {
  if (!store || !sessionId) throw new TypeError('work store and session are required');
  return {
    name: 'work_transition',
    informationAlwaysVisible: true,
    informationFamily: 'continuity',
    description: 'Classify every newly admitted user message against the current user purpose. The model, not the runtime, decides: steer changes the active work now; followup belongs after the current result; new_work is a genuinely separate purpose; cancel stops the current work. Use the exact inputId. Never infer this relation from keywords alone.',
    parameters: { type: 'object', properties: {
      decisions: { type: 'array', minItems: 1, items: { type: 'object', properties: {
        inputId: { type: 'string' }, relation: { type: 'string', enum: ['steer', 'followup', 'new_work', 'cancel'] },
        cancelCurrent: { type: 'boolean' },
      }, required: ['inputId', 'relation', 'cancelCurrent'], additionalProperties: false } },
    }, required: ['decisions'], additionalProperties: false },
    async execute(args = {}) {
      const classified = [];
      for (const decision of args.decisions ?? []) {
        const state = await store.read();
        const input = state.inputs.find((item) => item.inputId === decision.inputId && item.sessionId === sessionId);
        if (!input || input.state !== 'admitted') throw new Error('work input is not pending');
        let current = state.works.filter((work) => work.sessionId === sessionId && work.status === 'active').at(-1)
          ?? state.works.filter((work) => work.sessionId === sessionId).at(-1);
        if (!current) throw new Error('active work not found');
        if (decision.relation !== 'new_work' && current.status !== 'active') {
          await store.setStatus({ workId: current.workId, expectedRevision: current.revision, status: 'active' });
        }
        if (decision.relation === 'new_work') {
          if (current.status === 'active') await store.setStatus({ workId: current.workId, expectedRevision: current.revision,
            status: decision.cancelCurrent ? 'cancelled' : 'paused' });
          if (decision.cancelCurrent) await stopProcesses();
          current = await store.create({ sessionId, sourceMessageId: input.messageId });
        }
        const revision = await store.classifyInput({ inputId: input.inputId,
          relation: decision.relation, workId: current.workId, expectedRevision: current.revision });
        if (decision.relation === 'cancel') {
          await stopProcesses();
          const cancellationRunId = runId ?? 'model-classified-cancel';
          await store.claimExecution({ workId: current.workId, revision: revision.revision,
            runId: cancellationRunId });
          await store.settle({ workId: current.workId, revision: revision.revision,
            outcome: 'cancelled', runId: cancellationRunId });
        }
        if (decision.relation === 'steer' && runId) await store.claimExecution({
          workId: current.workId, revision: revision.revision, runId,
        });
        classified.push({ inputId: input.inputId, relation: decision.relation,
          workId: current.workId, revision: revision.revision });
      }
      return { state: 'classified', classified };
    },
  };
}
