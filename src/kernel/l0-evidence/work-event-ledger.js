// L0 · P90-1 장기 작업 사건 원장.
// 현재 상태를 따로 저장하지 않는다. append-only 사건과 검증된 근거만이 진실이고 WorkState는 투영이다.
import { createHash } from 'node:crypto';

export const WORK_EVENT_SCHEMA_VERSION = 1;
export const WORK_EVENT_TYPES = Object.freeze([
  'agreement_set',
  'agreement_superseded',
  'agreement_retracted',
  'question_opened',
  'question_resolved',
  'execution_completed',
  'chat_delivered',
]);

const EVENT_TYPE_SET = new Set(WORK_EVENT_TYPES);
const INPUT_KEYS = ['eventId', 'type', 'workRef', 'subjectRef', 'scopeRef', 'evidence'];
const RECORD_KEYS = [
  'schemaVersion', 'ordinal', 'eventId', 'type', 'workRef', 'subjectRef', 'scopeRef',
  'evidence', 'eventDigest', 'previousHash', 'hash', 'checkpoint',
];
const EVIDENCE_KEYS = Object.freeze({
  agreement_set: ['turnRef', 'statement'],
  agreement_superseded: ['turnRef', 'statement', 'targetEventId'],
  agreement_retracted: ['turnRef', 'statement', 'targetEventId'],
  question_opened: ['turnRef', 'question', 'changesAnswerFor'],
  question_resolved: ['targetEventId', 'turnRef', 'receiptRef'],
  execution_completed: ['completionContractRef', 'receiptRef', 'verificationPassed'],
  chat_delivered: ['resultContractRef', 'turnRef', 'contentDigest', 'persisted'],
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (!plainObject(value)) throw new TypeError(`${label}은 객체여야 한다`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}.${key}: 허용되지 않은 필드`);
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 한다`);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function digest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function assertTurnRef(value, label) {
  exactKeys(value, ['sessionId', 'turnSeq'], label);
  requiredString(value.sessionId, `${label}.sessionId`);
  if (!Number.isInteger(value.turnSeq) || value.turnSeq < 1) throw new TypeError(`${label}.turnSeq는 1 이상의 정수여야 한다`);
}

function assertScopeRef(value) {
  if (value === undefined) throw new TypeError('WorkEvent.scopeRef가 필요하다');
  exactKeys(value, ['principalRef', 'projectRef', 'workspaceRef'], 'WorkEvent.scopeRef');
  requiredString(value.principalRef, 'WorkEvent.scopeRef.principalRef');
  if (value.projectRef !== undefined) requiredString(value.projectRef, 'WorkEvent.scopeRef.projectRef');
  if (value.workspaceRef !== undefined) requiredString(value.workspaceRef, 'WorkEvent.scopeRef.workspaceRef');
}

function guardRawText(value, label, sensitiveGuard) {
  requiredString(value, label);
  if (sensitiveGuard(value)) throw new TypeError(`${label}: 민감 원문은 WorkEventLedger에 저장할 수 없다`);
}

function assertNoSensitiveValues(value, sensitiveGuard, label = 'WorkEvent') {
  if (typeof sensitiveGuard !== 'function') {
    throw new TypeError(`${label}: durable 사건 저장에는 주입된 sensitiveGuard 민감정보 경계가 필요하다`);
  }
  const osInternalRef = typeof value === 'string'
    && (/^(?:rr1|wr1|cr1|sr1)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
      || /^we1\.[A-Za-z0-9_-]+$/.test(value)
      || /^[0-9a-f]{64}$/.test(value));
  if (typeof value === 'string' && !osInternalRef && sensitiveGuard(value)) {
    throw new TypeError(`${label}: 민감값은 WorkEventLedger에 저장할 수 없다`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveValues(item, sensitiveGuard, `${label}[${index}]`));
  } else if (plainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertNoSensitiveValues(item, sensitiveGuard, `${label}.${key}`);
    }
  }
}

