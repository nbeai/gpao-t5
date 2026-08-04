// **S6-c 그물 — 등급은 돌려 보고 매기고, 본 것과 한 것이 같다.**
//
// S6-PREP §2 의 2번(`probe → toolActionKind`). S6-a 가 **걸음 경로만** 경계로 옮겼고
// 계획 경로는 `turn.js:1103` 에 같은 로직을 한 벌 더 갖고 있다. 줄 단위로 같은 코드다.
//
// §10 규율 12 대로 **개수가 아니라 계약**을 잰다:
//   "probe 를 한 번만 부른다"(개수) ❌
//   → **"명령은 돌려 보고 판정한다 · 모르면 승인으로 간다 ·
//      사용자가 본 것과 실제로 돈 것이 같다 · 경로에 안 갈린다"**(계약) ⭕
//
// 마지막 칸이 이 자리의 핵심이다. `turn.js:1110` 이 이유를 적어 뒀다:
//   *"probe 결과를 **그대로 싣는다.** 안 그러면 도구가 같은 명령을 한 번 더 돌린다 —
//     느린 것보다, `date`·`ls` 처럼 **두 번 돌리면 답이 달라지는** 명령에서 사용자에게
//     보인 것과 원장에 남은 것이 갈라지는 게 문제다(두 진실 금지)."*
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 본선 = (opts) => (opts?.tools ?? []).length > 1;

/**
 * 터미널 하나로 판을 만든다.
 * @param 돌때마다 - probe 가 부를 때마다 다른 답을 낸다(두 진실이 갈리면 드러난다).
 */
function 판({ changes = true, 돌때마다 = false } = {}) {
  const probe한것 = [];
  const 실행된인자 = [];
  let 회차 = 0;
  const tools = demoTools({
    localTerminal: {
      async probe(cmd, opts) {
        회차 += 1;
        probe한것.push({ cmd, opts, 회차 });
        // `date` 처럼 부를 때마다 답이 달라지는 명령을 흉내 낸다.
        return { changes, probe: 돌때마다 ? `결과${회차}` : '고정결과' };
      },
      async handler(a) { 실행된인자.push(a); return { result: { stdout: '' } }; },
    },
  });
  return {
    probe한것, 실행된인자,
    ctx: (model) => ({ env: demoEnv(), tools, model, pending: new Map() }),
  };
}

const 계획경로모델 = (명령) => ({
  냈나: false,
  async respond(_tc, opts = {}) {
    if (본선(opts) && !this.냈나) {
      this.냈나 = true;
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 명령, cwd: '.' } }] };
    }
    return '했어요.';
  },
});

/** 걸음 경로 — 읽기 하나를 먼저 하고 **다음 왕복**에서 터미널을 낸다. */
const 걸음경로모델 = (명령) => ({
  단계: 0,
  async respond(_tc, opts = {}) {
    if (!본선(opts)) return '했어요.';
    this.단계 += 1;
    if (this.단계 === 1) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    if (this.단계 === 2) {
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 명령, cwd: '.' } }] };
    }
    return '했어요.';
  },
});

const 경로들 = [['계획 경로', 계획경로모델], ['걸음 경로', 걸음경로모델]];

