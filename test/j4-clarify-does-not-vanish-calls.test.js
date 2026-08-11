// **J4 반대시험 — 모델이 되물으면 같은 응답의 실행 호출이 사유와 함께 남는다**
// (상태 지도 §12-J4 · turn.js:1244).
//
// 커널에는 호출이 실행되지 않고 끝나는 자리가 여섯 있다. 다섯은 전부 `못한호출남기기` 로
// 사유가 남는다 — 없는손 · 예산소진 · 되풀이 · 승인대기중단 · 되묻기중단(걸음 루프 안).
// **`kind:'clarify'` 로 턴을 닫는 자리만 없었다.** 모델이 `ask.user` 를 내면서 같은 응답에
// 작업 호출을 함께 내면, 그 호출은 실행도 영수증도 원장도 없이 통째로 증발했다.
//
// 그건 F-68 의 형제다: 모델은 자기가 시킨 것이 갔다고 믿고 다음 턴을 쓴다.
//
// 오픈북:
//   클로드코드(나) — 사용자가 취소하면 즉시 멈추지만, **무엇을 하다 멈췄는지는 남는다.**
//     조용히 사라지는 도구 호출은 없다.
//   오픈클로 `docs/concepts/agent-loop.md` "Where things can end early" — 일찍 끝나는 자리마다
//     그 사유가 lifecycle 로 나간다.
//
// **실행하지 않는 계약은 그대로다**(turn.js:1238 — 물어 놓고 실행하면 승인 전 효과의 사촌이다).
// 여기서 여는 것은 실행이 아니라 **사실**이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 첫 응답에 `ask.user` 와 작업 호출을 **함께** 내는 대본. */
async function 무대() {
  const dir = await mkdtemp(join(tmpdir(), 'j4-clarify-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 실행된인자 = [];
  const 원핸들러 = localFile.handler.bind(localFile);
  localFile.handler = async (a) => { 실행된인자.push(a); return 원핸들러(a); };
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length) {
        return { text: '', toolCalls: [
          { providerCallId: 'call_ask', name: 'ask.user', args: {
            question: '어느 폴더를 정리할까요?', options: [{ label: '다운로드' }, { label: '바탕화면' }],
          } },
          { providerCallId: 'call_work', name: 'local.file', args: { action: 'write', path: join(dir, '메모.txt'), content: '안녕' } },
        ] };
      }
      return '어느 쪽인가요?';
    },
  };
  const 원장 = [];
  const ctx = {
    env: demoEnv(), tools: demoTools({ localFile }), model,
    ledger: { entries: 원장, append: (x) => { 원장.push(x); return x; } },
  };
  return { ctx, 원장, 실행된인자 };
}

test('J4 — 되묻기로 닫는 턴도 못 한 호출을 사유와 함께 남긴다', async () => {
  const { ctx, 원장, 실행된인자 } = await 무대();
  const r = await runTurn({ text: '폴더 정리해줘' }, ctx);

  assert.equal(r.kind, 'clarify', '이 시험은 모델이 되물어야 성립한다');
  // 계약 그대로: **실행은 안 한다.**
  assert.deepEqual(실행된인자.filter((a) => a.action === 'write'), [],
    '되물어 놓고 실행했다 — 사용자의 답이 오기 전에 효과가 났다');

  const 못한것 = 원장.filter((e) => e?.제안한호출?.tool === 'local.file');
  assert.equal(못한것.length, 1,
    `되묻기로 닫은 턴에서 같은 응답의 작업 호출이 원장에 안 남았다(${원장.length}건 중 0건) — 모델은 그게 갔다고 믿는다`);
  const [rec] = 못한것;
  // 다섯 형제와 **같은 계약**이다: 부르지 않았으니 `actualCall` 은 null, 신분은 `제안한호출` 에.
  assert.equal(rec.actualCall, null, '부르지 않은 호출이 "실제 호출"로 기록됐다');
  assert.equal(rec.제안한호출.providerCallId, 'call_work', '모델이 낸 신분이 사라졌다');
  assert.equal(rec.failureState, 'blocked',
    '되묻기로 못 한 일은 안 된 일이다 — cancelled 로 적으면 "이미 된 일"과 같은 자리에 들어간다');
  assert.equal(rec.diagnosticTrace?.reason, '되묻기중단',
    `사유 어휘가 형제들과 다르다: ${JSON.stringify(rec.diagnosticTrace)}`);
  assert.ok(String(rec.userSafeSummary ?? '').trim(), '왜 안 했는지가 사용자면에 없다');
});

test('J4 — 작업 호출 없이 되묻기만 하면 아무 사실도 지어내지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'j4-plain-'));
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length) {
        return { text: '', toolCalls: [{ name: 'ask.user', args: {
          question: '어느 쪽일까요?', options: [{ label: '가' }, { label: '나' }],
        } }] };
      }
      return '어느 쪽인가요?';
    },
  };
  const 원장 = [];
  const r = await runTurn({ text: '정리해줘' }, {
    env: demoEnv(), tools: demoTools({ localFile }), model,
    ledger: { entries: 원장, append: (x) => { 원장.push(x); return x; } },
  });
  assert.equal(r.kind, 'clarify');
  assert.deepEqual(원장.filter((e) => e?.diagnosticTrace?.reason === '되묻기중단'), [],
    '고른 손이 없는데 못 한 호출을 지어냈다');
});
