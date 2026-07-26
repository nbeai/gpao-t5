// L4 · Work Chat 서버 — 얇은 HTTP 진입점. 의존성 0(node 내장만).
// 세션 인지: 세션별 transcript·원장·pending을 분리하고 파일로 지속. env/model/tools는 공유.
// GET  /                → 채팅 화면
// GET  /sessions        → 세션 목록(사이드바)
// POST /sessions        → 새 세션
// GET  /sessions/:id    → 세션 transcript(재접속 복원)
// POST /turn            → { sessionId, text|approve|reject, ... } → 턴 결과 JSON
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runTurn } from '../kernel/turn.js';
import { TruthLedger } from '../kernel/l0-evidence/ledger.js';
import { buildSelfState } from '../kernel/l0-evidence/self-state.js';
import { recentTurns } from '../kernel/l1-intent/conversation.js';
import { toolActionKind } from '../kernel/l2-plan/action-plan.js';
import { isSafetyFloor } from '../kernel/l2-plan/authority.js';
import { StubModelClient } from '../runtime/model-client.js';
import { withModelTimeout } from '../runtime/model-timeout.js';
import { describeUnprobedModel } from '../runtime/model-doctor.js';
import { ModelConnectionStore } from './model-connection.js';
import { OnboardingStore, onboardingNeeded } from './onboarding-store.js';
import { SelfhoodStore } from './selfhood-store.js';
import { DEFAULT_IDENTITY } from '../kernel/identity.js';
import { makeWelcome } from './welcome.js';
import { demoEnv, demoTools } from './demo-context.js';
import { SessionStore } from './session-store.js';
import { MemoryStore } from './memory-store.js';
import { makeCandidate, runReplay, promote } from '../kernel/l1-intent/context-mesh.js';
import { makeInferredTrait, makeOperatingPreference, confirmOperatingPreference, projectUserModel } from '../kernel/l1-intent/user-model.js';
import { normalizeInboundEvent } from '../kernel/l1-intent/inbound-gate.js';
import { connectorReadiness, sendNeedsApproval } from '../kernel/l2-plan/connector-profile.js';
import { demoConnectors, demoDescriptors, demoChannels } from './demo-context.js';
import { projectChannels } from '../kernel/l2-plan/channel-registry.js';
import { searchTranscripts, projectSearchCandidates, makeSearchCandidate } from '../kernel/l5-growth/session-search.js';
import { buildOverview } from './overview.js';
import { projectToolbox } from './toolbox-view.js';
import { PersonalToolsStore } from './personal-tools-store.js';
import { definePersonalTool, runProbe, applyProbe } from '../kernel/l2-plan/personal-tool.js';
import { parseCompletionCriteria, verifyCompletion } from '../kernel/l2-plan/completion-contract.js';
import { EventLog } from './event-log.js';
import { makeTurnEvent } from '../kernel/l0-evidence/turn-event.js';
import { TaskTraceStore } from './task-trace-store.js';
import { makeTaskTrace, proposeDefaultTarget, replayDefaultTarget, promoteDefaultTarget } from '../kernel/l5-growth/task-trace.js';
import { DeliveryStore } from './delivery-store.js';
import { makeDelivery, applyDeliveryResult, isRetriable } from '../kernel/l5-growth/delivery.js';
import { SkillStore } from './skill-store.js';
import { detectSkillCandidate, surfaceCandidate, markReplayRequired, replaySkill, approveSkill, admitSkill, rejectSkill, canInfluence, canAutoExecute } from '../kernel/l5-growth/skill-learning.js';
import { AutomationStore } from './automation-store.js';
import { makeGrowthCandidate, approveAutomation, cancelJob, admitTickTrigger } from '../kernel/l5-growth/automation.js';
import { tickAutomation } from '../runtime/automation-engine.js';
import { AutomationScheduler } from '../runtime/automation-scheduler.js';
import { liveDeps } from './live-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/**
 * @param {Object} [deps]
 * @param {SessionStore} [deps.store]
 * @param {Object} [deps.env]   SelfState 입력(공유)
 * @param {Object} [deps.model] ModelClient(공유)
 * @param {Object} [deps.tools] ToolRunner(공유)
 */
