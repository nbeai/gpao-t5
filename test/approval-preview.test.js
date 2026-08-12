// P6-T5 · 승인 카드는 **사실**이어야 한다 — 무엇을 허락하는지 모르는 승인은 승인이 아니다.
//
// 실측: 서버 시작 카드에 "실행 중인 것 실행"이라고 떴다. 사용자는 무엇이 켜지는지,
// 어디서 도는지, 계속 도는지, 어떻게 끄는지 하나도 모른 채 누르게 된다.
//
// 고치는 방식도 중요하다. 커널의 describeAction 에 도구별 if 를 늘리면 **새 도구가 생길
// 때마다 같은 빈 문구가 또 나온다.** 도구가 자기 미리보기를 내는 계약 하나로 바꿨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools, demoDescriptors } from '../src/surface/demo-context.js';
import { makeLocalProcessTool } from '../src/runtime/local-process.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { ProcessStore } from '../src/runtime/process-store.js';

const 고른다 = (calls) => {
  let used = false;
  return { async respond(_tc, opts = {}) {
    if (!used && opts.tools?.length) { used = true; return { text: '', toolCalls: calls }; }
    return opts.tools?.length ? { text: '했어요', toolCalls: [] } : '했어요';
  } };
};

async function 자리() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-card-'));
  return { dir, tool: makeLocalProcessTool({ store: new ProcessStore(dir), dataDir: dir, cwd: dir }) };
}

// 자동성 헌장(2026-08-03) + 오너 결정: **서버 켜기는 자동이다**(끄면 되돌아간다).
// 그래서 카드가 뜨지 않는다 — **재는 계약은 그대로다**: 도구가 자기 일을 사용자 말로 정확히
// 설명하는가(무엇을·어디서·계속·끄는 법). 그 문장은 `previewOf` 가 소유하고, 카드가 뜰 때도
// 자동으로 돌 때도 같은 자리에서 나온다. 관측점만 도구 계약으로 옮긴다.
// (부수 효과: 이 검사가 더 이상 실제로 `python3 -m http.server 9913` 을 띄우지 않는다 —
//  헌장 뒤 이 검사가 포트를 잡고 정리하지 않아 같은 포트를 쓰는 `execution-block` 검사를 깼다.)
test('서버 시작 설명에 무엇을·어디서·계속·끄는 법이 보인다', async () => {
  const { dir, tool } = await 자리();
  const p = tool.previewOf({ action: 'start', command: 'python3 -m http.server 9913', label: 'http-9913', cwd: dir }) ?? {};
  const 카드 = JSON.stringify(p);
  assert.doesNotMatch(카드, /실행 중인 것 실행/, '도구 이름만 있는 빈 문구는 승인이 아니다');
  assert.match(p.impact, /http-9913/, '무엇을 켜는지');
  assert.match(p.impact, /python3 -m http\.server 9913/, '실행 명령');
  assert.match(p.scope, new RegExp(dir.split('/').pop()), '실행 위치');
  assert.match(p.scope, /9913 포트/, '포트를 쓴다는 영향');
  assert.match(p.duration, /계속 돌아요/, '한 번 하고 끝나는 일이 아니라는 것');
  assert.match(p.cancel, /꺼줘/, '나중에 끄는 방법');
});

test('명령 실행 카드에는 명령 원문과 자리가 보인다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-card2-'));
  const r = await runTurn({ text: '지워줘' }, {
    env: demoEnv(), model: 고른다([{ name: 'local.terminal', args: { command: 'rm -rf 어딘가' } }]),
    tools: demoTools({ localTerminal: makeLocalTerminalTool({ cwd: dir }) }),
  });
  if (r.kind !== 'approval') return; // 샌드박스 없는 기계에서는 이 경로가 안 열린다
  const p = r.pending[0].preview;
  assert.match(p.impact, /rm -rf 어딘가/, '무엇을 하는 명령인지 원문이 보여야 한다');
  assert.match(p.scope, /에서/);
});

// ── 고친 방식이 반복을 막는가 ───────────────────────────────────────────
test('미리보기를 안 내는 도구도 깨지지 않는다(계약이지 의무가 아니다)', async () => {
  const r = await runTurn({ text: '메모.md 지워줘' }, { env: demoEnv(), model: 고른다([]) , tools: demoTools({}) });
  assert.ok(r.kind === 'approval' || r.kind === 'reply' || r.kind === 'clarify');
});

test('승인이 필요한 도구는 미리보기를 낼 수 있어야 한다', () => {
  // 새 도구를 만들 때 이 검사가 "카드에 뭐라고 쓸지"를 묻는다 —
  // 안 그러면 다음 도구에서 "○○ 실행"이 또 나온다.
  const 승인도구 = demoDescriptors().filter((d) => d.needsApproval || d.toolKind === 'run_command');
  assert.ok(승인도구.length > 0);
  for (const d of 승인도구) {
    assert.ok(d.capability && d.capability.length > 10, `${d.id}: 무엇을 하는 도구인지 설명이 없다`);
  }
});
