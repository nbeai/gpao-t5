import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

const digest = (value) => createHash('sha256')
  .update(JSON.stringify(value)).digest('hex');

export function sourceMemberRef(sourceSetRef, member) {
  return `wsm1.${digest({ sourceSetRef, name: String(member?.name ?? '').normalize('NFC'), kind: member?.kind }).slice(0, 28)}`;
}

export function identifyWorksetMembers(reality) {
  if (!reality?.sourceSetRef || !Array.isArray(reality.members)) return reality;
  return {
    ...reality,
    members: reality.members.map((member) => ({
      ...member,
      memberRef: member.memberRef ?? sourceMemberRef(reality.sourceSetRef, member),
    })),
  };
}

export function bindSourceReceipt(rec, { workRef, sourceSetRef } = {}) {
  // ReceiptRef는 이 본문의 digest에 대한 OS 서명이다. 발급 뒤 source 결산 표식을 덧붙이면
  // 서명한 사실과 durable 원장이 갈라진다. 완료 write는 source read 결산 대상도 아니므로
  // 그대로 보존하고, 아직 서명되지 않은 실행 Receipt만 새 객체로 결속한다.
  if (!rec || rec.origin === 'runtime_observation' || rec.receiptRef) return rec;
  return {
    ...rec,
    ...(workRef ? { sourceWorkRef: workRef } : {}),
    ...(sourceSetRef ? { sourceSetRef } : {}),
  };
}

function requestedPath(args, root) {
  const raw = String(args?.path ?? '').trim();
  if (!raw) return null;
  return isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
}

function memberForReceipt(receipt, reality) {
  if (receipt?.sourceWorkRef == null || receipt?.sourceSetRef !== reality?.sourceSetRef) return null;
  if (receipt?.actualCall?.tool !== 'local.file' || receipt?.actualCall?.args?.action !== 'read') return null;
  const root = reality?.currentRoot?.path;
  if (!root) return null;
  const asked = requestedPath(receipt.actualCall.args, root);
  const actual = typeof receipt?.result?.path === 'string' ? resolve(receipt.result.path) : null;
  const lexical = (reality.members ?? []).filter((member) => resolve(root, member.name) === asked);
  if (lexical.length === 1) return lexical[0];
  const byActual = (reality.members ?? []).filter((member) => resolve(root, member.name) === actual);
  return byActual.length === 1 ? byActual[0] : null;
}

