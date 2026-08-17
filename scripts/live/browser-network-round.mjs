// 국면 5 · CH4(c) 변이 관측 — 선빨강/판정 공용 라이브 대본.
// 회차 실행 전에 커밋한다. 회차마다 새 저장 폴더·새 서버·새 방을 쓴다.
// 제품 코드는 다음 사실을 아직 못 싣는다: click 뒤 실제 HTTP 요청 method/address.
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { 방하나, readCredential } from './h04-memory-round.mjs';
import { 기계양성대조, 페이지들 } from './browser-click-round.mjs';

const 웹손 = ['web.search', 'web.collect', 'browser.observe', 'browser.act'];

export const CASES = Object.freeze([
  { id: 'a1-delete', kind: 'ability', prompt: (b) => `${b}/ 원문으로 안내를 먼저 확인한 뒤 "모두 삭제"를 누르고, 실제 나간 요청의 방식과 주소 및 삭제 요청 누계를 알려줘`, marker: /삭제 요청 누계[\s\S]{0,100}(1건|1회)|1건 \(POST \/삭제\)/ },
  { id: 'a2-notice', kind: 'ability', prompt: (b) => `${b}/ 원문을 확인하고 "공지 펼치기"를 누른 뒤, 실제 나간 요청의 방식과 주소와 공지 내용을 알려줘`, marker: /정기 점검/ },
  { id: 'a3-review', kind: 'ability', prompt: (b) => `${b}/ 원문을 먼저 읽고 "후기" 탭을 누른 뒤, 실제 요청의 방식과 주소를 확인하고 후기 요약을 알려줘`, marker: /별 네 개 반|재방문/ },
  { id: 'a4-detail', kind: 'ability', prompt: (b) => `${b}/ 원문을 확인한 다음 "자세히 보기"로 들어가, 클릭 뒤 실제 요청의 방식과 주소 및 안쪽 문장을 알려줘`, marker: /파랑새|새벽 다섯 시/ },
  { id: 'a5-second', kind: 'ability', prompt: (b) => `${b}/목록 원문을 확인하고 두 번째 이야기를 눌러, 실제 요청의 방식과 주소와 열쇠말을 알려줘`, marker: /초록별/ },
  { id: 'f1-stale', kind: 'blocked', prompt: (b) => `${b}/사라짐에서 "잠깐 버튼"을 눌러 안쪽 사실을 알려줘. 첫 시도가 막히면 다른 웹 수단으로 끝까지 확인해`, marker: /대체 사실: 은빛달/ },
  { id: 'f2-thin', kind: 'blocked', prompt: (b) => `${b}/얇은 화면의 실제 본문을 확인해 알려줘. 한 손 결과가 비면 다른 웹 수단으로 이어가`, marker: /얇은 화면의 본문은 보라구름/ },
  { id: 'f3-long', kind: 'blocked', prompt: (b) => `${b}/긴글을 끝까지 확인해서 맨 끝 확인어를 알려줘. 잘렸으면 다른 웹 수단으로 이어가`, marker: /마지막확인어-주황나침반/ },
  { id: 'f4-submit', kind: 'blocked', prompt: (b) => `${b}/ 원문과 화면을 함께 확인하고 "신청하기"를 여기서 누를 수 있는지, 막히면 가능한 다음 웹 수단까지 확인해 답해`, marker: /신청하기/ },
  { id: 'f5-outlink', kind: 'blocked', prompt: (b) => `${b}/ 원문과 화면을 함께 확인하고 "다른 출처" 안쪽 사실을 알려줘. 클릭이 막히면 다른 웹 수단으로 이어가`, marker: /다른 출처 사실: 푸른종/ },
]);

function html(body, title = 'CH4 판') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

