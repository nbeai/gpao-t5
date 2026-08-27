import { createHash } from 'node:crypto';

import { AttachmentStore } from './attachment-store.js';
import { ConsoleSessionStore } from './console-session-store.js';
import { ConversationLedger } from './conversation-ledger.js';
import { makeArtifactPublicationProductAdapter, projectHumanArtifactReceipt } from './artifact-publication-projection.js';
import { makeEffectForensicProductAdapter, projectHumanEffectForensicReceipt } from './effect-forensic-projection.js';
import { ResourceLedger } from './resource-ledger.js';
import { RunLedger } from './run-ledger.js';
import { WorkStore } from './work-store.js';

const MAX_ITEMS = 20;
const STATUS = new Set(['working', 'completed', 'incomplete', 'stopped', 'resumable', 'needs_review']);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const bounded = (value, maximum = 160) => String(value ?? '').replaceAll(/[\u0000-\u001f\u007f]/gu, ' ')
  .replaceAll(/\s+/gu, ' ').trim().slice(0, maximum);
function publicText(value, maximum = 160) {
  return bounded(value, maximum).replaceAll(/(?:\/(?:Users|private|Volumes|home|tmp|var|etc)\/[^\s]+|[A-Za-z]:\\[^\s]+|\\\\[^\s]+\\[^\s]+|\b[0-9a-f]{8}-[0-9a-f-]{27}\b|\b[0-9a-f]{64}\b|\b(?:sk-|xox[baprs]-|ghp_)[A-Za-z0-9_-]+\b)/giu,
    '민감한 정보');
}

function publicDate(value, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return '날짜 확인 필요';
  return date.toLocaleDateString('ko-KR', { timeZone });
}
function statusText(status) {
  return ({ working: '진행 중', completed: '완료', incomplete: '끝내지 못함', stopped: '멈춤',
    resumable: '이어서 요청할 수 있음', needs_review: '확인 필요' })[status];
}
function count(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : 0; }
function assertSafe(output, internalValues = []) {
  const serialized = JSON.stringify(output);
  for (const value of internalValues) if (typeof value === 'string' && value.length >= 3
    && serialized.includes(value)) throw new Error('Work history leaked internal identity');
  if (/[0-9a-f]{8}-[0-9a-f-]{27}/iu.test(serialized) || /\b(?:runId|workId|sessionId|toolCallId|sha256|filePath)\b/u.test(serialized)) {
    throw new Error('Work history leaked internal fields');
  }
  return output;
}

export function projectWorkHistoryEntry(input = {}) {
  if (!/^[0-9a-f]{32}$/u.test(input.historyHandle ?? '') || !STATUS.has(input.status)) {
    throw new TypeError('validated Work history input is required');
  }
  const output = { schema: 't5.public-work-history.v1', historyHandle: input.historyHandle,
    title: publicText(input.title) || '제목 없는 작업', whenText: publicDate(input.recordedAt, input.timeZone),
    status: { text: statusText(input.status) },
    actorText: ['내 요청', 'Telegram 요청', '자동 실행', '알 수 없음'].includes(input.actorText)
      ? input.actorText : '알 수 없음',
    artifacts: { recorded: count(input.artifacts?.recorded), available: count(input.artifacts?.available),
      unavailable: count(input.artifacts?.unavailable),
      items: (input.artifacts?.items ?? []).slice(0, 12).map((item) => ({
        name: publicText(item.name, 240), type: publicText(item.type, 40), availabilityText: publicText(item.availabilityText, 80),
      })) },
    effects: { recorded: count(input.effects?.recorded), confirmed: count(input.effects?.confirmed), unknown: count(input.effects?.unknown),
      summaries: (input.effects?.summaries ?? []).slice(0, 8).map((item) => publicText(item, 180)) },
    resources: { accountingText: publicText(input.resources?.accountingText, 100) || '사용량 확인 자료 없음' },
    remaining: { count: count(input.remaining?.count), needsUserReview: input.remaining?.needsUserReview === true,
      text: publicText(input.remaining?.text, 160) || '남은 항목 없음' },
    actions: { reopenConversation: true, continueInNewConversation: false } };
  return assertSafe(output, input.internalValues ?? []);
}