for (const [이름, 모델만들기] of 경로들) {
  test(`① **명령은 돌려 보고 판정한다** — ${이름}`, async () => {
    const p = 판({ changes: true });
    await runTurn({ text: '임시 폴더 지워줘' }, p.ctx(모델만들기('rm -rf ./임시')));
    assert.ok(p.probe한것.length > 0,
      `${이름}: **probe 를 안 돌리고 등급을 매겼다.**\n`
      + '위험 명령 목록으로 알아맞히지 않는다는 계약이 여기서 무너진다 — 목록은 `find -delete` 하나에 뚫린다.');
    assert.equal(p.probe한것[0].cmd, 'rm -rf ./임시', `${이름}: 실행할 명령이 아닌 것을 돌려 봤다`);
    assert.deepEqual(p.probe한것[0].opts, { cwd: '.' },
      `${이름}: 어느 자리에서 도는지를 빼고 돌려 봤다 — 자리에 따라 답이 달라지는 명령이 있다`);
  });

  test(`② **바꾸는 명령은 승인으로 간다** — ${이름}`, async () => {
    const p = 판({ changes: true });
    const r = await runTurn({ text: '임시 폴더 지워줘' }, p.ctx(모델만들기('rm -rf ./임시')));
    assert.equal(r.kind, 'approval',
      `${이름}: probe 가 "바꾼다"고 했는데 자동으로 갔다 — 헌장 ②("되돌릴 수 없는 파괴는 묻는다")`);
    assert.equal(p.실행된인자.length, 0, `${이름}: 카드가 떴는데 이미 실행됐다`);
  });

  test(`③ **probe 를 못 돌리면 모르는 대로 둔다** — 미상은 승인이지 read 가 아니다 — ${이름}`, async () => {
    const 실행된인자 = [];
    const tools = demoTools({
      localTerminal: {
        // probe 자체가 없는 손 — 옛 도구·새 드라이버에서 실제로 생긴다.
        async handler(a) { 실행된인자.push(a); return { result: { stdout: '' } }; },
      },
    });
    const r = await runTurn({ text: '임시 폴더 지워줘' }, {
      env: demoEnv(), tools, pending: new Map(), model: 모델만들기('rm -rf ./임시'),
    });
    assert.equal(r.kind, 'approval',
      `${이름}: **모르는 것을 안전하다고 봤다.** probe 를 못 돌렸으면 미상이고, 미상은 승인으로 간다.\n`
      + 'read 로 흘리면 돌려 보지도 않은 명령이 조용히 실행된다.');
    assert.equal(실행된인자.length, 0, `${이름}: 미상인데 실행됐다`);
  });

  // ── ④ **본 것과 한 것이 같다** ────────────────────────────────────────────
  //
  // turn.js:1110 의 계약: probe 결과를 **그대로 실어** 도구가 같은 명령을 두 번 돌리지 않게 한다.
  // 두 번 돌면 `date`·`ls` 처럼 답이 달라지는 명령에서 **사용자가 승인한 것과 실제로 돈 것이
  // 갈라진다.** 개수를 세지 않는다 — 갈라졌는지를 잰다.
  test(`④ **사용자가 승인한 그 판정으로 실행된다**(두 진실 금지) — ${이름}`, async () => {
    const p = 판({ changes: true, 돌때마다: true });
    const 판모음 = p.ctx(모델만들기('rm -rf ./임시'));
    const 카드 = await runTurn({ text: '임시 폴더 지워줘' }, 판모음);
    assert.equal(카드.kind, 'approval');
    const 승인때본것 = p.probe한것.at(-1);
    await runTurn({ approve: 카드.pendingId }, 판모음);
    const 실행 = p.실행된인자.at(-1);
    assert.ok(실행, `${이름}: 승인했는데 실행이 없다`);
    assert.equal(실행.probeResult, `결과${승인때본것.회차}`,
      `${이름}: **판정한 사실과 실행된 사실이 다르다.**\n`
      + `  판정 때: 결과${승인때본것.회차}\n  실행 때: ${실행.probeResult}\n`
      + '같은 명령을 두 번 돌린 것이다. `date`·`ls` 처럼 답이 달라지는 명령에서\n'
      + '사용자가 승인한 것과 원장에 남는 것이 갈라진다(두 진실 금지).');
  });
}

