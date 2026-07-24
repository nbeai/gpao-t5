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
import { StubModelClient } from '../runtime/model-client.js';
import { demoEnv, demoTools } from './demo-context.js';
import { SessionStore } from './session-store.js';
import { MemoryStore } from './memory-store.js';
import { makeCandidate, runReplay, promote } from '../kernel/l1-intent/context-mesh.js';
import { normalizeInboundEvent } from '../kernel/l1-intent/inbound-gate.js';
import { connectorReadiness, sendNeedsApproval } from '../kernel/l2-plan/connector-profile.js';
import { demoConnectors } from './demo-context.js';

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
  const env = deps.env ?? demoEnv();
  const model = deps.model ?? new StubModelClient();
  const tools = deps.tools ?? demoTools();

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

  return createServer(async (req, res) => {
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
        await store.save(session);
        return sendJson(res, 200, result);
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
}

// 직접 실행할 때만 listen 한다(import 시 부작용 없음).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4173);
  makeServer().listen(port, () => {
    console.log(`GPAO-T5 Work Chat (slice-2 living) → http://localhost:${port}`);
  });
}