export function searchWorkHistory(entries = [], { query = '', status = null, cursor = null, limit = 10 } = {}) {
  if (String(query ?? '').length > 200) throw Object.assign(new Error('검색어가 너무 길어요.'), { status: 400 });
  if (status != null && !STATUS.has(status)) throw Object.assign(new Error('작업 상태 조건이 올바르지 않아요.'), { status: 400 });
  const needle = normalize(query).trim(); const count = Math.min(MAX_ITEMS, Math.max(1, Number(limit) || 10));
  let values = entries.filter((entry) => !status || entry.statusKey === status);
  if (needle) values = values.filter((entry) => normalize(entry.searchText).includes(needle));
  const cursorIndex = cursor == null ? -1 : values.findIndex((entry) => entry.historyHandle === cursor);
  if (cursor != null && cursorIndex < 0) throw Object.assign(new Error('작업 기록 페이지가 바뀌었어요.'), { status: 409 });
  const start = cursorIndex + 1;
  const selected = values.slice(start, start + count).map(({ searchText: _searchText, sortKey: _sortKey,
    statusKey: _statusKey, detail: _detail, internalSessionId: _internalSessionId, ...entry }) => entry);
  return { items: selected, nextCursor: start + count < values.length ? selected.at(-1)?.historyHandle ?? null : null };
}

function actor(run, session) {
  const trigger = run.metadata?.trigger;
  if (trigger === 'automation' || trigger === 'automation_main') return '자동 실행';
  if (trigger === 'messenger' || trigger === 'messenger_followup') return 'Telegram 요청';
  return ['user', 'work_followup'].includes(trigger) ? '내 요청' : '알 수 없음';
}
function statusFor({ run, result, cancellation, claim, effectUnknown = false, artifactUnavailable = false,
  requiresExternalDelivery = false }) {
  if (cancellation?.unknownEffect || cancellation?.state === 'recovery_pending'
    || result?.delivery?.state === 'unknown' || effectUnknown || artifactUnavailable) return 'needs_review';
  if (cancellation?.disposition === 'hard_cancelled' && cancellation.state === 'terminal'
    && cancellation.childrenTerminal === true && cancellation.claimReleased === true
    && cancellation.surfacePersisted === true && run.status === 'cancelled') return 'stopped';
  if (cancellation?.disposition === 'interrupted_resumable' && cancellation.childrenTerminal === true
    && cancellation.state === 'terminal' && cancellation.claimReleased === true
    && cancellation.surfacePersisted === true && run.status === 'cancelled') return 'resumable';
  if (claim.state === 'active' && run.status === 'running') return 'working';
  if (result?.delivery?.state === 'failed') return 'incomplete';
  const delivered = result?.state === 'delivery_terminal'
    && ['sent', 'persisted'].includes(result.delivery?.state);
  if (result?.objectiveOutcome === 'achieved'
    && ((!requiresExternalDelivery && result.state === 'surface_persisted') || delivered)) {
    return 'completed';
  }
  return ['failed', 'cancelled', 'interrupted'].includes(run.status) || result ? 'incomplete' : 'needs_review';
}
function runScope(runId) { return `run:${createHash('sha256').update(String(runId)).digest('hex').slice(0, 32)}`; }

