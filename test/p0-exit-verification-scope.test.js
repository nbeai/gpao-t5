// P0 출구 검증 범위 — 일반 지식·인사는 실행 원장과 대조하지 않는다.
// 과거형 한글을 전부 "T5가 방금 끝낸 일"로 읽으면 지식 답변도 completion_repair 왕복을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { 출구검증생략가능 } from '../src/kernel/l2-plan/exit-verification.js';

test('현재형 일반 설명은 실행 원장 대상이 아니다 — 검증·보정 왕복 0', async () => {
  const calls = [];
  const ctx = {
    env: demoEnv(), tools: demoTools(),
    model: { async respond(tc) {
      calls.push(tc);
      return '의존성 주입은 필요한 객체를 바깥에서 전달하는 설계 방식이에요.';
    } },
  };
  const result = await runTurn({ text: '의존성 주입이 뭐야?' }, ctx);
  assert.equal(result.reply, '의존성 주입은 필요한 객체를 바깥에서 전달하는 설계 방식이에요.');
  assert.equal(ctx.완료검증셈.잰것, 0, '일반 지식 답을 실행 원장과 대조했다');
  assert.equal(calls.length, 1, '일반 지식 답에 completion repair 왕복을 붙였다');
  assert.deepEqual(ctx.modelCallAccounting.records.map((record) => record.purpose), ['primary']);
});

test('일반 인사도 원장 직렬화·출구 검증을 열지 않는다', async () => {
  const ctx = {
    env: demoEnv(), tools: demoTools(),
    model: { async respond() { return '안녕하세요.'; } },
  };
  await runTurn({ text: '안녕' }, ctx);
  assert.deepEqual(ctx.완료검증셈, { 잰것: 0, 재사용: 0 });
});

test('무해 답은 과거 원장을 직렬화하지 않는다', async () => {
  const poison = { toJSON() { throw new Error('과거 원장을 직렬화했다'); } };
  const ledger = { entries: [poison], append(value) { this.entries.push(value); } };
  const ctx = {
    env: demoEnv(), tools: demoTools(), ledger,
    model: { async respond() { return 'HTTP 404는 요청한 자원이 서버에 없다는 상태 코드예요.'; } },
  };
  const result = await runTurn({ text: 'HTTP 404는 무슨 뜻이야?' }, ctx);
  assert.match(result.reply, /상태 코드/);
  assert.equal(ctx.완료검증셈.잰것, 0);
});

test('값싼 predicate는 기존 P0 후보를 생략하지 않는다', () => {
  const skip = (reply, extra = {}) => 출구검증생략가능({ reply, ...extra });
  assert.equal(skip('안녕하세요.'), true);
  assert.equal(skip('의존성 주입은 객체를 바깥에서 전달하는 방식이에요.'), true);
  assert.equal(skip('확인해 볼게요.\n```bash\nls -al /tmp\n```'), false, '안 돌린 shell을 생략했다');
  assert.equal(skip('/tmp/report.xlsx에 저장했어요.'), false, '원장 밖 실물 주장을 생략했다');
  assert.equal(skip('파일을 모두 정리했어요.'), false, '근거 없는 완료 주장을 생략했다');
  assert.equal(skip('표로 정리하면:\n- 하나\n- 둘'), false, '형식 불일치를 생략했다');
  assert.equal(skip('현재 설명이에요.', { receipts: [{ failureState: 'blocked' }] }), false,
    '막힌 영수증이 있는 답을 생략했다');
  assert.equal(skip('현재 설명이에요.', { 자동화사실: true }), false, '자동화 사실을 생략했다');
  assert.equal(skip('현재 설명이에요.', { 손0건: true }), false, '손 필요 0건을 생략했다');
  assert.equal(skip('현재 설명이에요.', { 파일계약빈손: true }), false, 'FILE 빈손 계약을 생략했다');
});

test('실행 요청의 근거 없는 완료 주장은 그대로 검증하고 한 번 보정한다', async () => {
  const calls = [];
  const dir = await mkdtemp(join(tmpdir(), 'exit-scope-task-'));
  const ctx = {
    env: demoEnv(), tools: demoTools({ localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }) }),
    model: { async respond(tc) {
      calls.push(tc);
      if (tc?.workContractAssessment) {
        return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
      }
      if (tc?.completionMismatch) return '아직 실행하지 못했어요.';
      return '파일을 모두 정리했어요.';
    } },
  };
  const result = await runTurn({ text: '폴더 좀 봐줘' }, ctx);
  assert.ok(calls.some((tc) => tc?.completionMismatch), '실행 요청의 거짓 완료 그물이 사라졌다');
  assert.match(result.reply, /아직/);
  assert.equal(ctx.modelCallAccounting.records.filter((record) => record.purpose === 'completion_repair').length, 1);
});
