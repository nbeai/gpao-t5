import { randomUUID } from 'node:crypto';

import { makeForgetPlan, makeForgetReceipt, validateForgetPlan } from './forgetting-contract.js';
import { validateRecordReference } from './record-reference.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function exactIds(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

export class ForgettingCoordinator {
  constructor({
    memoryLedger, makeId = randomUUID, now = () => new Date().toISOString(),
    derivedAdapters = {}, backupAvailable = true, exactRecallProbe = null,
    contextProjectionProbe = null, behaviorProbe = null,
  } = {}) {
    if (!memoryLedger) throw new TypeError('forgetting coordinator requires MemoryLedger');
    this.memoryLedger = memoryLedger; this.makeId = makeId; this.now = now;
    this.derivedAdapters = derivedAdapters; this.backupAvailable = backupAvailable;
    this.exactRecallProbe = exactRecallProbe; this.contextProjectionProbe = contextProjectionProbe;
    this.behaviorProbe = behaviorProbe;
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
    const targets = selected.map((claim) => ({
      kind: 'memory', id: claim.memoryId, action: 'retract', revision: claim.subjectRevision,
    }));
    for (const claim of selected) {
      for (const [kind, adapter] of Object.entries(this.derivedAdapters)) {
        const target = await adapter.preview?.(claim);
        if (target) targets.push({ kind, id: target.id ?? claim.memoryId,
          action: target.action ?? 'delete', revision: target.revision ?? null });
      }
    }
    return makeForgetPlan({
      requestId: String(this.makeId()), selector,
      targets,
      backupAvailable: this.backupAvailable,
    });
  }

