// **모델이 낸 호출은 하나도 합쳐지지 않고 하나도 조용히 사라지지 않는다.**
//
// 이 파일은 원래 벽을 **기록**하던 검사였다. S1 실모델 6회차(2026-08-04, gpt-5.1 · 437개)에서
// 회차 6 의 모델이 한 응답에 `local.file move` 를 다섯 개 냈는데(`backup-1329.png` ·
// `2071.png` · `2556.png` · `4078.png` · `1218.svg` → `images/`) 옮겨진 것은 **마지막 하나뿐**
// 이었다. 나머지 넷은 실행도, 실패도, 고지도 없었다.
//
// 벽은 두 겹이었다:
//   `tool-schema.js`  toolArgs[id] = { ...(toolArgs[id] ?? {}), ...args }  ← 같은 손을 하나로 합침
//   `turn.js`         const toolId = parts.neededTools?.[0]               ← 그중 첫 손 하나만 집음
//   그리고 계획 경로(`executePlan`)도 `plan.toolsToUse` 를 돌며 도구 하나당 인자 하나만 실행
//
// 그래서 T5 의 실행 입자는 "한 걸음 = 한 파일"이 아니라 **"한 왕복 = 한 호출"** 이었고,
// 걸음 상한 6과 곱해 한 턴 최대 6개였다. 437개 앞에서 구조적으로 불가능한데
// **그 불가능이 모델에게도 사용자에게도 안 보였다.**
//
// 오너 판정(2026-08-04): *"다중 tool call 이 병합·폐기되는 실행 벽은 모델 주권 계약의
// 본체이므로 즉시 수정하라. 모델이 낸 모든 호출의 callId·순서·Authority·실행 결과·
// ToolReceipt 를 보존해 전부 모델에게 돌려줘라."*
//
// 이제 이 파일은 **그 계약을 지킨다.** 성공 선언이 아니라 계약의 기계 사실이다 —
// 실모델에서 실제로 열렸는지는 별도 회차가 답한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

const 파일들 = ['backup-1329.png', 'backup-2071.png', 'backup-2556.png', 'backup-4078.png', 'backup-1218.svg'];

/** 같은 대본으로 한 팔을 돌린다 — move 다섯을 **한 응답에** 낸다(회차 6 재현). */
async function 다섯을내본다(주객회복, { 호출들 = null } = {}) {
  const 원래 = process.env.T5_MODEL_SOVEREIGN;
  if (주객회복) process.env.T5_MODEL_SOVEREIGN = '1';
  else delete process.env.T5_MODEL_SOVEREIGN;
  try {
    const dir = await mkdtemp(join(tmpdir(), 's1-wall-'));
    await mkdir(join(dir, 'images'), { recursive: true });
    for (const f of 파일들) await writeFile(join(dir, f), `내용 ${f}`);
    const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
    const 실행된인자 = [];
    const 원핸들러 = localFile.handler.bind(localFile);
    localFile.handler = async (a) => { 실행된인자.push(a); return 원핸들러(a); };
    let 냈나 = false;
    const model = {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        if (opts.tools?.length && !냈나) {
          냈나 = true;
          return { text: '', toolCalls: 호출들 ? 호출들(dir) : 파일들.map((f, i) => ({
            id: `wire_${i + 1}`,
            name: 'local.file',
            args: { action: 'move', path: join(dir, f), to: join(dir, 'images', f) },
          })) };
        }
        return '정리했어요.';
      },
    };
    const r = await runTurn({ text: 'backup 파일들 images 로 옮겨줘' },
      { env: demoEnv(), tools: demoTools({ localFile }), model });
    return { r, dir, 실행된인자, 옮겨진것: 파일들.filter((f) => existsSync(join(dir, 'images', f))) };
  } finally {
    if (원래 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 원래;
  }
}

// ── ① 합치지 않는다 ────────────────────────────────────────────────────────
test('한 응답에 낸 move 다섯이 **다섯 다** 실행된다(회차 6 재현)', async () => {
  const { 옮겨진것, 실행된인자 } = await 다섯을내본다(true);
  assert.deepEqual(옮겨진것, 파일들,
    `합쳐지거나 버려진 것이 있다 — 옮겨진 것: ${옮겨진것.join(', ') || '(없음)'}`);
  const 이동인자 = 실행된인자.filter((a) => a.action === 'move');
  assert.equal(이동인자.length, 5, '손이 다섯 번 불려야 한다 — 인자 병합이 남아 있으면 한 번이다');
});

test('모델이 낸 **순서 그대로** 실행된다', async () => {
  const { 실행된인자 } = await 다섯을내본다(true);
  const 순서 = 실행된인자.filter((a) => a.action === 'move').map((a) => String(a.path).split('/').pop());
  assert.deepEqual(순서, 파일들, '순서가 뒤바뀌면 모델이 세운 계획의 의미가 달라진다');
});

