// **S2 필수 계약 둘** — 정본 §S2 "없이 본 전환 착수 금지".
//
//   ③ **영수증 진실**: `applied:false` 인데 성공 영수증이 만들어지는 자리를 전수 열거하고 닫는다.
//      성공 = **관찰된 실제 효과**. 판정 불능은 판정 불능으로 기록한다(성공으로 꾸미지 않는다).
//   ② **exchange 저장**: 재시작하면 모델의 행동 이력이 사라진다 — 모델 주도 구조에서는 기억상실이다.
//
// ── 왜 이 둘이 본 전환보다 먼저인가 ────────────────────────────────────────
// 지휘 층(심문·강제·상한·서술 블록)을 걷으면 모델이 **원장을 근거로** 판단하게 된다.
// 그 원장이 거짓이면 걷어낸 만큼 그대로 거짓 위에서 돈다. 실측(2026-08-03, 헤르메스 대조):
// `probe` 가 쓰기 막힌 채 exit 0 을 내자 원장에 "실행했어요 · failureState:none" 이 남았고
// 디스크는 그대로였다. 모델은 그 거짓 기록 위에서 다음을 판단했다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 확인된사실, projectReceipts } from '../src/kernel/l0-evidence/ledger.js';
import { receipt } from '../src/kernel/l0-evidence/tool-receipt.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

// ── ③ 영수증 진실 ──────────────────────────────────────────────────────────
test('③ `applied:false` 는 확인된 사실이 아니다 (probe 는 실행이 아니다)', () => {
  // `local.terminal` 의 probe 는 **쓰기가 막힌 채 도는 확인**이다. exit 0 이어도 아무것도
  // 안 바뀌었다. 그런데 `확인된사실` 은 lifecycle·failureState·result 만 봐서 통과시켰다 —
  // 사용자면 문장은 "확인만 했어요"인데 **원장은 confirmed 로 세었다.** 두 진실이다.
  const 확인만 = receipt({
    intended: 'local.terminal 실행',
    actualCall: { tool: 'local.terminal', args: { command: 'rm -rf 임시' } },
    result: { command: 'rm -rf 임시', exitCode: 0, applied: false },
    userSafeSummary: '확인만 했어요 — 아직 아무것도 바꾸지 않았어요.',
  });
  assert.equal(확인된사실(확인만), false,
    'applied:false 를 확인된 사실로 세면 모델이 "이미 했다" 위에서 다음을 판단한다');
  const 투영 = projectReceipts([확인만]);
  assert.deepEqual(투영.confirmed, [], '확인만 한 것이 confirmed 로 샜다');
  assert.equal(투영.estimated.length + 투영.unconfirmed.length, 1, '사실 자체는 사라지면 안 된다');
});

test('③ `applied:true` 는 그대로 확인된 사실이다(과잉 차단 금지)', () => {
  const 진짜실행 = receipt({
    intended: 'local.terminal 실행',
    actualCall: { tool: 'local.terminal', args: { command: 'ls' } },
    result: { command: 'ls', exitCode: 0, applied: true },
    userSafeSummary: '실행했어요.',
  });
  assert.equal(확인된사실(진짜실행), true, '실제로 한 일까지 막으면 원장이 반대로 거짓이 된다');
});

test('③ `applied` 를 아예 안 내는 손은 영향받지 않는다', () => {
  // 파일 손·웹 손은 `applied` 개념이 없다. 없는 칸을 false 로 읽으면 전부 미확인이 된다.
  const 파일읽기 = receipt({
    intended: 'local.file 실행',
    actualCall: { tool: 'local.file', args: { action: 'read', path: 'a.md' } },
    result: { path: '/집/a.md', text: '내용' },
    userSafeSummary: 'a.md 를 읽었어요.',
  });
  assert.equal(확인된사실(파일읽기), true);
});

// ── ② exchange 가 턴을 넘어 살아남는가 ─────────────────────────────────────
test('② 모델의 도구 대화가 **다음 턴에도** 자기 이력으로 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's2-exchange-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 본것 = [];
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      본것.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_TURN1', name: 'local.file',
          args: { action: 'read', path: join(dir, '정산.csv') },
        }] };
      }
      return '읽었어요.';
    },
  };
  const ctx = { env: demoEnv(), tools: demoTools({ localFile }), model };
  await runTurn({ text: '정산.csv 읽어줘' }, ctx);

  // 두 번째 턴 — 모델은 자기가 1턴에 무엇을 했는지 **자기 행동 이력으로** 볼 수 있어야 한다.
  본것.length = 0;
  await runTurn({ text: '방금 본 거 요약해줘' }, ctx);
  const 실린것 = JSON.stringify(본것);
  assert.ok(실린것.includes('call_TURN1'),
    '앞 턴의 도구 대화가 사라졌다 — 모델은 자기가 한 일을 남의 소식(서술)으로만 받는다');
});

