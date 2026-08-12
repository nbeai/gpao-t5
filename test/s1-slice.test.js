// **S1 슬라이스가 정말 무는가** — 반대시험.
//
// 왜 이 파일이 있는가: `T5_MODEL_SOVEREIGN=1` 이 A 와 아무 차이도 안 만들면 S1 은 같은 팔을
// 여섯 번 돌리는 실험이 된다. 그런데 그 사실은 **통과하는 검사로는 안 드러난다** — 기존 회귀는
// 전부 A 팔 계약이라 플래그가 죽어 있어도 초록이다. preflight 첫 판이 `off1 vs off2` 를 비교해
// 구조적으로 실패할 수 없었던 것과 같은 병이다.
//
// 그래서 여기서는 **같은 대본·같은 발화**를 두 팔에 넣고 호출 순서를 나란히 놓는다.
// 두 팔이 같으면 이 검사가 빨개진다.
//
// 동결 §1 이 여는 셋(이 밖은 없다):
//   ① 현재 행동 재심사 호출 미실행       (`currentActionAssessment`)
//   ② FILE/CHAT 완료 형식 판정 호출 미실행 (`workContractAssessment`)
//   ③ 실패·차단 호출도 tool exchange 로 반환 (→ `turn-exchange.test.js` 가 양팔로 잰다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { 모델주도, 심문허용, 실패도교환 } from '../src/kernel/model-sovereign.js';

// ── 플래그 자체 ────────────────────────────────────────────────────────────
test('플래그는 "1" 에서만 열린다(기본은 기준선)', () => {
  assert.equal(모델주도({}), false, '없으면 꺼짐 — 기준선이 기본이다');
  assert.equal(모델주도({ T5_MODEL_SOVEREIGN: '0' }), false);
  assert.equal(모델주도({ T5_MODEL_SOVEREIGN: 'true' }), false, '"1" 이 아니면 안 연다(오타로 팔이 바뀌면 안 된다)');
  assert.equal(모델주도({ T5_MODEL_SOVEREIGN: '1' }), true);

  assert.equal(심문허용({}), true);
  assert.equal(심문허용({ T5_MODEL_SOVEREIGN: '1' }), false);
  assert.equal(실패도교환({}), false);
  assert.equal(실패도교환({ T5_MODEL_SOVEREIGN: '1' }), true);
});

test('플래그는 매번 읽는다(import 시점에 얼리지 않는다)', () => {
  // 회차 러너가 한 프로세스에서 A/B 를 번갈아 돌린다 — 얼리면 두 번째 팔부터 거짓말이 된다.
  const 원래 = process.env.T5_MODEL_SOVEREIGN;
  try {
    process.env.T5_MODEL_SOVEREIGN = '1';
    assert.equal(심문허용(), false);
    process.env.T5_MODEL_SOVEREIGN = '0';
    assert.equal(심문허용(), true);
  } finally {
    if (원래 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 원래;
  }
});

// ── 같은 대본을 두 팔에 넣는다 ─────────────────────────────────────────────
const 관심칸 = ['workContractAssessment', 'currentActionAssessment', 'answerOnly'];
const 표식 = (tc, opts) => {
  const 켜진칸 = 관심칸.filter((k) => tc?.[k] !== undefined && tc?.[k] !== null && tc?.[k] !== false);
  return `model[${켜진칸.join('+') || '-'}|tools=${opts?.tools?.length ?? 0}]`;
};

async function 무대(응답) {
  const dir = await mkdtemp(join(tmpdir(), 's1-slice-'));
  await writeFile(join(dir, '정산.csv'), '항목,금액\n임대료,500000\n');
  const 순서 = [];
  const model = { async respond(tc, opts = {}) { 순서.push(표식(tc, opts)); return 응답(tc, opts); } };
  const localFile = makeLocalFileTool({ roots: [dir], dataDir: dir });
  const 원래 = localFile.handler.bind(localFile);
  localFile.handler = async (...a) => { 순서.push('tool[local.file]'); return 원래(...a); };
  const localTerminal = {
    async probe(command) { return { command, cwd: dir, changes: true, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 순서.push('tool[local.terminal]'); return { result: { command: a.command, exitCode: 0, stdout: '', cwd: dir }, userSafeSummary: '했어요.' }; },
  };
  return { ctx: { env: demoEnv(), tools: demoTools({ localFile, localTerminal }), model }, 순서, dir };
}

/** 같은 대본·같은 발화를 두 팔에서 돌리고 각 팔의 호출 순서를 돌려준다. */
async function 양팔(응답, 입력) {
  const 원래 = process.env.T5_MODEL_SOVEREIGN;
  const 재기 = async (켬) => {
    if (켬) process.env.T5_MODEL_SOVEREIGN = '1';
    else delete process.env.T5_MODEL_SOVEREIGN;
    const { ctx, 순서, dir } = await 무대(응답);
    const r = await runTurn(typeof 입력 === 'function' ? 입력(dir) : 입력, ctx);
    return { 순서, r };
  };
  try {
    return { A: await 재기(false), B: await 재기(true) };
  } finally {
    if (원래 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 원래;
  }
}

// ── ② 완료 형식 판정 호출 ──────────────────────────────────────────────────
test('② B 는 FILE/CHAT 심문에 왕복을 쓰지 않는다 — 그 밖의 순서는 같다', async () => {
  const { A, B } = await 양팔(
    (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: '정산.csv' } }] };
      return '정리했어요.';
    },
    { text: '정산.csv 읽고 알려줘' },
  );
  assert.equal(A.r.kind, 'reply');
  assert.equal(B.r.kind, 'reply');
  assert.ok(A.순서.some((s) => s.includes('workContractAssessment')), 'A 팔에서 심문이 사라졌다 — 기준선이 아니다');
  assert.ok(!B.순서.some((s) => s.includes('workContractAssessment')),
    `B 팔에 심문이 남아 있다 — 플래그가 죽어 있다: ${B.순서.join(' → ')}`);
  // 심문 하나만 빠지고 나머지는 그대로여야 한다. 다른 게 같이 바뀌면 슬라이스가 샌 것이다.
  assert.deepEqual(B.순서, A.순서.filter((s) => !s.includes('workContractAssessment')),
    'B 가 심문 말고 다른 것까지 바꿨다 — 격리가 샜다');
  assert.ok(A.순서.includes('tool[local.file]') && B.순서.includes('tool[local.file]'),
    '양팔 모두 실제로 손이 움직여야 비교가 성립한다');
});

