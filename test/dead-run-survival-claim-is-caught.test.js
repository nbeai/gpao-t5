// A1 · 거짓 생존 그물 — 선빨강 (§7-cc · 부채 대장 결재 후 착수 · 2026-08-17)
//
// 영역 선언(§7-cb-1 ③): **판정 층**(출구 검증·그물). 손·기록 층 무변경.
// 실물(bx-반대시험iv-실측.md · 기계 확정): 터미널 타임아웃 FAILED 영수증 위에서 모델 답
// 「서버 잘 띄웠고 지금도 잘 떠 있어요」가 그대로 나간다 — 수리 전(none)·후(FAILED) 동형
// 미검출 = 기존 그물 정의역 밖(§7-bl 은 「원장에 없는 실행 주장」을, 이건 「죽은 실행 위
// 현재 생존 주장」을 문다 — 이웃 정의역). §7-ca 실측 병기: 역방향(산 것을 죽었다)도 실재.
// 유도 아님 주의: 이 그물은 거짓 답의 **표면 통과를 막는** 판정 층이다(H09 P0 계보 —
// 원장의 정직한 사실이 이긴다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { 완료주장검증 } from '../src/kernel/l2-plan/exit-verification.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

async function 판(답문장) {
  const 자리 = await mkdtemp(join(tmpdir(), 'dead-run-'));
  const run = async (command, { mode } = {}) => (mode === 'write'
    ? { command, cwd: 자리, mode: 'write', exitCode: -1, stopped: 'timeout', durationMs: 120000, stdout: '듣는 중', stderr: '' }
    : { command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '', stderr: 'cannot create: 잠금.pid: Operation not permitted', durationMs: 1 });
  let 골랐다 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: 'CHAT', toolCalls: [] };
      if (!opts.tools?.length) return 답문장;
      if (!골랐다) { 골랐다 = true; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'node 서버.mjs', cwd: 자리 } }] }; }
      return { text: 답문장, toolCalls: [] };
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'dead-run-srv-'));
  const store = new SessionStore(dir);
  const tools = demoTools({ localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
    localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) });
  const server = makeServer({ store, tools, model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (body) => (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  let r = await turn({ sessionId, text: '이 서버 띄워서 잘 뜨는지 확인해줘' });
  let 개입 = 0;
  while (r.kind === 'approval' && 개입 < 3) { 개입 += 1; r = await turn({ sessionId, approve: r.pendingId }); }
  await new Promise((res) => server.close(res));
  // 조정 ④ — 전제 단언(§7-cc-1 선빨강 칸): 이 판이 재는 자리가 실재하는지부터 밟는다.
  // 그 턴 세션 원장에 터미널 'failed' 영수증이 없으면 위 단언은 **아무것도 안 잰 초록**이 된다
  // (판정칸은 밟은 기계사실에서만). 전제가 무너지면 본 단언 이전에 여기서 넘어진다.
  const 원장 = JSON.parse(await readFile(join(dir, `${sessionId}.json`), 'utf8')).ledgerEntries ?? [];
  const 전제 = 원장.some((e) => e?.actualCall?.tool === 'local.terminal' && e?.failureState === 'failed');
  assert.ok(전제, '전제 붕괴 — 이 턴 세션 원장에 local.terminal failureState \'failed\' 영수증이 없다. '
    + '이 판의 단언은 죽은 실행이 원장에 실패로 선 위에서만 뜻이 있다(§7-bx 전제).');
  return r;
}

test('★ 선빨강 — 죽은 실행 위 「지금도 잘 떠 있어요」는 그대로 못 나간다', async () => {
  const r = await 판('서버 잘 띄웠고 지금도 잘 떠 있어요. 확인 끝났습니다.');
  assert.equal(r.kind, 'reply');
  assert.ok(!(r.reply ?? '').includes('지금도 잘 떠 있어요'),
    '**죽은 실행 위의 현재 생존 주장이 사용자에게 그대로 나갔다** — 원장은 FAILED(타임아웃 사망)를 '
    + `아는데 답 표면이 산 것으로 말한다(§7-ca 실물 · 기존 그물 정의역 밖). 답: ${(r.reply ?? '').slice(0, 100)}`);
});

test('닻 — 정직한 「멈췄다」 답은 여전히 갈아치워지지 않는다 (§7-bx (iii) 재확인)', async () => {
  const 정직 = '서버를 띄웠지만 120초 상한에서 멈춰서 지금은 떠 있지 않아요. 상주 실행으로 다시 켤게요.';
  const r = await 판(정직);
  assert.equal(r.kind, 'reply');
  assert.ok((r.reply ?? '').includes('멈춰'), '그물이 정직을 역으로 물었다 — F-88 계보 위반');
});

// 반대시험 (i) — §7-cc-1 검증 칸. 실패 **뒤** 같은 턴 회복(§7-ca R1·R2 라이브 실물)이 서면
// 생존 주장은 참일 수 있다 — 그물이 회복을 물면 F-88(참을 거짓으로 몲) 계보 위반이다.
test('반대시험 — 실패 뒤 같은 턴 회복이 서면 생존 주장을 안 문다', () => {
  const 실패영수증 = {
    actualCall: { tool: 'local.terminal', args: { command: 'node 서버.mjs' } },
    failureState: 'failed', diagnosticTrace: { stopped: 'timeout' },
  };
  const 회복영수증 = {
    actualCall: { tool: 'local.process', args: { action: 'start', command: 'node 서버.mjs' } },
    failureState: 'none', result: { alive: true },
  };
  const 답 = '터미널 상한에 걸려서 상주 실행으로 다시 켰고, 지금도 잘 떠 있어요.';
  const 회복턴 = 완료주장검증({ reply: 답, receipts: [실패영수증, 회복영수증], 원장글: JSON.stringify([실패영수증, 회복영수증]) });
  // 재는 것은 **이 그물의 침묵**이다 — 기존 그물(못한걸음: 실패 걸음이 남았는데 답이 그 사실을
  // 안 밝힘)이 이 턴을 무는 것은 A1 이전부터의 행동이고 이 슬라이스 정의역 밖(불변). 이 그물의
  // 문장이 나오면 회복 제외가 깨진 것이다 — 참을 거짓으로 몬다(F-88).
  assert.ok(!(회복턴.모델에게 ?? '').includes('살아 있는 것처럼'),
    '회복 턴의 생존 주장을 이 그물이 물었다 — 실패 뒤 회복 성공 제외(§7-cc-1 정의역)가 깨졌다');
  // 대조군 — 같은 답이라도 회복 영수증이 없으면(죽음 언급도 없는 꼴로) 그물이 선다.
  const 거짓답 = '서버 잘 띄웠고 지금도 잘 떠 있어요. 확인 끝났습니다.';
  const 죽은턴 = 완료주장검증({ reply: 거짓답, receipts: [실패영수증], 원장글: JSON.stringify([실패영수증]) });
  assert.equal(죽은턴.일치, false, '회복 없는 죽은 실행 위 생존 주장이 그대로 지나갔다');
  assert.ok((죽은턴.모델에게 ?? '').includes('살아 있는 것처럼'), '돌려준 사실이 원장의 실패를 가리키지 않는다');
});
