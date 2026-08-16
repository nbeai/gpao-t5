// UX 정본 §4의 「못 본 여덟」을 실제 제품 HTML로 띄우고 보이는 글·행동 입구를 잰다.
// 서버 응답만 고정하며, 카드 DOM/CSS/렌더 함수는 복제하지 않는다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { 크롬띄우기 } from './ux-cdp.mjs';
import { 숨은표면고정물 } from './ux-hidden-fixtures.mjs';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 웹 = join(여기, '../../src/surface/web');
const 정적 = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/markdown.js', ['markdown.js', 'text/javascript; charset=utf-8']],
  ['/approval-state.js', ['approval-state.js', 'text/javascript; charset=utf-8']],
]);
const 고정물표 = new Map(숨은표면고정물.map((x) => [x.id, x]));

function 세션(고정물) {
  const transcript = [{ role: 'user', text: `${고정물.이름}을 보여줘` }];
  if (!고정물.recovery) transcript.push({ role: 'assistant', result: 고정물.result });
  return {
    id: 고정물.id, title: `고정물 · ${고정물.이름}`, updatedAt: '2026-08-13T00:00:00.000Z',
    transcript, activePendingIds: 고정물.activePendingIds ?? [],
  };
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
const 기다림 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function 고정물서버() {
  let 새대화저장됨 = false;
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (정적.has(u.pathname)) {
      const [name, type] = 정적.get(u.pathname);
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(await readFile(join(웹, name)));
      return;
    }
    if (req.method === 'GET' && u.pathname === '/sessions') {
      json(res, { sessions: 숨은표면고정물.map(세션) }); return;
    }
    const sessionMatch = /^\/sessions\/([^/]+)$/.exec(u.pathname);
    if (req.method === 'GET' && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      if (id === 'optimistic') {
        // 일부러 한 박자 전 스냅샷만 준다. 스트림으로 받은 말이 이 GET 때문에 사라지면 빨강이다.
        json(res, { id, title: '늦은 서버 스냅샷', updatedAt: '2026-08-13T00:00:00.000Z', transcript: [], activePendingIds: [] });
        return;
      }
      if (id === 'large') {
        const transcript = Array.from({ length: 240 }, (_, i) => i % 2 === 0
          ? { role: 'user', text: `큰 대화 사용자 ${i + 1}` }
          : { role: 'assistant', result: { kind: 'reply', reply: `큰 대화 답 ${i + 1}` } });
        json(res, { id, title: '큰 대화', updatedAt: '2026-08-13T00:00:00.000Z', transcript, activePendingIds: [] });
        return;
      }
      if (id === 'fresh') {
        const transcript = 새대화저장됨 ? [
          { role: 'user', text: '안녕' },
          { role: 'assistant', result: { kind: 'reply', reply: '안녕하세요. 무엇을 같이 해볼까요?' } },
        ] : [];
        json(res, { id, title: '안녕', updatedAt: '2026-08-13T00:00:00.000Z', transcript, activePendingIds: [] });
        return;
      }
      const fixed = 고정물표.get(id);
      json(res, fixed ? 세션(fixed) : { error: 'not_found' }, fixed ? 200 : 404); return;
    }
    if (req.method === 'POST' && u.pathname === '/sessions') {
      json(res, { id: 'fresh', title: '새 대화', transcript: [], activePendingIds: [] }); return;
    }
    if (req.method === 'GET' && u.pathname === '/model/connection') {
      json(res, { connected: true, provider: 'fixture', modelId: 'UX 고정물', source: 'saved' }); return;
    }
    if (req.method === 'GET' && u.pathname === '/onboarding') {
      json(res, { needed: false, canConnect: false, seenWelcome: true }); return;
    }
    if (req.method === 'POST' && u.pathname === '/turn/stream-start') {
      json(res, { streamId: 'ux-recovery-stream', measurementId: 'ux-recovery-measurement' }); return;
    }
    if (req.method === 'POST' && u.pathname === '/search') {
      const statement = '…앞 문맥에서 찾았습니다. 큰 대화 답 240 그리고 뒤 문맥입니다.';
      const matchText = '큰 대화 답 240';
      json(res, { results: [{
        statement,
        source: {
          sessionId: 'large', title: '큰 대화', role: 'assistant', matchText,
          matchStart: statement.indexOf(matchText), matchLength: matchText.length,
        },
      }] });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/turn/stream') {
      if (u.searchParams.get('sessionId') === 'fresh') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
        });
        // 실제 커널 회수 순서: 첫 답을 흘린 뒤 되돌리고 다른 최종 답을 낸다. 첫 답이 화면에
        // 한 프레임이라도 보이면 오너가 본 「다른 답→사라짐→새 답」 회귀다.
        res.write(`event: answer_delta\ndata: ${JSON.stringify({ text: '폐기될 임시 답입니다.' })}\n\n`);
        await 기다림(250);
        res.write('event: answer_reset\ndata: {}\n\n');
        await 기다림(250);
        res.write(`event: answer_delta\ndata: ${JSON.stringify({ text: '안녕하세요. 무엇을 같이 해볼까요?' })}\n\n`);
        await 기다림(250);
        새대화저장됨 = true;
        res.write('event: complete\ndata: {}\n\n');
        res.end();
        return;
      }
      if (u.searchParams.get('sessionId') === 'optimistic') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
        });
        res.write(`event: answer_delta\ndata: ${JSON.stringify({ text: '서버 저장을 기다리는 동안에도 이 답은 남아요.' })}\n\n`);
        res.write('event: complete\ndata: {}\n\n');
        res.end();
        return;
      }
      const recovery = 고정물표.get('recovery').recovery;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive',
      });
      res.write(`event: recoverable_error\ndata: ${JSON.stringify(recovery)}\n\n`);
      res.write('event: complete\ndata: {}\n\n');
      res.end();
      return;
    }
    // 초기 화면의 보조 읽기와 카드 버튼은 고정물의 핵심이 아니다. 죽은 404로 화면을 흔들지 않는다.
    if (req.method === 'GET') { json(res, {}); return; }
    json(res, { ok: true });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}

