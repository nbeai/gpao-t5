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

/**
 * 모델이 지목한 대상이 원장의 **어느 현재값**인가.
 *
 * 예전엔 저장된 원문과 **완전히 같을 때만** 맞다고 봤다. 라이브 실측(2026-08-10 · S1)에서
 * 수정·제외가 `target_not_current` 로 줄줄이 떨어졌다 — 사용자는 분명히 바꿨는데
 * 원장에는 옛 값만 남는다(취소된 값이 부활하는 바로 그 자리다). 모델은 브리프에 렌더된
 * 문장을 보고 **그 일부를** 지목한다.
 *
 * 그래서 **신분 해소**로 바꾼다: 완전 일치가 있으면 그것, 없으면 서로 품는 관계
 * (한쪽이 다른 쪽의 부분 문자열)로 찾되 **하나로 특정될 때만** 통과시킨다. 둘 이상이면
 * 지어내지 않고 거부한다 — `quoteSourceRef` 와 같은 규율이다. 이건 문구 규칙이 아니라
 * **원장 안에서의 지시 대상 해소**이고, 정의역은 이 작업의 현재값들뿐이다.
 */
function targetFor(change, targets) {
  const expectedType = change.type === 'question_resolved'
    ? 'question_opened'
    : ['agreement_set', 'agreement_superseded'];
  const 후보 = targets.filter((record) => (Array.isArray(expectedType)
    ? expectedType.includes(record.type) : record.type === expectedType));
  const 글 = (record) => String(record.type === 'question_opened'
    ? record.evidence?.question : record.evidence?.statement ?? '');
  const quote = String(change.targetQuote ?? '');
  const 완전일치 = 후보.find((record) => 글(record) === quote);
  if (완전일치) return { target: 완전일치 };
  if (quote.length < 4) return { target: undefined, 모호: false };   // 짧은 조각은 무엇이든 품는다 — 해소가 아니다
  const 품음 = 후보.filter((record) => 글(record).includes(quote) || quote.includes(글(record)));
  // **모호와 부재는 다르다**(③-b 봉인) — 여럿을 품으면 지어내지 않고 거부해야 하고,
  // 아무도 안 품으면 그때가 소급(사용자 원문 정의역)의 자리다.
  return 품음.length === 1 ? { target: 품음[0] } : { target: undefined, 모호: 품음.length > 1 };
}

function validQuote(text, quote) {
  return typeof quote === 'string' && quote.length > 0 && String(text ?? '').includes(quote);
}

/**
 * 이 인용이 **누구의 어느 발화**에서 왔는가. 있으면 그 발화의 TurnRef, 없으면 null.
 *
 * 예전엔 "이번 발화에 있는가" 하나만 봤다. 라이브 실측(2026-08-10 · S1 12턴)에서 모델은
 * 앞 턴들에 확정된 것을 **뒤늦게** 제출했고(t7 에 t2~t5 의 문장 넷), 전부
 * `utterance_quote_mismatch` 로 떨어졌다 — 사용자가 실제로 한 말인데도 원장에 못 남았다.
 * 합의의 증거는 **사용자 원문 + 그 원문이 있었던 TurnRef** 이지 "몇 번째 턴에 제출했는가"가
 * 아니다. 그래서 이 대화의 사용자 발화 전체를 정의역으로 삼고, **어느 발화였는지 하나로
 * 특정될 때만** 통과시킨다(둘 이상이면 지어내지 않고 거부한다).
 *
 * 거짓 전제는 이 문으로 못 들어온다 — 사용자가 하지 않은 말은 어느 발화에도 없다.
 */
function quoteSourceRef(quote, { inputText, turnRef, priorUtterances }) {
  if (typeof quote !== 'string' || quote.length === 0) return null;
  if (String(inputText ?? '').includes(quote)) return turnRef;
  const hits = (priorUtterances ?? []).filter((u) => String(u?.text ?? '').includes(quote));
  if (hits.length !== 1) return null;
  const ref = hits[0]?.turnRef;
  return ref?.sessionId && Number.isSafeInteger(ref?.turnSeq) ? ref : null;
}

/** 같은 문장이 이 작업에 이미 사건으로 서 있는가(상태 무관). 재등재는 부활이다. */
function alreadyRecorded(records, workRef, statement) {
  return records.some((record) => record.workRef === workRef
    && (record.evidence?.statement === statement || record.evidence?.question === statement));
}

/**
 * 모델 후보는 단독으로 사건이 되지 않는다. 모든 후보를 먼저 검증한 뒤에만 append한다.
 */