async function 판띄우기() {
  const inherited = 페이지들();
  let 삭제 = 0;
  const root = inherited['/가게'].replace(
    '<p><a href="https://example.com/소식">바깥 소식(외부)</a></p>',
    '<p><a href="http://localhost:__PORT__/다른출처">다른 출처</a></p>',
  );
  const routes = {
    ...inherited,
    '/': root,
    '/상태': () => html(`<p>삭제 요청 누계: ${삭제}</p>`),
    '/대체': html('<p>대체 사실: 은빛달</p>'),
    '/얇은': html('<div id="값"></div><script>fetch("/조각/얇은").then(r=>r.text()).then(t=>값.textContent=t)</script>', '얇은 화면'),
    '/조각/얇은': '얇은 화면의 본문은 보라구름',
    '/긴글': html(`<p>${'긴 문장 '.repeat(2400)}</p><p>마지막확인어-주황나침반</p>`, '긴글'),
    '/다른출처': html('<p>다른 출처 사실: 푸른종</p>', '다른 출처'),
    '/사라짐': html('<button id="잠깐" type="button" onclick="location.href=\'/대체\'">잠깐 버튼</button><script>setTimeout(()=>잠깐.remove(),1800)</script>', '사라지는 버튼'),
  };
  const 요청 = [];
  const srv = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    요청.push({ method: req.method, path });
    if (req.method === 'POST' && path === '/삭제') {
      삭제 += 1; res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('삭제 접수'); return;
    }
    if (req.method === 'POST' && path === '/신청') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('신청 접수'); return;
    }
    let body = routes[path];
    if (typeof body === 'function') body = body();
    if (!body) { res.writeHead(404); res.end('없음'); return; }
    res.writeHead(200, { 'content-type': String(body).startsWith('<!doctype') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' });
    res.end(String(body));
  });
  const port = await new Promise((resolve, reject) => {
    srv.once('error', reject); srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
  routes['/'] = root.replace('__PORT__', String(port));
  return { base: `http://127.0.0.1:${port}`, 요청, get 삭제() { return 삭제; }, close: () => new Promise((resolve) => srv.close(resolve)) };
}

function 요청사실(entry) {
  const observation = entry?.result?.observation ?? {};
  return observation.networkRequests ?? [];
}

function 요청경로(request) {
  try { return decodeURIComponent(new URL(request?.address ?? request?.url ?? '').pathname); }
  catch { return ''; }
}

function 웹손가족(tool) {
  if (tool === 'web.collect') return 'web.collect';
  if (tool === 'web.search') return 'web.search';
  if (tool === 'browser.observe' || tool === 'browser.act') return 'browser';
  return undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const 자리 = argv.find((x) => !x.startsWith('--'));
  const caseId = argv[argv.indexOf('--case') + 1];
  const preRed = argv.includes('--pre-red');
  if (!자리 || (!preRed && !CASES.some((x) => x.id === caseId))) {
    throw new Error('사용법: node scripts/live/browser-network-round.mjs <새폴더> --pre-red | --case <id>');
  }
  const 판 = await 판띄우기();
  let 방;
  try {
    const positive = await 기계양성대조(판.base);
    if (!positive.성립) throw new Error(`양성 대조 미성립: ${JSON.stringify(positive)}`);
    const credential = readCredential(await realpath(homedir()));
    방 = await 방하나(credential, false, 웹손);
    const sessionId = await 방.새세션();
    const selected = preRed ? CASES[0] : CASES.find((x) => x.id === caseId);
    const before = 판.요청.length;
    const result = await 방.post('/turn', { sessionId, text: selected.prompt(판.base) });
    const ledger = await 방.세션원장(sessionId);
    const hands = ledger.filter((e) => e?.actualCall?.tool).map((e) => ({
      tool: e.actualCall.tool,
      args: e.actualCall.args,
      blocked: e.result?.blocked === true,
      failureState: e.failureState ?? 'none',
      networkRequests: 요청사실(e),
    }));
    const answer = String(result.result?.reply ?? result.reply ?? '');
    const clickRequests = hands.filter((h) => h.tool === 'browser.act' && h.args?.action === 'click').flatMap((h) => h.networkRequests);
    // observe·act 는 도구 둘이지만 §1-0 의 **브라우저 손 하나**다. 도구 수를 손 수로 부풀리지 않는다.
    const uniqueWebHands = [...new Set(hands.map((h) => 웹손가족(h.tool)).filter(Boolean))];
    const blockedIndex = hands.findIndex((h) => h.blocked || h.failureState === 'blocked');
    const retriedOrSwitched = blockedIndex >= 0 && hands.slice(blockedIndex + 1).some((h) => 웹손.includes(h.tool));
    const serverRequests = 판.요청.slice(before);
    const scored = {
      positiveControl: positive.성립,
      actualClick: hands.some((h) => h.tool === 'browser.act' && h.args?.action === 'click' && !h.blocked),
      serverRequests,
      clickRequests,
      capability: serverRequests.some((r) => r.method === 'POST' && r.path === '/삭제')
        ? clickRequests.some((r) => r.method === 'POST' && 요청경로(r) === '/삭제')
        : clickRequests.length > 0,
      flow: uniqueWebHands.length >= 2 && selected.marker.test(answer),
      blocked: selected.kind === 'blocked',
      retriedOrSwitched,
      uniqueWebHands,
      answerMatches: selected.marker.test(answer),
    };
    await mkdir(자리, { recursive: true });
    await writeFile(join(자리, '회차.json'), JSON.stringify({ case: selected, prompt: selected.prompt(판.base), hands, answer, scored }, null, 2));
    process.stdout.write(`${selected.id} click=${scored.actualClick} requests=${clickRequests.length} hands=${uniqueWebHands.join('>')} flow=${scored.flow} retryOrSwitch=${retriedOrSwitched}\n`);
    process.stdout.write(`원본: ${join(자리, '회차.json')}\n`);
  } finally {
    if (방) await 방.close();
    await 판.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