export function makeWorkHistoryProductAdapter({ sessions, conversations, workStore, runLedger,
  attachmentStore, resourceLedger = null } = {}) {
  if (!(sessions instanceof ConsoleSessionStore) || !(conversations instanceof ConversationLedger)
    || !(workStore instanceof WorkStore) || !(runLedger instanceof RunLedger)
    || !(attachmentStore instanceof AttachmentStore)
    || (resourceLedger != null && !(resourceLedger instanceof ResourceLedger))) {
    throw new TypeError('canonical Work history stores are required');
  }
  const artifacts = makeArtifactPublicationProductAdapter({ attachmentStore, runLedger, workStore });
  const effects = makeEffectForensicProductAdapter({ runLedger });
  async function materialize({ targetHandle = null, enrich = false } = {}) {
    const [sessionState, workState, runs, resourceState] = await Promise.all([
      sessions.read(), workStore.read(), runLedger.list(), resourceLedger?.state() ?? null,
    ]);
    const visible = new Map(sessionState.sessions.filter((item) => !item.deletedAt).map((item) => [item.id, item]));
    const entries = []; const conversationSnapshots = new Map(); const enrichedArtifacts = [];
    for (const claim of workState.claims) {
      const run = runs.find((item) => item.runId === claim.runId); const work = workState.works
        .find((item) => item.workId === claim.workId); const session = work && visible.get(work.sessionId);
      if (!run || !work || !session || run.sessionId !== session.id) continue;
      if (workState.claims.filter((item) => item.runId === run.runId).length !== 1) continue;
      const result = workState.results.find((item) => item.runId === run.runId) ?? null;
      const cancellation = workState.cancellations.find((item) => item.runId === run.runId) ?? null;
      const historyHandle = hash(['work-history-v1', session.id, work.workId, claim.revision, run.runId]).slice(0, 32);
      if (targetHandle && targetHandle !== historyHandle) continue;
      const workBindings = run.events.filter((item) => item.type === 'work_bound');
      if (workBindings.length !== 1 || workBindings[0].payload?.workId !== work.workId
        || workBindings[0].payload?.revision !== claim.revision
        || (result && (result.workId !== work.workId || result.revision !== claim.revision))) {
        continue;
      }
      if (!conversationSnapshots.has(session.id)) {
        conversationSnapshots.set(session.id, await conversations.read(session.id).catch(() => ({ events: [], entries: [] })));
      }
      const conversation = conversationSnapshots.get(session.id);
      const sourceEntries = conversation.entries.filter((item) => item.messageId === work.sourceMessageId
        && item.message?.role === 'user');
      if (sourceEntries.length !== 1) continue;
      const objective = publicText(sourceEntries[0].message.content, 600);
      const artifactItems = []; let unavailableArtifacts = 0;
      for (const item of enrich ? result?.surfaceResult?.artifacts ?? [] : []) {
        try {
          const publication = await artifacts.materialize({ sessionId: session.id,
            runId: run.runId, attachmentId: item.attachmentId });
          if (!['surface_persisted', 'delivered'].includes(publication.state)) {
            unavailableArtifacts += 1; continue;
          }
          const receipt = projectHumanArtifactReceipt(publication);
          enrichedArtifacts.push({ sessionId: session.id, runId: run.runId,
            attachmentId: item.attachmentId, receiptDigest: publication.receiptDigest });
          artifactItems.push({ name: receipt.fileName, type: receipt.typeLabel, availabilityText: 'T5에 보관됨' });
        } catch { unavailableArtifacts += 1; }
      }
      const effectSummaries = []; let confirmedEffects = 0; let unknownEffects = 0;
      let criticalEffectUnknown = run.events.some((item) => item.type === 'tool_completed'
        && (item.payload?.receipt?.outcome === 'failed' || item.payload?.receipt?.outcome === 'unknown'
          || item.payload?.receipt?.result?.effectUnknown === true));
      for (const event of (enrich ? run.events : []).filter((item) => item.type === 'tool_completed'
        && item.payload?.receipt?.result?.effectObservation)) {
        try {
          const forensic = await effects.materialize({ sessionId: session.id,
            runId: run.runId, toolCallId: event.payload.receipt.toolCallId });
          const human = projectHumanEffectForensicReceipt(forensic);
          effectSummaries.push(human.title);
          if (['confirmed_change', 'confirmed_no_change'].includes(forensic.result)
            && forensic.effect.executionOutcome === 'succeeded') confirmedEffects += 1;
          if (forensic.result === 'partial' || forensic.result === 'unknown'
            || forensic.effect.executionOutcome !== 'succeeded' || forensic.unknowns.length) unknownEffects += 1;
          if (forensic.effect.executionOutcome === 'failed' || forensic.effect.executionOutcome === 'unknown') {
            criticalEffectUnknown = true;
          }
        } catch { unknownEffects += 1; criticalEffectUnknown = true; }
      }
      const proposal = workState.proposals.find((item) => item.runId === run.runId);
      const actionableInputStates = new Set(['admitted', 'classified', 'presented', 'executing',
        'completed_pending_surface', 'scheduled', 'recovery_pending', 'cancel_recovery_pending']);
      const pendingInputs = workState.inputs.filter((item) => (item.workId === work.workId
        || item.baseWorkId === work.workId) && actionableInputStates.has(item.state)).length;
      const remaining = (proposal?.blockers?.length ?? 0) + pendingInputs;
      const scopeEvents = resourceState?.events?.filter((item) => item.scopeId === runScope(run.runId)) ?? [];
      const accountingUnknown = scopeEvents.some((item) => item.type === 'UsageMarkedUnknown')
        || run.events.some((item) => item.type === 'resource_accounting_degraded');
      const searchText = [objective, publicText(result?.surfaceResult?.reply, 600)].join('\n');
      const internalValues = [session.id, work.workId, run.runId, work.sourceMessageId];
      const actorText = actor(run, session);
      const status = statusFor({ run, result, cancellation, claim, effectUnknown: criticalEffectUnknown,
        artifactUnavailable: false,
        requiresExternalDelivery: session.origin?.channel === 'telegram' || result?.delivery?.provider === 'telegram' });
      let publicEntry;
      try {
        publicEntry = projectWorkHistoryEntry({ historyHandle, title: objective,
          recordedAt: run.startedAt, status,
        actorText, artifacts: { recorded: result?.surfaceResult?.artifacts?.length ?? 0, available: artifactItems.length,
            unavailable: unavailableArtifacts, items: artifactItems },
          effects: { recorded: run.events.filter((item) => { if (item.type !== 'tool_completed') return false;
            const kind = item.payload?.receipt?.requestedCall?.args?.effect?.kind
              ?? item.payload?.receipt?.actualCall?.args?.effect?.kind;
            return Boolean(kind && kind !== 'observe'); }).length,
          confirmed: confirmedEffects, unknown: unknownEffects, summaries: effectSummaries },
          resources: { accountingText: accountingUnknown ? '사용량 일부는 확인이 필요해요.'
            : scopeEvents.length ? '사용량 정산 기록이 있어요.' : '사용량 확인 자료 없음' },
          remaining: { count: remaining, needsUserReview: remaining > 0 || accountingUnknown,
            text: remaining ? `확인하거나 이어서 처리할 항목 ${remaining}개` : '남은 항목 없음' },
          internalValues });
      } catch { continue; }
      entries.push({ ...publicEntry, searchText, sortKey: run.startedAt,
        statusKey: status,
        detail: { objective: objective || '요청 내용 없음',
          finalAnswer: result?.surfaceResult?.reply ? '결과 답변은 대화를 열어 확인할 수 있어요.' : '표시할 최종 답변 없음' },
        internalSessionId: session.id });
    }
    entries.sort((left, right) => String(right.sortKey).localeCompare(String(left.sortKey))
      || left.historyHandle.localeCompare(right.historyHandle));
    const handleCounts = new Map(); for (const entry of entries) {
      handleCounts.set(entry.historyHandle, (handleCounts.get(entry.historyHandle) ?? 0) + 1);
    }
    const projected = entries.filter((entry) => handleCounts.get(entry.historyHandle) === 1);
    const [sessionAfter, workAfter, runsAfter, resourceAfter] = await Promise.all([
      sessions.read(), workStore.read(), runLedger.list(), resourceLedger?.state() ?? null]);
    const fence = (sessionValue, workValue, runValues, resources) => hash({
      sessions: sessionValue, work: workValue, runs: runValues, resources });
    if (fence(sessionState, workState, runs, resourceState)
      !== fence(sessionAfter, workAfter, runsAfter, resourceAfter)) {
      throw Object.assign(new Error('작업 기록이 갱신됐어요. 다시 열어 주세요.'), { status: 409 });
    }
    for (const [sessionId, snapshot] of conversationSnapshots) {
      const current = await conversations.read(sessionId).catch(() => ({ events: [] }));
      if (hash(snapshot.events) !== hash(current.events)) {
        throw Object.assign(new Error('작업 기록이 갱신됐어요. 다시 열어 주세요.'), { status: 409 });
      }
    }
    for (const artifact of enrichedArtifacts) {
      const current = await artifacts.materialize(artifact);
      if (current.receiptDigest !== artifact.receiptDigest) {
        throw Object.assign(new Error('작업 결과 파일이 갱신됐어요. 다시 열어 주세요.'), { status: 409 });
      }
    }
    const [sessionFinal, workFinal, runsFinal, resourceFinal] = await Promise.all([
      sessions.read(), workStore.read(), runLedger.list(), resourceLedger?.state() ?? null]);
    if (fence(sessionAfter, workAfter, runsAfter, resourceAfter)
      !== fence(sessionFinal, workFinal, runsFinal, resourceFinal)) {
      throw Object.assign(new Error('작업 기록이 갱신됐어요. 다시 열어 주세요.'), { status: 409 });
    }
    for (const [sessionId, snapshot] of conversationSnapshots) {
      const current = await conversations.read(sessionId).catch(() => ({ events: [] }));
      if (hash(snapshot.events) !== hash(current.events)) {
        throw Object.assign(new Error('작업 기록이 갱신됐어요. 다시 열어 주세요.'), { status: 409 });
      }
    }
    return projected;
  }
  return Object.freeze({
    async list(options = {}) { return searchWorkHistory(await materialize(), options); },
    async detail(historyHandle) {
      const values = await materialize({ targetHandle: historyHandle, enrich: true });
      const entry = values.find((item) => item.historyHandle === historyHandle);
      if (!entry) throw Object.assign(new Error('작업 기록을 찾지 못했어요.'), { status: 404 });
      const { searchText: _searchText, sortKey: _sortKey, statusKey: _statusKey,
        internalSessionId: _internalSessionId, ...publicEntry } = entry; return publicEntry;
    },
    async resolve(historyHandle) {
      const values = await materialize({ targetHandle: historyHandle });
      const matches = values.filter((item) => item.historyHandle === historyHandle);
      if (matches.length !== 1) throw Object.assign(new Error('작업 기록을 찾지 못했어요.'), { status: 404 });
      return Object.freeze({ sessionId: matches[0].internalSessionId });
    },
  });
}
