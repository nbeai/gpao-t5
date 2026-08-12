// **승인으로 턴이 쪼개지면 모델이 자기가 한 일을 잊는다.**
//
// 밟은 사실(라이브 2026-08-06 · 오너의 ④ 마지막 확인). T5 는 카톡 입력칸에 글자를 넣고,
// 전송 카드를 띄우고, 승인을 받아 **실제로 보냈다**(화면에 말풍선이 남았다). 그런데 마지막 답은
// *"제가 이 컴퓨터에서 직접 카카오톡 창을 조작해서 메시지를 보내는 기능은 지금은 쓸 수 없는
// 상태라…"* 였다. 다 해놓고 못 했다고 말한 것이다.
//
// 원인은 문장이 아니라 **재료**였다. 재개 턴의 `turnExchange` 길이가 **1** 이었다 —
// 마지막 걸음 하나만 있고 **앞서 실행한 입력 걸음이 사라졌다.** 모델은 자기 눈에 보이는
// 것만으로 답을 쓴다. 이건 A14 의 거울상이다: 됐는데 안 됐다고 한다.
//
// 이 저장소는 같은 병을 이미 한 번 고쳤다 — 계획 단계에서 막힌 사실을 `앞선막힘` 으로 이어
// 붙인 자리다(*"여기 없으면 모델은 자기가 고른 손이 왜 안 갔는지 모른 채 답을 쓴다"*).
// **승인으로 쪼개진 걸음도 같은 통로로 이어야 한다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function 자리() {
  const dir = await mkdtemp(join(tmpdir(), 'resume-'));
  return { dir, tools: demoTools({
    localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }),
    localTerminal: {
      async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
      async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '정리했어요.' }; },
    },
  }) };
}

/** 첫 걸음은 자동으로 되는 것, 둘째 걸음은 승인이 나는 것. */
function 두걸음모델() {
  let n = 0;
  return {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'ok' } }] };
      if (!opts.tools?.length) return '했어요';
      n += 1;
      if (n === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list' } }] };
      if (n === 2) return { text: '찾았어요.', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf 오래된정산' } }] };
      return { text: '다 했어요', toolCalls: [] };
    },
  };
}

test('승인 뒤에도 앞서 한 걸음이 모델에게 남는다 — 다 해놓고 "못 했다"고 하지 않는다', async () => {
  const { tools } = await 자리();
  const ctx = { env: demoEnv(), tools, model: 두걸음모델() };
  const 첫 = await runTurn({ text: '오래된 정산 정리해줘' }, ctx);
  assert.equal(첫.kind, 'approval', `카드가 안 떴다: ${첫.kind}`);

  const 이어 = await runTurn({ approve: 첫.pendingId }, ctx);
  const 교환 = 이어.turnExchange ?? [];
  const 손들 = 교환.map((e) => e.tool);
  assert.ok(손들.includes('local.file'),
    `**앞서 한 걸음이 사라졌다** — 모델은 마지막 하나만 보고 답을 쓴다: ${JSON.stringify(손들)}`);
  assert.ok(손들.includes('local.terminal'), `승인받은 걸음이 없다: ${JSON.stringify(손들)}`);
});

test('원장에도 두 걸음이 다 있다 — 사용자도 무슨 일이 있었는지 본다', async () => {
  const { tools } = await 자리();
  const ctx = { env: demoEnv(), tools, model: 두걸음모델() };
  const 첫 = await runTurn({ text: '오래된 정산 정리해줘' }, ctx);
  const 이어 = await runTurn({ approve: 첫.pendingId }, ctx);
  const 원장글 = JSON.stringify(이어.ledger ?? {});
  assert.match(원장글, /정리했어요/, `승인받은 걸음이 원장에 없다: ${원장글.slice(0, 200)}`);
});

test('같은 걸음이 두 번 세어지지 않는다 — 이어붙였다고 중복이 되면 안 된다', async () => {
  const { tools } = await 자리();
  const ctx = { env: demoEnv(), tools, model: 두걸음모델() };
  const 첫 = await runTurn({ text: '오래된 정산 정리해줘' }, ctx);
  const 이어 = await runTurn({ approve: 첫.pendingId }, ctx);
  const 파일걸음 = (이어.turnExchange ?? []).filter((e) => e.tool === 'local.file');
  assert.equal(파일걸음.length, 1, `**같은 걸음이 여러 번 실렸다**: ${파일걸음.length}`);
});
