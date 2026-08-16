// ⑥⑧ 유도 수리 선빨강(§7-bv) — **오너 인과 귀속 승인 2026-08-17 (보좌역 4자 감사)**
//
// ⑧ 실물(§7-bu R2 u9): 모델이 서버를 포그라운드 터미널로 띄워 120s 상한에서 죽었고 답에
// 자백했다. 귀속: 타임아웃 실패 시점에 **행선지가 0** — cwd_missing 갈래(:446-449)는
// 다음수단을 주는데 timeout 갈래는 안 준다. 그 턴 local.process 시야 0회.
// ⑥ 실물(§7-bu R2 u7): 산문으로 선허락을 구하고 설치를 안 함(카드 0장) — R1·R3 은
// 시도→카드→같은 턴 완주. 귀속(검문 정정): 카드 기제 문장은 이미 있다(:697-698) — 안 덮인
// 갈래는 **산문 선허락**이고, 더하는 것은 「요청 자체가 허락 구하기」라는 정체성 델타 하나다
// (준중복 델타 — 기대값 그만큼 낮게 · 손 관리자).
// 수리 형태(오너 고정): ⑧ 기존 다음수단 차선에 timeout 갈래 추가(새 구조 금지) ·
// ⑥ capability 사실 한 문장(120초 문장 ac327607 과 같은 어법). 이름 패턴 강제·스키마 확장 금지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { demoDescriptors } from '../src/surface/demo-context.js';
import { compactResult } from '../src/kernel/l1-intent/task-context.js';

async function 도구(정지) {
  const 자리 = await mkdtemp(join(tmpdir(), 'timeout-dest-'));
  const run = async (command, { mode } = {}) => ({
    // 제품 실물: SIGTERM 종료는 code null → -1 (terminal-run.js:97-109 · 검문 어긋남 1 정정)
    command, cwd: 자리, mode: 'granted', exitCode: 정지 ? -1 : 0, durationMs: 정지 ? 120000 : 5,
    stdout: '듣는 중', stderr: '', ...(정지 ? { stopped: 'timeout' } : {}),
  });
  return { tool: makeLocalTerminalTool({ cwd: 자리, run, sandboxAvailable: () => true }), 자리 };
}

test('★ 선빨강(⑧) — 타임아웃으로 멈춘 실행에 행선지(local.process)가 실린다', async () => {
  const { tool } = await 도구(true);
  const r = await tool.handler({ command: 'node 서버.mjs', granted: true });
  const 수단들 = r.result?.다음수단 ?? [];
  assert.ok(수단들.some((s) => JSON.stringify(s).includes('local.process')),
    '**타임아웃 실패 시점에 행선지가 0이다** — cwd_missing 갈래는 다음수단을 주는데 timeout 갈래는 '
    + '빈손이라, 모델이 상주 실행의 길(local.process)을 그 자리에서 못 본다(§7-bu R2 u9 실물)');
  // 만든 것과 닿은 것(검문 어긋남 2): 모델 입력 렌더(compactResult → 「다음 수」 줄)에 실제로 닿는가.
  assert.ok(compactResult(r.result).includes('local.process'),
    '다음수단은 실렸는데 모델 입력 렌더에 안 닿는다 — 렌더가 푸는 키(방법·cwd·왜) 밖에 실었다');
});

test('닻 — 정상 종료(exit 0 · 정지 없음)에는 다음수단이 없다 (유도 과잉 방지)', async () => {
  const { tool } = await 도구(false);
  const r = await tool.handler({ command: 'ls', granted: true });
  assert.equal(r.result?.다음수단, undefined,
    '멈추지 않은 실행에 행선지가 붙었다 — 사실 없는 유도는 소음이다');
});

test('★ 선빨강(⑥) — 터미널 capability 가 「시도가 곧 물음 · 카드가 먼저」 사실을 말한다', () => {
  const 터미널 = demoDescriptors({ desktop: false }).find((d) => d.id === 'local.terminal');
  const 글 = String(터미널.capability ?? '');
  assert.ok(글.includes('허락') && 글.includes('카드가 먼저'),
    '**「실행 요청이 곧 허락 구하기」 사실이 공급되지 않는다** — 모델이 산문으로 선허락을 구하고 '
    + '설치를 다음 턴으로 미룬다(§7-bu R2 u7 · 카드 0장 실물)');
});

test('닻 — 120초 사실 문장과 process 행선지는 그대로다 (기존 유도 재료 불변)', () => {
  const 터미널 = demoDescriptors({ desktop: false }).find((d) => d.id === 'local.terminal');
  const 글 = String(터미널.capability ?? '');
  assert.ok(글.includes('120') && 글.includes('local.process'),
    '기존 재료(시간 상한·행선지)가 사라졌다 — 문장을 더하다 있던 사실을 밀어냈다');
});
