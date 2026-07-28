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

// ── 감사 보충(2026-07-29): 봉인 증거 2건 ─────────────────────────────────

// B'. **실제로 편입한 손의 전송 서버를 실제로 끊는다.** (주입 B 는 손 모양만 흉내냈다 —
// 이 검사는 진짜 MCP 클라이언트·편입 기계·죽은 소켓을 관통한다. 로컬 루프백만 쓴다.)
test("B'. 편입된 원격 손의 전송 사망: 호출 1회 · 거짓 성공 0 · 숨은 재시도 0", async () => {
  const { createServer } = await import('node:http');
  const { openHttpMcp } = await import('../src/runtime/mcp-http.js');
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');

  // 진짜 HTTP MCP 서버(테스트 자산 — 루프백).
  const srv = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    let msg = {}; try { msg = JSON.parse(body); } catch { /* notify */ }
    const reply = (result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, result })); };
    if (msg.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: '끊김', version: '0' } });
    if (msg.method === 'tools/list') return reply({ tools: [{ name: 'lookup', description: '찾기', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }] });
    if (msg.method === 'tools/call') return reply({ content: [{ type: 'text', text: '뜻풀이' }] });
    reply({});
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;

  const session = openHttpMcp({ url, timeoutMs: 3000 });
  await session.initialize();
  const mcpTools = await session.listTools();
  const ctx = { tools: demoTools(), descriptors: [], env: demoEnv() };
  const { admitted } = admitMcpTools({ connector: 'd-끊김', tools: mcpTools, session }, ctx);
  assert.equal(admitted.length, 1, '편입 실패');
  const toolId = admitted[0];

  // 살아 있을 때 한 번 — 편입이 실제로 동작함을 먼저 확인(연결≠사용 구분).
  const alive = await ctx.tools.tools[toolId].handler({ q: 'svelte' });
  assert.ok(JSON.stringify(alive).includes('뜻풀이'));

  // **전송 서버를 실제로 끊는다.**
  srv.closeAllConnections?.();
  await new Promise((r) => srv.close(r));

  // 호출 횟수를 세는 투명 래퍼(runtime 동작은 그대로).
  let 호출 = 0;
  const 원핸들러 = ctx.tools.tools[toolId].handler;
  ctx.tools.tools[toolId].handler = async (a) => { 호출 += 1; return 원핸들러(a); };

  // 모델이 같은 호출을 두 번 고집 — 편입 손은 승인 경계라 카드가 먼저 선다.
  const 모델 = 걸음모델([
    { name: toolId, args: { q: 'svelte' } },
    { name: toolId, args: { q: 'svelte' } },
  ], '조회가 안 돼서 확인하지 못했어요');
  const turnCtx = { env: ctx.env, tools: ctx.tools, model: 모델 };
  const r1 = await runTurn({ text: '끊김 사전에서 svelte 찾아줘' }, turnCtx);
  assert.equal(r1.kind, 'approval', `승인 경계가 안 섰다: ${r1.kind}`);
  const r2 = await runTurn({ approve: r1.pendingId }, turnCtx);

  assert.equal(호출, 1, `죽은 손이 ${호출}회 호출됐다 — 숨은 재시도`);
  const 성공 = [...(r2.ledger?.confirmed ?? [])].filter((e) => JSON.stringify(e).includes(toolId));
  assert.equal(성공.length, 0, `죽은 손이 성공으로 남았다: ${JSON.stringify(성공)}`);
  const 전부 = JSON.stringify(r2);
  assert.ok(!전부.includes('ECONNREFUSED') && !전부.includes('fetch failed'), '전송 진단이 사용자 결과에 샜다');
  assert.equal(r2.kind, 'reply');
});

// C2'. **서버 표면 관통** — 걸음 하나 성공 뒤 모델이 죽으면, /turn 응답·원장·저장된 대화가
// "이미 한 일은 보존됨"으로 **같은 이야기**를 해야 한다.
test("C2'. /turn 관통: 걸음 성공 후 모델 사망 — 응답·원장·저장 일치", async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readFile } = await import('node:fs/promises');

  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-c2p-'));
  const 손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(args) { return { result: { command: args.command, exitCode: 0, stdout: '자료', cwd: '/x' }, userSafeSummary: '봤어요.' }; },
  };
  let 첫호출 = true;
  const 도중죽는모델 = {
    async respond(_tc, opts = {}) {
      if (!opts.tools?.length) return '정리했어요';
      if (첫호출) { 첫호출 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
      throw new Error('stream cut');
    },
  };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 손 }), model: 도중죽는모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const r = await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text: '폴더 보고 정리해줘' }),
    })).json();
    // 응답: 한 일이 있음을 구분한 정직한 안내(지어낸 정리 결과 없음).
    assert.equal(r.kind, 'reply');
    assert.match(r.reply ?? '', /기록에 남겼어요/, `한 일 있음 구분이 없다: ${r.reply}`);
    // 저장: 세션에 영수증과 이 응답이 그대로 남았다.
    const saved = JSON.parse(await readFile(join(dir, `${s.id}.json`), 'utf8'));
    assert.ok((saved.ledgerEntries ?? []).length >= 1, '걸음 영수증이 세션에 없다');
    const last = saved.transcript[saved.transcript.length - 1];
    assert.equal(last.result.reply, r.reply, '응답과 저장된 대화가 다르다');
  } finally { await new Promise((r) => server.close(r)); }
});

