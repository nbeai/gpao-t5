import { randomUUID } from 'node:crypto';

import { selectionSideMessageHandle } from './selection-exploration-projection.js';

export function makeExplicitWorkCorrection({ conversationLedger, workStore,
  makeId = randomUUID } = {}) {
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
    if (!sourceWork) throw new Error('selection source Work is unavailable');
    const state = await workStore.read();
    const currentSource = state.works.find((work) => work.workId === sourceWork.workId);
    if (!currentSource || currentSource.revision !== sourceWork.claimedRevision) {
      throw new Error('stale selection source Work');
    }
    const active = state.works.filter((work) => work.sessionId === sessionId && work.status === 'active').at(-1);
    const relation = currentSource.status === 'active' ? 'current_revision'
      : currentSource.status === 'completed' ? 'derived_work' : null;
    if (!relation) throw new Error('selection source Work cannot be applied now');
    if (active && active.workId !== currentSource.workId) {
      throw new Error('another active Work requires an explicit target choice');
    }
    const messageId = makeId();
    const preparedInput = await workStore.prepareInputAdmission({ sessionId, messageId,
      origin: 'selection_exploration', source: { channel: 'selection_exploration',
        sourceMessageId: instruction.sideMessageId, selectionAnchorId: branch.anchor.anchorId,
        admissionTime: { activeRun: false, currentResultProduced: true } } });
    await conversationLedger.prepareSelectionApply({ sessionId, explorationId, requestId,
      inputId: preparedInput.inputId, instructionSideMessageId: instruction.sideMessageId,
      relation, targetWorkId: currentSource.workId, expectedRevision: currentSource.revision });
    await conversationLedger.appendMessage({ sessionId, messageId,
      message: { role: 'user', content: instruction.content } });
    await workStore.commitInputAdmission(preparedInput.inputId);
    let result;
    if (relation === 'current_revision') {
      result = await workStore.attachAdmittedInputToCurrentWork(preparedInput.inputId);
    } else {
      result = await workStore.createDerivedFromSelection({ sessionId, sourceMessageId: messageId,
        sourceInputId: preparedInput.inputId, derivedFromWorkId: currentSource.workId,
        derivedFromRevision: currentSource.revision, selectionAnchorId: branch.anchor.anchorId,
        requestId });
    }
    await conversationLedger.commitSelectionApply({ sessionId, explorationId, requestId,
      relation, resultingWorkId: result.workId, resultingRevision: result.revision });
    return { state: 'committed', relation, workId: result.workId,
      revision: result.revision, inputId: preparedInput.inputId, messageId };
  } };
}
