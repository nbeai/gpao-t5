import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

import { RunLedger } from './run-ledger.js';

const MATERIALIZED = new WeakSet();
const ROLLBACK_MATERIALIZED = new WeakSet();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function lane(before, after, key, same = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  if (before == null || after == null) return 'unknown';
  return same(before, after) ? 'unchanged' : 'changed';
}
function targetChange(before = null, after = null) {
  const existsBefore = before?.exists; const existsAfter = after?.exists;
  const existence = existsBefore == null || existsAfter == null ? 'unknown'
    : !existsBefore && existsAfter ? 'created' : existsBefore && !existsAfter ? 'removed' : 'unchanged';
  const both = existsBefore === true && existsAfter === true;
  const openKnown = (value, type) => value && typeof value.readable === 'boolean'
    && typeof value.writable === 'boolean' && (type !== 'directory' || typeof value.listable === 'boolean');
  return {
    existence,
    identity: both ? lane(before.filesystemIdentity, after.filesystemIdentity, 'identity') : 'unknown',
    type: both ? lane(before.type, after.type, 'type') : 'unknown',
    content: both ? lane(before.sha256, after.sha256, 'content') : 'unknown',
    size: both ? lane(before.size, after.size, 'size') : 'unknown',
    mode: both ? lane(before.mode, after.mode, 'mode') : 'unknown',
    owner: both ? lane(before.owner, after.owner, 'owner') : 'unknown',
    acl: both ? lane(before.acl, after.acl, 'acl') : 'unknown',
    flags: both ? lane(before.flags, after.flags, 'flags') : 'unknown',
    entries: both ? lane(before.entryDigest, after.entryDigest, 'entries') : 'unknown',
    openability: both && openKnown(before.openability, before.type) && openKnown(after.openability, after.type)
      ? lane(before.openability, after.openability, 'openability') : 'unknown',
  };
}
function targetState(value) {
  if (!value) return null;
  return { observed: value.exists !== null, exists: value.exists ?? null, type: value.type ?? null,
    bytes: value.size ?? null, contentDigest: value.sha256 ?? null,
    filesystemIdentityDigest: value.filesystemIdentity ? hash(value.filesystemIdentity) : null,
    mode: value.mode ?? null, ownerDigest: value.owner ? hash(value.owner) : null,
    aclDigest: value.acl ? hash(value.acl) : null, flagsDigest: value.flags == null ? null : hash(value.flags),
    entryCount: value.entryCount ?? null, entryDigest: value.entryDigest ?? null,
    openability: value.openability ?? null };
}