test('② B 는 쓰기를 골라도 심문 없이 간다(파일 산출물은 고른 것으로 선다)', async () => {
  const { A, B } = await 양팔(
    (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '메모.md', text: '한 줄' } }] };
      return '적었어요.';
    },
    { text: '메모.md 에 한 줄 적어줘' },
  );
  assert.ok(A.순서.some((s) => s.includes('workContractAssessment')));
  assert.ok(!B.순서.some((s) => s.includes('workContractAssessment')));
  // 심문을 걷었다고 쓰기가 실행되지 않으면 슬라이스가 제품을 부순 것이다.
  assert.ok(B.순서.includes('tool[local.file]'), '심문을 걷었더니 쓰기가 실행되지 않았다');
  assert.equal(B.r.kind, 'reply');
});

// ── ① 현재 행동 재심사 호출 — **본 전환으로 제품에서 사라졌다** ────────────
//
// 이 자리는 원래 A/B 를 갈랐다: A 는 승인 경계 후보를 다시 심문하고 B 는 안 했다.
// **본 전환(2026-08-04) 뒤 두 팔 모두 심문하지 않는다** — 플래그가 아니라 제품이 바뀌었다.
// 그래서 닻을 "B 에는 없다"에서 "**어디에도 없다**"로 옮긴다.
//
// 걷어낸 근거(같은 코드·같은 문장·같은 437개 고정판, 2026-08-04):
//   심문 켬 — 모델호출 18 · 토큰 178k · 무진전반복 4 · 이동 353
//   심문 끔 — 모델호출  5 · 토큰  51k · 무진전반복 0 · 이동 367
//
// 심문이 지키던 절대 게이트("현재 요청 침해")는 **사라지지 않았다.** 왕복을 쓰는 되묻기
// 대신 승인 경계로 보이기가 받는다 — 그 계약은 `test/s2-carryover-boundary.test.js` 가 잰다.
test('① 심문(work.current_actions)은 두 팔 어디에도 남아 있지 않다', async () => {
  const { A, B } = await 양팔(
    (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (tc?.currentActionAssessment) {
        return { text: '', toolCalls: [{ name: 'work.current_actions', args: { unclear: false, requestedIndexes: [0, 1] } }] };
      }
      if (o.tools?.length) {
        return { text: '', toolCalls: [
          { name: 'local.file', args: { action: 'read', path: '정산.csv' } },
          { name: 'local.file', args: { action: 'delete', path: '낡은.csv' } },
        ] };
      }
      return '지울까요?';
    },
    { text: '정산.csv 읽고 낡은.csv 지워줘' },
  );
  for (const [이름, 팔] of [['A', A], ['B', B]]) {
    assert.ok(!팔.순서.some((s) => s.includes('currentActionAssessment')),
      `${이름} 팔에 심문이 남아 있다 — 본 전환이 안 끝났다: ${팔.순서.join(' → ')}`);
  }
  // 심문을 걷었다고 모델이 고른 것이 사라지면 안 된다 — 그게 걷어낸 이유였다.
  assert.ok(B.순서.includes('tool[local.file]'), '심문을 걷었더니 모델이 고른 손이 실행되지 않았다');
});

// ── 열지 않은 것 ───────────────────────────────────────────────────────────
test('플래그는 승인 경계를 건드리지 않는다 — 되돌릴 수 없는 것은 B 에서도 묻는다', async () => {
  // 자동성 헌장 넷은 이 실험과 무관하게 그대로 선다. 여기가 무너지면 슬라이스가 아니라 사고다.
  const { A, B } = await 양팔(
    (tc, o) => {
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      if (o.tools?.length) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf 임시폴더' } }] };
      return '지울까요?';
    },
    { text: '임시폴더 지워줘' },
  );
  assert.equal(A.r.kind, 'approval');
  assert.equal(B.r.kind, 'approval', '주객 회복이 헌장 ②(되돌릴 수 없는 파괴)를 걷어냈다');
  assert.ok(!B.순서.includes('tool[local.terminal]'), '승인 전 효과 0 이 B 에서 무너졌다');
});
