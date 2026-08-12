// L1 · P90-1 장기 작업 상태.
// append-only WorkEventLedger의 사건만 투영한다. 별도 현재 상태나 문장 의미 규칙은 두지 않는다.

export const WORK_STATE_FACTS_MAX_CHARS = 4_000;

const SCOPE_KEYS = Object.freeze(['principalRef', 'projectRef', 'workspaceRef']);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requestedScope(value) {
  if (!plainObject(value)) return null;
  const nested = plainObject(value.scopeRef) ? value.scopeRef : value;
  const principalRef = value.principalRef ?? nested.principalRef;
  if (!nonempty(principalRef)) return null;
  if (nonempty(value.principalRef)
    && nonempty(nested.principalRef)
    && value.principalRef !== nested.principalRef) return null;

  const scopeRef = { principalRef };
  for (const key of ['projectRef', 'workspaceRef']) {
    const item = nested[key] ?? (nested === value ? undefined : value[key]);
    if (item !== undefined) {
      if (!nonempty(item)) return null;
      scopeRef[key] = item;
    }
  }
  return scopeRef;
}

function exactScope(actual, expected) {
  if (!plainObject(actual) || !expected) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.some((key) => !SCOPE_KEYS.includes(key))) return false;
  if (actualKeys.length !== expectedKeys.length) return false;
  return actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function orderedRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record, index) => ({ record, index }))
    .filter(({ record }) => plainObject(record))
    .sort((a, b) => {
      const aOrdinal = Number.isSafeInteger(a.record.ordinal) ? a.record.ordinal : Number.MAX_SAFE_INTEGER;
      const bOrdinal = Number.isSafeInteger(b.record.ordinal) ? b.record.ordinal : Number.MAX_SAFE_INTEGER;
      return aOrdinal - bOrdinal || a.index - b.index;
    })
    .map(({ record }) => record);
}

function ordinalOf(record, fallback) {
  return Number.isSafeInteger(record.ordinal) ? record.ordinal : fallback;
}

function sameSubject(record, target) {
  return nonempty(record.workRef)
    && record.workRef === target?.record?.workRef
    && nonempty(record.subjectRef)
    && record.subjectRef === target?.record?.subjectRef;
}

function newestFirst(items) {
  return [...items].sort((a, b) => b.ordinal - a.ordinal);
}

/**
 * WorkEventLedger records를 한 principal·scope의 현재 상태로 투영한다.
 * 범위가 정확히 같지 않은 사건은 전이의 대상에도, 결과에도 참여하지 않는다.
 */
export function projectWorkState(records = [], scope = {}) {
  const expectedScope = requestedScope(scope);
  const agreements = new Map();
  const questions = new Map();
  const completedExecutions = [];
  const deliveredChats = [];
  const resolvedQuestions = [];

  if (expectedScope) {
    let fallbackOrdinal = 0;
    for (const record of orderedRecords(records)) {
      fallbackOrdinal += 1;
      if (!exactScope(record.scopeRef, expectedScope) || !nonempty(record.eventId)) continue;
      const ordinal = ordinalOf(record, fallbackOrdinal);
      const evidence = plainObject(record.evidence) ? record.evidence : {};

      if (record.type === 'agreement_set') {
        if (!nonempty(evidence.statement)) continue;
        agreements.set(record.eventId, {
          active: true,
          record,
          value: { label: evidence.statement, statement: evidence.statement, ordinal },
        });
        continue;
      }

      if (record.type === 'agreement_superseded') {
        const target = agreements.get(evidence.targetEventId);
        if (!target?.active || !sameSubject(record, target) || !nonempty(evidence.statement)) continue;
        target.active = false;
        agreements.set(record.eventId, {
          active: true,
          record,
          value: { label: evidence.statement, statement: evidence.statement, ordinal },
        });
        continue;
      }

      if (record.type === 'agreement_retracted') {
        const target = agreements.get(evidence.targetEventId);
        if (target?.active && sameSubject(record, target)) target.active = false;
        continue;
      }

      if (record.type === 'question_opened') {
        if (!nonempty(evidence.question) || !nonempty(evidence.changesAnswerFor)) continue;
        questions.set(record.eventId, {
          open: true,
          record,
          value: {
            question: evidence.question,
            changesAnswerFor: evidence.changesAnswerFor,
            ordinal,
          },
        });
        continue;
      }

      if (record.type === 'question_resolved') {
        const target = questions.get(evidence.targetEventId);
        if (!target?.open || !sameSubject(record, target)) continue;
        target.open = false;
        resolvedQuestions.push({
          ...target.value,
          openedOrdinal: target.value.ordinal,
          ordinal,
        });
        continue;
      }

      if (record.type === 'execution_completed' && evidence.verificationPassed === true) {
        completedExecutions.push({ ordinal, verificationPassed: true });
        continue;
      }

      if (record.type === 'chat_delivered' && evidence.persisted === true) {
        deliveredChats.push({ ordinal, persisted: true });
      }
    }
  }

  const activeAgreements = newestFirst([...agreements.values()]
    .filter((entry) => entry.active)
    .map((entry) => entry.value));
  const openQuestions = newestFirst([...questions.values()]
    .filter((entry) => entry.open)
    .map((entry) => entry.value));

  return {
    activeAgreements,
    openQuestions,
    resolvedQuestions: newestFirst(resolvedQuestions),
    completedExecutions: newestFirst(completedExecutions),
    deliveredChats: newestFirst(deliveredChats),
    executionCompleted: completedExecutions.length > 0,
    chatDelivered: deliveredChats.length > 0,
  };
}

