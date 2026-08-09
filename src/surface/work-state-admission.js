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

// **물음은 확정이 아니다**(P-OP 결함 가족 A-② · 2026-08-10). 이 모듈의 계약은
// "모델이 지목한 문장이 실제로 있었는지"인데, 존재만 보면 거짓 전제 질문("~포함한다고
// 했지?")이 그 문장 그대로 합의 사건이 된다 — 기계 확인으로 사건 1이 실제로 생겼다.
// 의미 판단이 아니라 **문장 부호의 기계 사실**만 본다: 물음표로 끝나는 발화는 합의의
// 증거 인용이 될 수 없다(질문은 openQuestion 의 자리다). 목록이 아니라 닫힌 부호다.
function questionShaped(quote) {
  return /[?？]\s*$/.test(String(quote ?? '').trim());
}

/**
 * 모델 후보는 단독으로 사건이 되지 않는다. 모든 후보를 먼저 검증한 뒤에만 append한다.
 */
export async function admitWorkStateProposal({
  store, proposal, inputText, reply, turnRef, principalRef, workRef: existingWorkRef,
  provisionalWorkRef = null, shownProjects = [],
}) {
  if (!store || !proposal || !principalRef || !turnRef) return { accepted: false, reason: 'missing_fact' };
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  const openQuestion = proposal.openQuestion;
  if (!changes.length && !openQuestion && !proposal.continueFrom && !proposal.continueFromRef) {
    return { accepted: false, reason: 'empty_proposal' };
  }
  if (changes.some((change) => !validQuote(inputText, change.utteranceQuote))) {
    return { accepted: false, reason: 'utterance_quote_mismatch' };
  }
  if (changes.some((change) => questionShaped(change.utteranceQuote))) {
    return { accepted: false, reason: 'question_is_not_confirmation' };
  }
  if (openQuestion && (!validQuote(reply, openQuestion.question) || !openQuestion.changesAnswerFor)) {
    return { accepted: false, reason: 'question_not_delivered' };
  }

  const records = await store.load();
  let workRef = existingWorkRef;
  let provisional = false;
  if (!workRef && (proposal.continueFrom || proposal.continueFromRef)) {
    const byQuote = proposal.continueFrom
      ? shownProjects.filter((entry) => entry?.quotes?.includes(proposal.continueFrom)) : [];
    const byRef = proposal.continueFromRef
      ? shownProjects.filter((entry) => entry?.selectionRef === proposal.continueFromRef) : [];
    if ((proposal.continueFrom && byQuote.length !== 1)
      || (proposal.continueFromRef && byRef.length !== 1)
      || (byQuote.length && byRef.length && byQuote[0].workRef !== byRef[0].workRef)) {
      return { accepted: false, reason: 'continuation_not_shown' };
    }
    workRef = (byRef[0] ?? byQuote[0])?.workRef;
  }
  if (!workRef) {
    // agreement_set의 targetQuote는 의미가 없다. 모델이 선택 필드를 채웠다는 이유만으로
    // 새 합의를 기존 프로젝트 수정으로 바꾸지 않는다.
    const targetQuotes = changes
      .filter((change) => change.type !== 'agreement_set')
      .map((change) => change.targetQuote).filter(Boolean);
    if (targetQuotes.length) {
      const matches = shownProjects.filter((entry) => targetQuotes.some((quote) => entry?.quotes?.includes(quote)));
      if (matches.length !== 1) return { accepted: false, reason: 'target_project_ambiguous' };
      workRef = matches[0].workRef;
    }
  }
  if (!workRef && provisionalWorkRef) {
    workRef = provisionalWorkRef;
    provisional = true;
  }
  if (workRef) {
    const known = records.some((record) => record.workRef === workRef && exactScope(record, principalRef, workRef));
    if (!known && !provisional) return { accepted: false, reason: 'unknown_work' };
  }
  const targets = workRef ? currentTargets(records, principalRef, workRef) : [];
  const repeatedOpenQuestion = openQuestion && targets.some((record) => (
    record.type === 'question_opened'
      && record.evidence?.question === openQuestion.question
      && record.evidence?.changesAnswerFor === openQuestion.changesAnswerFor
  ));
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
  if (openQuestion && !repeatedOpenQuestion) {
    candidates.push({
      type: 'question_opened', workRef,
      subjectRef: await store.issueSubjectRef({ turnRef, eventOrdinal: nextOrdinal++ }),
      scopeRef,
      evidence: { turnRef, question: openQuestion.question, changesAnswerFor: openQuestion.changesAnswerFor },
    });
  }

  const events = candidates.length ? await store.appendBatch(candidates) : [];
  return { accepted: true, workRef, scopeRef, events };
}
