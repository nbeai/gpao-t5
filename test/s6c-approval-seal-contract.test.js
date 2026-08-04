// **S6-c 그물 — 승인 봉인의 계약.**
//
// 여기 걸린 절대 게이트는 둘이다: **"승인 전 효과 0"** 과 **"거절 뒤 실행 0"**.
// 그리고 준비 문서 §5 가 경고한 되살아나기 쉬운 병 하나가 이 자리다:
//   *"승인 봉인에 **판정인자를 안 실음** → 승인 뒤 `{request:발화원문}` 으로 엉뚱하게 실행"*
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "봉인이 두 자리에서 같은 모양이다"(모양) ❌
//   → **"승인 전 실행 0 · 거절 뒤 실행 0 · 승인 뒤 실행된 것은 봉인된 그것"**(계약) ⭕
//
// 준비 문서 §2 는 7번을 "같음"으로 적었지만 **읽어서 판단한 것**이고 실행으로 대조하지 않았다
// (§8 이 그렇게 밝혀 뒀다). 그래서 여기서 **밟는다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** 승인이 필요한 손 하나로 두 경로를 각각 만든다. */
async function 자리() {
  const 실행된인자 = [];
  const tools = demoTools({
    localFile: {
      async handler(a) { 실행된인자.push(a); return { result: { path: a?.path ?? 'x', items: [] } }; },
    },
    localTerminal: {
      async probe() { return { changes: true, probe: 'rm' }; },
      async handler(a) { 실행된인자.push(a); return { result: { stdout: '' } }; },
    },
  });
  return {
    실행된인자,
    ctx: (model) => ({ env: demoEnv(), tools, model, pending: new Map() }),
  };
}

/** 계획 경로 — 첫 응답이 바로 승인 대상이다. */
const 계획경로모델 = {
  async respond(_tc, opts = {}) {
    if (opts.tools?.length) {
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf ./임시', cwd: '.' } }] };
    }
    return '했어요.';
  },
};

/** 걸음 경로 — 읽기 하나를 먼저 하고, **다음 왕복**에서 승인 대상을 낸다. */
const 걸음경로모델 = {
  파일했나: false,
  async respond(_tc, opts = {}) {
    const 이름들 = (opts.tools ?? []).map((t) => t.name);
    const 본선 = 이름들.includes('local.terminal') && 이름들.includes('local.file');
    if (본선 && !this.파일했나) {
      this.파일했나 = true;
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    if (본선) return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'rm -rf ./임시', cwd: '.' } }] };
    return '했어요.';
  },
};

const 경로들 = [
  ['계획 경로', () => ({ ...계획경로모델 })],
  ['걸음 경로', () => ({ ...걸음경로모델, 파일했나: false })],
];

for (const [이름, 모델만들기] of 경로들) {
  test(`① **승인 전 효과 0** — ${이름}`, async () => {
    const { ctx, 실행된인자 } = await 자리();
    const r = await runTurn({ text: '임시 폴더 지워줘' }, ctx(모델만들기()));
    assert.equal(r.kind, 'approval', `${이름}: 되돌릴 수 없는 명령인데 안 물었다`);
    assert.equal(실행된인자.some((a) => typeof a?.command === 'string'), false,
      `${이름}: **승인 카드가 떴는데 이미 실행됐다** — 절대 게이트 "승인 전 효과 0" 위반`);
  });

  test(`② **거절 뒤 실행 0** — ${이름}`, async () => {
    const { ctx, 실행된인자 } = await 자리();
    const 판 = ctx(모델만들기());
    const 카드 = await runTurn({ text: '임시 폴더 지워줘' }, 판);
    assert.equal(카드.kind, 'approval');
    await runTurn({ reject: 카드.pendingId }, 판);
    assert.equal(실행된인자.some((a) => typeof a?.command === 'string'), false,
      `${이름}: **거절했는데 실행됐다** — 절대 게이트 "거절 뒤 실행 0" 위반`);
  });

  test(`③ **승인 뒤 실행되는 것은 봉인된 그 인자다** — ${이름}`, async () => {
    const { ctx, 실행된인자 } = await 자리();
    const 판 = ctx(모델만들기());
    const 카드 = await runTurn({ text: '임시 폴더 지워줘' }, 판);
    assert.equal(카드.kind, 'approval');
    await runTurn({ approve: 카드.pendingId }, 판);
    const 돈명령 = 실행된인자.filter((a) => typeof a?.command === 'string');
    assert.equal(돈명령.length, 1, `${이름}: 승인 뒤 실행이 ${돈명령.length}번이다(정확히 한 번이어야 한다)`);
    assert.equal(돈명령[0].command, 'rm -rf ./임시',
      `${이름}: **봉인된 인자가 아닌 것이 실행됐다** — 판정과 실행이 다른 것을 본다.\n`
      + `실행된 것: ${JSON.stringify(돈명령[0])}\n`
      + '준비 문서 §5 가 경고한 자리다: 봉인에 판정인자를 안 실으면 발화 원문으로 실행된다.');
  });
}