// ── ⑥ **어느 자리에서 돌았는지가 원장에 남는다** ──────────────────────────
//
// 진짜 손의 probe 는 자리를 **풀어서** 돌려준다(local-terminal.js:60 — `blank(opts.cwd) ?? cwdOf()`).
// 빈 칸은 없는 칸이라 기본 자리로 풀린다. 그 파일 16~19 줄이 왜 중요한지 적어 뒀다:
//   *"실측: `cwd: ''` 가 통과해서 기본 자리(홈) 대신 **서버를 띄운 자리**에서 돌았고,
//     `find ..` 가 옆 프로젝트의 dist 수백 줄을 긁어와 모델이 답을 못 냈다."*
//
// 실행 자리 자체는 handler 가 같은 식으로 다시 풀어서 안 갈린다. 갈리는 것은 **기록**이다 —
// 한쪽은 풀린 자리를, 한쪽은 빈 값을 원장에 적는다. 같은 명령이 어디서 돌았는지를
// 감사가 한쪽에서만 볼 수 있다면 그건 절대 게이트 "원장↔영수증↔실물 불일치"의 자리다.
for (const [이름, 모델만들기] of 경로들) {
  test(`⑥ **probe 가 알아낸 자리가 판정 인자에 남는다** — ${이름}`, async () => {
    const 실행된인자 = [];
    const tools = demoTools({
      localTerminal: {
        // 빈 칸을 받아 기본 자리로 풀어 돌려주는 진짜 손의 계약을 그대로 흉내 낸다.
        async probe(cmd, opts) {
          return { command: cmd, cwd: opts?.cwd?.trim() ? opts.cwd : '/기본자리', changes: true, probe: 'rm' };
        },
        async handler(a) { 실행된인자.push(a); return { result: { stdout: '' } }; },
      },
    });
    const 모델 = 모델만들기('rm -rf ./임시');
    // 모델은 자리를 비워 보낸다 — 실제로 늘 그런다(빈 칸을 채워 보내는 병).
    const 원래 = 모델.respond.bind(모델);
    모델.respond = async (tc, opts) => {
      const out = await 원래(tc, opts);
      for (const c of out?.toolCalls ?? []) if (c.name === 'local.terminal') c.args.cwd = '';
      return out;
    };
    const ctx = { env: demoEnv(), tools, model: 모델, pending: new Map() };
    const 카드 = await runTurn({ text: '임시 폴더 지워줘' }, ctx);
    assert.equal(카드.kind, 'approval');
    await runTurn({ approve: 카드.pendingId }, ctx);
    const 실행 = 실행된인자.at(-1);
    assert.ok(실행, `${이름}: 승인했는데 실행이 없다`);
    assert.equal(실행.cwd, '/기본자리',
      `${이름}: **어느 자리에서 도는지가 판정 인자에서 사라졌다.**\n`
      + `  남은 값: ${JSON.stringify(실행.cwd)}\n`
      + 'probe 는 자리를 풀어서 알려 줬는데 그 사실을 버렸다. 원장에는 빈 자리가 남고,\n'
      + '감사도 사용자도 그 명령이 어디서 돌았는지 못 본다(원장↔영수증↔실물 불일치).');
  });
}

test('⑤ **같은 명령이면 두 경로가 같게 판정한다** — 등급이 경로에 안 갈린다', async () => {
  const 결과 = async (모델만들기, 명령, changes) => {
    const p = 판({ changes });
    const r = await runTurn({ text: '이것 좀 해줘' }, p.ctx(모델만들기(명령)));
    return { 카드떴나: r.kind === 'approval', 실행됐나: p.실행된인자.length > 0, 돌려봤나: p.probe한것.length > 0 };
  };
  for (const [명령, changes] of [['rm -rf ./임시', true], ['ls -al', false]]) {
    const 계획 = await 결과(계획경로모델, 명령, changes);
    const 걸음 = await 결과(걸음경로모델, 명령, changes);
    assert.deepEqual(걸음, 계획,
      `\`${명령}\` 이 경로에 따라 다르게 판정됐다 — 한쪽에서만 카드가 뜨거나 한쪽에서만 실행된다.\n`
      + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
  }
});
