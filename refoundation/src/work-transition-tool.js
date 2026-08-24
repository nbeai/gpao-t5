export function makeWorkTransitionTool({ store, sessionId, runId = null, stopProcesses = async () => {} } = {}) {
  if (!store || !sessionId) throw new TypeError('work store and session are required');
  return {
    name: 'work_transition',
    informationAlwaysVisible: true,
    informationFamily: 'continuity',
    description: 'Classify every newly admitted user message by the result relationship the user requested at admission time. The model, not the runtime, decides: modify_current_result_now replaces or changes the scope, method, goal, or result currently being produced; preserve_current_result_then_add preserves that current result and asks for a separate additional result after it; independent_new_work is an independent purpose; cancel_current_work stops the current work. A user-requested future sequence for an additional deliverable is preserve_current_result_then_add even when it depends on or reformats the current result: do not merge that later deliverable into the current answer. Example: “끝나면 표로도 정리해줘” means finish and preserve the current result first, then run one separate followup that produces the table. “현재 결과를 먼저 마치고 그 다음에 표를 만들어줘” has the same relation. By contrast, “지금 결과를 표로 바꿔줘” modifies the current result now. Use the supplied admission-time facts, full user message, current conversation, work state, and observed effects. Use the exact inputId. Never infer this relation from keywords alone.',
    parameters: { type: 'object', properties: {
      decisions: { type: 'array', minItems: 1, items: { type: 'object', properties: {
        inputId: { type: 'string' }, relation: { type: 'string', enum: [
          'modify_current_result_now', 'preserve_current_result_then_add',
          'independent_new_work', 'cancel_current_work',
        ] },
        currentResultDisposition: { type: 'string', enum: ['replace_or_modify', 'preserve_then_add', 'independent', 'stop'],
          description: 'What the user wants done with the result already being produced.' },
        executionTiming: { type: 'string', enum: ['current_run', 'after_current_result', 'separate_work', 'stop'],
          description: 'When the user wants this admitted input executed relative to the current result.' },
        cancelCurrent: { type: 'boolean' },
      }, required: ['inputId', 'relation', 'currentResultDisposition', 'executionTiming', 'cancelCurrent'],
      additionalProperties: false } },
    }, required: ['decisions'], additionalProperties: false },
    async execute(args = {}) {
      const classified = [];
      for (const decision of args.decisions ?? []) {
        const relation = { modify_current_result_now: 'steer',
          preserve_current_result_then_add: 'followup', independent_new_work: 'new_work',
          cancel_current_work: 'cancel' }[decision.relation];
        const expected = { steer: ['replace_or_modify', 'current_run'],
          followup: ['preserve_then_add', 'after_current_result'],
          new_work: ['independent', 'separate_work'], cancel: ['stop', 'stop'] }[relation];
        if (!expected || decision.currentResultDisposition !== expected[0]
          || decision.executionTiming !== expected[1]) throw new Error('work transition decision is inconsistent');
        const state = await store.read();
        const input = state.inputs.find((item) => item.inputId === decision.inputId && item.sessionId === sessionId);
        if (!input || input.state !== 'admitted') throw new Error('work input is not pending');
        let current = state.works.filter((work) => work.sessionId === sessionId && work.status === 'active').at(-1)
          ?? state.works.filter((work) => work.sessionId === sessionId).at(-1);
        if (!current) throw new Error('active work not found');
        if (relation !== 'new_work' && current.status !== 'active') {
          await store.setStatus({ workId: current.workId, expectedRevision: current.revision, status: 'active' });
        }
        if (relation === 'new_work') {
          if (current.status === 'active') await store.setStatus({ workId: current.workId, expectedRevision: current.revision,
            status: decision.cancelCurrent ? 'cancelled' : 'paused' });
          if (decision.cancelCurrent) await stopProcesses();
          current = await store.create({ sessionId, sourceMessageId: input.messageId });
        }
        const revision = await store.classifyInput({ inputId: input.inputId,
          relation, workId: current.workId, expectedRevision: current.revision });
        if (relation === 'cancel') {
          await stopProcesses();
          const cancellationRunId = runId ?? 'model-classified-cancel';
          await store.claimExecution({ workId: current.workId, revision: revision.revision,
            runId: cancellationRunId });
          await store.settle({ workId: current.workId, revision: revision.revision,
            outcome: 'cancelled', runId: cancellationRunId });
        }
        if (relation === 'steer' && runId) await store.claimExecution({
          workId: current.workId, revision: revision.revision, runId,
        });
        classified.push({ inputId: input.inputId, relation,
          workId: current.workId, revision: revision.revision });
      }
      return { state: 'classified', classified };
    },
  };
}
