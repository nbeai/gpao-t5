// 순서 6 착수 진단 — 계측기 양성 대조(§10 규율: 부재를 재는 자는 실재를 한 번 잡아 보여야 한다).
// 같은 스파이(respond 인자 기록)가 기존 배아 갈래의 발동을 실제로 잡는지 — 막힌 걸음(read 실패)
// + 미완 고지 답이면 ④ goalNotReached 가 서고 계약말이 가야 한다.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '/Users/jyp/Developer/t5-p-op/src/surface/server.js';
import { SessionStore } from '/Users/jyp/Developer/t5-p-op/src/surface/session-store.js';
import { demoTools } from '/Users/jyp/Developer/t5-p-op/src/surface/demo-context.js';
import { makeLocalFileTool } from '/Users/jyp/Developer/t5-p-op/src/runtime/local-file.js';
import { makeLocalTerminalTool } from '/Users/jyp/Developer/t5-p-op/src/runtime/local-terminal.js';

const 자리 = await mkdtemp(join(tmpdir(), 'seq6-pos-'));
const 답문장 = '그 파일은 아직 확인을 못 했어요.';
const respond기록 = [];
let 걸음냄 = false;
const model = {
  async respond(tc, opts = {}) {
    const 기록 = {
      keys: Object.keys(tc ?? {}).filter((k) => ['unmetDeliverable', 'candidatesUnopened', 'searchNotExhausted', 'partialRead', 'goalNotReached', 'completionMismatch'].includes(k)),
      계약말: JSON.stringify(tc?.recentTurns ?? []).includes('목적에 안 닿았어요'),
      contract: Boolean(tc?.workContractAssessment), tools: (opts.tools ?? []).length,
      goalNotReached: tc?.goalNotReached ? JSON.stringify(tc.goalNotReached).slice(0, 200) : null,
    };
    respond기록.push(기록);
    if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
    if (!opts.tools?.length) return 답문장;
    if (기록.계약말 || 기록.keys.length) return { text: 답문장, toolCalls: [] };
    if (!걸음냄) { 걸음냄 = true; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '없는파일.md' } }] }; }
    return { text: 답문장, toolCalls: [] };
  },
};
const run = async (command, { mode } = {}) => ({ command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '', stderr: 'unused', durationMs: 1 });
const dir = await mkdtemp(join(tmpdir(), 'seq6-pos-srv-'));
const store = new SessionStore(dir);
const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
  localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) });
const server = makeServer({ store, tools, model });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const turn = async (body) => (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
let r = await turn({ sessionId, text: '보고서.md 내용 확인해줘' });
let 개입 = 0;
while (r.kind === 'approval' && 개입 < 6) { 개입 += 1; r = await turn({ sessionId, approve: r.pendingId }); }
await new Promise((res) => server.close(res));
console.log('=== 결과 kind:', r.kind);
console.log('=== respond 호출 전량:', JSON.stringify(respond기록, null, 1));
console.log('=== 스파이가 발동을 잡았나:', respond기록.some((x) => x.계약말 || x.keys.length));