const 폭 = Number(process.argv[2] || 1180);
const { server, port } = await 고정물서버();
const base = `http://127.0.0.1:${port}`;
const 크롬 = await 크롬띄우기({ url: `${base}/#/s/approval`, width: 폭, height: 900 });
try {
  await 크롬.send('Emulation.setDeviceMetricsOverride', {
    width: 폭, height: 900, deviceScaleFactor: 2, mobile: 폭 < 768,
  });
  await 크롬.준비대기("!!document.getElementById('actbar') && document.body.innerText.includes('실행 전 승인이 필요해요')");
  const 결과 = [];
  for (const fixed of 숨은표면고정물) {
    await 크롬.돌리기(`location.hash = ${JSON.stringify(`/s/${fixed.id}`)}`);
    if (fixed.recovery) {
      await 크롬.준비대기(`location.hash === ${JSON.stringify(`#/s/${fixed.id}`)} && !document.querySelector('.stopbtn')`);
      await 크롬.돌리기(`(() => {
        const input = document.getElementById('text');
        input.value = '막힌 작업을 다른 길로 이어줘';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('send').click();
      })()`);
      await 크롬.준비대기(`document.body.innerText.includes(${JSON.stringify(fixed.기대글[0])})`);
    } else await 크롬.준비대기(`document.body.innerText.includes(${JSON.stringify(fixed.기대글[0])})`);
    const 측정 = await 크롬.돌리기(`(() => {
      const visible = (e) => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
      };
      const text = document.body.innerText;
      const buttons = [...document.querySelectorAll('button')].filter(visible).map((b) => (b.textContent || '').trim());
      return { viewport: [innerWidth, innerHeight], text, buttons };
    })()`);
    const 글 = fixed.기대글.map((x) => ({ 값: x, 보임: 측정.text.includes(x) }));
    const 버튼 = fixed.기대버튼.map((x) => ({ 값: x, 보임: 측정.buttons.includes(x) }));
    결과.push({ id: fixed.id, 이름: fixed.이름, 글, 버튼, 통과: [...글, ...버튼].every((x) => x.보임) });
  }
  // 처방 2: 스트림은 답을 줬지만 뒤의 GET /sessions는 일부러 빈 옛 스냅샷을 준다.
  await 크롬.돌리기(`location.hash = '#/s/optimistic'`);
  await 크롬.준비대기(`location.hash === '#/s/optimistic' && document.querySelectorAll('#wrap .turn').length === 0`);
  await 크롬.돌리기(`(() => {
    const input = document.getElementById('text');
    input.value = '이 말은 서버가 늦어도 남아야 해';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('send').click();
  })()`);
  await 크롬.준비대기(`document.body.innerText.includes('서버 저장을 기다리는 동안에도 이 답은 남아요.') && !document.querySelector('.stopbtn')`);
  const 낙관적유지 = await 크롬.돌리기(`(() => ({
    사용자말: [...document.querySelectorAll('.msg.me')].some((x) => x.textContent.includes('이 말은 서버가 늦어도 남아야 해')),
    받은답: [...document.querySelectorAll('.msg.bot')].some((x) => x.textContent.includes('서버 저장을 기다리는 동안에도 이 답은 남아요.')),
  }))()`);
  낙관적유지.통과 = 낙관적유지.사용자말 && 낙관적유지.받은답;
  // 처방 4: 240개 원문 중 최근 80개만 DOM에 두고, 접은 160개와 원문 보존을 말한다.
  await 크롬.돌리기(`location.hash = '#/s/large'`);
  await 크롬.준비대기(`document.body.innerText.includes('이전 대화 160개는 화면에서 접어 두었어요.')`);
  const 큰대화 = await 크롬.돌리기(`(() => ({
    그린대화: document.querySelectorAll('#wrap .turn').length,
    접은수고지: document.body.innerText.includes('이전 대화 160개는 화면에서 접어 두었어요.'),
    원문보존고지: document.body.innerText.includes('저장된 원문은 그대로예요.'),
  }))()`);
  큰대화.통과 = 큰대화.그린대화 === 80 && 큰대화.접은수고지 && 큰대화.원문보존고지;
  // 처방 5: 실제 검색 버튼으로 열어 결과의 맞은 말을 강조하고, 누르면 원 대목으로 이동한다.
  await 크롬.돌리기(`(() => {
    document.getElementById('searchbtn').click();
    const q = document.getElementById('q'); q.value = '큰 대화 답 240';
    document.getElementById('qgo').click();
  })()`);
  await 크롬.준비대기(`document.querySelector('#qresults mark')?.textContent === '큰 대화 답 240'`);
  const 검색강조 = await 크롬.돌리기(`document.querySelector('#qresults mark')?.textContent`);
  await 크롬.돌리기(`document.querySelector('#qresults .qh-body').click()`);
  await 크롬.준비대기(`!!document.querySelector('.turn.search-target')`);
  const 검색스니펫 = await 크롬.돌리기(`(() => ({
    강조: false,
    원대화: location.hash === '#/s/large',
    첫일치이동: !!document.querySelector('.turn.search-target .msg.bot'),
  }))()`);
  검색스니펫.강조 = 검색강조 === '큰 대화 답 240';
  검색스니펫.통과 = 검색스니펫.강조 && 검색스니펫.원대화 && 검색스니펫.첫일치이동;

  // 오너 실사용 회귀: 발화가 많은 대화를 본 뒤 새 대화에서 한 번 말해도 한 벌만 보여야 한다.
  await 크롬.돌리기(`document.querySelector('#newchat').click()`);
  await 크롬.준비대기(`document.querySelectorAll('#wrap .turn').length === 0`);
  await 크롬.돌리기(`window.__uxAnswerFrames = []; window.__uxAnswerObserver = new MutationObserver(() => {
    window.__uxAnswerFrames.push(document.querySelector('#wrap')?.innerText || '');
  }); window.__uxAnswerObserver.observe(document.querySelector('#wrap'), { childList:true, subtree:true, characterData:true });`);
  await 크롬.돌리기(`document.querySelector('#text').value = '안녕'; document.querySelector('#send').click()`);
  await 크롬.준비대기(`document.querySelectorAll('#wrap .msg.bot').length > 0`);
  const 새대화중복 = await 크롬.돌리기(`(() => ({
    사용자: [...document.querySelectorAll('#wrap .msg.me')].filter((x) => x.textContent.trim() === '안녕').length,
    답: [...document.querySelectorAll('#wrap .msg.bot')].filter((x) => x.textContent.includes('무엇을 같이 해볼까요')).length,
  }))()`);
  새대화중복.통과 = 새대화중복.사용자 === 1 && 새대화중복.답 === 1;
  const 검증전답노출 = await 크롬.돌리기(`window.__uxAnswerObserver.disconnect(); window.__uxAnswerFrames.some((x) => x.includes('폐기될 임시 답'))`);
  새대화중복.검증전답노출 = 검증전답노출;
  새대화중복.통과 = 새대화중복.통과 && !검증전답노출;
  const 통과 = 결과.every((x) => x.통과) && 낙관적유지.통과 && 큰대화.통과 && 검색스니펫.통과 && 새대화중복.통과;
  console.log(JSON.stringify({ 폭, 주소: base, 결과, 낙관적유지, 큰대화, 검색스니펫, 새대화중복, 통과 }, null, 2));
  process.exitCode = 통과 ? 0 : 1;
} finally {
  await 크롬.닫기();
  server.close();
  server.closeAllConnections();
  // Node 내장 fetch(초기 정적/상태 요청과 CDP HTTP)가 keep-alive 소켓을 잠시 붙든다.
  // 결과·exitCode·자원 정리가 모두 끝난 뒤 그 대기만 강제로 끊는다.
  setTimeout(() => process.exit(process.exitCode ?? 0), 0).unref();
}