// 입력 사실 — **실패 영수증과 복구 단서가 다음 모델 입력에 실제로 실리는가.**
// 런타임의 책임은 모델을 대본으로 교정하는 게 아니라 실패 현실을 공급하는 것이다(감사 지적).
test('실패 뒤 다음 모델 입력에 실패 영수증과 다음 길이 실린다', async () => {
  const 실패손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler() { return { failed: true, userSafeSummary: '그 폴더를 읽지 못했어요.', nextSafeAction: '다른 자리에서 찾아볼까요?' }; },
  };
  const 입력들 = [];
  let i = 0;
  const 관찰모델 = {
    async respond(tc, opts = {}) {
      입력들.push(tc);
      if (!opts.tools?.length) return '못 읽어서 확인하지 못했어요';
      if (i === 0) { i += 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
      return { text: '못 읽어서 확인하지 못했어요', toolCalls: [] };
    },
  };
  await runTurn({ text: '폴더 봐줘' }, { env: demoEnv(), tools: demoTools({ localTerminal: 실패손 }), model: 관찰모델 });
  // 실패 뒤에 온 모델 입력(마지막 입력)에 실패 사실과 복구 단서가 있어야 한다.
  const 뒤입력 = JSON.stringify(입력들[입력들.length - 1]);
  assert.ok(뒤입력.includes('그 폴더를 읽지 못했어요'), '실패 영수증이 다음 모델 입력에 없다');
  assert.ok(뒤입력.includes('다른') || 뒤입력.includes('recoveryHint') || 뒤입력.includes('다음'),
    `복구 단서가 다음 모델 입력에 없다: ${뒤입력.slice(0, 200)}`);
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

// ── P-OP-6 · 무효 선언은 "없음"이 아니라 상태와 이유로 보인다 ─────────────
test('무효화된 저장 선언이 진실 표면에 이유와 함께 나타난다(수정 전 실패)', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { DeclaredConnectorStore } = await import('../src/surface/declared-connector-store.js');
  const { makeConnectorDeclareTool } = await import('../src/runtime/connector-declare.js');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-inv-'));
  // 저장 당시엔 유효했지만 지금 규칙(안쪽 주소 차단)에서 떨어지는 선언.
  await writeFile(join(dir, 'declared-connectors.json'),
    JSON.stringify([{ service: '옛서비스', authKind: 'mcp', url: 'https://127.0.0.1:9/mcp', id: 'd-old' }]), 'utf8');
  const tools = demoTools();
  tools.tools['connector.declare'] = makeConnectorDeclareTool({ connectors: () => [], store: new DeclaredConnectorStore(dir) });
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools });
  await new Promise((r) => server.listen(0, r));
  try {
    const t = await (await fetch(`http://127.0.0.1:${server.address().port}/connectors/truth`)).json();
    const inv = (t.invalidDeclared ?? []).find((x) => x.label === '옛서비스');
    assert.ok(inv, `무효 선언이 표면에서 사라졌다: ${JSON.stringify(t.invalidDeclared)}`);
    assert.equal(inv.invalid, true);
    assert.match(inv.userSafe ?? '', /붙일 수 없어요/, '이유가 사람 말로 없다');
    // 유효한 커넥터 목록에는 섞이지 않는다(붙을 수 있는 척 금지).
    assert.ok(!(t.connectors ?? []).some((c) => c.id === 'd-old'), '무효 선언이 유효 목록에 섞였다');
  } finally { await new Promise((r) => server.close(r)); }
});