function assertEvidence(input, sensitiveGuard) {
  const { type, evidence } = input;
  exactKeys(evidence, EVIDENCE_KEYS[type], `WorkEvent.${type}.evidence`);
  switch (type) {
    case 'agreement_set':
      assertTurnRef(evidence.turnRef, 'agreement_set.evidence.turnRef');
      guardRawText(evidence.statement, 'agreement_set.evidence.statement', sensitiveGuard);
      break;
    case 'agreement_superseded':
    case 'agreement_retracted':
      assertTurnRef(evidence.turnRef, `${type}.evidence.turnRef`);
      guardRawText(evidence.statement, `${type}.evidence.statement`, sensitiveGuard);
      requiredString(evidence.targetEventId, `${type}.evidence.targetEventId`);
      break;
    case 'question_opened':
      assertTurnRef(evidence.turnRef, 'question_opened.evidence.turnRef');
      guardRawText(evidence.question, 'question_opened.evidence.question', sensitiveGuard);
      requiredString(evidence.changesAnswerFor, 'question_opened.evidence.changesAnswerFor');
      break;
    case 'question_resolved':
      requiredString(evidence.targetEventId, 'question_resolved.evidence.targetEventId');
      if (evidence.turnRef === undefined && evidence.receiptRef === undefined) {
        throw new TypeError('question_resolved에는 사용자 TurnRef 또는 확인 ReceiptRef 근거가 필요하다');
      }
      if (evidence.turnRef !== undefined) assertTurnRef(evidence.turnRef, 'question_resolved.evidence.turnRef');
      if (evidence.receiptRef !== undefined) requiredString(evidence.receiptRef, 'question_resolved.evidence.receiptRef');
      break;
    case 'execution_completed':
      requiredString(evidence.completionContractRef, 'execution_completed.evidence.CompletionContractRef');
      requiredString(evidence.receiptRef, 'execution_completed.evidence.ReceiptRef');
      if (evidence.verificationPassed !== true) throw new TypeError('실행 완료는 완료 계약 검증을 통과해야 한다');
      break;
    case 'chat_delivered':
      requiredString(evidence.resultContractRef, 'chat_delivered.evidence.resultContractRef');
      assertTurnRef(evidence.turnRef, 'chat_delivered.evidence.turnRef');
      requiredString(evidence.contentDigest, 'chat_delivered.evidence.contentDigest');
      if (evidence.persisted !== true) throw new TypeError('chat_delivered는 내용 있는 결과가 실제 지속돼야 한다');
      break;
    default:
      throw new TypeError(`허용되지 않은 WorkEvent 사건 유형: ${type}`);
  }
}

function normalizeInput(value, sensitiveGuard) {
  exactKeys(value, INPUT_KEYS, 'WorkEvent');
  // 내부 HMAC ref는 사람이 쓴 원문이 아니어서 credential 모양이어도 허용하되, 그 밖의 ref
  // 칸 위장값까지 포함한 durable 객체 전체는 공용 민감 경계를 통과해야 한다.
  assertNoSensitiveValues(value, sensitiveGuard);
  requiredString(value.eventId, 'WorkEvent.eventId');
  if (!EVENT_TYPE_SET.has(value.type)) throw new TypeError(`허용되지 않은 WorkEvent 사건 유형: ${value.type}`);
  requiredString(value.workRef, 'WorkEvent.workRef');
  requiredString(value.subjectRef, 'WorkEvent.subjectRef');
  assertScopeRef(value.scopeRef);
  assertEvidence(value, sensitiveGuard);
  return clone({
    eventId: value.eventId,
    type: value.type,
    workRef: value.workRef,
    subjectRef: value.subjectRef,
    ...(value.scopeRef === undefined ? {} : { scopeRef: value.scopeRef }),
    evidence: value.evidence,
  });
}

function eventInputOf(record) {
  return {
    eventId: record.eventId,
    type: record.type,
    workRef: record.workRef,
    subjectRef: record.subjectRef,
    ...(record.scopeRef === undefined ? {} : { scopeRef: record.scopeRef }),
    evidence: record.evidence,
  };
}

function recordCore(input, ordinal, previousHash, eventDigest) {
  return {
    schemaVersion: WORK_EVENT_SCHEMA_VERSION,
    ordinal,
    ...input,
    eventDigest,
    previousHash,
  };
}

function assertTarget(records, input, allowedTypes, requiredStatus) {
  const targetId = input.evidence.targetEventId;
  const target = records.find((record) => record.eventId === targetId);
  if (!target || !allowedTypes.includes(target.type)) throw new TypeError(`${input.type}: 올바른 대상 사건을 지목해야 한다`);
  if (target.workRef !== input.workRef || target.subjectRef !== input.subjectRef) {
    throw new TypeError(`${input.type}: 대상의 workRef·subjectRef를 상속해야 한다`);
  }
  const projected = projectWorkEvents(records);
  if (requiredStatus && projected.byEvent[targetId]?.status !== requiredStatus) {
    throw new TypeError(`${input.type}: 대상 사건은 현재 ${requiredStatus} 상태여야 한다`);
  }
}

function assertTransition(records, input) {
  if (input.type === 'agreement_superseded' || input.type === 'agreement_retracted') {
    assertTarget(records, input, ['agreement_set', 'agreement_superseded'], 'active');
  } else if (input.type === 'question_resolved') {
    assertTarget(records, input, ['question_opened'], 'open');
  }
}

