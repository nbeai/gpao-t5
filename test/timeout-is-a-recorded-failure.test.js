// §7-bx 선빨강 — **타임아웃을 원장이 사실대로 센다** (오너 승인 수리 1 확장 · 2026-08-17)
//
// 실측 확정 결함(오너 4자 감사): granted 실행이 stopped:'timeout' 으로 죽어도 손이 성공 모양
// ({result}) 으로 돌려줘 영수증이 failureState:none — 죽은 실행이 원장에 깨끗한 성공으로 남고,
// model-provider:863 「내용 확인 안 됨」 표식과 복구 사다리가 이 갈래에서 영영 안 돈다.
// 비교군 셋 전부 타임아웃을 실패로 기록한다(오픈클로 failed · 헤르메스 124 · 클로드코드 에러).
// 정의역(오너 고정 · 좁게): granted/reach 실행 갈래의 타임아웃 강제 종료만. probe 는 밖.
// 부분 stdout 은 계속 준다 — 진단면(실패원문 · 확인 안 됨 표식)으로, 사실 승격 없이(:863 계약).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

async function 도구(모양) {
  const 자리 = await mkdtemp(join(tmpdir(), 'timeout-ledger-'));
  const run = async (command, { mode } = {}) => ({
    command, cwd: 자리, mode: mode === 'granted' ? 'granted' : mode,
    ...(모양 === '정지' ? { exitCode: -1, stopped: 'timeout', durationMs: 120000, stdout: '듣는 중: 부분출력', stderr: '' }
      : { exitCode: 0, durationMs: 5, stdout: '끝', stderr: '' }),
  });
  return makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true });
}

test('★ 선빨강 — granted 타임아웃은 실패로 선다 (failureState 가 none 이면 원장이 거짓)', async () => {
  const tool = await 도구('정지');
  const r = await tool.handler({ command: 'node 서버.mjs', granted: true });
  assert.equal(r.failed, true,
    '**죽은 실행이 성공 모양으로 돌아온다** — 영수증이 failureState:none 으로 서서, 원장은 깨끗한 '
    + '성공을 말하고 복구 사다리·「내용 확인 안 됨」 표식이 영영 안 돈다(비교군 셋 전부 실패로 기록)');
  // 부분 출력은 진단면으로 계속 준다 — 사실 승격 없이(:863 계약 그대로).
  assert.ok(JSON.stringify(r.diagnosticTrace ?? {}).includes('부분출력'),
    '실패로 세우며 부분 stdout 을 버렸다 — 내용은 주되 사실로 승격하지 않는 것이 계약이다');
  // §7-bv 행선지는 실패 갈래에서도 그대로 산다(수리 둘의 결합 — 행선지 없는 실패는 반쪽).
  assert.ok(JSON.stringify(r.다음수단 ?? []).includes('local.process'),
    '실패로 세우며 행선지(§7-bv)를 떨어뜨렸다 — 죽음의 사실과 다음 길은 함께 가야 한다');
});

test('반대시험(ii) — 정상 완료 exit 0 은 여전히 성공(none 경로)이다', async () => {
  const tool = await 도구('정상');
  const r = await tool.handler({ command: 'ls', granted: true });
  assert.equal(r.failed, undefined, '정상 완료가 실패로 승격됐다 — 정의역이 넓어졌다');
  assert.ok(r.result && r.userSafeSummary.includes('실행했어요'), '성공 갈래 모양이 깨졌다');
});

// ── 반대시험 (iii)(iv) — 결정적 스텁 서버 판(커널 문 :849 를 확실히 밟음 · 검문 층 지정) ──
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { 교환결과렌더 } from '../src/runtime/model-provider.js';

async function 판(답문장) {
  const 자리 = await mkdtemp(join(tmpdir(), 'timeout-honest-'));
  let granted호출 = 0;   // 빈 초록 방지(검문 ② · H09): FAILED 갈래가 실제로 돌았는지 검사가 스스로 센다
  const run = async (command, { mode } = {}) => (mode === 'write' && ++granted호출
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
  const dir = await mkdtemp(join(tmpdir(), 'timeout-honest-srv-'));
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
  return { r, granted호출: () => granted호출 };
}

test('반대시험(iii) — 정직한 「멈췄다」 답은 갈아치워지지 않는다', async () => {
  const 정직 = '서버를 띄웠지만 120초 상한에서 멈춰서 지금은 떠 있지 않아요. 계속 돌리려면 상주 실행으로 다시 켤게요.';
  const { r, granted호출 } = await 판(정직);
  assert.ok(granted호출() >= 1, '승인 흐름이 granted 실행에 안 닿았다 — 이 초록은 빈 측정이다(H09)');
  assert.equal(r.kind, 'reply');
  assert.ok((r.reply ?? '').includes('멈춰'),
    `정직한 실패 서술이 답에서 사라졌다 — 그물이 정직을 역으로 물었다. 답: ${(r.reply ?? '').slice(0, 120)}`);
});

// 반대시험(iv) 실측 기록(§7-bx-1): 「죽은 실행 위 성공 주장」 모양은 **수리 전(none)·후(FAILED)
// 동형으로 안 잡힌다** — 기계 확정(수리 걷고 같은 빨강). 즉 이 수리는 갈아치움 레인에 회귀를
// 만들지 않았고(레인 유지 ✓), 그 모양 자체는 기존부터 그물 정의역 밖이다 — 부채 대장 등재 ·
// 새 그물은 별도 오너 승인 사안(범위 조용한 확장 금지). 여기서는 레인 자체의 생존만 문다:
// (iii)가 정직 답 보존을, 아래가 갈아치움 레인의 기존 검사망 생존을 회귀로 문다.

test('새 경로 1:1 — FAILED 영수증의 다음수단이 모델 입력 렌더(「다음 수단」 줄)에 닿는다', () => {
  const 줄 = 교환결과렌더({ summary: '시간이 다 돼서 멈췄어요(120초).', failureState: 'failed',
    다음수단: [{ 방법: 'local.process:start', 왜: '계속 돌아야 하는 것을 켜 두는 손' }] });
  assert.ok(줄.includes('local.process'),
    '실패 갈래의 행선지가 모델 입력 렌더에 안 닿는다 — compactResult 경로가 닫힌 뒤의 새 1:1 경로가 끊겼다');
});