export async function admitWorkStateProposal({
  store, proposal, inputText, reply, turnRef, principalRef, workRef: existingWorkRef,
  provisionalWorkRef = null, shownProjects = [], priorUtterances = [],
}) {
  if (!store || !proposal || !principalRef || !turnRef) return { accepted: false, reason: 'missing_fact' };
  const changes = Array.isArray(proposal.changes) ? proposal.changes : [];
  const openQuestion = proposal.openQuestion;
  if (!changes.length && !openQuestion && !proposal.continueFrom && !proposal.continueFromRef) {
    return { accepted: false, reason: 'empty_proposal' };
  }
  const 인용출처 = new Map();
  for (const change of changes) {
    const ref = quoteSourceRef(change.utteranceQuote, { inputText, turnRef, priorUtterances });
    if (!ref) return { accepted: false, reason: 'utterance_quote_mismatch' };
    인용출처.set(change, ref);
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
      // **재등재는 부활이다**(2026-08-10). 인용 정의역을 이 대화 전체로 넓히자 모델이 뒤늦게
      // 옛 발화를 다시 세울 수 있게 됐다 — 그중에는 **이미 철회·대체된 값**도 있다. 같은
      // 문장으로 선 사건이 이 작업에 이미 있으면 새 합의가 아니다(상태 무관 · 원장 대조).
      if (workRef && alreadyRecorded(records, workRef, change.utteranceQuote)) {
        return { accepted: false, reason: 'already_recorded' };
      }
      prepared.push({ change, target: null });
      continue;
    }
    if (!workRef || !change.targetQuote) return { accepted: false, reason: 'target_required' };
    const 해소 = targetFor(change, targets);
    const target = 해소?.target;
    if (해소?.모호) {
      // **여럿을 품는 조각은 지어내지 않는다**(③-b 봉인 그대로) — 모호는 부재가 아니다.
      return {
        accepted: false,
        reason: 'target_not_current',
        detail: {
          targetQuote: change.targetQuote,
          currentQuotes: targets.map((r) => r.evidence?.statement ?? r.evidence?.question).filter(Boolean),
        },
      };
    }
    if (!target && change.type === 'question_resolved') {
      // 미정 해소는 **열린 질문이 실재해야** 한다 — 없는 질문을 닫으면 없던 미정이 지어진다.
      // **왜 못 맞췄는지 보이게 한다**(2026-08-10) — 진단면이므로 사용자·모델면에 나가지 않는다.
      return {
        accepted: false,
        reason: 'target_not_current',
        detail: {
          targetQuote: change.targetQuote,
          currentQuotes: targets.map((r) => r.evidence?.statement ?? r.evidence?.question).filter(Boolean),
        },
      };
    }
    if (!target) {
      // ── **수정·제외의 대상이 원장에 없다 — 거절하지 않는다**(P-OP S1 마감 · 2026-08-10) ──
      //
      // 실측(final r3·r4): 모델은 수정·제외를 9·10턴에 4/4 제출했는데, 지목 대상(t2·t3 의
      // 확정)이 게이트 탓에 원장에 못 서서 전부 `target_not_current` 로 죽었다 — 사용자의
      // 변경이 사라지고 **옛 값·미정 값이 최종 종합에 되살아나는** 뿌리다.
      //
      // **대상이 사용자 원문에서 하나로 특정되면 — 현재 발화가 새 확정으로 선다**(오너 판정
      // 2026-08-10). 과거 확정을 소급해 만들지 않는다: 그 발화는 검토("…생각했어")였을 수
      // 있고, 원장에 없던 과거를 발명하면 역사가 달라진다. **과거 기록 부재는 부재로 남기고**,
      // 사용자가 지금 정한 값(utteranceQuote — 이미 원문 대조 통과)이 현재값으로 확정된다.
      // 사건은 하나라 원자적이다(두 번 저장 없음 — Truth Ledger 계약).
      //
      // 대상의 사용자 원문 특정은 **거짓 전제 차단기**로만 쓴다: 진짜 수정은 옛 값을 정했던
      // 사용자 발화가 실재하지만, 거짓 전제의 지목(자기 답 문장·브리프 렌더 요약)은 사용자
      // 원문 어디에서도 특정되지 않는다 — 그 갈래는 아래에서 예전 그대로 거절된다(A-② 계약).
      const 대상실재 = (() => {
        const quote = String(change.targetQuote ?? '');
        if (quote.trim().length < 4) return false;   // 짧은 조각은 무엇이든 품는다 — 해소가 아니다
        return (priorUtterances ?? []).filter((u) => String(u?.text ?? '').includes(quote)).length === 1;
      })();
      if (대상실재) {
        if (alreadyRecorded(records, workRef, change.utteranceQuote)) {
          return { accepted: false, reason: 'already_recorded' };
        }
        prepared.push({ change: { type: 'agreement_set', utteranceQuote: change.utteranceQuote }, target: null });
        continue;
      }
      // **소급도 안 되면 예전 그대로 거절한다.** 검증된 이번 발화를 새 확정으로 "강등"하는
      // 길을 실측이 물렸다(전체 회귀 · A-② 봉인 빨강): 거짓 전제 평서문("~포함한다고 했지.")도
      // 사용자가 한 말이라 강등이 그것을 사건으로 세운다 — 의미를 재지 않고는 진짜 수정과
      // 못 가른다. 못 가르는 자리는 fail-closed 다(사건 0 이 옳다 — A-② 계약 유지).
      return {
        accepted: false,
        reason: 'target_not_current',
        detail: {
          targetQuote: change.targetQuote,
          currentQuotes: targets.map((r) => r.evidence?.statement ?? r.evidence?.question).filter(Boolean),
        },
      };
    }
    prepared.push({ change, target });
  }

  if (!workRef) workRef = await store.issueWorkRef({ turnRef, workOrdinal: 0 });
  const scopeRef = { principalRef, projectRef: workRef };
  const candidates = [];
  let nextOrdinal = records.length;
  for (const { change, target } of prepared) {
    let subjectRef = target?.subjectRef;
    if (!subjectRef) subjectRef = await store.issueSubjectRef({ turnRef, eventOrdinal: nextOrdinal++ });
    // **증거의 TurnRef 는 그 말이 있었던 턴이다** — 제출한 턴이 아니다.
    const 출처 = 인용출처.get(change) ?? turnRef;
    if (change.type === 'agreement_set') {
      candidates.push({
        type: change.type, workRef, subjectRef, scopeRef,
        evidence: { turnRef: 출처, statement: change.utteranceQuote },
      });
    } else if (change.type === 'question_resolved') {
      candidates.push({
        type: change.type, workRef, subjectRef, scopeRef,
        evidence: { targetEventId: target.eventId, turnRef: 출처 },
      });
    } else {
      candidates.push({
        type: change.type, workRef, subjectRef, scopeRef,
        evidence: { turnRef: 출처, statement: change.utteranceQuote, targetEventId: target.eventId },
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