test('④ **두 경로가 같은 봉인을 만든다** — 승인이 경로에 안 갈린다', async () => {
  const 봉인모양 = async (모델만들기) => {
    const { ctx } = await 자리();
    const 판 = ctx(모델만들기());
    const 카드 = await runTurn({ text: '임시 폴더 지워줘' }, 판);
    const 봉인 = 판.pending.get(카드.pendingId);
    return {
      있나: Boolean(봉인),
      // 재개가 실제로 쓰는 칸들 — 하나라도 없으면 그 경로의 승인만 조용히 다르게 산다.
      계획있음: Boolean(봉인?.plan),
      의도있음: Boolean(봉인?.intent),
      신분있음: Boolean(봉인?.호출신분),
      허락이어받음: Array.isArray(봉인?.허락한손),
    };
  };
  const 계획 = await 봉인모양(() => ({ ...계획경로모델 }));
  const 걸음 = await 봉인모양(() => ({ ...걸음경로모델, 파일했나: false }));
  assert.deepEqual(걸음, 계획,
    `봉인 모양이 경로에 따라 다르다 — 재개가 한쪽에서만 이어받는다.\n`
    + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
  assert.equal(계획.있나, true, '봉인 자체가 안 만들어졌다');
});

// ── **승인은 손이 아니라 그 행동에 준 것이다** ──────────────────────────────
//
// 밟은 사실(2026-08-05): 사용자가 `rm -rf ./임시` 하나를 승인했더니, 재개 루프에서
// 모델이 낸 **`rm -rf /전혀다른곳` 이 승인 없이 실행됐다.**
//   승인 뒤 모델 호출 3회 · 실행된 명령 ["rm -rf ./임시", "rm -rf /전혀다른곳"]
//
// 원인: `허락한손` 면제가 **손 단위**다("이 요청에서 이 손을 허락했으면 다시 안 묻는다").
// 되돌릴 수 있는 손에는 맞는 규칙이다 — 파일 목록을 허락했으면 또 묻지 않는 게 옳다.
// 그런데 **되돌릴 수 없는 파괴**에까지 번지면 **자동성 헌장 ②("되돌릴 수 없는 파괴는 묻는다")**
// 가 무너진다. 사용자가 승인한 것은 **그 명령**이지 "앞으로 터미널 마음대로"가 아니다.
//
// (S6-b 이전에는 이 자리가 `break` 로 **조용히 멈췄다** — 뚫리지는 않았다.
//  면제를 `decideAutoGrant` 앞으로 옮기며 뚫렸다. 어제 이월에서 한 번, 여기서 두 번째다.)
test('⑤ **승인한 손이라도 되돌릴 수 없는 새 파괴는 다시 묻는다**(헌장 ②)', async () => {
  const 실행된 = [];
  let 승인됨 = false;
  const tools = demoTools({
    localFile: { async handler() { return { result: { path: '작업 폴더', items: [] } }; } },
    localTerminal: {
      async probe() { return { changes: true, probe: 'rm' }; },
      async handler(a) { 실행된.push(a.command); return { result: { stdout: '' } }; },
    },
  });
  let 파일했나 = false;
  const model = {
    async respond(_tc, opts = {}) {
      const 이름들 = (opts.tools ?? []).map((t) => t.name);
      const 본선 = 이름들.includes('local.terminal') && 이름들.includes('local.file');
      if (본선 && !파일했나) {
        파일했나 = true;
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
      }
      if (본선) {
        return { text: '', toolCalls: [{ name: 'local.terminal',
          args: { command: 승인됨 ? 'rm -rf /전혀다른곳' : 'rm -rf ./임시', cwd: '.' } }] };
      }
      return '했어요.';
    },
  };
  const ctx = { env: demoEnv(), tools, model, pending: new Map() };
  const 카드 = await runTurn({ text: '작업 폴더 보고 임시 폴더 지워줘' }, ctx);
  assert.equal(카드.kind, 'approval');
  승인됨 = true;
  await runTurn({ approve: 카드.pendingId }, ctx);

  assert.deepEqual(실행된, ['rm -rf ./임시'],
    `**승인하지 않은 파괴가 실행됐다** — 사용자가 승인한 것은 그 명령이지 손 전체가 아니다.\n`
    + `실행된 것: ${JSON.stringify(실행된)}\n`
    + '자동성 헌장 ②("되돌릴 수 없는 파괴는 묻는다")가 무너진다.');
});
