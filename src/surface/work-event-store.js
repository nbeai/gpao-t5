// L4 · P90-1 장기 작업 사건 저장소.
// 모델은 사건 후보만 낸다. 내부 신분과 사건 신분은 이 저장소의 지속 키가 발급한다.
import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { WorkEventLedger } from '../kernel/l0-evidence/work-event-ledger.js';
import {
  issueCompletionContractRef as signCompletionContractRef,
  issueReceiptRef as signReceiptRef,
  issueSubjectRef as signSubjectRef,
  issueWorkRef as signWorkRef,
  readCompletionContractRef,
  readReceiptRef,
  readSubjectRef,
  readWorkRef,
  workEvidenceDigest,
} from '../kernel/l0-evidence/work-refs.js';
import {
  canonicalDurableEvidence, containsSensitiveValue,
} from '../kernel/l0-evidence/sensitive-text.js';
import { atomicWritePrivate, serializeByFile } from './versioned-json-store.js';

const STORE_VERSION = 1;
const KEY = /^[0-9a-f]{64}$/;
const CANDIDATE_KEYS = ['type', 'workRef', 'subjectRef', 'scopeRef', 'evidence'];

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}은 객체여야 한다`);
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} 필드가 계약과 다르다`);
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function receiptReadyForSignature(receipt, turnRef) {
  if (receipt?.turnRef && JSON.stringify(receipt.turnRef) !== JSON.stringify(turnRef)) {
    throw new TypeError('완료 Receipt 본문의 TurnRef가 서명 TurnRef와 다르다');
  }
  return canonicalDurableEvidence({ ...receipt, turnRef });
}

function eventIdFor(candidate, key) {
  const digest = createHmac('sha256', key)
    .update(JSON.stringify(stable(candidate)))
    .digest('base64url');
  return `we1.${digest}`;
}

export class WorkEventStore {
  constructor(dir) {
    if (typeof dir !== 'string' || dir.length === 0) throw new TypeError('WorkEventStore dir가 필요하다');
    this.dir = dir;
    this.file = join(dir, 'work-events.json');
    this.keyFile = join(dir, 'work-events.key');
  }

  async _key() {
    if (this.key) return this.key;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    let raw;
    try { raw = (await readFile(this.keyFile, 'utf8')).trim(); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      raw = randomBytes(32).toString('hex');
      try {
        await writeFile(this.keyFile, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      } catch (writeError) {
        if (writeError?.code !== 'EEXIST') throw writeError;
        raw = (await readFile(this.keyFile, 'utf8')).trim();
      }
    }
    if (!KEY.test(raw)) throw new Error('WorkEventStore 발급 키가 손상됐다 — 자동 교체하지 않는다');
    await chmod(this.keyFile, 0o600);
    this.key = Buffer.from(raw, 'hex');
    return this.key;
  }

  async _readState() {
    let raw;
    try { raw = await readFile(this.file, 'utf8'); } catch (error) {
      if (error?.code === 'ENOENT') return { records: [], parseCorrupt: false };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== STORE_VERSION || !Array.isArray(parsed.records)) {
        return { records: [], parseCorrupt: true, reason: '저장소 스키마가 유효하지 않다' };
      }
      return { records: parsed.records, parseCorrupt: false };
    } catch {
      return { records: [], parseCorrupt: true, reason: '저장소 JSON을 읽을 수 없다' };
    }
  }

  async _ledger() {
    const state = await this._readState();
    if (state.parseCorrupt) {
      return {
        ledger: WorkEventLedger.fromRecords([], { sensitiveGuard: containsSensitiveValue }),
        forcedDegraded: true,
        reason: state.reason,
      };
    }
    return {
      ledger: WorkEventLedger.fromRecords(state.records, { sensitiveGuard: containsSensitiveValue }),
      forcedDegraded: false,
      reason: null,
    };
  }

  async loadWithStatus() {
    const { ledger, forcedDegraded, reason } = await this._ledger();
    return {
      records: ledger.records,
      degraded: forcedDegraded || ledger.degraded,
      readOnly: forcedDegraded || ledger.readOnly,
      recovery: forcedDegraded
        ? { lastValidCheckpoint: 0, failedAt: 1, reason }
        : structuredClone(ledger.recovery),
    };
  }

  async load() {
    return (await this.loadWithStatus()).records;
  }

  async issueWorkRef(binding) {
    return signWorkRef(binding, await this._key());
  }

  /** 세션 저장이 사건 기록 뒤 끊겨도 최초 TurnRef에서 작업 신분을 복구한다. */
  async findWorkRef({ sessionId, principalRef }) {
    if (!sessionId || !principalRef) return null;
    const key = await this._key();
    for (const record of await this.load()) {
      if (record.scopeRef?.principalRef !== principalRef) continue;
      try {
        const binding = readWorkRef(record.workRef, key);
        if (binding.turnRef.sessionId === sessionId) return record.workRef;
      } catch { /* 서명 불일치는 후보가 아니다 */ }
    }
    return null;
  }

  async issueSubjectRef(binding) {
    return signSubjectRef(binding, await this._key());
  }

  async issueCompletionContractRef({ workRef, contract }) {
    const key = await this._key();
    readWorkRef(workRef, key);
    const canonical = canonicalDurableEvidence(contract);
    if (workEvidenceDigest(canonical) !== workEvidenceDigest(contract)) {
      throw new TypeError('CompletionContract는 민감값을 canonical 가림한 본문으로 발급해야 한다');
    }
    return signCompletionContractRef({ workRef, contractDigest: workEvidenceDigest(contract) }, key);
  }