test('② 재시작해도 앞 턴의 도구 대화가 복원된다(기억상실 금지)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's2-restart-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 냈나 = false;
  const 만들기 = (담을곳) => ({
    async respond(tc, opts = {}) {
      담을곳.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_BEFORE_RESTART', name: 'local.file',
          args: { action: 'read', path: join(dir, '정산.csv') },
        }] };
      }
      return '읽었어요.';
    },
  });
  const 앞 = [];
  const ctx1 = { env: demoEnv(), tools: demoTools({ localFile }), model: 만들기(앞) };
  await runTurn({ text: '정산.csv 읽어줘' }, ctx1);

  // **재시작**: ctx 를 통째로 새로 만든다. 살아남는 것은 저장된 대화뿐이다.
  const 뒤 = [];
  const ctx2 = {
    env: demoEnv(), tools: demoTools({ localFile }), model: 만들기(뒤),
    recentTurns: ctx1.recentTurns,
    priorExchange: ctx1.priorExchange,
  };
  await runTurn({ text: '아까 그거 이어서 해줘' }, ctx2);
  assert.ok(JSON.stringify(뒤).includes('call_BEFORE_RESTART'),
    '재시작 뒤 모델의 행동 이력이 사라졌다 — 모델 주도 구조에서는 기억상실이다');
});

// ── ② 진짜 재시작 관통 — 저장소를 지나서도 살아남는가 ──────────────────────
//
// `startLiveServer` 는 모델 연결을 env·연결저장소에서 스스로 만든다(대본 모델을 안 받는다) —
// 그래서 여기서는 `makeServer` 로 같은 표면을 세우고, **같은 폴더에 저장소를 두 번 연다.**
// 프로세스 안 상태는 전부 버려지고 파일만 남는 것이 재시작의 본질이다.
test('② 저장소를 다시 열어도 모델의 도구 대화가 대화에서 복원된다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const { ToolRunner } = await import('../src/runtime/tool-runner.js');

  const dir = await mkdtemp(join(tmpdir(), 's2-store-restart-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });

  const 본것 = [];
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      본것.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{
          providerCallId: 'call_ACROSS_RESTART', name: 'local.file',
          args: { action: 'read', path: join(dir, '정산.csv') },
        }] };
      }
      return '읽었어요.';
    },
  };
  const 세우기 = () => makeServer({
    store: new SessionStore(dir),
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: new ToolRunner({ 'local.file': localFile }),
    descriptors: demoDescriptors({ include: ['local.file'] }),
    model, modelTimeoutMs: 0, processEnv: { GPAO_T5_TCELL: 'off' },
  });
  const 열기 = async (server) => new Promise((r) => server.listen(0, '127.0.0.1', r));
  const 부르기 = async (server, 경로, 몸) => (await fetch(
    `http://127.0.0.1:${server.address().port}${경로}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(몸 ?? {}) },
  )).json();

  const s1 = 세우기();
  await 열기(s1);
  const 세션 = (await 부르기(s1, '/sessions')).id;
  const 첫턴 = await 부르기(s1, '/turn', { sessionId: 세션, text: '정산.csv 읽어줘' });
  await new Promise((r) => s1.close(r));
  assert.equal(첫턴.kind, 'reply', `첫 턴이 실행까지 못 갔다: ${JSON.stringify(첫턴).slice(0, 200)}`);

  // **재시작** — 새 저장소 인스턴스. 프로세스 안 기억은 없다.
  본것.length = 0;
  const s2 = 세우기();
  await 열기(s2);
  try {
    await 부르기(s2, '/turn', { sessionId: 세션, text: '아까 그거 요약해줘' });
  } finally {
    await new Promise((r) => s2.close(r));
  }
  assert.ok(JSON.stringify(본것).includes('call_ACROSS_RESTART'),
    '재시작 뒤 모델의 행동 이력이 사라졌다 — 대화에 저장되지 않았거나 복원 배선이 끊겼다');
});