  async execute({ plan: inputPlan, recordRefs, crashAfterEffectHandle = null } = {}) {
    const plan = validateForgetPlan(inputPlan);
    if (!Array.isArray(recordRefs) || !recordRefs.length) {
      throw new TypeError('forget execute requires current request RecordRef');
    }
    const references = recordRefs.map(validateRecordReference);
    let state = await this.memoryLedger.read();
    let operation = state.forgetOperations.find((item) => item.requestId === plan.requestId);
    if (operation && operation.plan.previewDigest !== plan.previewDigest) {
      throw new Error('forget request identity conflicts with another plan');
    }
    if (!operation) {
      for (const target of plan.targets.filter((item) => item.kind === 'memory')) {
        const current = state.claims.find((claim) => claim.memoryId === target.id && claim.status === 'active');
        if (!current || current.subjectRevision !== target.revision) {
          return { state: 'revision_changed', plan, receipt: null };
        }
      }
      await this.memoryLedger.append('memory_forget_prepared', {
        memoryId: plan.targets.find((target) => target.kind === 'memory')?.id ?? plan.targets[0].id,
        requestId: plan.requestId, plan, recordRefs: references,
      });
      state = await this.memoryLedger.read();
      operation = state.forgetOperations.find((item) => item.requestId === plan.requestId);
    }
    const settled = new Map(operation.settledTargets.map((item) => [item.id, item]));
    for (const target of plan.targets) {
      if (settled.has(`${target.kind}:${target.id}`) || target.kind !== 'memory') continue;
      const current = state.claims.find((claim) => claim.memoryId === target.id && claim.status === 'active');
      const existingTombstone = state.tombstones.find((item) => (
        item.memoryId === target.id && item.requestId === plan.requestId
      ));
      if (!existingTombstone && (!current || current.subjectRevision !== target.revision)) {
        return { state: 'revision_changed', plan, receipt: null };
      }
    }
    const recordedAt = this.now();
    const reversibleUntil = plan.backupAvailable === true
      ? new Date(new Date(recordedAt).getTime() + 30 * DAY_MS).toISOString() : null;
    const executedTargets = []; const unknownTargets = []; const retainedTargets = [];
    for (const target of plan.targets) {
      const handle = `${target.kind}:${target.id}`;
      const prior = settled.get(handle);
      if (prior) {
        if (prior.disposition === 'executed') executedTargets.push(handle);
        else if (prior.disposition === 'unknown') unknownTargets.push(handle);
        else retainedTargets.push({ id: handle, reason: prior.reason ?? 'retained' });
        continue;
      }
      let disposition = 'executed'; let reason = null;
      if (target.kind === 'memory') {
        const latest = await this.memoryLedger.read();
        const existing = latest.tombstones.find((item) => item.memoryId === target.id
          && item.requestId === plan.requestId);
        if (!existing) await this.memoryLedger.forgetClaim({
          requestId: plan.requestId, memoryId: target.id, expectedRevision: target.revision,
          recordRefs: references, reversibleUntil, recordedAt,
        });
      } else {
        const adapter = this.derivedAdapters[target.kind];
        if (!adapter?.settle) { disposition = 'unknown'; reason = 'adapter_unavailable'; }
        else {
          try {
            const result = await adapter.settle({ target, plan });
            disposition = result?.state === 'executed' ? 'executed'
              : result?.state === 'retained' ? 'retained' : 'unknown';
            reason = result?.reason ?? null;
          } catch { disposition = 'retained'; reason = 'adapter_failed'; }
        }
      }
      if (crashAfterEffectHandle === handle) throw new Error(`injected crash after ${handle}`);
      await this.memoryLedger.append('memory_forget_target_settled', {
        memoryId: plan.targets.find((item) => item.kind === 'memory')?.id ?? target.id,
        requestId: plan.requestId, targetHandle: handle, disposition, reason,
      });
      if (disposition === 'executed') executedTargets.push(handle);
      else if (disposition === 'unknown') unknownTargets.push(handle);
      else retainedTargets.push({ id: handle, reason: reason ?? 'retained' });
    }
    const searchKinds = new Set([
      'fts', 'embedding', 'relationship_index', 'library_view', 'spotlight', 'windows_search',
    ]);
    const searchProbes = [];
    for (const target of plan.targets.filter((item) => searchKinds.has(item.kind))) {
      const adapter = this.derivedAdapters[target.kind];
      try { searchProbes.push(adapter?.probe ? await adapter.probe({ target, plan }) : null); }
      catch { searchProbes.push(null); }
    }
    let exactHits = null;
    try { exactHits = this.exactRecallProbe ? await this.exactRecallProbe({ plan }) : null; } catch { exactHits = null; }
    const hasRecallProbe = Boolean(this.exactRecallProbe) || searchProbes.length > 0;
    const searchHitAfter = !hasRecallProbe
      || (searchProbes.length && searchProbes.some((value) => value == null))
      || (this.exactRecallProbe && exactHits == null) ? null
      : Number(exactHits ?? 0) + searchProbes.reduce((sum, value) => sum + Number(value), 0);
    let contextProjectionAfter = null;
    try {
      contextProjectionAfter = this.contextProjectionProbe
        ? await this.contextProjectionProbe({ plan }) : null;
    } catch { contextProjectionAfter = null; }
    let behaviorProbeAfter = 'unknown';
    try {
      const observed = this.behaviorProbe ? await this.behaviorProbe({ plan }) : 'unknown';
      behaviorProbeAfter = ['pass', 'fail', 'unknown'].includes(observed) ? observed : 'unknown';
    } catch { behaviorProbeAfter = 'unknown'; }
    return {
      state: 'executed', plan,
      receipt: makeForgetReceipt({
        plan, executedTargets, unknownTargets, retainedTargets,
        searchHitAfter, contextProjectionAfter,
        behaviorProbeAfter, reversibleUntil,
      }),
    };
  }

  async resume({ requestId, crashAfterEffectHandle = null } = {}) {
    const state = await this.memoryLedger.read();
    const operation = state.forgetOperations.find((item) => item.requestId === requestId);
    if (!operation) throw new Error('forget operation not found');
    return this.execute({ plan: operation.plan, recordRefs: operation.recordRefs, crashAfterEffectHandle });
  }

  async restore({ requestId, memoryId, recordRefs } = {}) {
    const restoredAt = this.now();
    const state = await this.memoryLedger.read();
    const tombstone = state.tombstones.find((item) => (
      item.requestId === String(requestId ?? '') && item.memoryId === String(memoryId ?? '')
    ));
    if (!tombstone) throw new Error('forget tombstone not found');
    if (tombstone.reversibleUntil == null || restoredAt >= tombstone.reversibleUntil) {
      throw Object.assign(new Error('forget recovery window expired'), { code: 'T5_FORGET_EXPIRED' });
    }
    const claim = await this.memoryLedger.restoreForgottenClaim({
      requestId, memoryId, recordRefs, recordedAt: restoredAt,
    });
    return { state: 'restored', memoryId: claim.memoryId,
      subjectRevision: claim.subjectRevision, sourceOrder: claim.sourceOrder };
  }
}
