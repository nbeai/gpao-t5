export function makeWorkTransitionTool({ store, sessionId, runId = null,
  stopProcesses = async () => {} } = {}) {
  if (!store || !sessionId || !runId) throw new TypeError('work control identity is required');
  return {
    name: 'work_control',
    informationAlwaysVisible: true,
    informationFamily: 'continuity',
    description: 'Use only when the presented user message must change durable Work scheduling: defer it until the current result is delivered, start an independent Work, cancel the current Work, or resume an exact paused Work. Do not call this for ordinary corrections, additions, constraints, or format changes; those continue in the current Work automatically.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: [
        'defer_after_delivery', 'start_independent_work', 'cancel_current_work', 'resume_paused_work',
      ] },
      currentWorkDisposition: { type: ['string', 'null'], enum: ['pause', 'cancel', null] },
      targetWorkId: { type: ['string', 'null'] },
    }, required: ['action', 'currentWorkDisposition', 'targetWorkId'] },
    async execute(args = {}) {
      const presented = await store.presentedInputs(sessionId, runId);
      if (!presented.length) throw new Error('presented input batch is required');
      const inputIds = presented.map((input) => input.inputId);
      const current = await store.activeForSession(sessionId);
      if (!current) throw new Error('active work not found');
      if (args.action === 'defer_after_delivery') {
        const deferred = await store.deferPresentedBatchAfterDelivery({
          inputIds, workId: current.workId, runId,
        });
        return { state: 'deferred_after_delivery', inputs: deferred };
      }
      if (args.action === 'start_independent_work') {
        const disposition = args.currentWorkDisposition ?? 'pause';
        if (disposition === 'cancel') await stopProcesses();
        const forked = await store.forkPresentedBatchToNewWork({ inputIds,
          currentWorkId: current.workId, runId, currentWorkDisposition: disposition });
        return { state: 'forked_to_independent_work', ...forked,
          deactivatedTools: ['work_completion'], workOwnershipRelinquished: true };
      }
      if (args.action === 'cancel_current_work') {
        await stopProcesses();
        const cancelled = await store.cancelPresentedBatchWork({
          inputIds, workId: current.workId, runId,
        });
        return { state: 'current_work_cancelled', ...cancelled,
          deactivatedTools: ['work_completion'], workOwnershipRelinquished: true };
      }
      if (args.action === 'resume_paused_work') {
        if (!args.targetWorkId) throw new TypeError('resume requires targetWorkId');
        const disposition = args.currentWorkDisposition ?? 'pause';
        if (disposition === 'cancel') await stopProcesses();
        const resumed = await store.resumePresentedBatchOnPausedWork({ inputIds,
          currentWorkId: current.workId, targetWorkId: args.targetWorkId,
          runId, currentWorkDisposition: disposition });
        return { state: 'paused_work_resumed', ...resumed,
          deactivatedTools: ['work_completion'], workOwnershipRelinquished: true };
      }
      throw new Error(`Unknown work control action: ${args.action}`);
    },
  };
}