// ── 설치 전 필수(감사): 단일 writer · HMAC 지문 ──────────────────────────
test('단일 writer: 살아 있는 다른 서버의 잠금이 있으면 정직하게 멈춘다 · 죽은 잠금은 스스로 걷는다', async () => {
  const { acquireWriterLock } = await import('../src/surface/writer-lock.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-lock-'));
  const first = await acquireWriterLock(dir, { pid: process.pid });
  // 살아 있는 pid(우리 자신)가 잡고 있는데 다른 주체가 또 잡으려 하면 — 멈춘다.
  await assert.rejects(() => acquireWriterLock(dir, { pid: process.pid + 999999 }), /다른 T5 서버/);
  await first.release();
  // 해제 뒤엔 잡힌다.
  const second = await acquireWriterLock(dir, { pid: process.pid });
  await second.release();
  // 죽은 pid 의 잠금은 스스로 걷는다(강제 종료 복구).
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, '.writer-lock.json'), JSON.stringify({ pid: 99999999, at: 0 }), 'utf8');
  const third = await acquireWriterLock(dir, { pid: process.pid });
  await third.release();
});

test('기억 지문은 로컬 비밀키 HMAC — 사전 대입으로 평문을 추측할 수 없다', async () => {
  const { MemoryLedger, memoryDigest } = await import('../src/surface/memory-store.js');
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const a = await mkdtemp(join(tmpdir(), 'gpao-t5-hmac-a-'));
  const b = await mkdtemp(join(tmpdir(), 'gpao-t5-hmac-b-'));
  const 항목 = { candidateId: 'c1', kind: 'preference', statement: '보고서는 목록으로' };
  const ea = await new MemoryLedger(a).append('proposed', 항목);
  const eb = await new MemoryLedger(b).append('proposed', 항목);
  // 같은 문장이라도 자리(키)가 다르면 지문이 다르다 — 평문 사전 대입이 성립하지 않는다.
  assert.notEqual(ea.digest, eb.digest, '지문이 키와 무관하다 — 사전 대입 가능');
  // 평문 sha256 절단과도 다르다(키 없는 옛 방식으로 추측 불가).
  assert.notEqual(ea.digest, memoryDigest('보고서는 목록으로'), '평문 지문 그대로다');
  // 같은 자리에서는 같은 문장 → 같은 지문(수명주기 연결은 유지).
  const ea2 = await new MemoryLedger(a).append('rolled_back', 항목);
  assert.equal(ea.digest, ea2.digest, '같은 자리의 수명주기 연결이 끊겼다');
  // 키 파일은 0600.
  const { statSync } = await import('node:fs');
  assert.equal(statSync(join(a, 'memory-ledger.key')).mode & 0o777, 0o600, '키 파일 권한이 넓다');
});

test('무효 선언 정리: 사용자가 만든 것은 사용자가 거둔다(/connectors/declared/remove)', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { DeclaredConnectorStore } = await import('../src/surface/declared-connector-store.js');
  const { makeConnectorDeclareTool } = await import('../src/runtime/connector-declare.js');
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-rm-'));
  await writeFile(join(dir, 'declared-connectors.json'),
    JSON.stringify([{ service: '옛서비스', authKind: 'mcp', url: 'https://127.0.0.1:9/mcp', id: 'd-old' }]), 'utf8');
  const tools = demoTools();
  const store = new DeclaredConnectorStore(dir);
  tools.tools['connector.declare'] = makeConnectorDeclareTool({ connectors: () => [], store });
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await (await fetch(`${base}/connectors/declared/remove`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'd-old' }),
    })).json();
    assert.equal(r.removed, true);
    // 진실 표면에서도 사라진다 — 정리했으니 이제 "없음"이 사실이다.
    const t = await (await fetch(`${base}/connectors/truth`)).json();
    assert.ok(!(t.invalidDeclared ?? []).length, '정리했는데 무효 선언이 남아 보인다');
    assert.equal((await store.load()).length, 0, '저장소에 선언이 남았다');
  } finally { await new Promise((r) => server.close(r)); }
});

// ── 감사 재현 2건(2026-07-29) — 수정 전 실제로 실패했다 ──────────────────
test('잠금 동시 획득: 정확히 하나만 이긴다(원자적 wx — 수정 전 2/2 성공)', async () => {
  const { acquireWriterLock } = await import('../src/surface/writer-lock.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-race-'));
  const rs = await Promise.allSettled([
    acquireWriterLock(dir, { pid: process.pid }),
    acquireWriterLock(dir, { pid: 1 }), // 살아 있는 다른 pid(launchd)
  ]);
  const wins = rs.filter((r) => r.status === 'fulfilled');
  assert.equal(wins.length, 1, `동시 획득 ${wins.length}건 — 경합이 남아 있다`);
  await wins[0].value.release();
});

