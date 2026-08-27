import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';

import { AttachmentStore } from './attachment-store.js';
import { RunLedger } from './run-ledger.js';
import { WorkStore } from './work-store.js';

const SHA = /^[0-9a-f]{64}$/u;
const MATERIALIZED = new WeakSet();
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameBytes = (left, right) => left && right && left.bytes === right.bytes && left.sha256 === right.sha256;
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeArtifact(record) {
  if (!record || !record.attachmentId || !record.sessionId || !record.originalName
    || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !SHA.test(String(record.sha256 ?? ''))
    || !record.mimeType || !record.kind) throw new TypeError('artifact identity is incomplete');
  return record;
}
function deliveryState(result) {
  if (result?.state !== 'delivery_terminal') return result?.state === 'delivery_started' ? 'unknown' : 'not_requested';
  if (result.delivery?.state === 'sent' || result.delivery?.state === 'persisted') return 'succeeded';
  if (result.delivery?.state === 'unknown') return 'unknown';
  return 'failed';
}
function classify({ receipt, artifact, produced, previous, run }) {
  const action = receipt.requestedCall?.args?.action; const effect = receipt.result?.effect;
  if (effect === 'reuse' && receipt.result?.reused === true) {
    return receipt.requestedCall?.args?.attachmentId === artifact.attachmentId ? 'reused_output' : 'unknown';
  }
  if (action === 'register_existing_file' && effect === 'existing_file_selected') {
    const source = receipt.result?.sourceIdentity;
    return source?.name === artifact.originalName && sameBytes(source, artifact) ? 'existing_file' : 'unknown';
  }
  if (artifact.artifactVersion > 1 || receipt.requestedCall?.args?.attachmentId) {
    return previous && receipt.requestedCall.args.attachmentId === previous.attachmentId
      && artifact.artifactFamilyId === previous.artifactFamilyId
      && artifact.artifactVersion === previous.artifactVersion + 1 && artifact.sha256 !== previous.sha256
      ? 'transformed_output' : 'unknown';
  }
  if (action !== 'register_output') return 'unknown';
  if (!produced) return 'authorized_workspace_output';
  const event = run.events.find((item) => item.type === 'output_produced'
    && item.payload?.outputHandle === produced.outputHandle);
  return event && sameBytes(event.payload, produced) && sameBytes(produced, artifact)
    && event.payload?.producerRunId === run.runId && produced.producerRunId === run.runId
    && receipt.result?.outputHandle === produced.outputHandle && receipt.result?.producerRunId === run.runId
    ? 'generated_output' : 'unknown';
}

function human(publication) {
  const title = publication.classification === 'existing_file' ? '기존 파일 그대로 준비했어요.'
    : publication.classification === 'generated_output' ? '새 결과 파일을 준비했어요.'
      : publication.classification === 'transformed_output' ? '기존 결과를 바꾼 새 버전을 준비했어요.'
        : publication.classification === 'reused_output' ? '이전에 만든 결과를 그대로 준비했어요.'
          : publication.classification === 'authorized_workspace_output'
            ? '허용된 작업공간의 결과 파일을 준비했어요.' : '파일의 출처는 추가 확인이 필요해요.';
  const confirmed = publication.storage.exactReadback
    ? ['저장된 파일의 크기·내용·형식을 다시 확인했어요.'] : [];
  if (publication.sourceProvenance?.verified === true) confirmed.push(
    `결과에 사용한 원본 ${publication.sourceProvenance.sourceCount}개가 바뀌지 않았는지 다시 확인했어요.`,
  );
  if (publication.sourceProvenance?.reconciliation?.verified === true) confirmed.push(
    `표준 열 ${publication.sourceProvenance.reconciliation.columnCount}개와 전체 ${publication.sourceProvenance.reconciliation.rowCount}행을 원본과 다시 맞췄어요.`,
  );
  const unknowns = [];
  if (!publication.storage.exactReadback) unknowns.push('저장된 파일을 다시 여는 확인은 아직 하지 않았어요.');
  unknowns.push('화면에서 실제로 열리는지는 아직 확인하지 않았어요.');
  unknowns.push('임시 파일 정리 상태는 아직 확인하지 않았어요.');
  if (publication.publication.delivery === 'failed') unknowns.push(publication.storage.exactReadback
    ? '전달에 실패했어요. 확인한 파일은 T5에 보존되어 있어요.' : '전달에 실패했고 파일 보존도 확인이 필요해요.');
  if (publication.publication.delivery === 'unknown') unknowns.push('전달 여부를 확인하지 못했어요. 다시 보내기 전에 상태 확인이 필요해요.');
  if (publication.temporary.userWorkspaceCopiesCreated > 0) unknowns.push('사용자 작업공간에 추가 파일이 생겼어요.');
  return Object.freeze({ title, fileName: String(publication.artifact.name).slice(0, 240),
    typeLabel: publication.artifact.kind === 'image' ? '이미지'
      : publication.artifact.kind === 'spreadsheet' ? '표' : '파일',
    confirmed, changed: publication.classification === 'transformed_output'
      ? ['이전 결과와 다른 새 버전이에요.'] : [],
    verification: confirmed[0] ?? '파일 검증 상태를 추가로 확인해야 해요.',
    delivery: publication.state === 'delivered' ? '전달을 마쳤어요.'
      : publication.publication.surfacePersisted ? 'T5 화면에 결과를 보관했어요.' : '아직 화면에 전달하지 않았어요.',
    recovery: null, unknowns, detailsAvailable: true });
}

