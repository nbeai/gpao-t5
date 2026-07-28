// P-OP-4 · **도구 실패 · 연결 끊김 · 모델 응답 실패를 대표 경로로 주입한다.**
//
// 계약(작업지시서 P-OP-4): 같은 실패 반복 없음 · 숨은 재시도 없음 · 다른 손 전환 또는
// 정직한 다음 길 · 원장과 답이 같은 사실. 이 파일은 **판정용**으로 먼저 쓰였다 —
// 수정 전에 세 실패를 한꺼번에 관찰하고(감사 지시), 공통 원인만 공통 경계에서 고친다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** 지정한 도구 호출을 순서대로 내놓는 모델. */
function 걸음모델(계획, 답 = '정리했어요') {
  let i = 0;
  return {
    호출수: () => i,
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return 답;
      if (i >= 계획.length) return { text: 답, toolCalls: [] };
      const 걸음 = 계획[i]; i += 1;
      return { text: '', toolCalls: [걸음] };
    },
  };
}

// ── 주입 A: 도구 실패(핸들러 예외) ───────────────────────────────────────
test('A. 던지는 도구: 실패 영수증 정직 · 같은 인자 재실행 0 · 내부 오류 비노출', async () => {
  let 호출 = 0;
  const 던지는손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler() { 호출 += 1; throw new Error('EIO: disk error at /dev/x0'); },
  };
  // 모델이 같은 명령을 세 번 고집한다 — 숨은 재시도가 있으면 호출이 3이 된다.
  const r = await runTurn(
    { text: '작업 폴더 봐줘' },
    { env: demoEnv(), tools: demoTools({ localTerminal: 던지는손 }),
      model: 걸음모델([
        { name: 'local.terminal', args: { command: 'ls' } },
        { name: 'local.terminal', args: { command: 'ls' } },
        { name: 'local.terminal', args: { command: 'ls' } },
      ]) },
  );
  assert.equal(호출, 1, `같은 실패가 반복 실행됐다: ${호출}회`);
  const 실패 = [...(r.ledger?.unconfirmed ?? []), ...(r.ledger?.estimated ?? [])];
  assert.ok(실패.length >= 1, `실패가 원장에 없다: ${JSON.stringify(r.ledger)}`);
  const 전부 = JSON.stringify(r);
  assert.ok(!전부.includes('EIO') && !전부.includes('/dev/x0'), '내부 오류 문자열이 사용자 결과에 샜다');
  assert.equal(r.kind, 'reply');
});

// ── 주입 B: 연결 끊김(편입된 원격 손의 전송 계층 사망) ────────────────────
test('B. 끊긴 원격 손: 성공을 지어내지 않는다 · 원장-답 일치 (판정: 현재 계약 관찰)', async () => {
  // 편입된 MCP 손의 실제 모양대로 — 전송 계층이 죽으면 callTool 이 던진다.
  const tools = demoTools();
  tools.tools['mcp.d-x.query'] = {
    async handler() { throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:9999'); },
  };
  const env = demoEnv();
  env.connections.push({
    id: 'mcp.d-x.query', label: '문서 조회', connected: true, executable: true, hasHandler: true,
    toolKind: 'read', schema: { description: '문서를 조회한다', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
  });
  const r = await runTurn(
    { text: '문서에서 훅 정리해줘' },
    { env, tools, model: 걸음모델([{ name: 'mcp.d-x.query', args: { q: 'hooks' } }], '조회가 안 돼서 정리를 못 했어요') },
  );
  // 성공 원장 0 — 끊겼는데 "조회했다"가 남으면 원장이 거짓이 된다.
  const 성공 = (r.ledger?.confirmed ?? []).filter((e) => JSON.stringify(e).includes('mcp.d-x'));
  assert.equal(성공.length, 0, `끊긴 손이 성공으로 남았다: ${JSON.stringify(성공)}`);
  const 전부 = JSON.stringify(r);
  assert.ok(!전부.includes('ECONNREFUSED') && !전부.includes('127.0.0.1:9999'), '연결 진단이 사용자 결과에 샜다');
  assert.equal(r.kind, 'reply');
});

// ── 주입 C: 모델 응답 실패 ───────────────────────────────────────────────
test('C1. 첫 호출부터 모델이 죽으면 — 실행 0 · 정직한 실패(지어낸 답 없음)', async () => {
  const 죽는모델 = { async respond() { throw new Error('provider 500: upstream'); } };
  let 실행 = 0;
  const 손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler() { 실행 += 1; return { result: {}, userSafeSummary: '했어요.' }; },
  };
  await assert.rejects(
    () => runTurn({ text: '작업 폴더 봐줘' }, { env: demoEnv(), tools: demoTools({ localTerminal: 손 }), model: 죽는모델 }),
    /provider 500/,
    '모델이 죽었는데 턴이 답을 지어냈다',
  );
  assert.equal(실행, 0, '모델 실패 턴에서 도구가 실행됐다');
});

test('C2. 걸음 도중 모델이 죽으면 — 이미 한 일의 영수증은 남는다(서버가 그 사실로 답한다)', async () => {
  let 첫호출 = true;
  const 손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(args) { return { result: { command: args.command, exitCode: 0, stdout: '결과', cwd: '/x' }, userSafeSummary: '봤어요.' }; },
  };
  const 도중죽는모델 = {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '정리했어요';
      if (첫호출) { 첫호출 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
      throw new Error('stream cut');
    },
  };
  const ledger = { entries: [], append(e) { this.entries.push(e); return e; } };
  await assert.rejects(
    () => runTurn({ text: '폴더 보고 정리해줘' }, { env: demoEnv(), tools: demoTools({ localTerminal: 손 }), model: 도중죽는모델, ledger }),
    /stream cut/,
  );
  // 서버 계층 계약(server.js runAndPersistTurn catch): ctx.ledger 에 남은 영수증으로
  // "방금까지 한 일은 기록에 남겼어요"를 구분해 답한다. 커널이 남긴 영수증이 그 근거다.
  assert.ok(ledger.entries.length >= 1, '걸음의 영수증이 원장에 남지 않았다 — 서버가 구분할 근거가 없다');
});

// ── 판정 관찰: retry 계단과 같은-일-반복 금지의 교차 ─────────────────────
test('관찰. "다시 해볼게요" 계단 뒤 같은 인자 재시도 — 무엇이 이기는지 기록', async () => {
  let 호출 = 0;
  const tools = demoTools();
  tools.tools['web.collect'] = {
    sourceLedgerRequired: false,
    async handler() { 호출 += 1; return { failed: true, fetchState: 'timeout', userSafeSummary: '응답이 늦어요.', nextSafeAction: '잠시 후 다시 시도할까요?' }; },
  };
  const r = await runTurn(
    { text: '이 페이지 읽어줘' },
    { env: demoEnv(), tools,
      model: 걸음모델([
        { name: 'web.collect', args: { request: 'https://example.com/a' } },
        { name: 'web.collect', args: { request: 'https://example.com/a' } }, // 같은 인자 재시도(계단이 권한 그 일)
      ], '그 페이지는 지금 못 읽었어요') },
  );
  // 현재 계약: 지문(같은 손+인자 1회)이 이긴다 — 재시도는 이 턴에 없다.
  assert.equal(호출, 1, `타임아웃 재시도가 같은 턴에 실행됐다: ${호출}회`);
  assert.equal(r.kind, 'reply');
});