export function makeServer(deps = {}) {
  const store = deps.store ?? new SessionStore();
  const memStore = deps.memoryStore ?? new MemoryStore(store.dir);
  const autoStore = deps.automationStore ?? new AutomationStore(store.dir);
  const personalStore = deps.personalStore ?? new PersonalToolsStore(store.dir);
  const traceStore = deps.traceStore ?? new TaskTraceStore(store.dir);
  const eventLog = deps.eventLog ?? new EventLog(store.dir);
  const deliveryStore = deps.deliveryStore ?? new DeliveryStore(store.dir);
  const skillStore = deps.skillStore ?? new SkillStore(store.dir);
  const onboardingStore = deps.onboardingStore ?? new OnboardingStore(store.dir); // P-ONB-2 단일 진실
  // P-ID-1 자기인지: SOUL.md · CAPABILITIES.md(사용자 경로). 문서는 부팅 시 읽고, 이름·능력이
  // 바뀌면 갱신한다. 모델에겐 상시 요약만 가고 상세는 물어봤을 때만 간다(turn 이 판단).
  const selfhoodStore = deps.selfhoodStore ?? new SelfhoodStore(store.dir);
  let selfhoodDocs = { soul: null, capabilities: null };
  let identity = { ...DEFAULT_IDENTITY };
  // P6-12: 스트림 시작을 POST 본문으로 받아 streamId만 발급한다 — 사용자 원문을 URL에 싣지 않는다(프라이버시).
  //   EventSource는 streamId로만 구독한다. 일회성 소비 + 30초 만료(누수 방지).
  const pendingStreams = new Map();
  // 같은 세션의 턴은 durable truth(EventLog)와 transcript를 공유하므로 직렬화한다.
  // 다른 세션은 기존처럼 병렬로 둔다(lane 격리).
  const sessionQueues = new Map();
  const env = deps.env ?? demoEnv();
  // 안정성: 느린/멈춘 모델이 턴을 무한 매달아 세션 큐를 막지 않게 타임아웃으로 감싼다(기본 30s, 0이면 무제한).
  // 바깥 경계는 어댑터 상한(계정 경로 150s)보다 커야 안쪽의 진짜 취소가 먼저 돈다(§6.22).
  // 30s 기본은 추론 모델의 정상 응답까지 끊었다(2026-07-26 실사용) — 무한 매달림만 막는다.
  const modelTimeoutMs = Number(deps.modelTimeoutMs ?? process.env.GPAO_T5_MODEL_TIMEOUT_MS ?? 180_000);
  const model = withModelTimeout(deps.model ?? new StubModelClient(), modelTimeoutMs);
  const tools = deps.tools ?? demoTools();
  // tick 트러스트 토큰(§8.3): 런타임만 안다. 어떤 GET에도 노출하지 않는다 → 브라우저·사용자는 tick 불가.
  // in-process 스케줄러는 runTrustedTick을 직접 부르고, HTTP tick 라우트는 이 토큰을 요구한다.
  const runtimeToken = deps.runtimeToken ?? randomUUID();

  // tick 실행의 단일 경로(트러스트 게이트). trusted_runtime_event만 실행한다(admitTickTrigger).
  // tick 중첩 방지(P6-4): 이전 tick이 아직 도는 중이면 새 tick은 건너뛴다 — load→save 경합·중복 실행 차단.
  let ticking = false;
  async function runTrustedTick(trigger) {
    if (!admitTickTrigger(trigger)) return { ok: false, reason: 'not_trusted', ran: [] };
    if (ticking) return { ok: true, skipped: 'in_flight', ran: [] };
    ticking = true;
    try {
      const a = await autoStore.load();
      const selfState = buildSelfState(env);
      const ran = await tickAutomation(a.jobs, { tools, selfState, now: Date.now() });
      await autoStore.save(a);
      return { ok: true, ran: ran.map((r) => ({ jobId: r.jobId, failureState: r.receipt.failureState })) };
    } finally {
      ticking = false;
    }
  }

  function withSessionQueue(sessionId, task) {
    const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    // 꼬리는 장부용일 뿐이다 — run 의 거부는 호출자가 받는다. 꼬리가 거부를 다시 들고 있으면
    // 아무도 안 받는 unhandledRejection 으로 프로세스가 죽는다(P-RT-1 라이브 실측에서 발견).
    const tail = run.catch(() => {}).finally(() => {
      if (sessionQueues.get(sessionId) === tail) sessionQueues.delete(sessionId);
    });
    sessionQueues.set(sessionId, tail);
    return run;
  }

  // 승인 대기(pending)를 세션 파일에 지속한다(Approval Lifecycle). 기억(memory)·활성목표(activeGoal)를
  // ctx에 주입 — 라우터는 raw 기억을 쓰지 않고, admitted된 것만 좁게 입장한다(§5).
  function ctxForSession(session, memory) {
    const ledger = new TruthLedger();
    ledger.entries = (session.ledgerEntries ?? []).slice();
    const pending = new Map(Object.entries(session.pendingApprovals ?? {}));
    return {
      env, model, tools, ledger, pending, identity, selfhoodDocs,
      modelSupportsSearch: deps.modelSupportsSearch?.() ?? false,
      memory, activeGoal: session.activeGoal ?? null,
      // Phase 2-1: 같은 대화의 최근 발화. **현재 발화를 transcript 에 넣기 전에** 만든다 —
      // 지금 말은 currentRequest 로 따로 가므로 이력에 또 들어가면 두 번 말한 게 된다.
      recentTurns: recentTurns(session.transcript ?? []),
      newId: () => randomUUID(), now: () => Date.now(),
    };
  }

  // 한 턴을 실행하고 지속한다(transcript·원장·pending·학습·후보). /turn과 /turn/stream이 공유해 동작이 갈라지지
  // 않게 한다. emit(선택, P6-12)이 있으면 진행 이벤트를 방출한다 — 스트림은 durable truth 위의 투영이다.
  async function runAndPersistTurn(session, input, emit, onAnswerDelta) {
    const hasText = typeof input.text === 'string' && input.text.trim();
    const memory = await memStore.load();
    const learning = await traceStore.load();
    const ctx = ctxForSession(session, memory);
    ctx.defaults = learning.promoted; // P6-11: 승격된 기본 대상만 영향(narrow)
    // Phase 0-4: 승격된 스킬을 턴에 넘긴다. 커널이 canInfluence 로 다시 거르므로 전부 넘겨도
    // 미승인 스킬은 영향 0 이다(게이트는 커널에 하나만 둔다 — 여기서 미리 거르면 이중 진실).
    ctx.skills = (await skillStore.load()).skills ?? [];
    if (emit) ctx.emit = emit; // P6-12: 진행 상태 스트리밍(사용자 언어, 모델 사고 원문 아님)
    // P-STR-1: 답변 조각. **durable 에 남기지 않는다** — 토큰마다 EventLog append 는 §6.21 후속의
    // "EventLog 무한 성장"을 우리가 직접 만드는 셈이다. 진실은 지속된 완성 결과 하나, 조각은 미리보기.
    if (onAnswerDelta) ctx.onAnswerDelta = onAnswerDelta;
    if (hasText) {
      if (!session.transcript.some((e) => e.role === 'user')) session.title = input.text.trim().slice(0, 30);
      session.transcript.push({ role: 'user', text: input.text });
    }
    const result = await runTurn(input, ctx);
    // P-ID-1: 사용자가 이름을 지어 줬으면 SOUL.md 에 남긴다(다음 대화에서도 그 이름으로 답한다).
    if (result.identityUpdate?.name) {
      const soul = await selfhoodStore.setName(result.identityUpdate.name);
      selfhoodDocs = { ...selfhoodDocs, soul };
      identity = { name: result.identityUpdate.name, named: true };
    }
    session.transcript.push({ role: 'assistant', result });
    session.ledgerEntries = ctx.ledger.entries;
    session.pendingApprovals = Object.fromEntries(ctx.pending);
    if (result.goal) session.activeGoal = result.goal;
    if (result.sentVia?.tool && result.sentVia.target) {
      const sv = result.sentVia;
      const delivered = sv.failureState === 'none' || sv.failureState === undefined;
      // P6-14: 전달 원장 — 생성(artifact)과 전달을 분리해 남긴다. 실패해도 산출물 보존 → 재전달 가능.
      const dl = await deliveryStore.load();
      let rec = makeDelivery({ id: randomUUID(), sessionId: session.id, tool: sv.tool, target: sv.target, artifact: { text: sv.text }, now: Date.now() });
      rec = applyDeliveryResult(rec, sv.failureState ?? 'none', sv.userSafeSummary, Date.now());
      dl.deliveries.push(rec);
      await deliveryStore.save(dl);
      // 전달 실패면 채팅에서 "전달이 막혔어요 / 다시 보낼까요?"로 이어가게 표면화(처음부터 다시 아님).
      if (rec.state !== 'delivered') result.deliveryFailed = { deliveryId: rec.id, tool: rec.tool, target: rec.target, needsFix: rec.needsFix, userSafeSummary: rec.lastError?.userSafeSummary };
      // P6-11 학습: TaskTrace는 넓게 기록하되, DefaultTarget 후보는 **실제 전달된** 경우에만 제안(잘못 학습 방지).
      learning.traces.push(makeTaskTrace({ id: randomUUID(), requestText: input.text ?? '', tool: sv.tool, target: sv.target, outcome: delivered ? 'delivered' : 'failed', now: Date.now() }));
      if (delivered) {
        const cand = proposeDefaultTarget({ tool: sv.tool, target: sv.target, promoted: learning.promoted, proposed: learning.proposed });
        if (cand) { const withId = { patternId: randomUUID(), ...cand }; learning.proposed.push(withId); result.patternCandidate = withId; }
      }
      await traceStore.save(learning);
    }
    if (result.memorySuggestion) {
      const dup = [...memory.candidates, ...memory.promoted].some((e) => e.statement === result.memorySuggestion.statement);
      if (dup) { result.memorySuggestion = undefined; }
      else {
        const c = makeCandidate(randomUUID(), result.memorySuggestion.kind, result.memorySuggestion.statement);
        memory.candidates.push(c); await memStore.save(memory); result.memorySuggestion.candidateId = c.candidateId;
      }
    }
    if (result.automationSuggestion?.action) {
      const a = await autoStore.load();
      const dedupKey = result.automationSuggestion.statement;
      if (a.candidates.some((c) => c.statement === dedupKey && !c.approved)) { result.automationSuggestion = undefined; }
      else {
        const c = makeGrowthCandidate({ candidateId: randomUUID(), statement: result.automationSuggestion.statement, action: result.automationSuggestion.action, dedupKey });
        a.candidates.push(c); await autoStore.save(a); result.automationSuggestion.candidateId = c.candidateId;
      }
    } else if (result.automationSuggestion) { result.automationSuggestion = undefined; }
    await store.save(session);
    return result;
  }

  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? '').split('?')[0];

      // ── health (P-DIST-1) ── 설치 검증이 물어보는 단일 신호. **거짓 초록 금지**: 서버가 살아 있으면
      //   ok:true 이되, 모델 연결 여부는 있는 그대로 싣는다(모델이 없다고 ok 를 거짓으로 만들지도,
      //   연결됐다고 꾸미지도 않는다). 설치 스크립트가 이 한 줄로 "도달했는가"를 판정한다.
      if (req.method === 'GET' && url === '/health') {
        const connStatus = deps.modelConnection?.status?.() ?? {};
        const onboarding = await onboardingStore.load();
        return sendJson(res, 200, {
          ok: true,
          model: {
            connected: Boolean(connStatus.connected),
            id: env.model?.id ?? null,
            healthState: env.model?.healthState ?? null, // 미검증이면 null — 검증됨이라 말하지 않는다
          },
          onboarding: { needed: onboardingNeeded(onboarding, connStatus) },
        });
      }

      if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
        const html = await readFile(join(__dirname, 'web', 'index.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (req.method === 'GET' && url === '/sessions') {
        return sendJson(res, 200, { sessions: await store.list() });
      }
      if (req.method === 'POST' && url === '/sessions') {
        const s = await store.create();
        return sendJson(res, 200, { id: s.id, title: s.title });
      }
      if (req.method === 'GET' && url.startsWith('/sessions/')) {
        const id = decodeURIComponent(url.slice('/sessions/'.length));
        const s = await store.load(id);
        if (!s) return sendJson(res, 404, { error: '세션을 찾지 못했어요.' });
        // activePendingIds: 아직 유효한(만료 전) 승인 대기만 — 만료된 것은 UI에서 되살아나면 죽은 버튼이라
        // 제외한다(감사 보정). 만료된 pending은 세션 파일에서도 정리한다.
        const now = Date.now();
        const all = s.pendingApprovals ?? {};
        const activePendingIds = Object.keys(all).filter(
          (id) => !all[id].grantScope?.expiresAt || all[id].grantScope.expiresAt > now,
        );
        if (activePendingIds.length !== Object.keys(all).length) {
          s.pendingApprovals = Object.fromEntries(activePendingIds.map((id) => [id, all[id]]));
          await store.save(s);
        }
        return sendJson(res, 200, { id: s.id, title: s.title, transcript: s.transcript, activePendingIds });
      }

      if (req.method === 'POST' && url === '/turn') {
        const body = await readBody(req);
        const input = body ? JSON.parse(body) : {};
        const hasText = typeof input.text === 'string' && input.text.trim();
        const hasControl = typeof input.approve === 'string' || typeof input.reject === 'string';
        if (!hasText && !hasControl) return sendJson(res, 400, { error: '빈 발화' });
        if (typeof input.sessionId !== 'string') return sendJson(res, 400, { error: '세션 없음' });

        const result = await withSessionQueue(input.sessionId, async () => {
          const session = await store.load(input.sessionId);
          if (!session) return null;
          return runAndPersistTurn(session, input);
        });
        if (!result) return sendJson(res, 404, { error: '세션을 찾지 못했어요.' });
        return sendJson(res, 200, result);
      }

      // ── 스트림 시작 (P6-12) ── 사용자 원문은 POST 본문으로만. streamId를 발급하고 EventSource가 그걸로 구독.
      if (req.method === 'POST' && url === '/turn/stream-start') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.text !== 'string' || !input.text.trim()) return sendJson(res, 400, { error: '빈 발화' });
        if (typeof input.sessionId !== 'string') return sendJson(res, 400, { error: '세션 없음' });
        const session = await store.load(input.sessionId);
        if (!session) return sendJson(res, 404, { error: '세션을 찾지 못했어요.' });
        const streamId = randomUUID();
        pendingStreams.set(streamId, { sessionId: input.sessionId, text: input.text, expiresAt: Date.now() + 30_000 });
        return sendJson(res, 200, { streamId });
      }

      // ── 스트리밍 (P6-12) ── SSE로 진행 상태를 흘리되, 진실은 EventLog(durable)에 남긴다. 끊겨도 복구된다.
      //   모델 숨은 사고 원문은 절대 흘리지 않는다 — trace_status/tool_progress 등 사용자 언어 상태만.
      //   URL엔 sessionId·streamId·lastEventId만(사용자 원문 미포함).
      if (req.method === 'GET' && url === '/turn/stream') {
        const q = new URL(req.url, 'http://x').searchParams;
        const sessionId = q.get('sessionId');
        if (typeof sessionId !== 'string' || !sessionId) return sendJson(res, 400, { error: '세션 없음' });
        const session = await store.load(sessionId);
        if (!session) return sendJson(res, 404, { error: '세션을 찾지 못했어요.' });
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const writeEvent = (ev) => res.write(`id: ${ev.eventId}\nevent: ${ev.type}\ndata: ${JSON.stringify({ ...ev.payload, _turnId: ev.turnId })}\n\n`);
        const writeHeartbeat = () => res.write('event: heartbeat\ndata: {}\n\n'); // 연결 생존(비지속, EventLog에 안 남김)

        // 재접속: lastEventId 이후의 durable 이벤트만 재생(진실은 EventLog에 있었다). 미종료면 표시.
        const lastEventId = q.get('lastEventId');
        if (lastEventId != null) {
          for (const ev of await eventLog.since(sessionId, lastEventId)) writeEvent(ev);
          const terminal = await eventLog.lastIsTerminal(sessionId);
          res.write(`event: reconnected\ndata: ${JSON.stringify({ terminal })}\n\n`);
          res.end();
          return;
        }

        // 실행: streamId로 pending 발화를 찾는다(URL에 원문 없음). 일회성 + 만료 검사.
        const streamId = q.get('streamId');
        const pending = streamId && pendingStreams.get(streamId);
        if (pending) pendingStreams.delete(streamId);
        if (!pending || pending.sessionId !== sessionId || pending.expiresAt < Date.now()) {
          res.write('event: recoverable_error\ndata: {"text":"요청이 만료됐어요. 다시 보내 주세요."}\n\n');
          res.write('event: complete\ndata: {"kind":"error"}\n\n');
          res.end();
          return;
        }
        const text = pending.text;
        writeHeartbeat(); // 연결 즉시 생존 신호(무한 대기 방지)
        const hb = setInterval(writeHeartbeat, 15_000); hb.unref?.(); // 긴 turn 동안 연결 유지
        try {
          await withSessionQueue(sessionId, async () => {
            try {
              const activeSession = await store.load(sessionId);
              if (!activeSession) {
                res.write('event: recoverable_error\ndata: {"text":"세션을 찾지 못했어요."}\n\n');
                res.write('event: complete\ndata: {"kind":"error"}\n\n');
                return;
              }
              const turnId = randomUUID();
              let seq = (await eventLog.nextEventId(sessionId)) - 1;
              const emit = async (type, payload) => {
                seq += 1;
                const ev = makeTurnEvent({ turnId, eventId: seq, type, payload: payload ?? {}, now: Date.now() });
                await eventLog.append(sessionId, ev); // durable만 남는다(안전 척추)
                writeEvent(ev);
              };
              await emit('trace_status', { text: '요청을 이해했어요' }); // 시작 신호(무한 대기 금지)
              // 답변 조각은 EventLog 를 거치지 않고 바로 화면으로만 흘린다(비지속 미리보기).
              const onAnswerDelta = (piece) => {
                res.write(`event: answer_delta\ndata: ${JSON.stringify({ text: piece, _turnId: turnId })}\n\n`);
              };
              const result = await runAndPersistTurn(activeSession, { sessionId, text }, emit, onAnswerDelta);
              // 결과 → 사용자 상태 이벤트(사고 원문 아님). 그리고 항상 complete로 닫는다.
              if (result.kind === 'approval') await emit('approval_required', { pendingId: result.pendingId, count: result.pending?.length ?? 0 });
              else if (result.capabilityResolution && ['connector', 'tool'].includes(result.capabilityResolution.capabilityType)) {
                await emit('capability_needed', { capabilityType: result.capabilityResolution.capabilityType, missingCapability: result.capabilityResolution.missingCapability });
              }
              await emit('complete', { kind: result.kind });
            } catch (err) {
              // 느린 모델은 그 원인을 사용자 언어로(진단 원문 아님). 어느 경우든 항상 complete로 닫아 큐를 푼다.
              const text = err?.isModelTimeout ? '응답이 늦어 잠시 멈췄어요.' : '처리 중 문제가 있었어요.';
              res.write(`event: recoverable_error\ndata: ${JSON.stringify({ text, nextSafeAction: '잠시 후 다시 시도할까요?' })}\n\n`);
              res.write('event: complete\ndata: {"kind":"error"}\n\n');
              console.error('[stream:diagnostic]', err?.stack ?? err);
            }
          });
        } finally {
          clearInterval(hb); // heartbeat 정리(타이머 누수 방지)
          res.end();
        }
        return;
      }

      // ── 자동화 (P6-3) ── 후보 → 승인 → 예약 → tick 실행 → 원장 → 취소/만료.
      if (req.method === 'GET' && url === '/automation') {
        const a = await autoStore.load();
        // ledger: AutomationLedger 투영(세션 TruthLedger와 분리). runs·lastResult는 그 요약.
        const stripJob = (j) => ({
          id: j.id, statement: j.statement, state: j.state, external: j.external,
          nextRunAt: j.nextRunAt, grantScope: j.grantScope, runs: j.executions.length,
          failureCount: j.failureCount ?? 0, // 신뢰성(P6-4): 연속 실패 카운트 표면화
          lastResult: j.executions.at(-1)?.failureState ?? null,
          ledger: j.executions.map((r) => ({ failureState: r.failureState, lifecycle: r.lifecycle, summary: r.userSafeSummary })),
        });
        return sendJson(res, 200, {
          candidates: a.candidates.filter((c) => !c.approved).map((c) => ({ candidateId: c.candidateId, statement: c.statement })),
          jobs: a.jobs.map(stripJob),
        });
      }
      // 후보 승인 → ScheduledJob. external(외부 전송) 여부는 도구 descriptor에서 파생(사용자 입력 불신).
      // 외부 전송 자동화는 반드시 만료(bounded) 승인 범위를 요구한다 — 몰래·무기한 권한 금지(A2 경계).
      if (req.method === 'POST' && url === '/automation/approve') {
        const input = JSON.parse((await readBody(req)) || '{}');
        const a = await autoStore.load();
        const cand = a.candidates.find((c) => c.candidateId === input.candidateId && !c.approved);
        if (!cand) return sendJson(res, 404, { error: '자동화 후보를 찾지 못했어요.' });
        // 만료를 강제할지는 **행동 종류**로 정한다. 도구 단위 needsApproval 로 보면 `local.file` 은
        // 플래그가 없어 삭제 자동화가 무기한 승인으로 통과했다(도구 단위 kind 고정이 만든 사고의 재판).
        const jobKind = toolActionKind({
          toolId: cand.action?.tool, args: cand.action?.args, selfState: buildSelfState(env),
        });
        const external = isSafetyFloor(jobKind);
        const expiresAt = Number.isFinite(input.expiresAt) ? input.expiresAt : undefined;
        if (external && !expiresAt) {
          // 외부 전송은 만료 없는 승인을 허용하지 않는다(승인 경계 유지).
          return sendJson(res, 400, { error: '외부 전송 자동화는 만료가 있는 승인이 필요해요.', needsExpiry: true });
        }
        const grantScope = { kind: external ? 'session' : (input.persist ? 'persist' : 'session'), ...(expiresAt ? { expiresAt } : {}) };
        const job = approveAutomation(cand, {
          id: randomUUID(),
          grantScope, external,
          now: Date.now(),
          nextRunAt: Number.isFinite(input.nextRunAt) ? input.nextRunAt : Date.now(),
          intervalMs: Number.isFinite(input.intervalMs) ? input.intervalMs : undefined,
        });
        cand.approved = true;
        a.jobs.push(job);
        await autoStore.save(a);
        return sendJson(res, 200, { ok: true, jobId: job.id, state: job.state, external, grantScope });
      }
      // tick은 런타임 이벤트로만 실행된다(§8.3). 사용자 버튼이 아니다 — 트러스트 토큰 없으면 거부.
      // 정상 구동은 in-process 스케줄러(server.runtimeTick). 이 라우트는 런타임/운영·테스트 전용.
      if (req.method === 'POST' && url === '/automation/tick') {
        if (req.headers['x-runtime-token'] !== runtimeToken) {
          return sendJson(res, 403, { ok: false, reason: 'not_trusted', error: 'tick은 런타임 이벤트로만 실행돼요.' });
        }
        return sendJson(res, 200, await runTrustedTick({ source: 'trusted_runtime_event' }));
      }
      // 취소(되돌리기). 이후 tick에서 실행되지 않는다.
      if (req.method === 'POST' && url === '/automation/cancel') {
        const input = JSON.parse((await readBody(req)) || '{}');
        const a = await autoStore.load();
        const idx = a.jobs.findIndex((j) => j.id === input.jobId);
        if (idx < 0) return sendJson(res, 404, { error: '자동화 작업을 찾지 못했어요.' });
        a.jobs[idx] = cancelJob(a.jobs[idx]);
        await autoStore.save(a);
        return sendJson(res, 200, { ok: true, state: 'cancelled' });
      }

      // ── 기억(Context Mesh) ──
      if (req.method === 'GET' && url === '/memory') {
        const m = await memStore.load();
        const strip = (e) => ({ candidateId: e.candidateId, kind: e.kind, statement: e.statement });
        return sendJson(res, 200, { candidates: m.candidates.map(strip), promoted: m.promoted.map(strip) });
      }
      if (req.method === 'POST' && url === '/memory/confirm') {
        const input = JSON.parse((await readBody(req)) || '{}');
        const m = await memStore.load();
        const idx = m.candidates.findIndex((e) => e.candidateId === input.candidateId);
        if (idx < 0) return sendJson(res, 404, { error: '후보를 찾지 못했어요.' });
        const entry = m.candidates[idx];
        // operating_principle 은 replay 게이트를 통과해야 승격된다 — replay 전에는 행동 영향 0(§5).
        let replayPassed = entry.kind !== 'operating_principle';
        if (entry.kind === 'operating_principle') {
          const past = [...m.promoted, ...m.candidates.filter((e) => e !== entry)].map((e) => e.statement);
          replayPassed = runReplay(entry, past);
          if (!replayPassed) {
            return sendJson(res, 200, { ok: false, reason: 'replay_failed', userSafeReason: '검토에서 과거와 충돌해 적용하지 않았어요.' });
          }
        }
        const r = promote(entry, { userConfirmed: true, replayPassed });
        if (!r.ok) return sendJson(res, 200, { ok: false, reason: r.reason });
        m.candidates.splice(idx, 1);
        m.promoted.push(r.entry);
        await memStore.save(m);
        // 권한 표면(감사 보정): 무엇을·어디에·되돌리기 가능한지 UI가 짧게 보여줄 근거.
        return sendJson(res, 200, {
          ok: true, kind: entry.kind, candidateId: r.entry.candidateId,
          statement: r.entry.statement, influenceScope: r.entry.influenceScope,
          reviewLevel: r.entry.reviewLevel, rollbackable: r.entry.rollbackable,
        });
      }
      if (req.method === 'POST' && url === '/memory/rollback') {
        // 반영 철회 — "반영하기"가 있으면 "잘못 반영 시 되돌릴 길"도 같은 수준(감사 지적). promoted에서 빼면
        //   다음 턴부터 admittedContext에 안 들어간다(영향 사라짐). rollbackable=false(고정 원칙 등)는 거부.
        const input = JSON.parse((await readBody(req)) || '{}');
        const cid = input.candidateId ?? input.id;
        const m = await memStore.load();
        const idx = m.promoted.findIndex((e) => e.candidateId === cid);
        if (idx < 0) return sendJson(res, 200, { ok: true, rolledBack: false, reason: 'not_found' });
        if (m.promoted[idx].rollbackable === false) return sendJson(res, 200, { ok: false, rolledBack: false, reason: 'not_rollbackable' });
        const [removed] = m.promoted.splice(idx, 1);
        await memStore.save(m);
        return sendJson(res, 200, { ok: true, rolledBack: true, statement: removed.statement });
      }

      // ── 학습(Learning-to-Workflow, P6-11) ── 후보 → 승인+replay → 승격(영향) → 되돌리기.
      if (req.method === 'GET' && url === '/patterns') {
        const a = await traceStore.load();
        return sendJson(res, 200, {
          proposed: a.proposed.map((p) => ({ patternId: p.patternId, kind: p.kind, tool: p.tool, target: p.target, scope: p.scope ?? 'global' })),
          promoted: a.promoted.map((p) => ({ kind: p.kind, tool: p.tool, target: p.target, scope: p.scope ?? 'global' })),
          traceCount: a.traces.length,
        });
      }
      // 승격: 승인 + replay 게이트를 통과해야 promoted(영향)로. 실패하면 승격하지 않고 정직하게 알린다.
      if (req.method === 'POST' && url === '/patterns/confirm') {
        const input = JSON.parse((await readBody(req)) || '{}');
        const a = await traceStore.load();
        const idx = a.proposed.findIndex((p) => p.patternId === input.patternId);
        if (idx < 0) return sendJson(res, 404, { error: '학습 후보를 찾지 못했어요.' });
        const pat = a.proposed[idx];
        const replay = replayDefaultTarget(pat); // 승격 전 재현 검증(영향 전 게이트)
        if (!replay.ok) {
          return sendJson(res, 200, { ok: false, reason: 'replay_failed', userSafeReason: replay.reason });
        }
        a.proposed.splice(idx, 1);
        // 같은 도구의 기존 기본은 대체(하나만 유지).
        a.promoted = a.promoted.filter((p) => !(p.kind === 'default_target' && p.tool === pat.tool));
        const prom = promoteDefaultTarget(pat, Date.now());
        a.promoted.push(prom);
        await traceStore.save(a);
        return sendJson(res, 200, { ok: true, kind: pat.kind, tool: pat.tool, target: pat.target, scope: prom.scope });
      }
      // 되돌리기: 잘못 배운 기본 대상을 제거한다(영향 제거). 다음부터 다시 대상을 확인한다.
      if (req.method === 'POST' && url === '/patterns/rollback') {
        const input = JSON.parse((await readBody(req)) || '{}');
        const a = await traceStore.load();
        const before = a.promoted.length;
        a.promoted = a.promoted.filter((p) => !(p.kind === 'default_target' && p.tool === input.tool));
        if (a.promoted.length !== before) await traceStore.save(a);
        return sendJson(res, 200, { ok: true });
      }

      // ── 완료 검증 (Completion Contract, P6-13) ── 자연어 완료 기준 → 구조화 검증 → VerificationReceipt.
      //   완료 = "생성했다"가 아니라 검증 통과. 실패면 무엇이 안 맞는지, 중단 기준이면 멈추고 묻는다.
      if (req.method === 'POST' && url === '/verify') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.criteria !== 'string' || !input.criteria.trim()) return sendJson(res, 400, { error: '완료 기준이 필요해요.' });
        const contract = parseCompletionCriteria(input.criteria);
        const receipt = verifyCompletion(contract, input.artifact ?? {});
        return sendJson(res, 200, { contract, receipt });
      }

      // ── 전달 원장 (Delivery Ledger, P6-14) ── 생성≠전달. 실패 시 기존 산출물 재전달(처음부터 아님).
      if (req.method === 'GET' && url === '/deliveries') {
        // 세션별 조회만 — 다른 대화의 전달은 보이지 않는다(권한 경계). sessionId 없으면 열지 않는다.
        const sessionId = new URL(req.url, 'http://x').searchParams.get('sessionId');
        if (typeof sessionId !== 'string' || !sessionId) return sendJson(res, 400, { error: '세션 없음' });
        const a = await deliveryStore.load();
        const strip = (d) => ({ id: d.id, tool: d.tool, target: d.target, state: d.state, attempts: d.attempts, retriable: isRetriable(d), needsFix: d.needsFix ?? false, lastResult: d.lastError?.failureState ?? null });
        return sendJson(res, 200, { deliveries: a.deliveries.filter((d) => d.sessionId === sessionId).map(strip) });
      }
      // 재전달: 이미 만든 산출물(artifact)을 그대로 다시 보낸다 — 재생성하지 않는다. 외부 전송은 원 승인 범위의
      //   재전달(A2 유지). 전달 확인(delivered) 이후에만 완료로 본다.
      if (req.method === 'POST' && url.startsWith('/deliveries/') && url.endsWith('/retry')) {
        const id = url.slice('/deliveries/'.length, -'/retry'.length);
        // 재전달 계약: same session + same approved artifact + same target + explicit user retry.
        //   세션 검증을 tools.run 전에 모두 통과시킨다 — 세션 없음/다른 세션은 tool call 0(외부 전송 A2 경계).
        const body = JSON.parse((await readBody(req)) || '{}');
        const sessionId = body.sessionId;
        if (typeof sessionId !== 'string' || !sessionId) return sendJson(res, 400, { error: '세션 없음' });
        const a = await deliveryStore.load();
        const idx = a.deliveries.findIndex((d) => d.id === id);
        if (idx < 0) return sendJson(res, 404, { error: '전달 기록을 찾지 못했어요.' });
        const d = a.deliveries[idx];
        if (d.sessionId !== sessionId) return sendJson(res, 403, { error: '다른 대화의 전달이라 여기서 다시 보낼 수 없어요.' });
        if (d.state === 'delivered') return sendJson(res, 200, { ok: true, state: 'delivered', alreadyDelivered: true });
        // 저장된 산출물을 그대로 재전달(재생성 없음). 실행 가능 게이트를 그대로 탄다.
        const selfState = buildSelfState(env);
        const rec = await tools.run(d.tool, { text: d.artifact?.text, target: d.target }, selfState);
        a.deliveries[idx] = applyDeliveryResult(d, rec.failureState, rec.userSafeSummary, Date.now());
        await deliveryStore.save(a);
        return sendJson(res, 200, { ok: rec.failureState === 'none', state: a.deliveries[idx].state, userSafeSummary: a.deliveries[idx].lastError?.userSafeSummary ?? '다시 보냈어요.' });
      }

      // ── 도구함 (2.0-A 상태 기반 표면) ── UI는 실제 runtime 상태만 본다(감사 §5.5·§10.1).
      if (req.method === 'GET' && url === '/toolbox') {
        const descriptors = deps.descriptors ?? demoDescriptors();
        const { tools: personalTools } = await personalStore.load(); // 2.0-C: 개인 도구 함께
        return sendJson(res, 200, projectToolbox(buildSelfState(env), descriptors, personalTools));
      }

      // ── 개인 도구 (2.0-C-1) ── 등록됨 ≠ 실행 가능. 설정 확인 통과 전에는 executable=false.
      if (req.method === 'POST' && url === '/personal-tools') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.label !== 'string' || !input.label.trim()) return sendJson(res, 400, { error: '도구 이름이 필요해요.' });
        const a = await personalStore.load();
        const tool = definePersonalTool({ id: randomUUID(), label: input.label.trim(), kind: input.kind, config: input.config, now: Date.now() });
        a.tools.push(tool);
        await personalStore.save(a);
        // 등록 직후엔 테스트 전 — 사용 가능처럼 보이지 않게 정직하게 반환.
        return sendJson(res, 200, { ok: true, id: tool.id, testState: tool.testState, executable: false });
      }
      // 설정 확인: 통과하면 executable, 실패하면 이유·다음 안전 행동을 정직하게.
      if (req.method === 'POST' && url.startsWith('/personal-tools/') && url.endsWith('/test')) {
        const id = url.slice('/personal-tools/'.length, -'/test'.length);
        const a = await personalStore.load();
        const idx = a.tools.findIndex((t) => t.id === id);
        if (idx < 0) return sendJson(res, 404, { error: '개인 도구를 찾지 못했어요.' });
        const probe = runProbe(a.tools[idx]);
        a.tools[idx] = applyProbe(a.tools[idx], probe, Date.now());
        await personalStore.save(a);
        return sendJson(res, 200, {
          ok: probe.ok, testState: a.tools[idx].testState, executable: probe.ok,
          reason: probe.ok ? undefined : probe.reason, nextSafeAction: probe.ok ? undefined : probe.nextSafeAction,
        });
      }

      // ── 커넥터 / 멀티채널 (P6-2 Slice-3) ──
      if (req.method === 'GET' && url === '/connectors') {
        // auth(자격)과 approval(전송)을 두 축으로 보여준다(원시 축 — 내부/디버그 뷰).
        const connectors = (deps.connectors ?? demoConnectors()).map((p) => ({
          id: p.id, label: p.label, kind: p.kind, authState: p.authState,
          readiness: connectorReadiness(p), sendNeedsApproval: sendNeedsApproval(),
        }));
        return sendJson(res, 200, { connectors });
      }
      // ── 첫 실행 온보딩 (P-ONB-2) ── **서버측 단일 진실**: 연결 0개 && 건너뛴 적 없음일 때만 필요.
      //   URL 쿼리로 판정하지 않는다(T3 실사고). 건너뛰기는 영속 — 다시 조르지 않는다.
      if (req.method === 'GET' && url === '/onboarding') {
        const state = await onboardingStore.load();
        const connStatus = deps.modelConnection?.status?.() ?? {};
        return sendJson(res, 200, {
          needed: onboardingNeeded(state, connStatus),
          skipped: Boolean(state.skippedAt),
          seenWelcome: Boolean(state.seenWelcome),
          canConnect: Boolean(deps.modelConnection),
        });
      }
      if (req.method === 'POST' && url === '/onboarding/skip') {
        await onboardingStore.patch({ skippedAt: new Date().toISOString() });
        return sendJson(res, 200, { ok: true, needed: false });
      }
      // ── 웰컴/첫 응답 (P-ONB-2) ── 인사말은 모델이 만든다(하드코딩 아님). 미연결이면 지어내지 않는다.
      if (req.method === 'POST' && url === '/welcome') {
        const { sessionId } = JSON.parse((await readBody(req)) || '{}');
        // 인사는 **빈 대화에서만** 한다. 이미 오간 대화에 첫인사가 끼어들면 흐름을 끊는다
        // (라이브 실측에서 발견: 진행 중이던 대화 한가운데 인사가 붙었다).
        if (typeof sessionId === 'string') {
          const existing = await store.load(sessionId);
          if (existing?.transcript?.length) return sendJson(res, 200, { state: 'skipped_existing' });
        }
        const connStatus = deps.modelConnection?.status?.() ?? {};
        const selfState = buildSelfState(env);
        let result;
        try {
          result = await makeWelcome({ model, selfState, connected: Boolean(connStatus.connected) });
        } catch (err) {
          // 모델이 실패해도 인사를 지어내지 않는다 — 정직하게 안내한다(§6.20 회복 표면).
          console.error('[welcome:diagnostic]', err?.stack ?? err);
          return sendJson(res, 200, {
            state: 'not_connected',
            userSafeSummary: '지금은 모델에 연결하지 못했어요.',
            nextSafeAction: '모델 연결을 확인하면 이어서 도와드릴게요.',
          });
        }
        if (result.state === 'greeted') {
          if (typeof sessionId === 'string') {
            // 숨은 지시는 남기지 않는다 — 사용자 발화로 위장하지 않는다. assistant 결과만 지속.
            const session = await store.load(sessionId);
            if (session) {
              session.transcript.push({ role: 'assistant', result: { kind: 'reply', reply: result.text } });
              await store.save(session);
            }
          }
          // **인사를 실제로 한 경우에만** 1회성 표식을 남긴다(라이브 실측에서 발견: 미연결 상태로
          // 한 번 열었다고 표식이 켜지면, 나중에 연결해도 첫인사를 영영 못 받는다).
          await onboardingStore.patch({ seenWelcome: true });
        }
        return sendJson(res, 200, result);
      }
      // ── 모델 doctor (P-RT-2) ── "구성됨→검증됨". 요청 시 재검증(과금 없는 목록 GET), 사용자 언어 리포트.
      //   doctor 미배선 구성(demo 등)은 검증 안 됨을 검증됨처럼 말하지 않는다(stub/unverified).
      if (req.method === 'GET' && url === '/model/health') {
        if (deps.modelDoctor) return sendJson(res, 200, await deps.modelDoctor());
        return sendJson(res, 200, describeUnprobedModel(env.model));
      }
      // ── 모델 연결 (P-RT-4 → P-ONB-2) ── 화면에서 키 연결. 저장 정책은 **확실한 무효만 거절**:
      //   usable 은 검증됨으로 저장·활성, unreachable/rate_limited 는 저장하되 verified:false("모델 확인
      //   필요"), auth_failed/model_missing/billing_blocked 는 저장하지 않는다(기존 연결 불가침).
      //   응답에 원본 키·원문 진단 미노출(마스킹·사용자 언어만).
      if (req.method === 'GET' && url === '/model/connection') {
        if (deps.modelConnection) return sendJson(res, 200, deps.modelConnection.status());
        return sendJson(res, 200, { connected: false, source: 'none', provider: null, modelId: null, keyMasked: null });
      }
      // ── 다중 연결 (P-ONB-1) ── 여러 개 보관 → 기본 선택 / 역할별 바인딩. 목록엔 마스킹만 나간다.
      //   역할 바인딩은 선택이지 허용목록이 아니다 — 없으면 조용히 기본으로 간다(T3 allowlist 사고 방지).
      if (req.method === 'GET' && url === '/model/connections') {
        if (!deps.modelConnection?.list) return sendJson(res, 200, { connections: [], activeId: null, roleBindings: {} });
        return sendJson(res, 200, deps.modelConnection.list());
      }
      if (req.method === 'POST' && url === '/model/connections/activate') {
        if (!deps.modelConnection?.activate) return sendJson(res, 400, { error: '이 구성에서는 모델 연결을 바꿀 수 없어요.' });
        const { id } = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, await deps.modelConnection.activate(id));
      }
      if (req.method === 'POST' && url === '/model/connections/bind') {
        if (!deps.modelConnection?.bind) return sendJson(res, 400, { error: '이 구성에서는 모델 연결을 바꿀 수 없어요.' });
        const { role, id } = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, await deps.modelConnection.bind(role, id ?? null));
      }
      if (req.method === 'POST' && url === '/model/connections/remove') {
        if (!deps.modelConnection?.remove) return sendJson(res, 400, { error: '이 구성에서는 모델 연결을 바꿀 수 없어요.' });
        const { id } = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, await deps.modelConnection.remove(id));
      }
      if (req.method === 'POST' && url === '/model/connect') {
        if (!deps.modelConnection) return sendJson(res, 400, { error: '이 구성에서는 모델 연결을 바꿀 수 없어요.' });
        const input = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, await deps.modelConnection.connect(input));
      }
      // ── ChatGPT 계정 연결 (P-RT-3) ── 로그인은 사용자가 브라우저에서 직접 한다(주소만 제공).
      //   비공식 경로임을 화면에 고지한다. 토큰은 응답에 절대 싣지 않는다.
      if (req.method === 'POST' && url === '/model/chatgpt/login') {
        if (!deps.modelConnection?.startChatGptLogin) return sendJson(res, 400, { error: '이 구성에서는 계정 연결을 쓸 수 없어요.' });
        try {
          return sendJson(res, 200, await deps.modelConnection.startChatGptLogin());
        } catch (err) {
          console.error('[oauth:diagnostic]', err?.stack ?? err);
          return sendJson(res, 200, { error: '로그인 창을 열지 못했어요(다른 로그인이 진행 중일 수 있어요).' });
        }
      }
      if (req.method === 'POST' && url === '/model/chatgpt/await') {
        if (!deps.modelConnection?.awaitChatGptLogin) return sendJson(res, 400, { error: '이 구성에서는 계정 연결을 쓸 수 없어요.' });
        const r = await deps.modelConnection.awaitChatGptLogin();
        // 실패 원문은 진단용 — 사용자에겐 사용자 언어만.
        return sendJson(res, 200, {
          connected: r.connected,
          userSafeSummary: r.connected ? '연결됐어요. 이제 ChatGPT 계정으로 답해요.' : '연결을 완료하지 못했어요.',
          nextSafeAction: r.connected ? undefined : '다시 시도해 주세요.',
        });
      }
      if (req.method === 'POST' && url === '/model/disconnect') {
        if (!deps.modelConnection) return sendJson(res, 400, { error: '이 구성에서는 모델 연결을 바꿀 수 없어요.' });
        return sendJson(res, 200, await deps.modelConnection.disconnect());
      }
      // ── 채널 레지스트리 (P6-16 Slice-1) ── 사용자 안전 상태 + doctor 진단(사용자 언어). 정리·표면화만.
      //   내부 readiness 코드가 아니라 "받을 준비됨/로그인 필요/연결 필요"로. 미연결·미자격은 초록 아님.
      if (req.method === 'GET' && url === '/channels') {
        return sendJson(res, 200, { channels: projectChannels(deps.channels ?? demoChannels()) });
      }
      // ── 상태 요약 (P6-18 Slice-1) ── 조용한 단일 진입점(읽기 전용). 안티 대시보드: 열 때만 본다.
      //   누적된 "반드시 구분"을 구조로: 연결↔가능·추천↔활성·추정↔반영·실패↔완료. 이미 만든 projection 조합만.
      if (req.method === 'GET' && url === '/overview') {
        const sessionId = new URL(req.url, 'http://x').searchParams.get('sessionId');
        const channels = projectChannels(deps.channels ?? demoChannels());
        const skillsData = await skillStore.load();
        const skills = skillsData.skills.map((s) => ({ id: s.id, label: s.label, state: s.state }));
        const memoryState = await memStore.load();
        const userModel = projectUserModel(memoryState);
        // 반영된 검색 기억(recalled_context)도 "반영 중"으로 함께 표면화 — 선호와 같은 자리서 보고 되돌린다.
        const memories = (memoryState.promoted ?? []).filter((e) => e.kind === 'recalled_context').map((e) => ({ candidateId: e.candidateId, statement: e.statement }));
        const dl = await deliveryStore.load();
        // 전달은 세션 소유(§6.13) — sessionId 있을 때만 그 세션 것을 본다. id는 재전달 액션에 쓴다.
        const deliveries = sessionId ? dl.deliveries.filter((d) => d.sessionId === sessionId).map((d) => ({ id: d.id, tool: d.tool, target: d.target, state: d.state })) : [];
        return sendJson(res, 200, buildOverview({ channels, skills, userModel, deliveries, memories }));
      }
      // ── 세션 검색 (P6-17 Slice-1) ── 과거 대화 회수. **결과는 후보로만 나온다(admitted:false, 영향 0).**
      //   turn을 돌리지 않고 모델에 먹이지 않는다 — 라우터·answer에 raw로 섞이지 않게. 승격은 별도 admission.
      if (req.method === 'POST' && url === '/search') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.query !== 'string' || !input.query.trim()) return sendJson(res, 400, { error: '검색어가 필요해요.' });
        const sessions = await store.loadAll();
        const hits = searchTranscripts(sessions, input.query);
        const results = projectSearchCandidates(hits, () => randomUUID());
        // admitted:false를 명시적으로 보장(표면이 "이미 반영됨"으로 오해하지 않게).
        return sendJson(res, 200, { query: input.query, results, admittedIntoContext: false });
      }
      // 검색 결과 반영 — **찾은 기억은 아직 반영된 기억이 아니다(§6.16).** 사용자가 명시로 admit할 때만
      //   admission(context-mesh promote, userConfirmed)을 태워 promoted로 → 이후 관련 대화에 좁게 입장.
      if (req.method === 'POST' && url === '/search/admit') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.statement !== 'string' || !input.statement.trim()) return sendJson(res, 400, { error: '반영할 내용이 필요해요.' });
        const memory = await memStore.load();
        const stmt = input.statement.trim();
        // 이미 반영된 같은 회수 기억이면 중복 반영하지 않는다. **단 되돌리기용 candidateId는 반드시 함께 준다**
        //   — 안 주면 UI가 "반영됨"으로 보이는데 되돌리기 id가 없어 못 되돌린다(반영↔되돌리기 대칭 깨짐, 감사 blocker).
        const dup = (memory.promoted ?? []).find((e) => e.kind === 'recalled_context' && e.statement === stmt);
        if (dup) {
          return sendJson(res, 200, { admitted: true, already: true, candidateId: dup.candidateId, statement: stmt });
        }
        const cand = makeSearchCandidate({ snippet: stmt, sessionId: input.source?.sessionId, title: input.source?.title, role: input.source?.role }, randomUUID());
        const result = promote(cand, { userConfirmed: true }); // §6.16 admission — 자동 아님, 사용자 확인
        if (!result.ok) return sendJson(res, 200, { admitted: false, reason: result.reason });
        memory.promoted = [...(memory.promoted ?? []), result.entry];
        await memStore.save(memory);
        // candidateId를 함께 준다 — "반영하기"가 있으면 "되돌리기"(POST /memory/rollback)도 같은 수준으로(감사 지적).
        return sendJson(res, 200, { admitted: true, candidateId: result.entry.candidateId, statement: result.entry.statement });
      }
      // ── 스킬 학습 (P6-17 Slice-2) ── SkillCandidate lifecycle. **추천 ≠ 실행/승격. replay+확인 전 영향 0.**
      //   스킬은 자동 실행 권한이 없다(외부 행동은 여전히 A2). UI는 최소 표면.
      const skillView = (s) => ({ id: s.id, label: s.label, state: s.state, trigger: s.trigger, steps: s.steps, tool: s.tool, canInfluence: canInfluence(s), canAutoExecute: canAutoExecute() });
      if (req.method === 'GET' && url === '/skills') {
        const a = await skillStore.load();
        return sendJson(res, 200, { skills: a.skills.map(skillView) });
      }
      // 반복 신호에서 스킬 후보를 감지해 표면화(candidate 상태, 영향 0). 자동 승격 아님.
      if (req.method === 'POST' && url === '/skills/detect') {
        const learning = await traceStore.load();
        const detected = detectSkillCandidate(learning.traces, { id: randomUUID(), now: Date.now() });
        if (!detected) return sendJson(res, 200, { detected: false });
        const a = await skillStore.load();
        // 같은 도구의 미종료(비 rejected) 후보가 이미 있으면 중복 제안하지 않는다.
        if (a.skills.some((s) => s.tool === detected.tool && s.state !== 'rejected')) return sendJson(res, 200, { detected: false, reason: 'already_proposed' });
        const surfaced = surfaceCandidate(detected); // detected → candidate(추천 표면화)
        a.skills.push(surfaced);
        await skillStore.save(a);
        return sendJson(res, 200, { detected: true, skill: skillView(surfaced) });
      }
      // 승인: 사용자 확인 + replay 통과해야 admitted. replay 실패면 rejected(영향 0). lifecycle을 코드가 강제.
      if (req.method === 'POST' && url.startsWith('/skills/') && url.endsWith('/approve')) {
        const id = url.slice('/skills/'.length, -'/approve'.length);
        const a = await skillStore.load();
        const idx = a.skills.findIndex((s) => s.id === id);
        if (idx < 0) return sendJson(res, 404, { error: '스킬 후보를 찾지 못했어요.' });
        let sk = markReplayRequired(a.skills[idx]);       // candidate → replay_required
        const appr = approveSkill(sk, { userConfirmed: true, replayResult: replaySkill(sk) });
        if (!appr.ok) { a.skills[idx] = appr.sk; await skillStore.save(a); return sendJson(res, 200, { ok: false, state: appr.sk.state, reason: appr.reason }); }
        const adm = admitSkill(appr.sk);                  // approved → admitted
        a.skills[idx] = adm.sk;
        await skillStore.save(a);
        return sendJson(res, 200, { ok: true, state: adm.sk.state, skill: skillView(adm.sk) });
      }
      // ── 사용자 모델 (P6-17 Slice-3) ── "추정된 성향"과 "승인된 운영 선호"를 분리. **추정은 관찰만(영향 0)**,
      //   운영 선호만 userConfirmed 후 admittedContext에 좁게 입장. UI는 최소 API(표면 분리는 P6-18).
      if (req.method === 'GET' && url === '/user-model') {
        const memory = await memStore.load();
        return sendJson(res, 200, projectUserModel(memory)); // {inferredTraits(영향0), operatingPreferences(pending/admitted)}
      }
      // 추정 성향 기록 — observed 레인(관찰 전용). 승격 대상 아님. admittedContext에 절대 안 들어간다.
      if (req.method === 'POST' && url === '/user-model/traits') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.statement !== 'string' || !input.statement.trim()) return sendJson(res, 400, { error: '추정 내용이 필요해요.' });
        const memory = await memStore.load();
        const trait = makeInferredTrait(randomUUID(), input.statement.trim(), input.evidence ?? []);
        memory.observed = [...(memory.observed ?? []), trait];
        await memStore.save(memory);
        return sendJson(res, 200, { trait: { statement: trait.statement, admitted: false, influence: 'none' } });
      }
      // 운영 선호 후보 등록(candidate, 영향 0). 확인 전까지 admittedContext에 안 들어간다.
      if (req.method === 'POST' && url === '/user-model/preferences') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.statement !== 'string' || !input.statement.trim()) return sendJson(res, 400, { error: '운영 선호 내용이 필요해요.' });
        const memory = await memStore.load();
        const pref = makeOperatingPreference(randomUUID(), input.statement.trim());
        memory.candidates = [...(memory.candidates ?? []), pref];
        await memStore.save(memory);
        return sendJson(res, 200, { preference: { id: pref.candidateId, statement: pref.statement, status: 'pending_confirm', admitted: false } });
      }
      // 운영 선호 승인 — userConfirmed로 승격(candidates→promoted). 이후 관련될 때만 좁게 입장.
      if (req.method === 'POST' && url.startsWith('/user-model/preferences/') && url.endsWith('/confirm')) {
        const id = url.slice('/user-model/preferences/'.length, -'/confirm'.length);
        const memory = await memStore.load();
        const idx = (memory.candidates ?? []).findIndex((c) => c.candidateId === id && c.kind === 'operating_preference');
        if (idx < 0) return sendJson(res, 404, { error: '운영 선호 후보를 찾지 못했어요.' });
        const result = confirmOperatingPreference(memory.candidates[idx]);
        if (!result.ok) return sendJson(res, 200, { ok: false, reason: result.reason });
        memory.candidates = memory.candidates.filter((_, i) => i !== idx);
        memory.promoted = [...(memory.promoted ?? []), result.entry];
        await memStore.save(memory);
        return sendJson(res, 200, { ok: true, status: 'admitted', statement: result.entry.statement });
      }
      // 거절: 후보를 rejected로(영향 0 영구).
      if (req.method === 'POST' && url.startsWith('/skills/') && url.endsWith('/reject')) {
        const id = url.slice('/skills/'.length, -'/reject'.length);
        const a = await skillStore.load();
        const idx = a.skills.findIndex((s) => s.id === id);
        if (idx < 0) return sendJson(res, 404, { error: '스킬 후보를 찾지 못했어요.' });
        a.skills[idx] = rejectSkill(a.skills[idx], 'user_rejected');
        await skillStore.save(a);
        return sendJson(res, 200, { ok: true, state: 'rejected' });
      }
      // 채널 인바운드 — 채널이 달라도 같은 OS 흐름을 탄다. 게이트 순서(감사 보정):
      //   1 sessionId 존재 → 2 channel 필드 → 3 registry 확인 → 4 readiness==ok → 5 정규화
      //   → 6 InboundEventGate(mention/allowlist/DM) → 7 respond일 때만 turn → 8 gated/blocked 미기록.
      if (req.method === 'POST' && url === '/channel/inbound') {
        const input = JSON.parse((await readBody(req)) || '{}');
        if (typeof input.text !== 'string' || !input.text.trim()) return sendJson(res, 400, { error: '빈 발화' });
        if (typeof input.sessionId !== 'string') return sendJson(res, 400, { error: '세션 없음' });
        const session = await store.load(input.sessionId);
        if (!session) return sendJson(res, 404, { error: '세션을 찾지 못했어요.' });
        // 2·3·4: 등록된 채널이고 연결이 ok일 때만 커널로 넘긴다. 아니면 blocked(미기록).
        if (typeof input.channel !== 'string' || !input.channel) {
          return sendJson(res, 200, { kind: 'blocked', reason: 'no_channel' });
        }
        const profile = (deps.connectors ?? demoConnectors()).find((c) => c.id === input.channel);
        if (!profile) return sendJson(res, 200, { kind: 'blocked', reason: 'unknown_channel' });
        const readiness = connectorReadiness(profile);
        if (readiness !== 'ok') return sendJson(res, 200, { kind: 'blocked', reason: 'channel_not_ready', readiness });

        // Phase 0-5: 채널이 선언한 수신 정책을 레지스트리에서 읽어 이벤트에 싣는다.
        //   이게 없으면 게이트가 정책을 볼 수 없어 allowlist_only 채널도 mention 하나로 열린다.
        const registered = (deps.channels ?? demoChannels()).find((c) => c.id === input.channel);
        const event = normalizeInboundEvent({
          ...input,
          inboundPolicy: registered?.inboundPolicy,
          connected: readiness === 'ok',
        }); // 5: 단일 정규화 이벤트
        const memory = await memStore.load();
        const ctx = ctxForSession(session, memory);
        // 6·7: 같은 커널. source=external_channel → InboundEventGate → (respond면) turn.
        const result = await runTurn({
          text: input.text, source: 'external_channel',
          triggerSignals: event.triggerSignals,
          channelPolicy: event.channelPolicy, channelConnected: event.channelConnected,
        }, ctx);
        // 8: gated/blocked는 대화에 남기지 않는다(조용히, 알림 콘솔화 방지). respond면 지속.
        if (result.kind === 'reply' || result.kind === 'approval' || result.kind === 'clarify') {
          session.transcript.push({ role: 'user', text: input.text, channel: event.channelMeta.channel });
          session.transcript.push({ role: 'assistant', result });
          session.ledgerEntries = ctx.ledger.entries;
          session.pendingApprovals = Object.fromEntries(ctx.pending);
          if (result.goal) session.activeGoal = result.goal;
          await store.save(session);
        }
        return sendJson(res, 200, { ...result, channelMeta: event.channelMeta });
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    } catch (err) {
      sendJson(res, 500, { error: '처리 중 문제가 있었어요.' });
      console.error('[turn:diagnostic]', err?.stack ?? err);
    }
  });
  // in-process 스케줄러가 부를 트러스트 tick(§8.3). HTTP를 거치지 않고 직접 실행 — 구성상 trusted.
  // P-ID-1: 문서를 읽고(없으면 오너 원문으로 시드) 능력 파생 구역을 지금 상태로 다시 만든다.
  server.loadSelfhood = async () => {
    const capabilities = await selfhoodStore.refreshCapabilities(buildSelfState(env));
    const loaded = await selfhoodStore.load();
    selfhoodDocs = { soul: loaded.soul, capabilities };
    identity = loaded.identity;
    return { identity, selfhoodDocs };
  };
  server.runtimeTick = () => runTrustedTick({ source: 'trusted_runtime_event' });
  return server;
}

