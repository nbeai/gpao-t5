#!/usr/bin/env node
// L5 정상 케이스 프로브 — respond 호출 순서·tools 유무·tc 신호를 계측한다. 제품 무변경.
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TREE = '/private/tmp/t5-f64-l5-admin';
const importFrom = (rel) => import(pathToFileURL(join(TREE, rel)).href);

function exchangeData(exchange) {
  if (exchange?.data && typeof exchange.data === 'object') return exchange.data;
  if (typeof exchange?.data !== 'string') return {};
  try { return JSON.parse(exchange.data); } catch {
    const match = exchange.data.match(/^파일:\s*(.+?)(?:\r?\n|$)[\s\S]*?\r?\n내용:\r?\n([\s\S]*)$/u);
    return match ? { path: match[1].trim(), text: match[2] } : {};
  }
}
function rowsFromExchange(tc) {
  return (tc.turnExchange ?? []).flatMap((exchange) => {
    if (exchange.tool !== 'local.file' || exchange.args?.action !== 'read') return [];
    const text = String(exchangeData(exchange).text ?? '');
    return text.split(/\r?\n/u).filter((line) => line.trim()).map((quote) => ({
      source: exchangeData(exchange).path ?? exchange.args.path, quote,
    }));
  });
}
function render(rows) {
  return `신청 전 확인한 사실입니다.\n${rows.map((row) => row.quote).join('\n')}\n`;
}

const SOURCES = {
  '위생설비_지원공고.txt': '대상: 영업신고 후 1년 이상인 지역 내 식품접객업. 필수: 사업자등록증, 영업신고증, 최근 1개월 견적서, 지방세 완납증명서. 접수 전 구매한 설비는 제외.\n',
  '우리상황.txt': '지역 내 반찬가게. 영업신고 2024-03-10. 세척기 교체 예정, 아직 구매하지 않음. 받은 견적은 2026-06-15 작성.\n',
  '보유서류.txt': '사업자등록증 있음. 영업신고증 있음. 지방세 완납증명서 없음. 세척기 견적서 있음.\n',
};

const { makeLocalFileTool } = await importFrom('src/runtime/local-file.js');
const { demoEnv, demoTools } = await importFrom('src/surface/demo-context.js');
const { makeServer } = await importFrom('src/surface/server.js');
const { SessionStore } = await importFrom('src/surface/session-store.js');
const { WorkEventStore } = await importFrom('src/surface/work-event-store.js');

const base = await realpath(await mkdtemp(join(tmpdir(), 'l5-probe-')));
const root = join(base, 'work'); const state = join(base, 'state');
await Promise.all([mkdir(root), mkdir(state)]);
for (const [name, text] of Object.entries(SOURCES)) await writeFile(join(root, name), text);
const baseFile = makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root });
const localFile = { ...baseFile, async handler(args, hctx) {
  if (args.action === 'write') console.log('  [tool] write handler 도달:', args.path);
  const out = await baseFile.handler(args, hctx);
  if (args.action === 'write') console.log('  [tool] write handler 결과:', JSON.stringify(out).slice(0, 120));
  return out;
} };
const sourceEntries = Object.entries(SOURCES);
let call = 0; let main = 0;
const model = { async respond(tc, options = {}) {
  call += 1;
  const 신호 = Object.keys(tc).filter((k) => ['workContractAssessment', 'workStateSettlement', 'answerOnly', 'toolStepsLeft'].includes(k) && tc[k] !== undefined);
  console.log(`[respond #${call}] tools=${options.tools?.length ?? 0} 신호=${JSON.stringify(신호)} toolStepsLeft=${tc.toolStepsLeft ?? '-'} exchange=${(tc.turnExchange ?? []).length}`);
  if (tc.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file', sourcePolicy: 'all_current', verification: 'admin_grounded' } }] };
  if (!options.tools?.length) { console.log('  → no-tools 가지 (답완성)'); return '근거 준비표를 만들었어요.'; }
  main += 1;
  if (process.env.MODE === 'early') {
    if (main === 1) {
      console.log('  → [early] 읽기 3건 일괄 발행');
      return { text: '', toolCalls: sourceEntries.map(([name]) => ({ name: 'local.file', args: { action: 'read', path: join(root, name) } })) };
    }
    if (main === 2) {
      const rows0 = rowsFromExchange(tc);
      console.log('  → [early] main 2 write 발행 (큐에 읽기 잔여) · rows=', rows0.length);
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: '신청준비표.md', source: join(root, sourceEntries[0][0]),
        text: render(rows0), evidenceRows: rows0,
      } }] };
    }
    return { text: '근거 준비표를 만들었어요.', toolCalls: [] };
  }
  const rows = rowsFromExchange(tc);
  const 읽은자리 = new Set(rows.map((r) => r.source));
  const 안읽은 = sourceEntries.filter(([name]) => !읽은자리.has(join(root, name)));
  if (안읽은.length) {
    console.log(`  → 다음 읽기 1건 (읽힌 원천 ${읽은자리.size}/3)`);
    return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: join(root, 안읽은[0][0]) } }] };
  }
  if (!tc.turnExchange?.some((x) => x.args?.action === 'write')) {
    console.log('  → 근거 완비, write 발행 · rows=', rows.length);
    return { text: '', toolCalls: [{ name: 'local.file', args: {
      action: 'write', path: '신청준비표.md', source: join(root, sourceEntries[0][0]),
      text: render(rows), evidenceRows: rows,
    } }] };
  }
  console.log('  → main', main, '(마무리 텍스트)');
  return { text: '근거 준비표를 만들었어요.', toolCalls: [] };
} };
const store = new SessionStore(state); const workEventStore = new WorkEventStore(state);
const server = makeServer({ store, workEventStore, model, env: demoEnv(), tools: demoTools({ localFile }),
  processEnv: { HOME: root, GPAO_T5_HOME: root, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: root } });
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
const http = `http://127.0.0.1:${server.address().port}`;
const session = await fetch(`${http}/sessions`, { method: 'POST' }).then((r) => r.json());
const r = await fetch(`${http}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: session.id, text: '신청준비표.md 파일에 공고, 우리 상황, 보유서류의 보유·누락·기간·조건을 근거 준비표로 기록해줘.' }) });
const body = await r.json();
console.log('턴 결과:', body.kind, '·', String(body.reply ?? '').slice(0, 60));
const saved = await store.load(session.id);
const writes = saved.ledgerEntries.filter((e) => e.actualCall?.tool === 'local.file' && e.actualCall?.args?.action === 'write');
console.log('write 영수증:', writes.length, writes.map((e) => `${e.lifecycle}/${e.failureState ?? '-'}${e.blocked ? '/blocked' : ''}`));
console.log('--- 원장 전량 (tool/action/failureState/제안한호출):');
for (const e of saved.ledgerEntries) {
  const t = e.actualCall?.tool ?? (e.제안한호출 ? `제안만:${e.제안한호출.tool}` : e.origin ?? '?');
  const a = e.actualCall?.args?.action ?? e.제안한호출?.args?.action ?? '-';
  console.log(`  ${t} · ${a} · ${e.failureState ?? '-'} · origin=${e.origin ?? '-'}`);
}
await new Promise((ok) => server.close(ok));