export function projectHumanArtifactReceipt(publication) {
  if (!MATERIALIZED.has(publication)) throw new TypeError('runtime-materialized artifact publication is required');
  return human(publication);
}

export function makeArtifactPublicationProductAdapter({ attachmentStore, runLedger, workStore } = {}) {
  if (!(attachmentStore instanceof AttachmentStore) || !(runLedger instanceof RunLedger)
    || !(workStore instanceof WorkStore)) throw new TypeError('canonical artifact stores are required');
  return Object.freeze({
    async materialize({ sessionId, runId, attachmentId } = {}) {
      const [run, workState, record] = await Promise.all([
        runLedger.read(runId), workStore.read(), attachmentStore.get({ sessionId, attachmentId }),
      ]);
      const before = await lstat(record.storedPath);
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
        throw new Error('managed artifact readback is not a regular single-link file');
      }
      const content = await attachmentStore.readContent({ sessionId, attachmentId });
      const after = await lstat(record.storedPath);
      const stableRead = after.isFile() && !after.isSymbolicLink() && after.nlink === 1
        && before.dev === after.dev && before.ino === after.ino && before.size === after.size
        && before.mtimeMs === after.mtimeMs;
      const artifact = safeArtifact(content.record);
      if (artifact.sessionId !== sessionId || artifact.attachmentId !== attachmentId
        || run.events[0]?.payload?.sessionId !== sessionId) throw new Error('artifact publication identity mismatch');
      const observedSha = createHash('sha256').update(content.bytes).digest('hex');
      const exactReadback = stableRead && content.bytes.length === artifact.bytes && observedSha === artifact.sha256;
      const matches = run.events.filter((event) => event.type === 'tool_completed'
        && event.payload?.receipt?.result?.artifact?.attachmentId === attachmentId);
      if (matches.length !== 1) throw new Error('exact artifact tool receipt is required');
      const receipt = matches[0].payload.receipt;
      if (receipt.outcome !== 'succeeded' || receipt.requestedCall?.name !== 'attachment'
        || !['register_existing_file', 'register_output'].includes(receipt.requestedCall?.args?.action)) {
        throw new Error('qualified artifact registration receipt is required');
      }
      const result = workState.results.find((item) => item.runId === runId && item.sessionId === sessionId);
      if (!result) throw new Error('artifact Work result is missing');
      const claims = workState.claims.filter((item) => item.runId === runId);
      if (claims.length !== 1 || result.workId !== claims[0].workId || result.revision !== claims[0].revision) {
        throw new Error('artifact Work result identity mismatch');
      }
      const linked = artifact.links?.some((link) => link.runId === runId) === true;
      const included = result.surfaceResult?.artifacts?.some((item) => item.attachmentId === attachmentId) === true;
      let produced = null;
      if (receipt.result?.outputHandle) produced = await attachmentStore.producedOutput({
        sessionId, outputHandle: receipt.result.outputHandle,
      });
      let previous = null;
      if (receipt.requestedCall?.args?.attachmentId && receipt.result?.effect !== 'reuse') {
        previous = await attachmentStore.get({ sessionId,
          attachmentId: receipt.requestedCall.args.attachmentId }).catch(() => null);
      }
      const classification = classify({ receipt, artifact, produced, previous, run });
      const producedEvents = run.events.filter((item) => item.type === 'output_produced'
        && item.payload?.outputHandle === produced?.outputHandle);
      if (produced && producedEvents.length !== 1) throw new Error('ambiguous produced output evidence');
      const core = { schema: 't5.artifact-publication.v1',
        artifact: { name: artifact.originalName, bytes: artifact.bytes,
          mimeType: artifact.mimeType, kind: artifact.kind }, classification,
        storage: { registered: true, exactReadback },
        publication: { linkedToRun: linked, includedInSurfaceResult: included,
          surfacePersisted: ['surface_persisted', 'delivery_started', 'delivery_terminal'].includes(result.state),
          delivery: deliveryState(result) },
        verification: { structural: 'unmeasured', visual: 'unmeasured', content: 'unmeasured', openability: 'unmeasured' },
        sourceProvenance: receipt.result?.sourceProvenance?.state === 'verified' ? {
          verified: true, sourceCount: receipt.result.sourceProvenance.sources?.length ?? 0,
          purpose: String(receipt.result.sourceProvenance.purpose ?? '').slice(0, 500),
          unknowns: (receipt.result.sourceProvenance.unknowns ?? []).map(String).slice(0, 20),
          reconciliation: receipt.result?.sourceReconciliation?.state === 'verified' ? {
            verified: true, mode: receipt.result.sourceReconciliation.mode,
            rowCount: receipt.result.sourceReconciliation.rowCount,
            columnCount: receipt.result.sourceReconciliation.outputColumns?.length ?? 0,
          } : { verified: false, mode: null, rowCount: null, columnCount: null },
        } : { verified: false, sourceCount: 0, purpose: null, unknowns: [] },
        temporary: { userWorkspaceCopiesCreated: classification === 'existing_file'
          && receipt.result?.publication?.managedCopy === true
          ? receipt.result.publication.userWorkspaceCopiesCreated : null, cleanup: 'unknown' },
        rollback: { available: null, kind: 'unknown' } };
      const publication = deepFreeze({ ...core, state: exactReadback && linked && included
        && core.publication.surfacePersisted ? core.publication.delivery === 'succeeded' ? 'delivered'
          : 'surface_persisted' : exactReadback ? 'verified' : 'unknown', receiptDigest: hash(core) });
      MATERIALIZED.add(publication); return publication;
    },
  });
}
