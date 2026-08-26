import { randomUUID } from 'node:crypto';

const DISPOSITIONS = new Set(['interrupted_resumable', 'hard_cancelled']);
const CHILD_SETTLEMENTS = new WeakSet();
const CONSUMED_CHILD_SETTLEMENTS = new WeakMap();

function bounded(value, label, max = 128) {
  const text = String(value ?? '');
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new TypeError(`${label} is invalid`);
  }
  return text;
}

export class WorkCancellationCoordinator {
  constructor({ workStore, runLedger, processRegistry, makeId = randomUUID } = {}) {
    if (typeof workStore?.read !== 'function' || typeof workStore?.append !== 'function'
      || typeof workStore?.releaseExecution !== 'function' || typeof runLedger?.read !== 'function'
      || typeof processRegistry?.stopOwner !== 'function' || typeof makeId !== 'function') {
      throw new TypeError('Work cancellation coordinator dependencies are required');
    }
    this.workStore = workStore; this.runLedger = runLedger;
    this.processRegistry = processRegistry; this.makeId = makeId; this.queue = Promise.resolve();
  }

  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }

  async admit({ sessionId, runId, disposition = 'interrupted_resumable', requestId = null } = {}) {
    const session = bounded(sessionId, 'cancel sessionId'); const run = bounded(runId, 'cancel runId');
    if (!DISPOSITIONS.has(disposition)) throw new TypeError('cancel disposition is invalid');
    return this.serialize(async () => {
      const state = await this.workStore.read();
      const prior = state.cancellations?.find((item) => item.runId === run && item.state !== 'terminal');
      if (prior) {
        if (prior.sessionId !== session || prior.disposition !== disposition) {
          throw Object.assign(new Error('work cancel run has a conflicting disposition'), {
            code: 'work_cancel_request_conflict',
          });
        }
        return prior;
      }
      const terminal = state.cancellations?.find((item) => item.runId === run && item.state === 'terminal');
      if (terminal) return terminal;
      const claim = state.claims.find((item) => item.runId === run && item.state === 'active');
      const work = claim && state.works.find((item) => item.workId === claim.workId);
      if (!claim || !work || work.sessionId !== session) {
        throw Object.assign(new Error('current Work execution claim is unavailable'), {
          code: 'work_cancel_claim_unavailable',
        });
      }
      const id = requestId == null ? this.makeId() : bounded(requestId, 'cancel requestId');
      return this.workStore.admitCancellation({ requestId: id, sessionId: session,
        runId: run, workId: claim.workId, revision: claim.revision, disposition });
    });
  }

  async requestStop({ admission, controller } = {}) {
    if (!admission?.sessionId || !admission?.runId) throw new TypeError('cancel admission is required');
    const persisted = (await this.workStore.read()).cancellations
      .find((item) => item.requestId === admission.requestId);
    if (!persisted || ['sessionId', 'runId', 'workId', 'revision', 'disposition', 'fingerprint']
      .some((field) => persisted[field] !== admission[field])) {
      throw Object.assign(new Error('work cancel admission does not match persisted request'), {
        code: 'work_cancel_admission_mismatch',
      });
    }
    controller?.abort?.(new Error('user_cancelled'));
    const stopped = await this.processRegistry.stopOwner(persisted.sessionId, 'user_cancelled');
    if (!Array.isArray(stopped) || stopped.some((item) => (
      !['completed', 'failed', 'stopped'].includes(item?.state)
    ))) {
      throw Object.assign(new Error('cancelled child process is not terminal'), {
        code: 'work_cancel_children_not_terminal',
      });
    }
    const receipt = Object.freeze({ requestId: persisted.requestId,
      childrenTerminal: true, stoppedChildren: Array.isArray(stopped) ? stopped.length : null });
    CHILD_SETTLEMENTS.add(receipt); return receipt;
  }

  async settle({ admission, childSettlementReceipt, unknownEffect = null } = {}) {
    if (!admission?.requestId || !admission.runId) throw new TypeError('cancel admission is required');
    const consumedRequestId = childSettlementReceipt && CONSUMED_CHILD_SETTLEMENTS.get(childSettlementReceipt);
    if (!childSettlementReceipt
      || (!CHILD_SETTLEMENTS.has(childSettlementReceipt) && consumedRequestId !== admission.requestId)
      || childSettlementReceipt.requestId !== admission.requestId
      || childSettlementReceipt.childrenTerminal !== true) {
      throw new TypeError('fresh child settlement receipt is required');
    }
    return this.serialize(async () => {
      let state = await this.workStore.read();
      const prior = state.cancellations?.find((item) => item.requestId === admission.requestId
        && item.state === 'terminal');
      if (prior) return this.receipt(prior);
      const run = await this.runLedger.read(admission.runId).catch(() => null);
      if (!run || !['cancelled', 'failed'].includes(run.status)) {
        throw Object.assign(new Error('cancelled Run is not terminal'), { code: 'work_cancel_run_not_terminal' });
      }
      const authoritativeUnknown = run.events.some((event) => (
        event.type === 'tool_completed'
        && (event.payload?.receipt?.result?.effectUnknown === true
          || event.payload?.receipt?.outcome === 'unknown')
      ));
      const completedToolCalls = new Set(run.events.filter((event) => event.type === 'tool_completed')
        .map((event) => event.payload?.receipt?.toolCallId).filter(Boolean));
      const unterminatedEffect = run.events.some((event) => event.type === 'tool_started'
        && event.payload?.toolCallId && !completedToolCalls.has(event.payload.toolCallId)
        && !['observe', 'none'].includes(event.payload?.args?.effect?.kind));
      const settled = await this.workStore.settleCancellation({ admission,
        unknownEffect: authoritativeUnknown || unterminatedEffect || unknownEffect === true,
        childrenTerminal: true });
      CHILD_SETTLEMENTS.delete(childSettlementReceipt);
      CONSUMED_CHILD_SETTLEMENTS.set(childSettlementReceipt, admission.requestId);
      return this.receipt(settled);
    });
  }

  receipt(value) {
    const unknown = value.unknownEffect === true;
    return { schema: 't5.work-cancellation-receipt.v1', requestId: value.requestId,
      state: value.state === 'recovery_pending' ? 'recovery_pending' : 'terminal',
      disposition: value.disposition, runTerminal: true,
      childrenTerminal: value.childrenTerminal === true ? true : null,
      claimReleased: value.claimReleased === true,
      unknownEffect: unknown, nextRevision: value.nextRevision,
      userSafeSummary: value.state === 'recovery_pending'
        ? '작업 중지는 확인했지만 시작한 하위 작업과 외부 변경은 추가 확인이 필요해요.' : unknown
        ? '작업은 멈췄지만 시작한 외부 변경의 완료 여부는 확인이 필요해요.'
        : value.disposition === 'hard_cancelled'
          ? '작업을 취소했어요.' : '작업을 멈췄어요. 이어서 다시 시작할 수 있어요.',
      nextSafeAction: value.state === 'recovery_pending' || unknown
        ? '마지막 하위 작업과 외부 상태를 확인한 뒤 이어가 주세요.' : null };
  }

  async repairLegacySettledClaims() {
    const state = await this.workStore.read(); const repaired = [];
    for (const claim of state.claims.filter((item) => item.state === 'active')) {
      const settled = state.events.find((event) => event.type === 'work_settled'
        && event.runId === claim.runId && event.outcome === 'cancelled');
      if (!settled) continue;
      const run = await this.runLedger.read(claim.runId).catch(() => null);
      if (!run || !['cancelled', 'failed'].includes(run.status)) continue;
      const released = await this.workStore.releaseExecution({ runId: claim.runId,
        reason: 'legacy_cancelled_claim_repair', allowSettled: true });
      if (released.released) repaired.push(claim.runId);
    }
    return repaired;
  }

  async reconcileAfterRestart() {
    const recovered = [];
    const state = await this.workStore.read();
    for (const cancellation of state.cancellations ?? []) {
      if (cancellation.state === 'terminal' || cancellation.state === 'recovery_pending') {
        if (!cancellation.surfacePersisted) recovered.push({ admission: cancellation,
          receipt: this.receipt(cancellation) });
        continue;
      }
      const run = await this.runLedger.read(cancellation.runId).catch(() => null);
      if (!run || !['cancelled', 'failed'].includes(run.status)) continue;
      const pending = await this.workStore.markCancellationRecoveryPending({ admission: cancellation });
      recovered.push({ admission: pending, receipt: this.receipt(pending) });
    }
    return recovered;
  }
}
