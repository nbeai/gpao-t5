// L4 · Work Chat 서버 — 얇은 HTTP 진입점. 의존성 0(node 내장만).
// GET /            → 채팅 화면
// POST /turn       → { text } | { approve } | { reject } (+ runningTask?, conflict?) → 턴 결과 JSON
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runTurn } from '../kernel/turn.js';
import { makeContext } from './demo-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

/**
 * Work Chat HTTP 서버를 만든다(listen 은 호출자가 한다 — 테스트가 부팅할 수 있게).
 * @param {import('../kernel/turn.js').TurnContext} [ctx]  기본은 데모 컨텍스트
 */
export function makeServer(ctx = makeContext()) {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        const html = await readFile(join(__dirname, 'web', 'index.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'POST' && req.url === '/turn') {
        const body = await readBody(req);
        const input = body ? JSON.parse(body) : {};
        // 유효한 입력: 발화(text) 또는 승인 재개(approve) 또는 거부(reject) 중 하나.
        const hasText = typeof input.text === 'string' && input.text.trim();
        const hasControl = typeof input.approve === 'string' || typeof input.reject === 'string';
        if (!hasText && !hasControl) {
          return sendJson(res, 400, { error: '빈 발화' });
        }
        const result = await runTurn(input, ctx);
        return sendJson(res, 200, result);
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    } catch (err) {
      // 서버 오류도 사용자면/진단면을 섞지 않는다.
      sendJson(res, 500, { error: '처리 중 문제가 있었어요.' });
      console.error('[turn:diagnostic]', err?.stack ?? err);
    }
  });
}

// 직접 실행할 때만 listen 한다(import 시 부작용 없음).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4173);
  makeServer().listen(port, () => {
    console.log(`GPAO-T5 Work Chat (slice-1) → http://localhost:${port}`);
  });
}