/** append-only 사건 배열의 현재 상태 투영. 입력 배열과 사건은 변경하지 않는다. */
export function projectWorkEvents(records = []) {
  const byEvent = {};
  const bySubject = {};
  const completedWorkRefs = [];

  for (const record of records) {
    let status;
    switch (record.type) {
      case 'agreement_set':
      case 'agreement_superseded':
        status = 'active';
        if (record.type === 'agreement_superseded') byEvent[record.evidence.targetEventId].status = 'superseded';
        break;
      case 'agreement_retracted':
        status = 'retracted';
        byEvent[record.evidence.targetEventId].status = 'retracted';
        break;
      case 'question_opened': status = 'open'; break;
      case 'question_resolved':
        status = 'resolved';
        byEvent[record.evidence.targetEventId].status = 'resolved';
        break;
      case 'execution_completed':
        status = 'completed';
        if (!completedWorkRefs.includes(record.workRef)) completedWorkRefs.push(record.workRef);
        break;
      case 'chat_delivered': status = 'chat-delivered'; break;
      default: throw new TypeError(`허용되지 않은 WorkEvent 사건 유형: ${record.type}`);
    }
    byEvent[record.eventId] = {
      eventId: record.eventId,
      workRef: record.workRef,
      subjectRef: record.subjectRef,
      type: record.type,
      status,
      ordinal: record.ordinal,
    };
    bySubject[record.subjectRef] = {
      eventId: record.eventId,
      workRef: record.workRef,
      subjectRef: record.subjectRef,
      type: record.type,
      status,
      ordinal: record.ordinal,
    };
  }
  return { byEvent, bySubject, completedWorkRefs };
}

export class WorkEventLedger {
  constructor({ checkpointEvery = 1, sensitiveGuard, records } = {}) {
    if (!Number.isInteger(checkpointEvery) || checkpointEvery < 1) throw new TypeError('checkpointEvery는 1 이상의 정수여야 한다');
    this.checkpointEvery = checkpointEvery;
    this.sensitiveGuard = sensitiveGuard;
    this._records = [];
    this.degraded = false;
    this.readOnly = false;
    this.recovery = { lastValidCheckpoint: 0, failedAt: null, reason: null };
    if (records !== undefined) this._load(records);
  }

  static fromRecords(records, options = {}) {
    return new WorkEventLedger({ ...options, records });
  }

  get records() {
    return clone(this._records);
  }

  append(value) {
    if (this.readOnly) throw new Error('WorkEventLedger는 손상 복구 후 read-only 읽기 전용 상태다');
    const input = normalizeInput(value, this.sensitiveGuard);
    const eventDigest = digest(input);
    const existing = this._records.find((record) => record.eventId === input.eventId);
    if (existing) {
      if (existing.eventDigest === eventDigest) return clone(existing);
      throw new Error(`WorkEvent eventId 충돌: ${input.eventId}`);
    }
    assertTransition(this._records, input);
    const ordinal = this._records.length + 1;
    const previousHash = this._records.at(-1)?.hash ?? null;
    const core = recordCore(input, ordinal, previousHash, eventDigest);
    const hash = digest(core);
    const checkpoint = ordinal % this.checkpointEvery === 0
      ? { ordinal, chainHash: hash }
      : null;
    const record = { ...core, hash, checkpoint };
    this._records.push(record);
    return clone(record);
  }

  project() {
    return projectWorkEvents(this._records);
  }

  _load(source) {
    if (!Array.isArray(source)) throw new TypeError('WorkEvent records는 배열이어야 한다');
    let lastValidCheckpoint = 0;
    let failure = null;

    for (let index = 0; index < source.length; index += 1) {
      const raw = source[index];
      try {
        exactKeys(raw, RECORD_KEYS, `WorkEventRecord[${index}]`);
        if (raw.schemaVersion !== WORK_EVENT_SCHEMA_VERSION) throw new Error('지원하지 않는 WorkEvent schemaVersion');
        const expected = this.append(eventInputOf(raw));
        if (raw.eventDigest !== expected.eventDigest) throw new Error('event digest 불일치');
        if (raw.previousHash !== expected.previousHash || raw.hash !== expected.hash) throw new Error('hash chain 불일치');
        if (canonical(raw.checkpoint) !== canonical(expected.checkpoint)) throw new Error('checkpoint 불일치');
        this._records[this._records.length - 1] = clone(raw);
        if (raw.checkpoint) lastValidCheckpoint = raw.ordinal;
      } catch (error) {
        failure = { failedAt: index + 1, reason: String(error?.message ?? error) };
        break;
      }
    }

    if (!failure) {
      this.recovery = { lastValidCheckpoint, failedAt: null, reason: null };
      return;
    }
    this._records = this._records.slice(0, lastValidCheckpoint);
    this.degraded = true;
    this.readOnly = true;
    this.recovery = { lastValidCheckpoint, ...failure };
  }
}