/**
 * 라이브 서버 부팅(P-RT-4 감사 B2로 추출·테스트 가능화). **저장된 모델 연결 복원은 listen 전에
 * 끝난다** — 재시작 직후 첫 요청이 잠깐 stub/env 로 처리되는 창을 없앤다(사용자 기대: 재시작해도
 * 저장 연결 유지). 복원 실패는 부팅을 막지 않는다(정직 표시로 폴백).
 * 라이브 서버는 실제 어댑터를 쓴다(P6-5 웹 · P6-6 채널). 자격 상태를 env·tools에 함께 반영(단일 진실).
 * @param {{port?:number, processEnv?:Object, sessionStore?:SessionStore, connectionStore?:ModelConnectionStore,
 *          fetchImpl?:Function, startScheduler?:boolean}} [opts]
 */
export async function startLiveServer(opts = {}) {
  const processEnv = opts.processEnv ?? process.env;
  const bootStore = opts.sessionStore ?? new SessionStore();
  // P-RT-4: 세션 store 와 같은 디렉터리에 사용자 모델 연결을 지속한다(0600, 소스 트리 밖).
  const connectionStore = opts.connectionStore ?? new ModelConnectionStore(bootStore.dir);
  const { env: liveEnv, tools: liveTools, channels: liveChannelList, connectors: liveConnectorList,
    descriptors: liveDescriptors,
    model: liveModel, modelDoctor, modelConnection, modelSupportsSearch } =
    liveDeps(processEnv, { connectionStore, fetchImpl: opts.fetchImpl });
  // 채널도 실제 자격에서 파생한 것을 넘긴다 — /channels가 fixture(demoChannels)로 초록 오표시 하지 않게(P6-16 보정).
  // 모델도 같은 원칙(P-RT-1): 자격이 구성되면 실 provider, 아니면 stub — env.model과 단일 진실.
  const server = makeServer({
    store: bootStore, env: liveEnv, tools: liveTools,
    channels: liveChannelList, connectors: liveConnectorList, // 자격도 실제에서 — fixture 폴백 금지
    descriptors: liveDescriptors,                             // 선언도 실제 손이 있는 것만
    model: liveModel, modelDoctor, modelConnection, modelSupportsSearch,
  });
  // 감사 B2: 저장 연결 복원을 listen **전에** 시도한다. 실패해도 부팅은 계속.
  try { await modelConnection.init(); } catch { /* 복원 실패 → env/stub 정직 폴백 */ }
  try { await server.loadSelfhood(); } catch { /* 문서 준비 실패 → 기본 정체로 계속(차단하지 않는다) */ }
  const port = opts.port ?? Number(processEnv.PORT ?? 4173);
  await new Promise((resolve) => server.listen(port, resolve));
  // P-RT-2 부팅 점검(비차단): 구성됨→검증됨. 게이트가 아니라 정직한 표시.
  modelDoctor()
    .then((r) => console.log(`[model:doctor] ${r.state}${r.modelId ? ` (${r.modelId})` : ''} — ${r.userSafeSummary}`))
    .catch(() => {});
  if (opts.startScheduler !== false) {
    // in-process 반복 스케줄러(§8.3). trusted_runtime_event로만 tick을 돈다. cron/daemon 아님(unref).
    const tickMs = Number(processEnv.GPAO_T5_TICK_MS ?? 60_000);
    new AutomationScheduler({ onTick: () => server.runtimeTick(), intervalMs: tickMs }).start();
  }
  return server;
}

// 직접 실행할 때만 listen 한다(import 시 부작용 없음).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startLiveServer().then((server) => {
    const { port } = server.address();
    console.log(`GPAO-T5 Work Chat (slice-2 living) → http://localhost:${port}`);
  }).catch((err) => {
    console.error('[boot:diagnostic]', err?.stack ?? err);
    process.exit(1);
  });
}
