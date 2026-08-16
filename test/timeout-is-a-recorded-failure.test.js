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
