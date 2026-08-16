// 순서 6 착수 진단(측정 · 제품 0줄) — J15 잔존 지문의 결정적 재현.
// 재는 것: ① 1차 R1 u10 / 2차 R3 u10 지문(정리 4손 전부 성공 · bulk_move 목적지가 치우던
// 폴더 안 · 완료 주장 답)에서 목적미달 되부름이 도는가 ② 되부름이 돌면 어떤 사실 키가
// 모델에게 갔는가(spy가 respond 인자를 전량 기록) ③ 세션 원장이 실제로 쥔 영수증 값.
// A1·A2 판례(결정적 서버판) 구조 재사용 — wrong-value-claim-is-caught.test.js 의 판.
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '/Users/jyp/Developer/t5-p-op/src/surface/server.js';
import { SessionStore } from '/Users/jyp/Developer/t5-p-op/src/surface/session-store.js';
import { demoTools } from '/Users/jyp/Developer/t5-p-op/src/surface/demo-context.js';
import { makeLocalFileTool } from '/Users/jyp/Developer/t5-p-op/src/runtime/local-file.js';
import { makeLocalTerminalTool } from '/Users/jyp/Developer/t5-p-op/src/runtime/local-terminal.js';

const 자리 = await mkdtemp(join(tmpdir(), 'seq6-diag-'));
// 재판 원본 지문 그대로: 백업/ 에 tar.gz 1 + md 4 + README.md
await mkdir(join(자리, '백업'), { recursive: true });
await writeFile(join(자리, '백업', '시작문서-전체백업.tar.gz'), 'x'.repeat(39492));
await writeFile(join(자리, '백업', 'T5-공장도달표-2026-08-11.md'), 'a'.repeat(10337));
await writeFile(join(자리, '백업', 'T5-비전과-성능철학.md'), 'b'.repeat(45534));
await writeFile(join(자리, '백업', '새-세션에게-보낼-메세지.md'), 'c'.repeat(14868));
await writeFile(join(자리, '백업', '현재상황.md'), 'd'.repeat(15837));
await writeFile(join(자리, '백업', 'README.md'), 'r'.repeat(120));

const 답문장 = '압축본만 남기고 정리해 놨어요.\n\n- `백업/시작문서-전체백업.tar.gz`만 남겨 두었고\n- 나머지 md 파일들은 `백업/임시/`로 옮겨 둔 상태입니다.';
const 걸음들 = [
  { name: 'local.file', args: { action: 'list', path: '.' } },
  { name: 'local.file', args: { action: 'list', path: '백업' } },
  { name: 'local.file', args: { action: 'delete', path: '백업/README.md' } },
  { name: 'local.file', args: { action: 'bulk_move', path: '백업', match: { extensions: ['.md'] }, to: '백업/임시' } },
];
const respond기록 = [];
let 걸음idx = 0;
const model = {
  async respond(tc, opts = {}) {
    const 기록 = {
      keys: Object.keys(tc ?? {}).filter((k) => ['unmetDeliverable', 'candidatesUnopened', 'searchNotExhausted', 'partialRead', 'goalNotReached', 'completionMismatch'].includes(k)),
      계약말: JSON.stringify(tc?.recentTurns ?? []).includes('목적에 안 닿았어요'),
      contract: Boolean(tc?.workContractAssessment), tools: (opts.tools ?? []).length,
    };
    respond기록.push(기록);
    if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
    if (!opts.tools?.length) return 답문장;
    if (기록.계약말 || 기록.keys.length) {
      // 되부름이 왔다 — 모델은 아무 손도 안 고른다(측정: 사실이 왔는지가 목적).
      return { text: 답문장, toolCalls: [] };
    }
    if (걸음idx < 걸음들.length) { const c = 걸음들[걸음idx]; 걸음idx += 1; return { text: '', toolCalls: [c] }; }
    return { text: 답문장, toolCalls: [] };
  },
};
const run = async (command, { mode } = {}) => ({ command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '', stderr: 'unused', durationMs: 1 });
const dir = await mkdtemp(join(tmpdir(), 'seq6-diag-srv-'));
const store = new SessionStore(dir);
const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
  localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) });
const server = makeServer({ store, tools, model });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const turn = async (body) => (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
let r = await turn({ sessionId, text: '백업 폴더는 압축본만 남기고 정리해줘' });
let 개입 = 0;
while (r.kind === 'approval' && 개입 < 6) { 개입 += 1; r = await turn({ sessionId, approve: r.pendingId }); }
await new Promise((res) => server.close(res));

const 원장 = JSON.parse(await readFile(join(dir, `${sessionId}.json`), 'utf8')).ledgerEntries ?? [];
const 영수증 = 원장.filter((e) => e?.actualCall?.tool);
console.log('=== 결과 kind:', r.kind, '· 개입:', 개입);
console.log('=== 최종 답:', String(r.reply ?? '').slice(0, 160).replace(/\n/g, ' / '));
console.log('=== respond 호출 전량:', JSON.stringify(respond기록, null, 1));
console.log('=== 세션 원장 영수증 (배아가 보는 값):');
for (const e of 영수증) {
  console.log(' *', JSON.stringify({
    tool: e.actualCall.tool, action: e.actualCall.args?.action, to: e.actualCall.args?.to ?? null,
    fs: e.failureState ?? 'none',
    다음수단: (e.다음수단 ?? []).length, 다른후보: (e.다른후보 ?? []).length,
    surfaceRequest: Boolean(e.surfaceRequest),
    resultKeys: Object.keys(e.result ?? {}).slice(0, 12),
  }));
}
console.log('=== 되부름 발생 여부:', respond기록.some((x) => x.계약말 || x.keys.length));
console.log('자리:', 자리, '· 세션:', join(dir, `${sessionId}.json`));
