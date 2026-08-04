// **막힌 뒤에 다음 손을 실제로 준다** — 말로만 "다른 손으로 해볼게요" 하고 끝내지 않는다.
//
// 라이브 실측(2026-08-04 · 사람 사용시험 · 실제 브라우저 · gpt-5.1 · 격리 증명 통과 뒤):
//   사용자 "~/Documents 폴더 안에 뭐가 있는지 목록으로 보여줘"
//   원장   `local.file list ~/Documents` → blocked ("작업 폴더 밖이에요")
//   T5     "**이번엔 터미널 쪽 손으로 직접 확인해서 목록만 가져올게요.**
//           다만 나는 실제 터미널을 지금 바로 실행해 결과를 붙여 넣을 수는 없고,
//           네 컴퓨터 안에서 `ls -al ~/Documents` 를 실행해서 붙여 주면…"
//   원장   `local.terminal` **호출 0건**
//
// 두 가지가 겹쳤다. ① 손이 있는데 "못 한다"고 말했다(거짓 무능력) ② 사용자에게 시켰다(떠넘김).
// 이건 이미 닫았던 병이다 — `recovery-ladder` 의 `out_of_scope` 는 `other_hand: local.terminal`
// 로 **2단**이지 3단(사용자 부탁)이 아니다(c217a0c6: "폴더를 통째로 복사해 주세요"까지 갔던 자리).
//
// 사다리는 옳았고 모델도 알고 있었다("터미널 쪽 손으로"). **그런데 그 손이 손에 안 쥐어졌다.**
// 계단을 말로만 알려 주고 도구를 안 주면, 모델은 그 자리에서 할 수 있는 유일한 것 —
// 사용자에게 부탁하기 — 를 한다. 계단은 문구가 아니라 **쥐어 주는 손**이어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 파일 손의 방 밖을 물어본 턴. 터미널 손은 배선돼 있다. */
async function 무대(모델만들기) {
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 'blocked-')));
  const 밖 = await realpath(await mkdtemp(join(tmpdir(), 'outside-')));
  const 돈명령 = [];
  const 터미널 = {
    async probe(command, opts = {}) {
      return { command, cwd: opts.cwd ?? 방, changes: false, probe: { exitCode: 0, stdout: '가.txt\n나.txt', stderr: '' } };
    },
    async handler(args) {
      돈명령.push(args.command);
      return { result: { command: args.command, exitCode: 0, stdout: '가.txt\n나.txt', applied: true }, userSafeSummary: '확인했어요.' };
    },
  };
  const r = await runTurn({ text: `${밖} 폴더 안에 뭐가 있는지 목록으로 보여줘.` }, {
    env: demoEnv({ include: ['local.file', 'local.terminal'], hands: ['local.file', 'local.terminal'] }),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [방], dataDir: 방 }),
      localTerminal: 터미널,
    }),
    model: 모델만들기(밖),
  });
  return { r, 돈명령, 방, 밖 };
}

test('파일 손이 방 밖에서 막히면 **다음 응답에 터미널 손이 쥐어진다**', async () => {
  const 받은도구 = [];
  const { 돈명령 } = await 무대((밖) => ({
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      받은도구.push((opts.tools ?? []).map((t) => t.name));
      if (opts.tools?.some((t) => t.name === 'local.file') && !this.파일냈나) {
        this.파일냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: 밖 } }] };
      }
      // 막힌 뒤: 터미널이 손에 있으면 쓴다. 없으면 쓸 수가 없다 — 그게 이 검사의 전부다.
      if (opts.tools?.some((t) => t.name === 'local.terminal') && !this.터미널냈나) {
        this.터미널냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: `ls -la ${밖}` } }] };
      }
      return '목록이에요.';
    },
  }));
  const 준적있나 = 받은도구.some((목록) => 목록.includes('local.terminal'));
  assert.ok(준적있나,
    `막힌 뒤 어느 응답에도 터미널 손을 안 줬다 — 모델은 "네가 실행해 줘"밖에 할 수 없다.\n받은 도구: ${JSON.stringify(받은도구)}`);
  assert.equal(돈명령.length, 1, '터미널 손을 줬는데 실행까지 안 갔다');
});

test('사다리 사실도 함께 간다 — 무엇이 막혔고 다음 손이 무엇인지', async () => {
  const 받은칸 = [];
  await 무대((밖) => ({
    async respond(tc, opts = {}) {
      받은칸.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.some((t) => t.name === 'local.file') && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: 밖 } }] };
      }
      return '못 봤어요.';
    },
  }));
  const 전문 = JSON.stringify(받은칸);
  assert.match(전문, /작업 폴더 밖|out_of_scope/,
    '무엇이 왜 막혔는지가 모델에게 안 갔다 — 모델은 이유를 지어낸다');
});
