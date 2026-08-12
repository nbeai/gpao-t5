// **"멈춰"가 실제로 멈춘다** — 취소 신호가 표면에서 커널의 실행 큐까지 닿는다.
//
// 후속 장부 F-5: 커널에 `ctx.취소됐나?.()` 이음새를 만들고 큐 전체 전파를 검사로 고정했지만
// **표면에서 그 이음새로 잇는 배선이 없었다.** 그때는 게이트가 아니었다 — 사용자에게
// "멈출 수 있다"고 말한 적이 없으니 거짓 주장은 아니었다.
//
// **캡슐(S4)이 서면서 게이트가 됐다.** 이제 한 턴이 수십 초 동안 수백 번 손을 쓸 수 있다.
// 그 동안 사용자가 멈출 방법이 없으면, 되돌릴 수 있는 작업이라도 사용자는 자기 컴퓨터에서
// 벌어지는 일을 못 세운다. **자동성이 의무인 만큼 정지도 의무다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools, demoDescriptors } from '../src/surface/demo-context.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

async function 무대(모델만들기) {
  const dir = await mkdtemp(join(tmpdir(), 's5-cancel-'));
  await mkdir(join(dir, '모음'), { recursive: true });
  const 파일들 = Array.from({ length: 40 }, (_, i) => `자료-${String(i).padStart(2, '0')}.txt`);
  for (const f of 파일들) await writeFile(join(dir, f), 'x');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const server = makeServer({
    store: new SessionStore(dir),
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: new ToolRunner({ 'local.file': localFile }),
    descriptors: demoDescriptors({ include: ['local.file'] }),
    model: 모델만들기(dir, 파일들), modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const 주소 = `http://127.0.0.1:${server.address().port}`;
  const 부르기 = async (경로, 몸) => (await fetch(`${주소}${경로}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(몸 ?? {}),
  })).json();
  return { dir, 파일들, server, 주소, 부르기, localFile };
}

test('표면에 **멈춤 문**이 있다', async () => {
  const { server, 부르기 } = await 무대(() => ({ async respond() { return '네.'; } }));
  try {
    const s = (await 부르기('/sessions')).id;
    const 답 = await 부르기('/turn/cancel', { sessionId: s });
    assert.equal(답?.ok, true, `멈춤 문이 없다: ${JSON.stringify(답)}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('"멈춰"를 누르면 **돌고 있는 큐가 선다**', async () => {
  let 취소부르기;
  let 세션;
  const 만들기 = (dir, 파일들) => ({
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        // 40개를 한 응답에 낸다 — 캡슐이 없어도 다중 호출이면 이만큼 돈다.
        return { text: '', toolCalls: 파일들.map((f, i) => ({
          providerCallId: `c${i}`, name: 'local.file',
          args: { action: 'move', path: join(dir, f), to: join(dir, '모음', f) },
        })) };
      }
      return '옮겼어요.';
    },
  });
  const { dir, server, 부르기, localFile, 파일들 } = await 무대(만들기);
  // 손이 몇 번 돌면 사용자가 "멈춰"를 누른다.
  let 실행수 = 0;
  const 원핸들러 = localFile.handler.bind(localFile);
  localFile.handler = async (a) => {
    실행수 += 1;
    if (실행수 === 5 && 세션) await 취소부르기(세션);
    return 원핸들러(a);
  };
  취소부르기 = (s) => 부르기('/turn/cancel', { sessionId: s });
  try {
    세션 = (await 부르기('/sessions')).id;
    await 부르기('/turn', { sessionId: 세션, text: '자료 옮겨줘' });
  } finally {
    await new Promise((r) => server.close(r));
  }
  const 옮겨진것 = (await readdir(join(dir, '모음'))).length;
  assert.ok(옮겨진것 < 파일들.length,
    `"멈춰" 뒤에도 ${옮겨진것}개가 전부 옮겨졌다 — 취소가 큐에 안 닿는다`);
  assert.ok(옮겨진것 >= 4, '취소 전에 몇 걸음은 돌아야 이 시험이 성립한다');
});

test('멈춘 뒤에는 **못 한 일이 사실로** 남는다(조용히 끝나지 않는다)', async () => {
  let 세션; let 취소부르기;
  const 만들기 = (dir, 파일들) => ({
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: {
          unclear: false, requestedIndexes: tc.currentActionAssessment.candidates.map((c) => c.index),
        } }] };
      }
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: 파일들.map((f, i) => ({
          providerCallId: `c${i}`, name: 'local.file',
          args: { action: 'move', path: join(dir, f), to: join(dir, '모음', f) },
        })) };
      }
      return '옮겼어요.';
    },
  });
  const { server, 부르기, localFile } = await 무대(만들기);
  let 실행수 = 0;
  const 원핸들러 = localFile.handler.bind(localFile);
  localFile.handler = async (a) => {
    실행수 += 1;
    if (실행수 === 3 && 세션) await 취소부르기(세션);
    return 원핸들러(a);
  };
  취소부르기 = (s) => 부르기('/turn/cancel', { sessionId: s });
  let 답;
  try {
    세션 = (await 부르기('/sessions')).id;
    답 = await 부르기('/turn', { sessionId: 세션, text: '자료 옮겨줘' });
  } finally {
    await new Promise((r) => server.close(r));
  }
  const 전문 = JSON.stringify(답?.ledger ?? {});
  assert.match(전문, /멈춰|그만|하지 않았/,
    `멈춘 뒤 못 한 일이 사실로 안 남았다: ${전문.slice(0, 300)}`);
});

test('새 발화는 **앞선 멈춤을 물려받지 않는다**(한 번 멈추면 영영 멈추지 않는다)', async () => {
  const { server, 부르기, dir } = await 무대((d, 파일들) => ({
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !this.냈나) {
        this.냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'move', path: join(d, 파일들[0]), to: join(d, '모음', 파일들[0]) } }] };
      }
      return '했어요.';
    },
  }));
  try {
    const s = (await 부르기('/sessions')).id;
    await 부르기('/turn/cancel', { sessionId: s });   // 아무 것도 안 돌 때 눌러 둔다
    await 부르기('/turn', { sessionId: s, text: '자료-00 옮겨줘' });
    assert.equal((await readdir(join(dir, '모음'))).length, 1,
      '앞서 눌린 멈춤이 새 발화까지 물려 내려와 아무 일도 안 됐다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
