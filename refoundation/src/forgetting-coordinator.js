import { randomUUID } from 'node:crypto';

import { makeForgetPlan, makeForgetReceipt, validateForgetPlan } from './forgetting-contract.js';
import { validateRecordReference } from './record-reference.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function exactIds(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

export class ForgettingCoordinator {
  constructor({ memoryLedger, makeId = randomUUID, now = () => new Date().toISOString() } = {}) {
    if (!memoryLedger) throw new TypeError('forgetting coordinator requires MemoryLedger');
    this.memoryLedger = memoryLedger; this.makeId = makeId; this.now = now;
  }

  async preview(selectorInput = {}) {
    const selector = {
      memoryIds: exactIds(selectorInput.memoryIds, 'memoryIds'),
      subjectKeys: exactIds(selectorInput.subjectKeys, 'subjectKeys'),
      scopeIds: exactIds(selectorInput.scopeIds, 'scopeIds'),
    };
    if (!selector.memoryIds.length && !selector.subjectKeys.length && !selector.scopeIds.length) {
      throw new TypeError('forget selector must name an exact identity');
    }
    const state = await this.memoryLedger.read();
    const active = state.claims.filter((claim) => claim.status === 'active');
    for (const id of selector.memoryIds) {
      if (!active.some((claim) => claim.memoryId === id)) throw new Error(`active memory not found: ${id}`);
    }
    const selected = active.filter((claim) => (
      selector.memoryIds.includes(claim.memoryId)
      || selector.subjectKeys.includes(claim.subjectKey)
      || selector.scopeIds.some((scopeId) => Object.values(claim.scope).includes(scopeId))
    ));
    if (!selected.length) throw new Error('forget selector matched no active memory');
    return makeForgetPlan({
      requestId: String(this.makeId()), selector,
      targets: selected.map((claim) => ({
        kind: 'memory', id: claim.memoryId, action: 'retract', revision: claim.subjectRevision,
      })),
      backupAvailable: true,
    });
  }

  async execute({ plan: inputPlan, recordRefs } = {}) {
    const plan = validateForgetPlan(inputPlan);
    if (!Array.isArray(recordRefs) || !recordRefs.length) {
      throw new TypeError('forget execute requires current request RecordRef');
    }
    const references = recordRefs.map(validateRecordReference);
    const state = await this.memoryLedger.read();
    for (const target of plan.targets) {
      if (target.kind !== 'memory' || target.action !== 'retract') {
        throw new Error('M3-1 coordinator only executes memory retract targets');
      }
      const current = state.claims.find((claim) => claim.memoryId === target.id && claim.status === 'active');
      if (!current || current.subjectRevision !== target.revision) {
        return { state: 'revision_changed', plan, receipt: null };
      }
    }
    const recordedAt = this.now();
    const reversibleUntil = plan.backupAvailable === true
      ? new Date(new Date(recordedAt).getTime() + 30 * DAY_MS).toISOString() : null;
    const executedTargets = [];
    for (const target of plan.targets) {
      await this.memoryLedger.forgetClaim({
        requestId: plan.requestId, memoryId: target.id, expectedRevision: target.revision,
        recordRefs: references, reversibleUntil, recordedAt,
      });
      executedTargets.push(`${target.kind}:${target.id}`);
    }
    return {
      state: 'executed', plan,
      receipt: makeForgetReceipt({
        plan, executedTargets, unknownTargets: [], retainedTargets: [],
        searchHitAfter: null, contextProjectionAfter: null,
        behaviorProbeAfter: 'unknown', reversibleUntil,
      }),
    };
  }

  async restore({ requestId, memoryId, recordRefs } = {}) {
    const claim = await this.memoryLedger.restoreForgottenClaim({
      requestId, memoryId, recordRefs, recordedAt: this.now(),
    });
    return { state: 'restored', memoryId: claim.memoryId,
      subjectRevision: claim.subjectRevision, sourceOrder: claim.sourceOrder };
  }
}
