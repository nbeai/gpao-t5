// 순서 6 측정 확장(감시자 조정 ②): 잔존 지문 턴에서 「답을 쓰는 마지막 호출」의 모델 입력 전량 대조.
// 재는 것: ① 남은자리말 원문(폴더가 세지나) ② 도착/출발(기하) ③ vef.bulkMove(낡은 값 모순)
// ④ 남은 폴더(임시/)가 어느 경로로든 「남았다」로 갔나 ⑤ 배아 사실 키(기존 스파이 유지).
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '/Users/jyp/Developer/t5-p-op/src/surface/server.js';
import { SessionStore } from '/Users/jyp/Developer/t5-p-op/src/surface/session-store.js';
import { demoTools } from '/Users/jyp/Developer/t5-p-op/src/surface/demo-context.js';
import { makeLocalFileTool } from '/Users/jyp/Developer/t5-p-op/src/runtime/local-file.js';
import { makeLocalTerminalTool } from '/Users/jyp/Developer/t5-p-op/src/runtime/local-terminal.js';

const 자리 = await mkdtemp(join(tmpdir(), 'seq6-full-'));
await mkdir(join(자리, '백업'), { recursive: true });
await writeFile(join(자리, '백업', '시작문서-전체백업.tar.gz'), 'x'.repeat(39492));
for (const [n, c] of [['T5-공장도달표-2026-08-11.md', 'a'], ['T5-비전과-성능철학.md', 'b'], ['새-세션에게-보낼-메세지.md', 'c'], ['현재상황.md', 'd']]) await writeFile(join(자리, '백업', n), c.repeat(1000));
await writeFile(join(자리, '백업', 'README.md'), 'r'.repeat(120));
const 답문장 = '압축본만 남기고 정리해 놨어요.';
const 걸음들 = [
  { name: 'local.file', args: { action: 'list', path: '.' } },
  { name: 'local.file', args: { action: 'list', path: '백업' } },
  { name: 'local.file', args: { action: 'delete', path: '백업/README.md' } },
  { name: 'local.file', args: { action: 'bulk_move', path: '백업', match: { extensions: ['.md'] }, to: '백업/임시' } },
];
const 기록 = [];
let i = 0;
const model = {
  async respond(tc, opts = {}) {
    const s = JSON.stringify(tc ?? {});
    기록.push({
      idx: 기록.length, contract: Boolean(tc?.workContractAssessment), tools: (opts.tools ?? []).length,
      사실키: Object.keys(tc ?? {}).filter((k) => ['unmetDeliverable', 'candidatesUnopened', 'searchNotExhausted', 'partialRead', 'goalNotReached', 'completionMismatch'].includes(k)),
      남은파일말: s.match(/남은 파일: [^"\\]*/g) ?? [],
      남은종류말: s.match(/남은 것의 종류: [^"\\]*/g) ?? [],
      도착말: s.match(/도착: [^"\\]*/g) ?? [],
      폴더언급: s.match(/폴더[^"\\]{0,40}남|남[^"\\]{0,40}폴더/g) ?? [],
      임시언급수: (s.match(/임시/g) ?? []).length,
      vefBulk: tc?.verifiedExecutionFacts?.bulkMove ? JSON.stringify(tc.verifiedExecutionFacts.bulkMove) : null,
    });
    if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
    if (!opts.tools?.length) return 답문장;
    if (i < 걸음들.length) { const c = 걸음들[i]; i += 1; return { text: '', toolCalls: [c] }; }
    return { text: 답문장, toolCalls: [] };
  },
};
const run = async (command, { mode } = {}) => ({ command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '', stderr: 'x', durationMs: 1 });
const dir = await mkdtemp(join(tmpdir(), 'seq6-full-srv-'));
const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }), localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) });
const server = makeServer({ store: new SessionStore(dir), tools, model });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://${'127.0.0.1'}:${server.address().port}`;
const turn = async (b) => (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
let r = await turn({ sessionId, text: '백업 폴더는 압축본만 남기고 정리해줘' });
let n = 0; while (r.kind === 'approval' && n < 6) { n += 1; r = await turn({ sessionId, approve: r.pendingId }); }
await new Promise((res) => server.close(res));
console.log('kind:', r.kind, '· 답:', String(r.reply ?? '').slice(0, 60));
for (const g of 기록) console.log(JSON.stringify(g, null, 0).slice(0, 700), '\n---');