export function makeEffectForensicProductAdapter({ runLedger } = {}) {
  if (!(runLedger instanceof RunLedger)) throw new TypeError('canonical RunLedger is required');
  const materialize = async ({ sessionId, runId, toolCallId } = {}) => {
      const run = await runLedger.read(runId);
      if (!sessionId || run.events[0]?.payload?.sessionId !== sessionId) {
        throw new Error('effect Run session identity mismatch');
      }
      const matches = run.events.filter((event) => event.type === 'tool_completed'
        && event.payload?.receipt?.toolCallId === toolCallId);
      if (matches.length !== 1) throw new Error('exact tool effect receipt is required');
      const receipt = matches[0].payload.receipt; const observation = receipt.result?.effectObservation;
      if (!['succeeded', 'failed', 'unknown', 'not_executed'].includes(receipt.outcome)
        || !['exec', 'terminal_session', 'pty_start'].includes(receipt.requestedCall?.name)) {
        throw new Error('qualified execution effect receipt is required');
      }
      let effectSource = receipt;
      if (!effectSource.requestedCall?.args?.effect && receipt.requestedCall?.name === 'terminal_session') {
        const processId = receipt.result?.processId ?? receipt.requestedCall?.args?.processId;
        const origins = run.events.filter((event) => event.type === 'tool_completed'
          && event.payload?.receipt?.requestedCall?.args?.effect
          && event.payload.receipt.result?.processId === processId);
        if (origins.length !== 1) throw new Error('terminal effect origin receipt is required');
        effectSource = origins[0].payload.receipt;
      }
      const declared = observation?.declared ?? effectSource.requestedCall?.args?.effect ?? null;
      if (!declared || !Array.isArray(declared.targets)) throw new Error('declared effect is required');
      if (observation?.schema !== 't5.effect-observation.v2') throw new Error('qualified effect observation is required');
      const observationCore = { ...observation }; delete observationCore.receiptDigest;
      if (observation.receiptDigest !== hash(observationCore)
        || observation.declaredDigest !== hash({ kind: declared.kind, targets: declared.targets })) {
        throw new Error('effect observation digest mismatch');
      }
      const requested = effectSource.requestedCall?.args?.effect;
      const executed = ['succeeded', 'failed', 'unknown'].includes(receipt.outcome);
      if (executed && (!receipt.actualCall || receipt.actualCall.name !== receipt.requestedCall.name)) {
        throw new Error('executed effect actual call is required');
      }
      if (receipt.outcome === 'not_executed' && (receipt.actualCall != null || observation?.after != null)) {
        throw new Error('not-executed effect cannot have after observation');
      }
      const actual = effectSource.actualCall?.args?.effect ?? requested;
      if (!requested || requested.kind !== declared.kind || actual?.kind !== declared.kind
        || JSON.stringify(requested.targets) !== JSON.stringify(declared.targets)
        || JSON.stringify(actual?.targets) !== JSON.stringify(declared.targets)) {
        throw new Error('declared effect does not match executed effect');
      }
      const scope = observation?.before?.scope ?? observation?.after?.scope
        ?? (['external_change', 'external_send', 'payment', 'secret_input'].includes(declared.kind) ? 'external' : 'local');
      const beforeTargets = observation?.before?.targets ?? []; const afterTargets = observation?.after?.targets ?? [];
      if (scope === 'local' && (beforeTargets.length !== declared.targets.length
        || (observation?.after && afterTargets.length !== declared.targets.length))) {
        throw new Error('effect target observation count mismatch');
      }
      const observedPaths = beforeTargets.map((item) => item?.path);
      const beforeBindings = observation?.before?.bindings ?? [];
      const afterBindings = observation?.after?.bindings ?? [];
      if (scope === 'local' && (new Set(observedPaths).size !== observedPaths.length
        || observedPaths.some((path, index) => !path || (afterTargets[index]
          && afterTargets[index].path !== path))
        || beforeBindings.length !== declared.targets.length
        || JSON.stringify(beforeBindings) !== JSON.stringify(afterBindings)
        || new Set(beforeBindings.map((item) => item.resolvedPathDigest)).size !== beforeBindings.length
        || !receipt.result?.cwd || !isAbsolute(receipt.result.cwd)
        || observation.before?.cwdDigest !== hash(resolve(receipt.result.cwd))
        || observation.after?.cwdDigest !== observation.before?.cwdDigest
        || beforeBindings.some((item, index) => item.ordinal !== index
          || item.declaredDigest !== hash(declared.targets[index])
          || item.resolvedPathDigest !== hash(isAbsolute(declared.targets[index])
            ? declared.targets[index] : resolve(receipt.result.cwd, declared.targets[index]))
          || item.resolvedPathDigest !== hash(beforeTargets[index].path))
        || observation.targetSetDigest == null
        || observation.targetSetDigest !== observation.before?.targetSetDigest
        || observation.targetSetDigest !== observation.after?.targetSetDigest)) {
        throw new Error('effect target identity mismatch');
      }
      const targets = declared.targets.map((target, index) => ({ targetIdentityDigest: hash({ target }),
        before: targetState(beforeTargets[index]), after: targetState(afterTargets[index]),
        changes: targetChange(beforeTargets[index], afterTargets[index]) }));
      const lanes = ['existence', 'identity', 'type', 'content', 'size', 'mode', 'owner', 'acl', 'flags', 'entries', 'openability'];
      const coverage = Object.fromEntries(lanes.map((name) => [name,
        targets.length > 0 && targets.every((target) => target.changes[name] !== 'unknown')]));
      const changed = targets.some((target) => Object.values(target.changes)
        .some((value) => ['created', 'removed', 'changed'].includes(value)));
      const unknowns = [];
      if (scope === 'external') unknowns.push('external effect was not observed by the local runtime');
      unknowns.push('undeclared effects unmeasured');
      for (const [name, covered] of Object.entries(coverage)) if (!covered) unknowns.push(`${name} unmeasured`);
      const result = scope === 'external' || !observation?.after ? 'unknown'
        : changed && unknowns.length ? 'partial' : changed ? 'confirmed_change'
          : unknowns.length ? 'partial' : 'confirmed_no_change';
      const core = { schema: 't5.effect-forensic-receipt.v1', effect: {
        runId, toolCallId, declaredKind: declared.kind,
        declaredTargetDigest: hash(declared.targets), executionOutcome: receipt.outcome ?? 'unknown' },
      scope: { kind: scope, confinementQualified: false, undeclaredEffectCoverage: 'unmeasured' },
      targets, coverage, result, unknowns };
      const value = deepFreeze({ ...core, receiptDigest: hash(core) }); MATERIALIZED.add(value); return value;
  };
  const materializeRollback = async ({ rollbackRunId, rollbackToolCallId } = {}) => {
    const rollbackRun = await runLedger.read(rollbackRunId);
    const rollbackEvents = rollbackRun.events.filter((event) => event.type === 'tool_completed'
      && event.payload?.receipt?.toolCallId === rollbackToolCallId);
    if (rollbackEvents.length !== 1) throw new Error('exact rollback effect receipt is required');
    const rollbackReceipt = rollbackEvents[0].payload.receipt;
    const relation = rollbackReceipt.requestedCall?.args?.effect?.rollbackOfToolCallId;
    if (!relation || rollbackReceipt.actualCall?.args?.effect?.rollbackOfToolCallId !== relation
      || rollbackReceipt.result?.effectObservation?.declared?.rollbackOfToolCallId !== relation) {
      throw new Error('explicit rollback relation is required');
    }
    const sessionId = rollbackRun.events[0]?.payload?.sessionId;
    const runs = await runLedger.list({ sessionId }); const sources = [];
    for (const run of runs) for (const event of run.events) {
      if (event.type === 'tool_completed' && event.payload?.receipt?.toolCallId === relation) {
        sources.push({ runId: run.runId, toolCallId: relation, sequence: event.sequence,
          eventRecordedAt: event.recordedAt });
      }
    }
    if (sources.length !== 1 || (sources[0].runId === rollbackRunId
      && sources[0].toolCallId === rollbackToolCallId)) throw new Error('exact source effect relation is required');
    const causal = sources[0].runId === rollbackRunId
      ? sources[0].sequence < rollbackEvents[0].sequence
      : String(sources[0].eventRecordedAt ?? '') < String(rollbackEvents[0].recordedAt ?? '');
    if (!causal) throw new Error('rollback source must precede rollback effect');
    const [source, rollback] = await Promise.all([materialize({ sessionId, ...sources[0] }),
      materialize({ sessionId, runId: rollbackRunId, toolCallId: rollbackToolCallId })]);
    if (source.scope.kind !== 'local' || rollback.scope.kind !== 'local'
      || source.effect.executionOutcome !== 'succeeded'
      || source.targets.length !== rollback.targets.length
      || source.targets.some((target, index) => target.targetIdentityDigest !== rollback.targets[index].targetIdentityDigest)) {
      throw new Error('rollback target identity mismatch');
    }
    const fullyMeasured = (state) => state?.exists === false || (state?.exists === true
      && state.type != null && state.filesystemIdentityDigest != null && state.mode != null
      && state.ownerDigest != null && state.aclDigest != null && state.flagsDigest != null
      && state.openability != null && (state.type !== 'file' || state.contentDigest != null)
      && (state.type !== 'directory' || (state.entryCount != null && state.entryDigest != null)));
    const comparison = source.targets.map((target, index) => ({
      targetIdentityDigest: target.targetIdentityDigest, expectedStateDigest: hash(target.before),
      actualStateDigest: rollback.targets[index].after ? hash(rollback.targets[index].after) : null,
      chainContinuous: rollback.targets[index].before
        ? hash(target.after) === hash(rollback.targets[index].before) : null,
      fullyMeasured: fullyMeasured(target.before),
      restored: rollback.targets[index].after ? hash(target.before) === hash(rollback.targets[index].after) : null,
    }));
    const outcome = rollback.effect.executionOutcome;
    const result = outcome !== 'succeeded' || comparison.some((item) => item.restored == null
      || item.chainContinuous !== true) ? 'unknown'
      : comparison.every((item) => item.restored && item.fullyMeasured) ? 'restored'
        : comparison.some((item) => item.restored) ? 'partially_restored' : 'not_restored';
    const core = { schema: 't5.effect-rollback-receipt.v1', sourceEffect: {
      forensicReceiptDigest: source.receiptDigest }, rollbackEffect: {
      forensicReceiptDigest: rollback.receiptDigest, executionOutcome: outcome }, comparison, result };
    const value = deepFreeze({ ...core, receiptDigest: hash(core) }); ROLLBACK_MATERIALIZED.add(value); return value;
  };
  return Object.freeze({ materialize, materializeRollback });
}

