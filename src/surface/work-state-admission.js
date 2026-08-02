// P90-1 · 모델의 work.state 후보를 사용자 원문·현재 원장에 대조해 OS 사건으로 바꾸는 경계.
// 이 모듈은 모델 의미 판단을 대신하지 않는다. 모델이 지목한 문장이 실제로 있었는지만 검증한다.
import { projectWorkEvents } from '../kernel/l0-evidence/work-event-ledger.js';

function exactScope(record, principalRef, workRef) {
  const scope = record?.scopeRef;
  return scope?.principalRef === principalRef
    && scope?.projectRef === workRef
    && Object.keys(scope).length === 2;
}

function currentTargets(records, principalRef, workRef) {
  const projection = projectWorkEvents(records);
  return records.filter((record) => record.workRef === workRef && exactScope(record, principalRef, workRef))
    .filter((record) => ['active', 'open'].includes(projection.byEvent[record.eventId]?.status));
}

function targetFor(change, targets) {
  const expectedType = change.type === 'question_resolved'
    ? 'question_opened'
    : ['agreement_set', 'agreement_superseded'];
  return targets.find((record) => {
    const allowed = Array.isArray(expectedType) ? expectedType.includes(record.type) : record.type === expectedType;
    if (!allowed) return false;
    const text = record.type === 'question_opened' ? record.evidence?.question : record.evidence?.statement;
    return text === change.targetQuote;
  });
}

function validQuote(text, quote) {
  return typeof quote === 'string' && quote.length > 0 && String(text ?? '').includes(quote);
}

/**
 * 모델 후보는 단독으로 사건이 되지 않는다. 모든 후보를 먼저 검증한 뒤에만 append한다.
 */
export async function admitWorkStateProposal({
  store, proposal, inputText, reply, turnRef, principalRef, workRef: existingWorkRef,
  shownProjects = [],
}) {
  if (!store || !proposal || !principalRef || !turnRef) return { accepted: false, reason: 'missing_fact' };
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  const openQuestion = proposal.openQuestion;
  if (!changes.length && !openQuestion && !proposal.continueFrom) {
    return { accepted: false, reason: 'empty_proposal' };
  }
  if (changes.some((change) => !validQuote(inputText, change.utteranceQuote))) {
    return { accepted: false, reason: 'utterance_quote_mismatch' };
  }
  if (openQuestion && (!validQuote(reply, openQuestion.question) || !openQuestion.changesAnswerFor)) {
    return { accepted: false, reason: 'question_not_delivered' };
  }

  const records = await store.load();
  let workRef = existingWorkRef;
  if (!workRef && proposal.continueFrom) {
    const matches = shownProjects.filter((entry) => entry?.quotes?.includes(proposal.continueFrom));
    if (matches.length !== 1) return { accepted: false, reason: 'continuation_not_shown' };
    workRef = matches[0].workRef;
  }
  if (!workRef) {
    const targetQuotes = changes.map((change) => change.targetQuote).filter(Boolean);
    if (targetQuotes.length) {
      const matches = shownProjects.filter((entry) => targetQuotes.some((quote) => entry?.quotes?.includes(quote)));
      if (matches.length !== 1) return { accepted: false, reason: 'target_project_ambiguous' };
      workRef = matches[0].workRef;
    }
  }
  if (workRef) {
    const known = records.some((record) => record.workRef === workRef && exactScope(record, principalRef, workRef));
    if (!known) return { accepted: false, reason: 'unknown_work' };
  }
  const targets = workRef ? currentTargets(records, principalRef, workRef) : [];
  const prepared = [];
  for (const change of changes) {
    if (change.type === 'agreement_set') {
      prepared.push({ change, target: null });
      continue;
    }
    if (!workRef || !change.targetQuote) return { accepted: false, reason: 'target_required' };
    const target = targetFor(change, targets);
    if (!target) return { accepted: false, reason: 'target_not_current' };
    prepared.push({ change, target });
  }

  if (!workRef) workRef = await store.issueWorkRef({ turnRef, workOrdinal: 0 });
  const scopeRef = { principalRef, projectRef: workRef };
  const candidates = [];
  let nextOrdinal = records.length;
  for (const { change, target } of prepared) {
    let subjectRef = target?.subjectRef;
    if (!subjectRef) subjectRef = await store.issueSubjectRef({ turnRef, eventOrdinal: nextOrdinal++ });
    if (change.type === 'agreement_set') {
      candidates.push({
        type: change.type, workRef, subjectRef, scopeRef,
        evidence: { turnRef, statement: change.utteranceQuote },
      });
    } else if (change.type === 'question_resolved') {
      candidates.push({
        type: change.type, workRef, subjectRef, scopeRef,
        evidence: { targetEventId: target.eventId, turnRef },
      });
    } else {
      candidates.push({
        type: change.type, workRef, subjectRef, scopeRef,
        evidence: { turnRef, statement: change.utteranceQuote, targetEventId: target.eventId },
      });
    }
  }
  if (openQuestion) {
    candidates.push({
      type: 'question_opened', workRef,
      subjectRef: await store.issueSubjectRef({ turnRef, eventOrdinal: nextOrdinal++ }),
      scopeRef,
      evidence: { turnRef, question: openQuestion.question, changesAnswerFor: openQuestion.changesAnswerFor },
    });
  }

  const events = [];
  for (const candidate of candidates) events.push(await store.append(candidate));
  return { accepted: true, workRef, scopeRef, events };
}