function completeRead(receipts) {
  const pages = receipts.map((receipt) => {
    const result = receipt.result ?? {};
    const start = Number.isInteger(result.offset) ? result.offset : 0;
    const textLength = typeof result.text === 'string' ? result.text.length : 0;
    const end = Number.isInteger(result.nextOffset) ? result.nextOffset : start + textLength;
    return { start, end, total: Number.isInteger(result.totalChars) ? result.totalChars : null,
      terminal: !Number.isInteger(result.nextOffset), callRef: receipt.actualCall?.callRef ?? null };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  if (!pages.length || pages[0].start !== 0) return { complete: false, callRefs: [] };
  let end = 0; let total = null; const callRefs = [];
  for (const page of pages) {
    if (page.start > end) return { complete: false, callRefs };
    end = Math.max(end, page.end);
    if (page.total !== null) total = total === null ? page.total : Math.max(total, page.total);
    if (page.callRef && !callRefs.includes(page.callRef)) callRefs.push(page.callRef);
  }
  const terminal = pages.some((page) => page.terminal && (page.total === null || page.end >= page.total));
  return { complete: terminal && total !== null && end >= total, callRefs };
}

/**
 * F-66b의 중립 결산. 현재 입장 가능한 제외 근거가 없으므로 excluded는 계약 어휘의 빈 정의역이다.
 * list 관측·이웃 preview·실패·부분 pagination은 read가 아니다.
 */
export function projectSourceCoverage({ worksetReality, receipts = [], workRef } = {}) {
  const reality = identifyWorksetMembers(worksetReality);
  if (!reality?.sourceSetRef || !Array.isArray(reality.members)) return null;
  const members = reality.members.map((member) => {
    const matching = receipts.filter((receipt) => receipt?.sourceWorkRef === workRef
      && (receipt?.failureState ?? 'none') === 'none'
      && receipt?.lifecycle === 'delivered'
      && member.revisionRef
      && receipt?.result?.sourceRevisionRef === member.revisionRef
      && memberForReceipt(receipt, reality)?.memberRef === member.memberRef);
    const read = member.kind === 'file' ? completeRead(matching) : { complete: false, callRefs: [] };
    return {
      memberRef: member.memberRef,
      name: member.name,
      kind: member.kind,
      ...(member.revisionRef ? { revisionRef: member.revisionRef } : {}),
      status: read.complete ? 'read' : 'unresolved',
      ...(read.callRefs.length ? { evidenceCallRefs: read.callRefs } : {}),
    };
  });
  const counts = { read: members.filter((m) => m.status === 'read').length, excluded: 0,
    unresolved: members.filter((m) => m.status === 'unresolved').length };
  const unobserved = Math.max(0, Number(reality.page?.total ?? members.length) - members.length);
  const complete = reality.membersComplete === true && unobserved === 0 && counts.unresolved === 0;
  const sourceCoverageRef = `sc1.${digest({ workRef, sourceSetRef: reality.sourceSetRef,
    members: members.map(({ memberRef, status, evidenceCallRefs }) => ({ memberRef, status, evidenceCallRefs })) }).slice(0, 32)}`;
  return {
    schemaVersion: 1,
    sourceCoverageRef,
    workRef: workRef ?? null,
    sourceSetRef: reality.sourceSetRef,
    currentRoot: reality.currentRoot,
    members,
    membersComplete: reality.membersComplete === true,
    unobserved,
    counts,
    complete,
    exclusionAdmission: 'unavailable',
  };
}

export function initialWorksetReality(entries = [], workRef, fallback) {
  const receipt = entries.find((entry) => entry?.origin === 'runtime_observation'
    && entry?.observationKind === 'workset'
    && entry?.sourceWorkRef === workRef
    && entry?.result?.sourceSetRef
    && Array.isArray(entry?.result?.items));
  if (!receipt) return identifyWorksetMembers(fallback);
  const items = receipt.result.items.map((member) => ({
    name: String(member.name), kind: member.kind === 'folder' ? 'folder' : 'file',
    ...(member.memberRef ? { memberRef: member.memberRef } : {}),
    ...(member.revisionRef ? { revisionRef: member.revisionRef } : {}),
  }));
  const total = Number(receipt.result.total ?? items.length);
  const nextOffset = Number.isInteger(receipt.result.nextOffset) ? receipt.result.nextOffset : null;
  return identifyWorksetMembers({
    status: total === 0 ? 'observed_empty' : 'observed',
    currentRoot: receipt.result.currentRoot,
    members: items,
    membersComplete: nextOffset === null,
    page: { offset: Number(receipt.result.offset ?? 0), observed: items.length, total,
      truncated: nextOffset !== null, ...(nextOffset !== null ? { nextOffset } : {}) },
    sourceSetRef: receipt.result.sourceSetRef,
  });
}

export function sourceCoverageReceipt(coverage, turnRef) {
  if (!coverage) return null;
  const snapshot = JSON.parse(JSON.stringify(coverage));
  return {
    intended: '현재 작업셋 source 결산',
    actualCall: null,
    result: { sourceCoverage: snapshot },
    failureState: 'none',
    lifecycle: 'none',
    userSafeSummary: '',
    origin: 'runtime_observation',
    observationKind: 'source_coverage',
    sourceWorkRef: coverage.workRef,
    sourceSetRef: coverage.sourceSetRef,
    ...(turnRef ? { turnRef } : {}),
  };
}
