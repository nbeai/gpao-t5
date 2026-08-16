// §7-br 선빨강 — **입장 거부는 완료를 막는 것이지, 사실을 지우는 것이 아니다**
//
// 라이브 실측(§7-bq-4 · bq-소검증-실측.md 실측 3): 터미널이 아카이브를 실제로 만들었고 원장
// 영수증에 새로생긴것들 이 실렸는데, 같은 턴에 FILE 서면 계약 입장이 거부되자(turn.js:1945)
// 서버 삭제(server.js:2163)가 result.workingState **전체**를 지워 사실 줄까지 죽었다 —
// 사용자와 다음 턴 모델이 방금 만들어진 실물의 자리를 못 받는다. §7-bn-2 교훈의 서버판.
//
// 정의역은 「입장 거부 턴」 전체다(검문) — 터미널 갈래 하나로 전체를 판정하지 않는다.
// 거부를 결정적으로 만드는 재료: 사용자 문장에 명시 경로가 없으면 parseFileRequest 가
// 단일 경로를 못 세워 completionBasis 가 unverified → sliceAdmitted false → 거부(코드 사실).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';

async function 방() {
  const d = await mkdtemp(join(tmpdir(), 'rejected-facts-'));
  await mkdir(join(d, '시작문서'), { recursive: true });
  await writeFile(join(d, '시작문서', 'a.md'), 'hello');
  return d;
}

async function 판(자리, { run, model }) {
  const dir = await mkdtemp(join(tmpdir(), 'rejected-facts-srv-'));
  const store = new SessionStore(dir);
  const tools = demoTools({
    localFile: makeLocalFileTool({ roots: [자리], dataDir: dir }),
    ...(run ? { localTerminal: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }) } : {}),
  });
  const server = makeServer({ store, tools, model });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (body) => (await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  const { id: sessionId } = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  return { server, turn, sessionId };
}

// 계측 정정(자백): 결과물 줄 문장은 workingState 객체가 아니라 사실 렌더(contextShown·모델
// 입력)에 산다 — 첫 판 헬퍼가 workingState 만 읽어 수리 전후 모두 빨강(측정 불능)이었다.
// 진짜 계약은 「다음 턴 모델 입력 도달」이므로 2턴 형태로 직접 잰다. 둘째 자백: 입력 전체
// 문자열 검색은 대화 이력의 명령 원문 메아리에 또 오염된다(같은 함정 2회) — 결과물 줄 문장만 문다.