  async _issueReceiptRef({ turnRef, turnOrdinal, receipt, completionExecution = false }) {
    if (receipt?.lifecycle !== 'delivered' || receipt?.failureState !== 'none') {
      throw new TypeError('성공 ReceiptRef는 delivered·failureState=none 영수증에서만 발급한다');
    }
    const isCompletionReceipt = Array.isArray(receipt.deliverableRefs) && receipt.deliverableRefs.length > 0;
    if (isCompletionReceipt) {
      if (!completionExecution) {
        throw new TypeError('완료 ReceiptRef는 사전 계약이 감싼 실행 경로에서만 발급한다');
      }
      if (receipt?.actualCall?.tool !== 'local.file' || receipt?.actualCall?.args?.action !== 'write') {
        throw new TypeError('완료 ReceiptRef는 성공한 local.file write 영수증에서만 발급한다');
      }
      if (!receipt.workRef || !receipt.completionContractRef) {
        throw new TypeError('완료 ReceiptRef에는 사전 WorkRef·CompletionContractRef 결합이 필요하다');
      }
      const contract = readCompletionContractRef(receipt.completionContractRef, await this._key());
      if (contract.workRef !== receipt.workRef) {
        throw new TypeError('완료 영수증의 WorkRef와 CompletionContractRef가 결합되지 않았다');
      }
      if (!receipt.completionContract
        || contract.contractDigest !== workEvidenceDigest(receipt.completionContract)) {
        throw new TypeError('완료 영수증이 사전 완료 계약 본문과 결합되지 않았다');
      }
      const required = (receipt.completionContract.deliverables ?? []).map((item) => item?.id).filter(Boolean);
      if (!required.length || required.some((id) => !receipt.deliverableRefs.includes(id))) {
        throw new TypeError('완료 영수증이 사전 완료 계약의 산출물을 충족하지 않았다');
      }
    }
    return signReceiptRef({
      turnRef,
      turnOrdinal,
      receiptDigest: workEvidenceDigest(receipt),
      ...(isCompletionReceipt ? {
        workRef: receipt.workRef,
        completionContractRef: receipt.completionContractRef,
      } : {}),
    }, await this._key());
  }

  async issueReceiptRef({ turnRef, turnOrdinal, receipt }) {
    return this._issueReceiptRef({ turnRef, turnOrdinal, receipt, completionExecution: false });
  }

  /** 계약을 먼저 검증한 뒤 그 경계 안에서 실행하고, 성공한 완료 영수증을 즉시 봉인한다. */
  async runCompletionExecution({
    turnRef, turnOrdinal, workRef, completionContract, completionContractRef, execute,
  }) {
    if (typeof execute !== 'function') throw new TypeError('완료 계약 실행 함수가 필요하다');
    const key = await this._key();
    readWorkRef(workRef, key);
    const contract = readCompletionContractRef(completionContractRef, key);
    if (contract.workRef !== workRef
      || contract.contractDigest !== workEvidenceDigest(completionContract)) {
      throw new TypeError('실행 전에 발급된 WorkRef·CompletionContractRef·계약 본문 결합이 필요하다');
    }
    const executed = await execute();
    const receipt = Array.isArray(executed?.deliverableRefs) && executed.deliverableRefs.length > 0
      ? receiptReadyForSignature(executed, turnRef) : executed;
    if (!Array.isArray(receipt?.deliverableRefs) || receipt.deliverableRefs.length === 0) return receipt;
    const receiptRef = await this._issueReceiptRef({
      turnRef, turnOrdinal, receipt, completionExecution: true,
    });
    return { ...receipt, receiptRef };
  }

  async _validateRefs(candidate, key) {
    readWorkRef(candidate.workRef, key);
    readSubjectRef(candidate.subjectRef, key);
    const evidence = candidate.evidence;
    if (candidate.type === 'execution_completed') {
      const contract = readCompletionContractRef(evidence.completionContractRef, key);
      const receipt = readReceiptRef(evidence.receiptRef, key);
      if (contract.workRef !== candidate.workRef) {
        throw new TypeError('CompletionContractRef가 사건 WorkRef와 다르다');
      }
      if (receipt.workRef !== candidate.workRef
        || receipt.completionContractRef !== evidence.completionContractRef) {
        throw new TypeError('ReceiptRef가 사건 WorkRef·CompletionContractRef와 결합되지 않았다');
      }
    } else if (candidate.type === 'question_resolved' && evidence.receiptRef !== undefined) {
      readReceiptRef(evidence.receiptRef, key);
    } else if (candidate.type === 'chat_delivered') {
      const contract = readCompletionContractRef(evidence.resultContractRef, key);
      if (contract.workRef !== candidate.workRef) throw new TypeError('결과 계약이 사건 WorkRef와 다르다');
    }
  }

  async _commitRecords(records) {
    await atomicWritePrivate(this.file, { schemaVersion: STORE_VERSION, records });
  }

  async appendBatch(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new TypeError('WorkEvent candidate 묶음이 필요하다');
    }
    const key = await this._key();
    const prepared = [];
    for (const candidate of candidates) {
      exactKeys(candidate, CANDIDATE_KEYS, 'WorkEvent candidate');
      await this._validateRefs(candidate, key);
      const input = structuredClone(candidate);
      prepared.push({ input, eventId: eventIdFor(input, key) });
    }

    return serializeByFile(this.file, async () => {
      const { ledger, forcedDegraded, reason } = await this._ledger();
      if (forcedDegraded || ledger.readOnly) {
        throw new Error(`WorkEventStore는 손상 후 읽기 전용이다: ${reason ?? ledger.recovery.reason}`);
      }
      const records = prepared.map(({ input, eventId }) => ledger.append({ eventId, ...input }));
      await this._commitRecords(ledger.records);
      return records.map((record) => ({ accepted: true, eventId: record.eventId, event: record }));
    });
  }

  async append(candidate) {
    return (await this.appendBatch([candidate]))[0];
  }
}
