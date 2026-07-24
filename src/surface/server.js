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
import { runTurn } from '../kernel/turn.js';
import { TruthLedger } from '../kernel/l0-evidence/ledger.js';
import { StubModelClient } from '../runtime/model-client.js';
import { demoEnv, demoTools } from './demo-context.js';
import { SessionStore } from './session-store.js';

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
  const env = deps.env ?? demoEnv();
  const model = deps.model ?? new StubModelClient();
  const tools = deps.tools ?? demoTools();
  // 세션별 라이브 pending(승인 대기 계획). 지속하지 않는다 — 프로세스 수명 동안만.
  const livePending = new Map();

  function ctxForSession(session) {
    const ledger = new TruthLedger();
    ledger.entries = (session.ledgerEntries ?? []).slice();
    let pending = livePending.get(session.id);
    if (!pending) { pending = new Map(); livePending.set(session.id, pending); }
    return { env, model, tools, ledger, pending };
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
        return sendJson(res, 200, { id: s.id, title: s.title, transcript: s.transcript });
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

        const ctx = ctxForSession(session);
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
        await store.save(session);
        return sendJson(res, 200, result);
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
