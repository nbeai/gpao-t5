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
import { StubModelClient } from '../runtime/model-client.js';
import { demoEnv, demoTools } from './demo-context.js';
import { SessionStore } from './session-store.js';
import { MemoryStore } from './memory-store.js';
import { makeCandidate, runReplay, promote } from '../kernel/l1-intent/context-mesh.js';
import { normalizeInboundEvent } from '../kernel/l1-intent/inbound-gate.js';
import { connectorReadiness, sendNeedsApproval } from '../kernel/l2-plan/connector-profile.js';
import { demoConnectors } from './demo-context.js';
import { AutomationStore } from './automation-store.js';
import { makeGrowthCandidate, approveAutomation, cancelJob, admitTickTrigger } from '../kernel/l5-growth/automation.js';
import { tickAutomation } from '../runtime/automation-engine.js';
import { AutomationScheduler } from '../runtime/automation-scheduler.js';
import { makeWebCollector } from '../runtime/web-collector.js';

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
  const env = deps.env ?? demoEnv();
  const model = deps.model ?? new StubModelClient();
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

  // 승인 대기(pending)를 세션 파일에 지속한다(Approval Lifecycle). 기억(memory)·활성목표(activeGoal)를
  // ctx에 주입 — 라우터는 raw 기억을 쓰지 않고, admitted된 것만 좁게 입장한다(§5).
  function ctxForSession(session, memory) {
    const ledger = new TruthLedger();
    ledger.entries = (session.ledgerEntries ?? []).slice();
    const pending = new Map(Object.entries(session.pendingApprovals ?? {}));
    return {
      env, model, tools, ledger, pending,
      memory, activeGoal: session.activeGoal ?? null,
      newId: () => randomUUID(), now: () => Date.now(),
    };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? '').split('?')[0];

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

        const session = await store.load(input.sessionId);
        if (!session) return sendJson(res, 404, { error: '세션을 찾지 못했어요.' });

        const memory = await memStore.load();
        const ctx = ctxForSession(session, memory);
        // 첫 사용자 발화로 제목을 짓는다(ChatGPT식). 발화가 있으면 transcript에 남긴다.
        if (hasText) {
          if (!session.transcript.some((e) => e.role === 'user')) {
            session.title = input.text.trim().slice(0, 30);
          }
          session.transcript.push({ role: 'user', text: input.text });
        }
        const result = await runTurn(input, ctx);
        session.transcript.push({ role: 'assistant', result });
        session.ledgerEntries = ctx.ledger.entries; // 세션 원장 갱신(지속)
        session.pendingApprovals = Object.fromEntries(ctx.pending); // 승인 대기 지속(재시작 후 이어실행)
        if (result.goal) session.activeGoal = result.goal; // 현재 목표 유지(세션 간 좁게 복원)
        // 기억 승격 후보: 자동 승격하지 않고 후보로만 저장(중복 제외). 승격은 별도 confirm/replay.
        if (result.memorySuggestion) {
          const dup = [...memory.candidates, ...memory.promoted].some((e) => e.statement === result.memorySuggestion.statement);
          if (dup) {
            result.memorySuggestion = undefined; // 이미 아는 것은 다시 제안하지 않는다
          } else {
            const cand = makeCandidate(randomUUID(), result.memorySuggestion.kind, result.memorySuggestion.statement);
            memory.candidates.push(cand);
            await memStore.save(memory);
            result.memorySuggestion.candidateId = cand.candidateId; // UI 가 confirm 에 쓸 id
          }
        }
        // 자동화 후보(P6-3): 반복 신호를 조용히 후보로만 저장. 승인 전 실행·영향 0(중복 제외).
        if (result.automationSuggestion?.action) {
          const a = await autoStore.load();
          const dedupKey = result.automationSuggestion.statement;
          if (a.candidates.some((c) => c.statement === dedupKey && !c.approved)) {
            result.automationSuggestion = undefined; // 이미 제안한 것은 다시 제안하지 않는다
          } else {
            const cand = makeGrowthCandidate({
              candidateId: randomUUID(),
              statement: result.automationSuggestion.statement,
              action: result.automationSuggestion.action,
              dedupKey,
            });
            a.candidates.push(cand);
            await autoStore.save(a);
            result.automationSuggestion.candidateId = cand.candidateId; // UI 가 approve 에 쓸 id
          }
        } else if (result.automationSuggestion) {
          result.automationSuggestion = undefined; // action 없는 후보는 실행 불가 — 표면화하지 않음
        }
        await store.save(session);
        return sendJson(res, 200, result);
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
        const external = env.connections.find((c) => c.id === cand.action?.tool)?.needsApproval === true;
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
        const input = JSON.parse((await readBody(req)) || '{}');
        const m = await memStore.load();
        const before = m.promoted.length;
        m.promoted = m.promoted.filter((e) => e.candidateId !== input.candidateId);
        if (m.promoted.length !== before) await memStore.save(m);
        return sendJson(res, 200, { ok: true });
      }

      // ── 커넥터 / 멀티채널 (P6-2 Slice-3) ──
      if (req.method === 'GET' && url === '/connectors') {
        // auth(자격)과 approval(전송)을 두 축으로 보여준다.
        const connectors = (deps.connectors ?? demoConnectors()).map((p) => ({
          id: p.id, label: p.label, kind: p.kind, authState: p.authState,
          readiness: connectorReadiness(p), sendNeedsApproval: sendNeedsApproval(),
        }));
        return sendJson(res, 200, { connectors });
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

        const event = normalizeInboundEvent(input); // 5: 단일 정규화 이벤트
        const memory = await memStore.load();
        const ctx = ctxForSession(session, memory);
        // 6·7: 같은 커널. source=external_channel → InboundEventGate → (respond면) turn.
        const result = await runTurn({ text: input.text, source: 'external_channel', triggerSignals: event.triggerSignals }, ctx);
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
  server.runtimeTick = () => runTrustedTick({ source: 'trusted_runtime_event' });
  return server;
}

// 직접 실행할 때만 listen 한다(import 시 부작용 없음).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4173);
  // 라이브 서버는 실제 웹 수집 어댑터를 쓴다(P6-5). 테스트/기본 demoTools는 offline 스텁 유지.
  const server = makeServer({ tools: demoTools({ webCollector: makeWebCollector() }) });
  server.listen(port, () => {
    console.log(`GPAO-T5 Work Chat (slice-2 living) → http://localhost:${port}`);
  });
  // in-process 반복 스케줄러(§8.3). trusted_runtime_event로만 tick을 돈다. cron/daemon 아님(unref).
  const tickMs = Number(process.env.GPAO_T5_TICK_MS ?? 60_000);
  new AutomationScheduler({ onTick: () => server.runtimeTick(), intervalMs: tickMs }).start();
}
