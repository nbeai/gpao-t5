// **출구 검증** — 모델이 완료를 주장하면 런타임이 원장·실물과 대조하고,
// 불일치면 **사용자에게 가지 않고 모델에게 반환한다**.
//
// 정본 §S5 H08 재개봉 절차:
//   · 기존 통과: FILE 판정 + write 강제 + 계약 결합 영수증
//   · 무효화한 사실: **강제가 쓰레기 산출물을 만든다**(실측 2026-08-03 — 모델이 낼 것이
//     없을 때 억지로 로그 파일을 만들었다)
//   · 어디까지만 다시 여는가: **중간 강제만** 걷는다. 완료 검증 자체는 유지하되 **출구로 옮긴다.**
//   · 다시 닫는 조건: "파일 요청이 말로만 끝남"이 실모델 반복에서 0.
//
// ── 왜 출구인가 ────────────────────────────────────────────────────────────
// 중간에서 강제하면 모델의 판단을 뺏는다(쓰레기 산출물). 출구에서 대조하면 판단은 모델의
// 것으로 두고 **거짓만 막는다.** 그리고 불일치를 사용자에게 보내지 않고 모델에게 돌려주므로
// 대필도 아니다 — 모델이 사실을 보고 자기 말로 고쳐 쓴다.
//
// 실측 근거(2026-08-04 S4 라이브): 캡슐이 "손을 한 번도 쓰지 않았어요"를 정직하게 돌려줬는데
// 모델의 최종 답은 "옮겼어"였다. 원인(응답 모양·이유·이름)은 고쳤지만 **출구가 없으면
// 다음 계열 거짓 완료가 그대로 사용자에게 간다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';

const 성공 = (tool, args, result) => ({
  intended: `${tool} 실행`, failureState: 'none', userSafeSummary: '했어요.',
  actualCall: { tool, args }, result,
});
const 실패 = (tool, args) => ({
  intended: `${tool} 실행`, failureState: 'blocked', userSafeSummary: '막혔어요.',
  actualCall: { tool, args },
});

// ── ① 실행이 하나도 없는데 "했다"고 하면 막는다 ────────────────────────────
test('실행 0인데 완료를 주장하면 **모델에게 돌려준다**', () => {
  const v = 완료주장검증({ reply: '파일들 다 옮겼어요.', receipts: [] });
  assert.equal(v.일치, false, '실행이 하나도 없는데 완료 주장이 그대로 나간다');
  assert.equal(v.사용자에게, false, '불일치가 사용자에게 갔다 — 계약은 모델에게 반환이다');
  assert.match(v.모델에게, /실행|없/, '무엇이 어긋났는지가 모델에게 안 간다');
});

test('말로만 끝낸 답도 같은 자리에서 걸린다("다음에 하겠다" 금지)', () => {
  const v = 완료주장검증({ reply: '정리해서 저장해 뒀어요.', receipts: [실패('local.file', { action: 'write' })] });
  assert.equal(v.일치, false);
});

// ── ② 실행이 있으면 통과한다(과잉 차단 금지) ───────────────────────────────
test('실제로 한 일이 있으면 완료 주장은 그대로 간다', () => {
  const v = 완료주장검증({
    reply: '옮겼어요.',
    receipts: [성공('local.file', { action: 'move' }, { from: 'a', to: 'b/a' })],
  });
  assert.equal(v.일치, true, '실제로 한 일까지 막으면 그게 반대 방향의 거짓이다');
  assert.equal(v.모델에게, undefined);
});

test('완료를 주장하지 않는 답은 아예 대상이 아니다', () => {
  for (const 답 of ['어떻게 정리할까요?', '두 가지 방법이 있어요.', '지금 폴더에 437개가 있어요.']) {
    assert.equal(완료주장검증({ reply: 답, receipts: [] }).일치, true, `물어보는 답을 막았다: ${답}`);
  }
});

// ── ③ 숫자를 말하면 그 숫자를 대조한다 ─────────────────────────────────────
test('"N개 옮겼다"는 실제 이동 수와 대조한다', () => {
  const 이동 = (n) => Array.from({ length: n }, (_, i) => 성공('local.file', { action: 'move' }, { from: `a${i}`, to: `b/a${i}` }));
  assert.equal(완료주장검증({ reply: '5개를 옮겼어요.', receipts: 이동(5) }).일치, true);
  const 어긋남 = 완료주장검증({ reply: '50개를 옮겼어요.', receipts: 이동(5) });
  assert.equal(어긋남.일치, false, '말한 수와 실제 수가 열 배 차이인데 통과했다');
  assert.match(어긋남.모델에게, /5/, '실제 수가 모델에게 안 간다');
});

test('묶음 이동은 한 영수증이 여러 개를 옮긴다(그 수를 센다)', () => {
  const v = 완료주장검증({
    reply: '102개를 옮겼어요.',
    receipts: [성공('local.file', { action: 'bulk_move' }, { moved: Array.from({ length: 102 }, () => ({})), skipped: [] })],
  });
  assert.equal(v.일치, true, '묶음 이동의 실제 개수를 못 센다');
});

test('캡슐 안에서 한 일도 센다(손 하나로 보이지만 여러 번 돌았다)', () => {
  const v = 완료주장검증({
    reply: '3개를 옮겼어요.',
    receipts: [성공('local.capsule', { code: '…' }, {
      calls: 3,
      innerReceipts: Array.from({ length: 3 }, (_, i) => 성공('local.file', { action: 'move' }, { from: `a${i}`, to: `b/a${i}` })),
    })],
  });
  assert.equal(v.일치, true, '캡슐 안 실행을 안 세면 정직한 답이 거짓으로 잡힌다');
});

