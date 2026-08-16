// 터미널 산출물이 원장에 사실로 남는다(§7-bq 선빨강) — **오너 승인 수리 2026-08-16**
//
// §7-bp 오너 승인 재판 ④ R3 실물: 터미널 명령이 만든 압축본의 경로가 원장에 없어,
// 모델이 자기 산출물의 자리를 다음 판단에서 못 받았다(§7-bn 한계칸에 선신고된 자리).
// 오너 결정: 「터미널 산출물 일반이 원장에 사실로 남는 균일 배선. 강제가 아니라 유도 —
// 배치를 대신 정하지 않는다. 시험 낱말(zip·백업)에 기대는 배선 금지.」
//
// 이 검사가 무는 계약: 승인받아 실제로 돈(granted) 터미널 명령이 디스크에 새로 만든 것의
// **자리(경로)**가, 파일 손의 창조·이동 산출물과 같은 배선(결과물 줄)으로 모델에게 공급된다.
// 관측 방식·칸 이름은 계약이 아니다 — 끝 사실(결과물 줄 도달)만 문다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

async function 방() {
  const d = await mkdtemp(join(tmpdir(), 'terminal-artifact-'));
  await mkdir(join(d, '시작문서'), { recursive: true });
  await writeFile(join(d, '시작문서', 'a.md'), 'hello');
  return d;
}

/** 실행기 스텁 — probe 는 쓰기 막힘 자국(카드로 가는 길), granted 는 **진짜 디스크 변화**를 만든다.
 *  관측 배선이 스텁의 주장이 아니라 실물 diff 를 밟게 하기 위해 파일을 실제로 만든다. */
function 실행기(자리, 만들것들) {
  return async (command, { mode } = {}) => {
    if (mode !== 'granted') {
      return { command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '',
        stderr: `cannot create: 보관.tar: Operation not permitted`, durationMs: 1 };
    }
    for (const 이름 of 만들것들) writeFileSync(join(자리, 이름), '실물');
    return { command, cwd: 자리, mode: 'granted', exitCode: 0, stdout: '묶음 완료', stderr: '', durationMs: 1 };
  };
}

const 묶는모델 = (자리) => {
  let 골랐다 = false;
  return {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (!골랐다) {
        골랐다 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'tar -cf 보관.tar 시작문서', cwd: 자리 } }] };
      }
      return { text: '묶어 뒀어요.', toolCalls: [] };
    },
  };
};

async function 판(자리, { run, model }) {
  const dir = await mkdtemp(join(tmpdir(), 'terminal-artifact-srv-'));
  const store = new SessionStore(dir);
  const tools = demoTools({
    localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
    localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }),
  });
  const server = makeServer({ store, tools, model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (body) => (await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  return { server, turn, sessionId };
}

test('★ 선빨강 — granted 터미널이 만든 파일의 자리가 결과물 줄에 선다', async () => {
  const 자리 = await 방();
  const { server, turn, sessionId } = await 판(자리, { run: 실행기(자리, ['보관.tar']), model: 묶는모델(자리) });
  try {
    const a = await turn({ sessionId, text: '시작문서를 묶어서 보관본 하나 만들어줘' });
    assert.equal(a.kind, 'approval', `승인에서 안 멈췄다: ${a.kind}`);
    const r = await turn({ sessionId, approve: a.pendingId });
    assert.equal(r.kind, 'reply');
    // 명령 원문 메아리(`tar -cf 보관.tar …`)로는 못 산다 — **결과물 줄** 그 문장에 서야 한다.
    // (첫 판 단언이 상태글 전체를 물어 명령 echo 로 초록이 됐다 — 재는 자 정정.)
    const 상태글 = JSON.stringify([r.workingState ?? null, r.contextShown ?? null]);
    const 결과물줄 = 상태글.match(/이 작업에서 만든 결과물 파일:[^"\\]*/g) ?? [];
    assert.ok(결과물줄.some((줄) => 줄.includes('보관.tar')),
      '**터미널 산출물의 자리가 결과물 줄에 안 선다** — 원장에 경로 사실이 없어, 다음 판단의 '
      + `모델은 자기가 방금 만든 것의 자리를 못 받는다(§7-bp ④ R3 실물의 커널 자리). 결과물 줄: ${JSON.stringify(결과물줄)}`);
  } finally { await new Promise((r) => server.close(r)); }
});

test('보존 닻 — probe 로만 돈 명령은 산출물 주장을 만들지 않는다', async () => {
  const 자리 = await 방();
  // probe 가 막히지 않는 읽기 명령: 자국 없음 → changes:false → 자동 실행이지만 granted 아님.
  const run = async (command, { mode } = {}) => (
    { command, cwd: 자리, mode, sandboxed: true, exitCode: 0, stdout: '읽음', stderr: '', durationMs: 1 });
  let 골랐다 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (!골랐다) { 골랐다 = true; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls 시작문서', cwd: 자리 } }] }; }
      return { text: '봤어요.', toolCalls: [] };
    },
  };
  const { server, turn, sessionId } = await 판(자리, { run, model });
  try {
    const r = await turn({ sessionId, text: '시작문서에 뭐 있는지 봐줘' });
    assert.equal(r.kind, 'reply');
    const 상태글 = JSON.stringify([r.workingState ?? null, r.contextShown ?? null]);
    assert.ok(!상태글.includes('이 작업에서 만든 결과물 파일'),
      '아무것도 안 만든 확인 명령에 결과물 줄이 섰다 — 관측이 주장을 지어냈다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('보존 닻 — 파일 손 write 산출물 줄은 지금처럼 선다 (기존 배선 불변)', async () => {
  const 자리 = await 방();
  let 골랐다 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (!골랐다) { 골랐다 = true; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: join(자리, '메모.md'), text: '적음' } }] }; }
      return { text: '적어 뒀어요.', toolCalls: [] };
    },
  };
  const { server, turn, sessionId } = await 판(자리, { run: 실행기(자리, []), model });
  try {
    const r = await turn({ sessionId, text: '메모 하나 적어줘' });
    const 상태글 = JSON.stringify([r.workingState ?? null, r.contextShown ?? null]);
    assert.ok(상태글.includes('메모.md'), 'write 산출물 줄이 사라졌다 — 넓히다 기존 배선을 끊었다');
  } finally { await new Promise((r) => server.close(r)); }
});
