#!/usr/bin/env node
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const TURN_COUNTS = Object.freeze([30, 60, 100]);
export const PROMPT_BOUND_CHARS = 4_000;
export const REQUIRED_EVENT_KINDS = Object.freeze([
  'agreement_set',
  'agreement_superseded',
  'agreement_retracted',
  'question_opened',
  'question_resolved',
  'execution_completed',
  'chat_delivered',
]);

const turnRef = (sessionId, turnSeq) => ({ sessionId, turnSeq });

function receiptFor(sessionId, turnSeq, domain) {
  return {
    intended: `${domain} 산출물 작성`,
    actualCall: { tool: 'local.file', args: { action: 'write' } },
    result: {
      path: `/isolated/${domain}/result.md`,
      digest: `digest-${domain}`,
      originalUntouched: true,
    },
    failureState: 'none',
    lifecycle: 'delivered',
    userSafeSummary: '별도 결과물을 만들고 확인했어요.',
    turnRef: turnRef(`session-${domain}`, turnSeq),
  };
}

/**
 * 의미 사건은 고정된 위치에 두되 나머지 턴은 의미 없는 활동 기록으로 채운다.
 * 제품 구현은 filler 문장을 해석할 필요가 없다. 검사는 사건 후보와 증거 신분만 사용한다.
 */
export function buildLongWorkScenario(turnCount, domain = `domain-${turnCount}`) {
  if (!TURN_COUNTS.includes(turnCount)) throw new RangeError(`지원하지 않는 turnCount: ${turnCount}`);
  const sessionId = `session-${domain}`;
  const projectRef = `project-${domain}`;
  const principalRef = 'principal-owner';
  const workRef = `work-${domain}`;
  const subjectA = `subject-${domain}-scope`;
  const subjectB = `subject-${domain}-name`;
  const subjectQ = `subject-${domain}-question`;
  const contract = {
    contractRef: `contract-${domain}`,
    workRef,
    contractDigest: `contract-digest-${domain}`,
    deliverables: [{ id: `deliverable-${domain}`, kind: 'file', operation: 'write' }],
  };
  const receipt = receiptFor(sessionId, turnCount - 4, domain);

  const meaningful = new Map([
    [1, [{
      key: 'scope-set', kind: 'agreement_set', workRef, subjectRef: subjectA,
      scopeRef: { principalRef, projectRef },
      evidence: { turnRef: turnRef(sessionId, 1), utteranceQuote: `${domain} 범위 초안` },
      value: { label: `${domain} 범위 초안` },
    }]],
    [3, [{
      key: 'name-set', kind: 'agreement_set', workRef, subjectRef: subjectB,
      scopeRef: { principalRef, projectRef },
      evidence: { turnRef: turnRef(sessionId, 3), utteranceQuote: `${domain} 임시 이름` },
      value: { label: `${domain} 임시 이름` },
    }]],
    [Math.floor(turnCount * 0.25), [{
      key: 'question-open', kind: 'question_opened', workRef, subjectRef: subjectQ,
      scopeRef: { principalRef, projectRef },
      evidence: {
        turnRef: turnRef(sessionId, Math.floor(turnCount * 0.25)),
        assistantText: `${domain}의 최종 대상은 어느 쪽인가요?`,
      },
      value: { question: `${domain}의 최종 대상` },
    }]],
    [Math.floor(turnCount * 0.45), [{
      key: 'scope-new', kind: 'agreement_superseded', workRef, subjectRef: subjectA,
      targetKey: 'scope-set', scopeRef: { principalRef, projectRef },
      evidence: {
        turnRef: turnRef(sessionId, Math.floor(turnCount * 0.45)),
        utteranceQuote: `${domain} 범위 확정`,
      },
      value: { label: `${domain} 범위 확정` },
    }]],
    [Math.floor(turnCount * 0.60), [{
      key: 'name-retracted', kind: 'agreement_retracted', workRef, subjectRef: subjectB,
      targetKey: 'name-set', scopeRef: { principalRef, projectRef },
      evidence: {
        turnRef: turnRef(sessionId, Math.floor(turnCount * 0.60)),
        utteranceQuote: `${domain} 임시 이름은 철회`,
      },
    }]],
    [Math.floor(turnCount * 0.72), [{
      key: 'question-resolved', kind: 'question_resolved', workRef, subjectRef: subjectQ,
      targetKey: 'question-open', scopeRef: { principalRef, projectRef },
      evidence: {
        turnRef: turnRef(sessionId, Math.floor(turnCount * 0.72)),
        utteranceQuote: `${domain}의 최종 대상 답변`,
      },
      value: { answer: `${domain}의 최종 대상 답변` },
    }]],
    [turnCount - 4, [{
      key: 'execution-done', kind: 'execution_completed', workRef,
      subjectRef: `subject-${domain}-deliverable`, scopeRef: { principalRef, projectRef },
      completionContract: contract, receipt,
    }]],
    [turnCount - 2, [{
      key: 'chat-done', kind: 'chat_delivered', workRef,
      subjectRef: `subject-${domain}-chat`, scopeRef: { principalRef, projectRef },
      chatContract: { resultKind: 'chat', contentRequired: true },
      evidence: {
        turnRef: turnRef(sessionId, turnCount - 2),
        assistantText: `${domain} 최종 종합 결과`,
        persisted: true,
      },
      value: { label: `${domain} 최종 종합 결과` },
    }]],
  ]);

  return {
    id: `p90-long-${turnCount}`,
    turnCount,
    sessionId,
    principalRef,
    projectRef,
    workRef,
    contract,
    receipt,
    turns: Array.from({ length: turnCount }, (_, index) => {
      const turnSeq = index + 1;
      return {
        turnSeq,
        turnRef: turnRef(sessionId, turnSeq),
        activity: { kind: 'conversation_progress', digest: `activity-${domain}-${turnSeq}` },
        candidates: meaningful.get(turnSeq) ?? [],
      };
    }),
    expected: {
      activeAgreementLabels: [`${domain} 범위 확정`],
      retractedLabels: [`${domain} 임시 이름`],
      openQuestionCount: 0,
      resolvedAnswers: [`${domain}의 최종 대상 답변`],
      executionCompleted: true,
      chatDelivered: true,
    },
  };
}