// ── ④ 반환은 지시가 아니라 사실이다 ────────────────────────────────────────
test('모델에게 돌려주는 것은 **사실**이지 지시가 아니다', () => {
  const v = 완료주장검증({ reply: '다 옮겼어요.', receipts: [] });
  for (const 지시어 of ['해라', '하지 마', '다시 써', '반드시', '금지']) {
    assert.equal(String(v.모델에게).includes(지시어), false,
      `사실 자리에 지시가 섞였다("${지시어}"): ${v.모델에게}`);
  }
});

test('같은 턴에서 두 번 반환하지 않는다(무한 왕복 금지)', () => {
  const v = 완료주장검증({ reply: '다 옮겼어요.', receipts: [], 이미돌려줬나: true });
  assert.equal(v.일치, true, '한 턴에 두 번 되돌리면 왕복이 무한이 된다 — 한 번만 준다');
});

// ── ⑤ 커널 출구에 실제로 붙었는가 ──────────────────────────────────────────
//
// 단위검사는 판정 함수만 잰다. **배선이 끊겨 있어도 전부 초록이다** — 그래서 여기서
// 실제 턴을 돌려 "거짓 완료가 사용자에게 안 간다"를 잰다.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

test('턴 출구: 손을 하나도 안 쓰고 "다 했어요"라고 하면 **모델에게 되돌아간다**', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's5-exit-turn-'));
  await writeFile(join(dir, 'a.txt'), 'x');
  const 받은칸 = [];
  let 몇번째 = 0;
  const model = {
    async respond(tc, opts = {}) {
      받은칸.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      몇번째 += 1;
      // 손을 한 번도 안 고르고 곧바로 "다 옮겼다"고 말한다 — 말로만 끝나는 턴.
      if (tc?.completionMismatch) return '아직 아무것도 옮기지 않았어요. 어떤 기준으로 옮길까요?';
      return '파일들 다 옮겨 뒀어요.';
    },
  };
  const r = await runTurn({ text: '파일 정리해줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.ok(받은칸.some((tc) => tc?.completionMismatch),
    '출구 검증이 커널에 안 붙었다 — 거짓 완료가 그대로 사용자에게 간다');
  assert.doesNotMatch(String(r.reply), /다 옮겨 뒀어요/,
    '거짓 완료가 사용자 화면까지 갔다');
  assert.match(String(r.reply), /아직/, '모델이 고쳐 쓴 답이 안 쓰였다');
});

test('턴 출구: 되돌림이 준 것은 **사실 한 줄**이고, 답은 모델이 쓴다(대필 0)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's5-exit-fact-'));
  let 받은사실;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.completionMismatch) { 받은사실 = tc.completionMismatch.사실; return '제 착각이었어요. 아직 안 했어요.'; }
      return '정리 끝냈어요.';
    },
  };
  const r = await runTurn({ text: '정리해줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.ok(받은사실, '되돌림 사실이 안 갔다');
  for (const 지시어 of ['해라', '하지 마', '다시 써', '반드시']) {
    assert.equal(받은사실.includes(지시어), false, `사실 자리에 지시가 섞였다("${지시어}")`);
  }
  assert.equal(String(r.reply).trim(), '제 착각이었어요. 아직 안 했어요.',
    '런타임이 답을 대신 쓰거나 덧붙였다 — 최종 답은 모델의 것이다');
});

test('턴 출구: 실제로 한 일이 있으면 되돌리지 않는다(왕복을 낭비하지 않는다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's5-exit-ok-'));
  await writeFile(join(dir, 'a.txt'), 'x');
  const 받은칸 = [];
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      받은칸.push(tc);
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: 'a.txt' } }] };
      }
      return 'a.txt 읽고 정리했어요.';
    },
  };
  await runTurn({ text: 'a.txt 정리해줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.equal(받은칸.some((tc) => tc?.completionMismatch), false,
    '읽고 답한 정상 턴을 되돌렸다 — 과잉 차단은 반대 방향의 거짓이다');
});

// ── ⑥ 검증은 **그물이지 관문이 아니다** ────────────────────────────────────
//
// 라이브 실측(2026-08-04 `live:charter`): 되돌림 왕복에서 anthropic 이 빈 스트림을 냈고,
// 그 예외가 답 경로 전체를 무너뜨려 **멀쩡한 답이 "연결이 잠시 끊겼어요"로 바뀌었다.**
// 검증은 거짓을 막으려고 있는 것이지 답을 없애려고 있는 것이 아니다.
test('되돌림 왕복이 실패해도 **답은 살아남는다**', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's5-exit-net-'));
  let 되돌림시도 = false;
  const model = {
    async respond(tc) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.completionMismatch) { 되돌림시도 = true; throw new Error('empty response stream'); }
      return '정리 끝냈어요.';
    },
  };
  const r = await runTurn({ text: '정리해줘' }, {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model,
  });
  assert.ok(되돌림시도, '이 시험이 성립하려면 되돌림이 한 번은 시도돼야 한다');
  assert.match(String(r.reply ?? ''), /끝냈어요/,
    '검증 왕복 하나가 트림했다고 답 전체가 사라졌다 — 그물이 관문이 됐다');
});
