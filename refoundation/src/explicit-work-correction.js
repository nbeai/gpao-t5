import { randomUUID } from 'node:crypto';

import { selectionSideMessageHandle } from './selection-exploration-projection.js';

export function makeExplicitWorkCorrection({ conversationLedger, workStore,
  makeId = randomUUID, hooks = {} } = {}) {
  if (!conversationLedger || !workStore) throw new TypeError('explicit correction dependencies are required');
  return { async apply({ sessionId, explorationId, instructionMessageHandle, requestId } = {}) {
    const conversation = await conversationLedger.read(sessionId);
    const branch = conversation.explorations.find((item) => item.explorationId === explorationId);
    if (!branch || branch.state === 'closed') throw new Error('selection exploration is unavailable');
    const instruction = branch.messages.find((message) => message.role === 'user'
      && selectionSideMessageHandle(message.sideMessageId) === instructionMessageHandle);
    if (!instruction) throw new Error('user-authored side instruction is required');
    const preparedApply = conversation.events.find((event) => event.type === 'selection_apply_prepared'
      && event.explorationId === explorationId && event.requestId === requestId);
    if (preparedApply && preparedApply.instructionSideMessageId !== instruction.sideMessageId) {
      throw new Error('selection apply request conflict');
    }
    const committed = conversation.events.find((event) => event.type === 'selection_apply_committed'
      && event.explorationId === explorationId && event.requestId === requestId);
    if (committed) return { state: 'committed', relation: committed.relation,
      workId: committed.resultingWorkId, revision: committed.resultingRevision,
      inputId: preparedApply.inputId,
      messageId: (await workStore.read()).inputs.find((input) => input.inputId === preparedApply.inputId)?.messageId };
    const sourceWork = branch.anchor.sourceRunId
      ? await workStore.workForRun(branch.anchor.sourceRunId) : null;
    const state = await workStore.read();
    const preparedInputState = preparedApply
      ? state.inputs.find((input) => input.inputId === preparedApply.inputId) : null;
    const alreadyApplied = ['classified', 'executing', 'executed'].includes(preparedInputState?.state);
    const currentSource = sourceWork
      ? state.works.find((work) => work.workId === sourceWork.workId) : null;
    if (sourceWork && (!currentSource
      || (currentSource.revision !== sourceWork.claimedRevision && !alreadyApplied))) {
      throw new Error('stale selection source Work');
    }
    const active = state.works.filter((work) => work.sessionId === sessionId && work.status === 'active').at(-1);
    const relation = preparedApply?.relation ?? (!currentSource ? 'derived_work'
      : currentSource.status === 'active' ? 'current_revision'
        : currentSource.status === 'paused' ? 'resumed'
          : currentSource.status === 'completed' ? 'derived_work' : null);
    if (!relation) throw new Error('selection source Work cannot be applied now');
    if (!alreadyApplied && active && active.workId !== currentSource?.workId) {
      throw new Error('another active Work requires an explicit target choice');
    }
    const targetWorkId = sourceWork?.workId ?? 'direct_no_work';
    const expectedRevision = sourceWork?.claimedRevision ?? 0;
    if (preparedApply && (preparedApply.relation !== relation
      || preparedApply.targetWorkId !== targetWorkId
      || preparedApply.expectedRevision !== expectedRevision)) {
      throw new Error('selection apply request conflict');
    }
    let preparedInput; let messageId;
    if (preparedApply) {
      preparedInput = { inputId: preparedApply.inputId };
      messageId = (await workStore.read()).inputs.find((input) => input.inputId === preparedInput.inputId)?.messageId;
      if (!messageId) throw new Error('prepared selection input is unavailable');
    } else {
      messageId = makeId();
      preparedInput = await workStore.prepareInputAdmission({ sessionId, messageId,
        origin: 'selection_exploration', source: { channel: 'selection_exploration',
          sourceMessageId: instruction.sideMessageId, selectionAnchorId: branch.anchor.anchorId,
          admissionTime: { activeRun: false, currentResultProduced: true } } });
      await conversationLedger.prepareSelectionApply({ sessionId, explorationId, requestId,
        inputId: preparedInput.inputId, instructionSideMessageId: instruction.sideMessageId,
        relation, targetWorkId, expectedRevision });
      await hooks.afterPrepare?.();
    }
    await conversationLedger.appendMessage({ sessionId, messageId,
      message: { role: 'user', content: instruction.content } });
    await hooks.afterConversationAppend?.();
    let input = (await workStore.read()).inputs.find((item) => item.inputId === preparedInput.inputId);
    if (input?.state === 'prepared') await workStore.commitInputAdmission(preparedInput.inputId);
    await hooks.afterInputCommit?.();
    input = (await workStore.read()).inputs.find((item) => item.inputId === preparedInput.inputId);
    let result;
    if (['classified', 'executing', 'executed'].includes(input?.state)) {
      result = { workId: input.workId, revision: input.revision };
    } else if (relation === 'current_revision') {
      result = await workStore.attachAdmittedInputToExactWork({ inputId: preparedInput.inputId,
        workId: currentSource.workId, expectedRevision });
    } else if (relation === 'resumed') {
      result = await workStore.resumeAdmittedInputFromSelection({ inputId: preparedInput.inputId,
        workId: currentSource.workId, expectedRevision });
    } else if (currentSource) {
      result = await workStore.createDerivedFromSelection({ sessionId, sourceMessageId: messageId,
        sourceInputId: preparedInput.inputId, derivedFromWorkId: currentSource.workId,
        derivedFromRevision: expectedRevision, selectionAnchorId: branch.anchor.anchorId,
        requestId });
    } else {
      result = await workStore.createFromSelection({ sessionId, sourceMessageId: messageId,
        sourceInputId: preparedInput.inputId, selectionAnchorId: branch.anchor.anchorId, requestId });
    }
    await hooks.afterWorkCommit?.();
    await conversationLedger.commitSelectionApply({ sessionId, explorationId, requestId,
      relation, resultingWorkId: result.workId, resultingRevision: result.revision });
    return { state: 'committed', relation, workId: result.workId,
      revision: result.revision, inputId: preparedInput.inputId, messageId };
  } };
}