export function resolveCandidate(candidate, refs) {
  const out = structuredClone(candidate);
  if (out.targetKey) {
    out.targetEventRef = refs.get(out.targetKey);
    delete out.targetKey;
  }
  return out;
}

function moduleError(message) {
  const fail = async () => { throw new Error(message); };
  return {
    available: false,
    assumption: message,
    createStore: fail,
    append: fail,
    loadEvents: fail,
    project: fail,
    render: fail,
    approvalCount: fail,
  };
}

/**
 * P90-1 제품 통합 계약:
 * - src/surface/work-event-store.js: WorkEventStore(dir), append(candidate), load()
 * - src/kernel/l1-intent/work-state.js: projectWorkState(events, scope), workStateFacts(state, opts)
 *
 * 저장소 append는 후보를 검증하고 OS 발급 eventRef를 반환해야 한다. 모델의 ref/done 주장은
 * 단독 근거가 아니다. approvalCount는 저장소가 제공하지 않으면 0으로 간주하지 않고 원시 사건에서 센다.
 */
export async function loadProductAdapter(root = resolve(fileURLToPath(new URL('../..', import.meta.url)))) {
  const storeUrl = pathToFileURL(join(root, 'src/surface/work-event-store.js')).href;
  const stateUrl = pathToFileURL(join(root, 'src/kernel/l1-intent/work-state.js')).href;
  let storeModule; let stateModule;
  try {
    [storeModule, stateModule] = await Promise.all([import(storeUrl), import(stateUrl)]);
  } catch (error) {
    return moduleError(`P90-1 제품 모듈 미구현: ${error.code ?? error.message}`);
  }
  const Store = storeModule.WorkEventStore;
  const projectWorkState = stateModule.projectWorkState;
  const workStateFacts = stateModule.workStateFacts;
  if (typeof Store !== 'function' || typeof projectWorkState !== 'function' || typeof workStateFacts !== 'function') {
    return moduleError('P90-1 export 계약 미충족: WorkEventStore/projectWorkState/workStateFacts');
  }
  return {
    available: true,
    assumption: null,
    createStore: async (dir) => new Store(dir),
    append: async (store, candidate) => store.append(candidate),
    loadEvents: async (store) => store.load(),
    project: async (events, scope) => projectWorkState(events, scope),
    render: async (state, opts) => workStateFacts(state, opts),
    issueWorkRef: async (store, binding) => store.issueWorkRef(binding),
    issueSubjectRef: async (store, binding) => store.issueSubjectRef(binding),
    issueCompletionContractRef: async (store, input) => store.issueCompletionContractRef(input),
    issueReceiptRef: async (store, input) => store.issueReceiptRef(input),
    approvalCount: async () => 0,
  };
}

