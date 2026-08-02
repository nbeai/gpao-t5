import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const DIGEST = /^[0-9a-f]{64}$/;
const PREFIX = Object.freeze({ receipt: 'rr1', work: 'wr1', completion: 'cr1', subject: 'sr1' });

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label}는 객체여야 한다`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} 필드가 계약과 다르다`);
  }
}

function issuerKey(key) {
  if (!(key instanceof Uint8Array) || key.byteLength < 32) {
    throw new TypeError('ref 발급 키는 32바이트 이상의 OS 키여야 한다');
  }
  return key;
}

function turnRef(value) {
  exactKeys(value, ['sessionId', 'turnSeq'], 'TurnRef');
  if (typeof value.sessionId !== 'string'
    || value.sessionId.length === 0
    || value.sessionId.length > 256
    || /[\u0000-\u001f\u007f]/.test(value.sessionId)) {
    throw new TypeError('TurnRef.sessionId가 유효하지 않다');
  }
  if (!Number.isSafeInteger(value.turnSeq) || value.turnSeq < 1) {
    throw new TypeError('TurnRef.turnSeq는 1 이상의 안전한 정수여야 한다');
  }
  return { sessionId: value.sessionId, turnSeq: value.turnSeq };
}

function ordinal(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label}는 음이 아닌 안전한 정수여야 한다`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new TypeError(`${label}는 소문자 SHA-256 digest여야 한다`);
  }
  return value;
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function workEvidenceDigest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function signature(prefix, payload, key) {
  return createHmac('sha256', issuerKey(key)).update(`${prefix}.${payload}`).digest('base64url');
}

function issue(prefix, payload, key) {
  const body = encoded(payload);
  return `${prefix}.${body}.${signature(prefix, body, key)}`;
}

function signedPayload(ref, prefix, key) {
  if (typeof ref !== 'string' || ref.length > 4096) throw new TypeError('ref가 유효하지 않다');
  const parts = ref.split('.');
  if (parts.length !== 3 || parts[0] !== prefix || !parts[1] || !parts[2]) {
    throw new TypeError('ref 종류나 형식이 계약과 다르다');
  }
  const expected = Buffer.from(signature(prefix, parts[1], key));
  const actual = Buffer.from(parts[2]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new TypeError('OS가 발급한 ref가 아니다');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new TypeError('ref payload를 읽을 수 없다');
  }
  if (encoded(payload) !== parts[1]) throw new TypeError('ref payload가 정규형이 아니다');
  return payload;
}

function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${label}가 기대한 원천 사실과 결합되지 않았다`);
  }
  return actual;
}

function receiptBinding(value) {
  exactKeys(value, ['turnRef', 'turnOrdinal', 'receiptDigest'], 'ReceiptRef binding');
  return {
    turnRef: turnRef(value.turnRef),
    turnOrdinal: ordinal(value.turnOrdinal, 'turnOrdinal'),
    receiptDigest: digest(value.receiptDigest, 'receiptDigest'),
  };
}

function workBinding(value) {
  exactKeys(value, ['turnRef', 'workOrdinal'], 'WorkRef binding');
  return {
    turnRef: turnRef(value.turnRef),
    workOrdinal: ordinal(value.workOrdinal, 'workOrdinal'),
  };
}

function completionBinding(value, key) {
  exactKeys(value, ['workRef', 'contractDigest'], 'CompletionContractRef binding');
  if (typeof value.workRef !== 'string') throw new TypeError('workRef가 필요하다');
  parseWorkRef(value.workRef, key);
  return {
    workRef: value.workRef,
    contractDigest: digest(value.contractDigest, 'contractDigest'),
  };
}

function subjectBinding(value) {
  exactKeys(value, ['turnRef', 'eventOrdinal'], 'subjectRef binding');
  return {
    turnRef: turnRef(value.turnRef),
    eventOrdinal: ordinal(value.eventOrdinal, 'eventOrdinal'),
  };
}

function parseReceiptRef(ref, key) {
  const payload = signedPayload(ref, PREFIX.receipt, key);
  return receiptBinding(payload);
}

function parseWorkRef(ref, key) {
  const payload = signedPayload(ref, PREFIX.work, key);
  return workBinding(payload);
}

function parseCompletionContractRef(ref, key) {
  const payload = signedPayload(ref, PREFIX.completion, key);
  return completionBinding(payload, key);
}

function parseSubjectRef(ref, key) {
  const payload = signedPayload(ref, PREFIX.subject, key);
  return subjectBinding(payload);
}

export function readReceiptRef(ref, key) { return parseReceiptRef(ref, key); }
export function readWorkRef(ref, key) { return parseWorkRef(ref, key); }
export function readCompletionContractRef(ref, key) { return parseCompletionContractRef(ref, key); }
export function readSubjectRef(ref, key) { return parseSubjectRef(ref, key); }

export function issueReceiptRef(binding, key) {
  return issue(PREFIX.receipt, receiptBinding(binding), key);
}

export function assertReceiptRef(ref, binding, key) {
  return same(parseReceiptRef(ref, key), receiptBinding(binding), 'ReceiptRef');
}

export function issueWorkRef(binding, key) {
  return issue(PREFIX.work, workBinding(binding), key);
}

export function assertWorkRef(ref, binding, key) {
  return same(parseWorkRef(ref, key), workBinding(binding), 'WorkRef');
}

export function issueCompletionContractRef(binding, key) {
  return issue(PREFIX.completion, completionBinding(binding, key), key);
}

export function assertCompletionContractRef(ref, binding, key) {
  return same(
    parseCompletionContractRef(ref, key),
    completionBinding(binding, key),
    'CompletionContractRef',
  );
}

export function issueSubjectRef(binding, key) {
  return issue(PREFIX.subject, subjectBinding(binding), key);
}

export function assertSubjectRef(ref, binding, key) {
  return same(parseSubjectRef(ref, key), subjectBinding(binding), 'subjectRef');
}

export function inheritSubjectRef(ref, key) {
  parseSubjectRef(ref, key);
  return ref;
}