test('손상된 지문 키로 평문에 후퇴하지 않는다(수정 전 평문 sha256 과 동일)', async () => {
  const { MemoryLedger, memoryDigest } = await import('../src/surface/memory-store.js');
  const { mkdtemp, writeFile, readdir, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-keyc-'));
  await writeFile(join(dir, 'memory-ledger.key'), '   \n', 'utf8'); // 손상(형식 아님)
  const e = await new MemoryLedger(dir).append('proposed', { candidateId: 'c', kind: 'preference', statement: '보고서는 목록으로' });
  assert.notEqual(e.digest, memoryDigest('보고서는 목록으로'), '평문 sha256 으로 후퇴했다');
  // 손상 키는 격리 보존됐고 새 키는 유효한 형식이다.
  const files = await readdir(dir);
  assert.ok(files.some((f) => f.startsWith('memory-ledger.key.corrupt-')), '손상 키가 보존되지 않았다');
  assert.match((await readFile(join(dir, 'memory-ledger.key'), 'utf8')).trim(), /^[0-9a-f]{64}$/);
});

// ── 감사 재현(2026-07-29): 잠금 소유는 pid 가 아니라 pid+ownerToken ───────
test('같은 pid 의 두 번째 획득은 차단되고, 늦은 해제가 남의 잠금을 지우지 않는다(수정 전 실패)', async () => {
  const { acquireWriterLock } = await import('../src/surface/writer-lock.js');
  const { mkdtemp, readFile, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-own-'));
  const lockPath = join(dir, '.writer-lock.json');

  // ① 같은 pid 의 두 번째 획득 — "내 죽은 잔여"로 오인하지 않고 차단한다.
  const first = await acquireWriterLock(dir);
  await assert.rejects(() => acquireWriterLock(dir), /다른 T5 서버/, '같은 pid 라고 살아 있는 잠금을 걷었다');

  // ② 늦은(중복) 해제가 새 소유자의 잠금을 지우지 않는다.
  await first.release();
  const second = await acquireWriterLock(dir); // 새 소유자
  await first.release(); // 옛 소유자의 늦은 해제 — 신분(token)이 달라 아무것도 안 지운다
  const cur = JSON.parse(await readFile(lockPath, 'utf8'));
  assert.ok(cur?.ownerToken, '새 소유자의 잠금이 지워졌다(늦은 해제가 남의 잠금을 삭제)');
  await second.release();

  // ③ 해제 후 새 획득 정상.
  const third = await acquireWriterLock(dir);
  await third.release();

  // ④ 죽은 pid 잔여는 여전히 스스로 걷는다.
  await writeFile(lockPath, JSON.stringify({ pid: 99999999, ownerToken: 'x', at: 0 }), 'utf8');
  const fourth = await acquireWriterLock(dir);
  await fourth.release();
});

// ── 감사 재현(2026-07-29, 2차): EPERM 은 생존이다 · 죽은 잠금 회수는 한 명만 ──
test('EPERM 을 주는 pid(신호 권한 없음)는 살아 있는 잠금이다(수정 전: 죽음으로 오판해 회수)', async () => {
  const { acquireWriterLock } = await import('../src/surface/writer-lock.js');
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-eperm-'));
  // pid 1(launchd) 은 비루트에게 EPERM 을 준다 — 살아 있다는 뜻이다.
  await writeFile(join(dir, '.writer-lock.json'), JSON.stringify({ pid: 1, ownerToken: 't', at: 0 }), 'utf8');
  await assert.rejects(() => acquireWriterLock(dir), /다른 T5 서버/, 'EPERM 생존을 죽음으로 오판했다');
  // 잠금 파일이 걷히지 않고 그대로 남아 있다.
  const cur = JSON.parse(await readFile(join(dir, '.writer-lock.json'), 'utf8'));
  assert.equal(cur.pid, 1, '살아 있는 잠금이 걷혔다');
});

test('죽은 잠금을 둘이 동시에 회수해도 정확히 하나만 획득한다(20회 반복 · 0회 실패)', async () => {
  const { acquireWriterLock } = await import('../src/surface/writer-lock.js');
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  for (let i = 0; i < 20; i++) {
    const dir = await mkdtemp(join(tmpdir(), `gpao-t5-reclaim-${i}-`));
    await writeFile(join(dir, '.writer-lock.json'), JSON.stringify({ pid: 99999999, ownerToken: 'dead', at: 0 }), 'utf8');
    const rs = await Promise.allSettled([
      acquireWriterLock(dir, { pid: process.pid }),
      acquireWriterLock(dir, { pid: process.pid }),
    ]);
    const wins = rs.filter((r) => r.status === 'fulfilled');
    assert.equal(wins.length, 1, `${i}회차: 동시 회수에서 ${wins.length}명이 획득했다`);
    // 남은 잠금은 이긴 쪽 것이고 죽은 항목이 아니다.
    const cur = JSON.parse(await readFile(join(dir, '.writer-lock.json'), 'utf8'));
    assert.equal(cur.pid, process.pid);
    assert.notEqual(cur.ownerToken, 'dead');
    await wins[0].value.release();
  }
});