test('서로 다른 손을 함께 내도 둘 다 선다(한 손만 집지 않는다)', async () => {
  const { r, 실행된인자 } = await 다섯을내본다(true, {
    호출들: (dir) => [
      { id: 'w1', name: 'local.file', args: { action: 'move', path: join(dir, 파일들[0]), to: join(dir, 'images', 파일들[0]) } },
      { id: 'w2', name: 'local.file', args: { action: 'move', path: join(dir, 파일들[1]), to: join(dir, 'images', 파일들[1]) } },
      { id: 'w3', name: 'local.file', args: { action: 'list', path: dir } },
    ],
  });
  assert.equal(실행된인자.filter((a) => a.action === 'move').length, 2);
  assert.equal(실행된인자.filter((a) => a.action === 'list').length, 1, '뒤에 온 다른 작업이 사라졌다');
  assert.equal(r.kind, 'reply');
});

// ── ② 못 한 것은 사실로 남고 모델에게 돌아간다 ─────────────────────────────
test('실행하지 못한 호출도 자기 호출로 원장에 남는다(조용한 축소 금지)', async () => {
  // 같은 인자를 두 번 내면 뒤엣것은 되풀이라 실행하지 않는다 — 그 사실이 남아야 한다.
  const { r } = await 다섯을내본다(true, {
    호출들: (dir) => [
      { id: 'w1', name: 'local.file', args: { action: 'move', path: join(dir, 파일들[0]), to: join(dir, 'images', 파일들[0]) } },
      { id: 'w2', name: 'local.file', args: { action: 'move', path: join(dir, 파일들[0]), to: join(dir, 'images', 파일들[0]) } },
      { id: 'w3', name: 'nonexistent.hand', args: { x: 1 } },
    ],
  });
  assert.equal(r.kind, 'reply');
  // 되풀이는 **미확인이 아니다** — 같은 일이 이미 확인됐으니 안 한 것이다.
  assert.equal(r.ledger.unconfirmed.some((s) => s.includes('같은 일이라')), false,
    '되풀이 건너뜀이 "아직 못 한 일"로 잡히면 턴 전체가 미완료로 읽힌다');
  // 없는 손은 **안 된 일**이다 — 사용자가 알아야 한다.
  assert.ok(r.ledger.unconfirmed.some((s) => s.includes('그 손은 지금 없어요')),
    `없는 손을 골랐다는 사실이 사라졌다: ${JSON.stringify(r.ledger)}`);
});

test('못 한 호출이 **모델 입력**에 자기 호출로 돌아간다(계약 ②)', async () => {
  // 원장에만 남고 모델에게 안 가면 계약 ②("모든 도구 결과는 모델 자신의 행동 이력으로
  // 돌아간다")를 못 지킨다 — 모델은 자기가 시킨 것이 갔다고 믿은 채 답을 쓴다.
  const selfState = buildSelfState(demoEnv());
  const 못한것 = {
    intended: '파일 도구 실행',
    actualCall: { tool: 'local.file', args: { action: 'move', path: 'a.png', to: 'images/a.png' } },
    failureState: 'blocked',
    userSafeSummary: '한 번에 할 수 있는 만큼만 하고 나머지는 남겨 뒀어요.',
    diagnosticTrace: { callId: 'wire_5', 순번: 5, tool: 'local.file', reason: '걸음상한' },
  };
  const tc = buildTaskContext({
    intent: { currentRequest: '옮겨줘' }, selfState, receipts: [못한것],
  });
  const 전문 = JSON.stringify(tc);
  assert.ok(전문.includes('a.png'), '무엇을 시키려 했는지가 모델에게 안 간다');
  assert.ok(전문.includes('남겨 뒀어요'), '왜 안 갔는지가 모델에게 안 간다');
  assert.equal(전문.includes('걸음상한'), false, '진단면 내부 분류값이 모델 입력으로 새면 안 된다');
});

// ── ③ 안전은 열지 않는다 ───────────────────────────────────────────────────
test('호출마다 권한 판정을 그대로 탄다 — 되돌릴 수 없는 것은 여전히 묻는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 's1-wall-auth-'));
  await writeFile(join(dir, 'a.txt'), 'x');
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  let 터미널실행 = 0;
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 터미널실행 += 1; return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '했어요.' }; },
  };
  let 냈나 = false;
  const model = {
    async respond(tc, opts = {}) {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (opts.tools?.length && !냈나) {
        냈나 = true;
        return { text: '', toolCalls: [
          { id: 'w1', name: 'local.file', args: { action: 'read', path: join(dir, 'a.txt') } },
          { id: 'w2', name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } },
        ] };
      }
      return '했어요.';
    },
  };
  const 원래 = process.env.T5_MODEL_SOVEREIGN;
  process.env.T5_MODEL_SOVEREIGN = '1';
  let r;
  try {
    r = await runTurn({ text: 'a.txt 읽고 임시폴더 지워줘' },
      { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model });
  } finally {
    if (원래 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 원래;
  }
  assert.equal(r.kind, 'approval', '되돌릴 수 없는 명령이 여러 호출에 섞였다고 자동으로 새면 안 된다');
  assert.equal(터미널실행, 0, '승인 전 효과 0 — 줄로 세운 뒤에도 이 경계는 그대로다');
});
