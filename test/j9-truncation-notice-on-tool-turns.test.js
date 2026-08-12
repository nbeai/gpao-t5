// **J9 반대시험 — 도구를 쓴 턴의 답이 잘려도 안내가 붙는다**(상태 지도 §12-J9 · turn.js:1423).
//
// `잘림말붙이기` 는 **빠른 경로에만** 붙어 있었고, `답잘림` 은 **호출 ①** 의 결과만 봤다.
// 그래서 손을 쓴 턴(복합 경로)의 답이 상한에서 끊기면 사용자는 아무 안내 없이 잘린 답을 받는다 —
// 라이브 실측(오너 2026-08-05)이 잡은 것과 같은 모양인데 경로만 다르다.
//
// 정직은 "낼 수 있는데 안 내고 대신 하는 말"이 아니다(turn.js:768). 공급자 층이 세 번 이어 써도
// 못 끝냈을 때만 `잘림` 이 온다 — 그 드문 자리에서 한 줄 남기는 것이 이 계약이다.
//
// 오픈북:
//   클로드코드(나) — 상한에서 끊긴 응답은 끊겼다는 사실이 그 자리에서 보인다. 다음 턴으로
//     미루지 않는다.
//   오픈클로 `docs/concepts/agent-loop.md` "Where things can end early" — 일찍 끝난 사유는
//     경로마다 따로 적지 않고 lifecycle 한 자리로 나간다.
//
// **잘림 사실은 마지막 답을 낸 호출에서 본다** — 앞선 호출이 잘렸어도 최종 답이 온전하면
// 안내는 안 붙는다(그건 반대 방향의 거짓이다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

const 잘림안내 = '남은 부분이 더 있어요';

/** 손 하나를 쓰고 최종 답을 내는 대본. `최종` 이 마지막 답 호출의 결과다. */
async function 무대(최종) {
  const dir = await mkdtemp(join(tmpdir(), 'j9-trunc-'));
  await writeFile(join(dir, '자료.txt'), '내용');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_1', name: 'local.file', args: { action: 'read', path: join(dir, '자료.txt') },
        }] };
      }
      return 최종;
    },
  };
  return { dir, localFile, model };
}

test('J9 — 손을 쓴 턴의 최종 답이 잘리면 안내가 붙는다', async () => {
  const { localFile, model } = await 무대({ text: '자료를 보니 첫 줄은', 잘림: true });
  const r = await runTurn({ text: '자료 읽고 알려줘' }, {
    env: demoEnv(), tools: demoTools({ localFile }), model,
  });
  assert.equal(r.kind, 'reply', '이 시험은 복합 경로가 답을 내야 성립한다');
  assert.ok(String(r.reply).includes(잘림안내),
    `손을 쓴 턴의 잘린 답에 안내가 없다 — 사용자는 왜 끊겼는지 알 길이 없다: ${JSON.stringify(r.reply)}`);
});

test('J9 — 온전한 답에는 안내가 안 붙는다(안 잘린 것을 잘렸다고 하지 않는다)', async () => {
  const { localFile, model } = await 무대({ text: '자료의 첫 줄은 "내용" 이에요.' });
  const r = await runTurn({ text: '자료 읽고 알려줘' }, {
    env: demoEnv(), tools: demoTools({ localFile }), model,
  });
  assert.equal(r.kind, 'reply');
  assert.ok(!String(r.reply).includes(잘림안내),
    `안 잘린 답에 잘림 안내가 붙었다: ${JSON.stringify(r.reply)}`);
});

test('J9 — 빠른 경로의 계약은 그대로다(같은 안내, 같은 자)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'j9-fast-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      return { text: '스윙이라면 예를 들어', 잘림: true };
    },
  };
  const r = await runTurn({ text: '골프 얘기 좀 해줘' }, {
    env: demoEnv(), tools: demoTools({ localFile }), model,
  });
  assert.equal(r.kind, 'reply');
  assert.ok(String(r.reply).includes(잘림안내),
    `빠른 경로의 잘림 안내가 사라졌다: ${JSON.stringify(r.reply)}`);
});