function safeFactText(value) {
  if (!nonempty(value)) return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(?:rr1|wr1|cr1|sr1)\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[내부 참조]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[지문]')
    .replace(/(^|[\s("'“‘])(?:~\/|\/)[^\s)"'”’]+/g, '$1[경로]')
    .replace(/\b[A-Za-z]:\\[^\s)"'”’]+/g, '[경로]')
    .replace(/\s+/g, ' ')
    .trim();
}

function boundedLines(groups, maxChars) {
  const lines = [];
  let used = 0;
  const add = (line) => {
    const separator = lines.length ? 1 : 0;
    const available = maxChars - used - separator;
    if (available <= 0) return false;
    if (line.length <= available) {
      lines.push(line);
      used += separator + line.length;
      return true;
    }
    if (available > 1) {
      lines.push(`${line.slice(0, available - 1)}…`);
      used = maxChars;
    }
    return false;
  };

  for (const group of groups) {
    const items = group.items.map(safeFactText).filter(Boolean);
    if (!items.length) continue;
    const firstLine = `${group.heading} ${items[0]}`;
    if (!add(firstLine)) break;
    for (const item of items.slice(1)) {
      if (!add(`- ${item}`)) return lines.join('\n');
    }
  }
  return lines.join('\n');
}

/** 모델 앞에 놓는 안전한 사실 뷰. 내부 신분·digest·원시 경로는 렌더하지 않는다. */
export function workStateFacts(stateOrNull, opts = {}) {
  const state = plainObject(stateOrNull) ? stateOrNull : {};
  const maxChars = opts.maxChars ?? WORK_STATE_FACTS_MAX_CHARS;
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new TypeError('workStateFacts.maxChars는 1 이상의 안전한 정수여야 한다');
  }

  const activeAgreements = Array.isArray(state.activeAgreements) ? state.activeAgreements : [];
  const openQuestions = Array.isArray(state.openQuestions) ? state.openQuestions : [];
  const resolvedQuestions = Array.isArray(state.resolvedQuestions) ? state.resolvedQuestions : [];
  const completedCount = Array.isArray(state.completedExecutions) ? state.completedExecutions.length : 0;
  const deliveredCount = Array.isArray(state.deliveredChats) ? state.deliveredChats.length : 0;

  const rendered = boundedLines([
    {
      heading: '[현재 합의]',
      items: activeAgreements.map((item) => item?.label ?? item?.statement),
    },
    {
      heading: '[미정 질문]',
      items: openQuestions.map((item) => {
        const question = safeFactText(item?.question);
        const effect = safeFactText(item?.changesAnswerFor);
        return effect ? `${question} — 이 답에 따라 달라짐: ${effect}` : question;
      }),
    },
    {
      heading: '[확인된 진행]',
      items: [
        ...(completedCount ? [`검증된 실행 완료: ${completedCount}건`] : []),
        ...(deliveredCount ? [`전달된 대화 산출물: ${deliveredCount}건`] : []),
      ],
    },
    {
      heading: '[해소된 질문]',
      items: resolvedQuestions.map((item) => item?.question),
    },
  ], maxChars);

  return rendered || undefined;
}