export function projectHumanEffectForensicReceipt(value) {
  if (!MATERIALIZED.has(value)) throw new TypeError('runtime-materialized effect forensic receipt is required');
  const changed = value.targets.filter((target) => Object.values(target.changes)
    .some((item) => ['created', 'removed', 'changed'].includes(item))).length;
  const confirmed = Object.entries(value.coverage).filter(([, covered]) => covered).map(([name]) => name);
  const labels = { existence: '존재 여부', identity: '파일 동일성', type: '종류', content: '내용', size: '크기',
    mode: '권한', owner: '소유자', acl: '접근 제어', flags: '파일 속성', entries: '항목 수', openability: 'T5의 읽기·쓰기 가능 여부' };
  const outcome = value.effect.executionOutcome;
  const title = value.scope.kind === 'external' ? '컴퓨터 밖 변화는 아직 관측하지 못했어요.'
    : changed ? `${changed}개 대상의 변화를 확인했어요.` : '관측한 대상의 변화를 확인했어요.';
  const outcomeWarning = outcome === 'failed' ? '실행은 실패했지만 일부 변화가 남았을 수 있어요.'
    : outcome === 'unknown' ? '실행 완료 여부를 확인하지 못했어요.'
      : outcome === 'not_executed' ? '실행되지 않았어요.' : null;
  return deepFreeze({ title,
    confirmed: confirmed.map((name) => labels[name]).slice(0, 11),
    rollback: '되돌리기는 실행하지 않았어요.',
    unknowns: [outcomeWarning, ...value.unknowns.map((item) => item === 'undeclared effects unmeasured'
      ? '이 대상 밖의 변화와 원인은 아직 확인하지 못했어요.'
      : `${labels[item.split(' ')[0]] ?? '다른 변화'}는 아직 확인하지 못했어요.`)]
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index).slice(0, 11),
    detailsAvailable: true });
}

export function projectHumanEffectRollbackReceipt(value) {
  if (!ROLLBACK_MATERIALIZED.has(value)) throw new TypeError('runtime-materialized rollback receipt is required');
  return deepFreeze({ summary: value.result === 'restored' ? '이전 상태로 돌아온 것을 확인했어요.'
    : value.result === 'partially_restored' ? '일부만 이전 상태로 돌아왔어요.'
      : value.result === 'not_restored' ? '이전 상태로 돌아오지 않았어요.'
        : '되돌린 결과를 아직 확인하지 못했어요.', result: value.result });
}