function contentDigest(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

async function canonicalCandidate(adapter, store, raw, refs, identities, turnRefValue) {
  const workRef = identities.workRef;
  let subjectRef = identities.subjects.get(raw.subjectRef);
  if (!subjectRef) {
    subjectRef = await adapter.issueSubjectRef(store, {
      turnRef: turnRefValue,
      eventOrdinal: identities.subjects.size,
    });
    identities.subjects.set(raw.subjectRef, subjectRef);
  }
  const base = { type: raw.kind, workRef, subjectRef, scopeRef: raw.scopeRef };
  const targetEventId = raw.targetKey ? refs.get(raw.targetKey) : undefined;
  switch (raw.kind) {
    case 'agreement_set':
      return { ...base, evidence: { turnRef: raw.evidence.turnRef, statement: raw.evidence.utteranceQuote } };
    case 'agreement_superseded':
    case 'agreement_retracted':
      return { ...base, evidence: {
        turnRef: raw.evidence.turnRef,
        statement: raw.evidence.utteranceQuote,
        targetEventId,
      } };
    case 'question_opened':
      return { ...base, evidence: {
        turnRef: raw.evidence.turnRef,
        question: raw.value.question,
        changesAnswerFor: raw.value.question,
      } };
    case 'question_resolved':
      return { ...base, evidence: { targetEventId, turnRef: raw.evidence.turnRef } };
    case 'execution_completed': {
      const completionContractRef = await adapter.issueCompletionContractRef(store, {
        workRef, contract: raw.completionContract,
      });
      const receiptRef = await adapter.issueReceiptRef(store, {
        turnRef: raw.receipt.turnRef,
        turnOrdinal: 0,
        receipt: raw.receipt,
      });
      return { ...base, evidence: { completionContractRef, receiptRef, verificationPassed: true } };
    }
    case 'chat_delivered': {
      const resultContractRef = await adapter.issueCompletionContractRef(store, {
        workRef, contract: raw.chatContract,
      });
      return { ...base, evidence: {
        resultContractRef,
        turnRef: raw.evidence.turnRef,
        contentDigest: contentDigest(raw.evidence.assistantText),
        persisted: raw.evidence.persisted,
      } };
    }
    default: throw new TypeError(`알 수 없는 scenario 사건: ${raw.kind}`);
  }
}

export async function runLongWorkScenario(adapter, scenario, opts = {}) {
  const dir = opts.dir ?? await mkdtemp(join(tmpdir(), `t5-${scenario.id}-`));
  let store = await adapter.createStore(dir);
  const refs = new Map();
  const identities = {
    workRef: await adapter.issueWorkRef(store, {
      turnRef: scenario.turns[0].turnRef,
      workOrdinal: 0,
    }),
    subjects: new Map(),
  };
  const appendResults = [];
  for (const turn of scenario.turns) {
    for (const raw of turn.candidates) {
      const candidate = await canonicalCandidate(adapter, store, raw, refs, identities, turn.turnRef);
      const result = await adapter.append(store, candidate);
      const eventId = result?.eventId ?? result?.event?.eventId;
      if (result?.accepted !== false && !eventId) {
        throw new Error(`${raw.kind}: accepted 사건에 OS eventId가 없다`);
      }
      if (eventId) refs.set(raw.key, eventId);
      appendResults.push({ key: raw.key, candidate, result });
    }
    if (opts.restartAt === turn.turnSeq) store = await adapter.createStore(dir);
  }
  const events = await adapter.loadEvents(store);
  const scope = {
    principalRef: opts.principalRef ?? scenario.principalRef,
    projectRef: opts.projectRef ?? scenario.projectRef,
    conversationRef: opts.conversationRef ?? `conversation-${scenario.id}`,
  };
  const state = await adapter.project(events, scope);
  const rendered = await adapter.render(state, { maxChars: PROMPT_BOUND_CHARS });
  return {
    dir, store, refs, appendResults, events, state,
    rendered: String(rendered ?? ''),
    approvalCount: await adapter.approvalCount(events),
  };
}

async function main() {
  const adapter = await loadProductAdapter();
  if (!adapter.available) {
    console.error(adapter.assumption);
    process.exitCode = 1;
    return;
  }
  const reports = [];
  for (const count of TURN_COUNTS) {
    const scenario = buildLongWorkScenario(count);
    const run = await runLongWorkScenario(adapter, scenario, { restartAt: Math.floor(count / 2) });
    reports.push({ id: scenario.id, events: run.events.length, state: run.state, renderedChars: run.rendered.length });
  }
  console.log(JSON.stringify({ schemaVersion: 1, reports }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