// 귀속 실측(정직 기록): 이 판에서는 (i)가 수리를 걷어도 초록이다 — 거부·삭제가 무는 턴이
// 라이브 실측 3(재개 턴 삭제)과 달리 이 조립에서는 승계를 안 끊는 자리에 떨어진다.
// 수리 귀속은 (ii)가 진다(걷으면 빨강). (i)는 터미널 거부 모양의 **보존 닻**으로 남긴다.
test('닻(터미널 거부 모양) — 거부 턴에서도 터미널 산출물의 사실이 다음 턴에 산다', async () => {
  const 자리 = await 방();
  const run = async (command, { mode } = {}) => {
    if (mode !== 'granted') {
      return { command, cwd: 자리, mode, sandboxed: true, exitCode: 1, stdout: '',
        stderr: 'cannot create: 묶음.tgz: Operation not permitted', durationMs: 1 };
    }
    writeFileSync(join(자리, '묶음.tgz'), '실물');
    return { command, cwd: 자리, mode: 'granted', exitCode: 0, stdout: '', stderr: '', durationMs: 1 };
  };
  let 걸음 = 0;
  const 둘째턴입력 = [];
  let 둘째턴 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (둘째턴) 둘째턴입력.push(JSON.stringify(tc?.workingState?.deliverables ?? null));
      // 서면이 열리면 FILE — deliverables 가 서고, 사용자 문장에 명시 경로가 없어 입장 거부로 간다.
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (둘째턴) return { text: '아까 만든 거 있어요.', toolCalls: [] };
      걸음 += 1;
      // 파일 손을 한 걸음 끼워 fileWorkIsInPlay 를 참으로 — 라이브 실측 3의 모양 그대로.
      if (걸음 === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: 자리 } }] };
      if (걸음 === 2) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'tar czf 묶음.tgz 시작문서', cwd: 자리 } }] };
      return { text: '묶어 뒀어요.', toolCalls: [] };
    },
    두번째로() { 둘째턴 = true; },
    입력들() { return 둘째턴입력; },
  };
  const { server, turn, sessionId } = await 판(자리, { run, model });
  try {
    let r = await turn({ sessionId, text: '여기 통째로 묶어 둬' });
    let 개입 = 0;
    while (r.kind === 'approval' && 개입 < 3) { 개입 += 1; r = await turn({ sessionId, approve: r.pendingId }); }
    assert.equal(r.kind, 'reply');
    // R-1 완료 얼굴 — 거부는 거부대로 선다(수리가 완료를 되살리면 F-64 반대 방향 사고).
    assert.equal(r.recentOutcome, undefined, '거부 턴에 완료 결과가 살아났다');
    assert.equal(r.deliverables, undefined, '거부 턴에 완료 투영이 살아났다');
    // 진짜 계약: **다음 턴 모델 입력**에 산출물 자리가 닿는다(§7-bq 종료칸 (b) 그대로).
    model.두번째로();
    const r2 = await turn({ sessionId, text: '방금 만든 거 어디 있어?' });
    assert.equal(r2.kind, 'reply');
    // 셋째 자백: 스텁 모델은 프로바이더 렌더 **이전**의 tc 를 받는다 — 줄 문장이 아니라
    // tc.workingState.deliverables(객체)가 스텁 계측의 정의역이다. 문장 렌더는
    // model-provider.js:222 + working-state 검사망이 문다. subjects 의 명령 메아리도 이걸로 피한다.
    assert.ok(model.입력들().some((x) => x.includes('묶음.tgz')),
      '**입장 거부가 사실의 승계를 끊었다** — 실물은 디스크에, 영수증은 원장에 있는데 '
      + 'workingState 삭제로 세션에 안 실려(server 2350) 다음 턴 모델이 자기 산출물의 자리를 못 받는다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('★ 선빨강 — 거부 턴에서도 파일 손 write 의 사실이 다음 턴에 산다 (귀속: 걷으면 빨강)', async () => {
  const 자리 = await 방();
  let 썼다 = false;
  const 둘째턴입력 = [];
  let 둘째턴 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (둘째턴) 둘째턴입력.push(JSON.stringify(tc?.workingState?.deliverables ?? null));
      if (tc?.workContractAssessment) return { text: 'FILE', toolCalls: [] };
      if (!opts.tools?.length) return '끝.';
      if (둘째턴) return { text: '아까 적었어요.', toolCalls: [] };
      if (!썼다) { 썼다 = true; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: join(자리, '기록.md'), text: '적음' } }] }; }
      return { text: '적어 뒀어요.', toolCalls: [] };
    },
    두번째로() { 둘째턴 = true; },
    입력들() { return 둘째턴입력; },
  };
  const { server, turn, sessionId } = await 판(자리, { model });
  try {
    // 명시 경로 없는 문장 — parseFileRequest 단일 경로 불성립 → unverified → 거부(코드 사실).
    const r = await turn({ sessionId, text: '오늘 한 일 간단히 남겨 둬' });
    assert.equal(r.kind, 'reply');
    assert.equal(r.recentOutcome, undefined, '거부 턴에 완료 결과가 살아났다');
    model.두번째로();
    const r2 = await turn({ sessionId, text: '방금 만든 거 어디 있어?' });
    assert.equal(r2.kind, 'reply');
    assert.ok(model.입력들().some((x) => x.includes('기록.md')),
      '입장 거부가 파일 손 write 사실의 승계까지 끊었다 — 같은 결함의 둘째 갈래');
  } finally { await new Promise((r) => server.close(r)); }
});

// 보존 닻(거부 없는 FILE 턴)은 이 환경에서 세울 수 없다 — 계측 사실: 입장(direct_exact)은
// ctx.initialWorksetReality.currentRoot 를 요구하는데 이 판에는 그 관측이 없어, 구조 채널로
// sourcePolicy 까지 답해도 completionBasis 가 unverified 로 떨어진다(= 모든 FILE 턴이 거부 턴).
// 정상 완료 경로의 보존은 기존 F-64 검사망이 문다: test/f64-l7-process-hash-completion.test.js ·
// test/f64-l5-l7-deterministic-probes.test.js (검문 §3-6 — 이미 선 것을 믿는다 · 중복 닻 금지).
