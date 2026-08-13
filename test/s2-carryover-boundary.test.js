// **현재 요청 침해 0** — 심문을 걷어도 지난 턴의 미완료 행동이 조용히 실행되지 않는다.
//
// 전환 장부(§S2)의 **본 전환 선결 조건**이다. `currentRequestCalls` 심문이 지금 하는 일은
// 하나다: 모델이 과거 턴의 미완료 행동과 현재 요청 행동을 함께 냈을 때 **현재 것만 남긴다.**
// 그걸 걷으면 과거 행동이 실행될 수 있고, 이 위험은 가설이 아니라 **실측됐다**
// (`pc-hands-c-closure` #293 — 다중 호출 병합을 걷어내자 걸음 루프가 걷어낸 과거 삭제를
// 다시 받아 실행했다).
//
// ── 대체 보호는 "버리기"가 아니라 "보이기"다 ───────────────────────────────
// 심문은 모델의 선택을 **조용히 버렸다**(왕복 하나를 쓰면서). 그건 계약 ① 과도 어긋난다 —
// 모델이 고른 것을 런타임이 판단해 지운다.
//
// 대신 **승인 경계로 올린다**: 지난 턴에 시도했다 못 끝낸 행동과 같은 지문이 이번 턴에
// 다시 나오면, 되돌릴 수 있든 없든 **자동으로 실행하지 않고 사용자에게 보인다.**
//   · 왕복 0 — 모델에게 다시 묻지 않는다
//   · 모델의 선택은 안 버려진다 — 카드에 그대로 실린다
//   · 사용자가 "그거 다시 해줘"라고 했으면 한 번 누르면 된다
//
// 실측 근거(2026-08-04, 같은 코드·같은 문장): A 팔(심문 켬) 모델호출 18 · 토큰 178k ·
// 무진전반복 4 / B 팔(심문 끔) 모델호출 5 · 토큰 51k · 무진전반복 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 이월행동, 이월지문 } from '../src/kernel/l2-plan/carryover.js';

const 부름 = (tool, args, failureState = 'none') => ({
  tool, args, failureState, ref: 'p1',
});

test('지난 턴에 **못 끝낸** 행동의 지문을 모은다', () => {
  const 지문 = 이월지문([
    부름('local.file', { action: 'read', path: 'a.md' }),                 // 성공 — 이월 아님
    부름('local.file', { action: 'delete', path: '견적서-최종.md' }, 'blocked'),
  ]);
  assert.equal(지문.size, 1, '성공한 것까지 이월로 잡으면 정상 이어가기가 전부 막힌다');
  assert.ok([...지문][0].includes('delete'));
});

test('앞 턴 교환이 없으면 이월도 없다(첫 턴은 아무 것도 안 막는다)', () => {
  assert.equal(이월지문(undefined).size, 0);
  assert.equal(이월지문([]).size, 0);
});

test('같은 지문이 이번 턴에 다시 나오면 **이월**로 잡는다', () => {
  const 지문 = 이월지문([부름('local.file', { action: 'delete', path: '견적서-최종.md' }, 'blocked')]);
  const 이번 = [
    { name: 'local.file', args: { action: 'delete', path: '견적서-최종.md' } },
    { name: 'local.file', args: { action: 'write', path: '정리본.md', text: '단가' } },
  ];
  const 잡힌것 = 이번.filter((c) => 이월행동(c, 지문));
  assert.equal(잡힌것.length, 1, '과거 행동만 잡아야 한다');
  assert.equal(잡힌것[0].args.action, 'delete');
});

test('인자가 다르면 이월이 아니다(같은 손이라도 다른 일이다)', () => {
  const 지문 = 이월지문([부름('local.file', { action: 'delete', path: '가.md' }, 'blocked')]);
  assert.equal(이월행동({ name: 'local.file', args: { action: 'delete', path: '나.md' } }, 지문), false);
});

// ── 커널 배선 — 단위검사는 배선이 끊겨도 전부 초록이다 ─────────────────────
import { mkdtemp, mkdir, writeFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 지난 턴에 삭제를 시도했다 막혔고, 이번 턴 모델이 그 삭제 + 이번 요청 이동을 함께 낸다. */
async function 무대() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 's2-carry-')));
  await writeFile(join(dir, '견적서-최종.md'), '단가 1200');
  await writeFile(join(dir, '자료.txt'), '표');
  await mkdir(join(dir, '보관'), { recursive: true });
  const 지난삭제 = { action: 'delete', path: join(dir, '견적서-최종.md') };
  const 이번이동 = { action: 'move', path: join(dir, '자료.txt'), to: join(dir, '보관', '자료.txt') };
  const ctx = {
    env: demoEnv({ include: ['local.file'], hands: ['local.file'] }),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    priorExchange: [{
      ref: 'c1', tool: 'local.file', args: 지난삭제, failureState: 'blocked', summary: '막혔어요.',
    }],
    model: {
      async respond(tc, opts = {}) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        if (tc?.currentActionAssessment) throw new Error('심문이 아직 살아 있다 — 본 전환이 안 됐다');
        if (opts.tools?.length && !this.냈나) {
          this.냈나 = true;
          // 모델이 지난 턴 삭제와 이번 요청 이동을 **한 응답에** 낸다 — 실측된 그 모양이다.
          return { text: '', toolCalls: [
            { name: 'local.file', args: 지난삭제 },
            { name: 'local.file', args: 이번이동 },
          ] };
        }
        return '정리했어요.';
      },
    },
  };
  return { dir, ctx };
}

test('턴: 지난 턴의 미완료 삭제가 이번 턴에 **조용히 실행되지 않는다**', async () => {
  const { dir, ctx } = await 무대();
  await runTurn({ text: '단가만 메모로 정리해줘' }, ctx);
  const 남은것 = await readdir(dir);
  assert.ok(남은것.includes('견적서-최종.md'),
    '지난 턴의 삭제가 이번 발화에 얹혀 실행됐다 — 절대 게이트 "현재 요청 침해"');
});

test('턴: 이월은 승인으로 바뀌지 않고 요청 밖 실행 제외로 남는다', async () => {
  const { ctx } = await 무대();
  const r = await runTurn({ text: '단가만 메모로 정리해줘' }, ctx);
  const 전문 = JSON.stringify(r ?? {});
  assert.match(전문, /out_of_scope|current_request_only|현재 요청에 포함되지 않은/,
    '이월 행동의 실행 제외 이유가 사라졌다');
});

test('턴: 이번 요청의 행동은 **그대로 실행된다**(이월이 현재를 막지 않는다)', async () => {
  const { dir, ctx } = await 무대();
  await runTurn({ text: '단가만 메모로 정리해줘' }, ctx);
  assert.ok((await readdir(join(dir, '보관'))).includes('자료.txt'),
    '이월 하나 때문에 이번 요청까지 섰다 — 그게 심문이 내던 병이다');
});

test('이월 판정은 **버리지 않는다** — 판정만 낸다', () => {
  // 이 모듈은 무엇을 지울지 정하지 않는다. 그건 호출자가 승인 경계로 올릴 때 쓴다.
  const 지문 = 이월지문([부름('local.terminal', { command: 'rm -rf 임시' }, 'blocked')]);
  const r = 이월행동({ name: 'local.terminal', args: { command: 'rm -rf 임시' } }, 지문);
  assert.equal(r, true);
  assert.equal(typeof r, 'boolean', '판정 외의 것을 돌려주면 호출자가 그걸 실행 결정으로 쓴다');
});
