// **S6 준비 — 같은 행동에 두 개의 답이 나오는가.**
//
// `turn.js` 는 같은 판정을 **두 벌** 돌린다: 계획 경로(`runTurn`)와 걸음 경로(`executePlan` 루프).
// 코드 주석이 그 대가를 이미 기록하고 있다 —
//   *"`reversible:false` 로 선언된 `rm -rf` 가 **걸음 경로에서만** 자동으로 실행됐다.
//     같은 명령이 계획 경로에서는 승인을 받았다 — 한 턴 안에서 같은 행동에 두 개의 답이 나온 것이다"*
//
// S6-PREP §2.1 이 **아직 안 재현된 가설** 하나를 남겼다:
//
//   isKnownCounterpart(아는 상대 면제 · 헌장 ③)  →  계획 경로에서만 읽는다 (turn.js:1324)
//   허락한손(이번 요청에서 허락한 손)            →  걸음 경로에서만 읽는다 (turn.js:2036)
//
// 가설: **전송이 두 번째 손으로 밀리면(걸음 경로) 아는 상대여도 카드가 다시 뜬다.**
// 그러면 헌장 ③("새 상대 첫 전송에만 묻는다")이 깨진다.
//
// 규율 1(착수 전 실패를 먼저 본다)대로 **가설을 기계 사실로 바꾼다.**
// 재현되면 S6-b 의 닫는 조건이 되고, 안 되면 가설을 접는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { isKnownCounterpart, rememberCounterpart } from '../src/kernel/l2-plan/known-counterpart.js';

/**
 * 전송을 **다음 왕복**에서 낸다 — 그래야 걸음 경로(`executePlan` 루프)로 간다.
 *
 * 처음엔 "한 응답에 두 호출"로 재현하려 했는데 **안 됐다.** 같은 응답의 호출들은
 * `buildActionPlan` 이 함께 들고 계획 경로가 판정한다. 걸음 경로는 **실행 뒤 다음 왕복**에서
 * 나온 호출이 탄다. 재는 자리를 틀리면 초록이 거짓이 된다 — 오늘 세 번째 확인이다.
 *
 * 왕복 구분도 **회차 숫자로 하면 안 된다.** 런타임은 중간에 도구 1개짜리 판정 호출을 섞는다
 * (실측: 왕복별 도구수 `9,1,1,9`). 그래서 **본선 도구 목록이 왔는지**로 가른다.
 */
const 나중에보내는모델 = (target) => ({
  파일했나: false,
  async respond(_tc, opts = {}) {
    const 이름들 = (opts.tools ?? []).map((t) => t.name);
    const 본선 = 이름들.includes('telegram.send') && 이름들.includes('local.file');
    if (본선 && !this.파일했나) {
      this.파일했나 = true;
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
    }
    if (본선) return { text: '', toolCalls: [{ name: 'telegram.send', args: { text: '정리 끝났어요', target } }] };
    return '했어요.';
  },
});

/** 전송만 낸다 — 계획 경로로 간다(비교군). */
const 보내기만하는모델 = (target) => ({
  async respond(_tc, opts = {}) {
    if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'telegram.send', args: { text: '정리 끝났어요', target } }] };
    return '보냈어요.';
  },
});

async function 자리(knownCounterparts = new Set()) {
  await mkdtemp(join(tmpdir(), 's6-two-paths-'));
  const 보낸것 = [];
  const tools = demoTools({
    localFile: { async handler() { return { result: { path: '작업 폴더', items: [] } }; } },
    senders: { 'telegram.send': { async handler(a) { 보낸것.push(a); return { result: { sent: true, target: a.target } }; } } },
  });
  return {
    보낸것,
    ctx: (model) => ({
      env: demoEnv(), tools, model, pending: new Map(), knownCounterparts,
      channelTargets: { 'telegram.send': [{ target: '111', label: '오너' }] },
    }),
  };
}

test('기준선: 계획 경로에서는 아는 상대에 다시 안 묻는다(헌장 ③)', async () => {
  const known = new Set();
  const { ctx, 보낸것 } = await 자리(known);
  const 판 = ctx(보내기만하는모델('111'));
  const 카드 = await runTurn({ text: '오너에게 보내줘' }, 판);
  assert.equal(카드.kind, 'approval', '첫 전송은 묻는다');
  await runTurn({ approve: 카드.pendingId }, 판);
  assert.ok(isKnownCounterpart(known, 'telegram.send', '111'), '허락한 상대를 기억한다');

  const 두번째 = await runTurn({ text: '오너에게 또 보내줘' }, ctx(보내기만하는모델('111')));
  assert.notEqual(두번째.kind, 'approval', '아는 상대인데 계획 경로에서 또 물었다');
  assert.equal(보낸것.length, 2, '두 번째는 바로 나가야 한다');
});

// ── 가설 재현 — **재현됐다** ────────────────────────────────────────────────
//
// 밟은 사실(2026-08-05): `kind === 'approval'`.
// 아는 상대인데 **걸음 경로라서** 카드가 다시 떴다. 실제 전송은 0건이다(카드에서 멈춘다).
// → 헌장 ③("새 상대 첫 전송에만 묻는다")이 **어느 경로로 왔느냐에 따라 갈린다.**
//
// 이 검사는 **지금 실패한다.** 그것이 이 검사의 일이다 — S6-b 가 두 벌을 한 벌로 만들면 초록이 된다.
// 대상은 `knownCounterparts` 에 **직접 심는다**(실제 승인·전송을 일으키지 않는다 — 오너 지적).
// **지금은 건너뛴다 — 본선은 늘 초록이다(§10 규율 3).**
// 재현은 끝났고(아래 주석의 기계 사실), 고치는 것은 S6-b 의 일이다.
// 한 번 부분 수정을 시도했다가 **전송이 조용히 증발**했다 — 면제로 카드만 없애면
// 그 행동이 `needsApproval` 에 남아 실행 목록에 안 든다. 원래 결함보다 나쁜 상태라 되돌렸다.
// **두 벌을 한 벌로 만드는 것이 답이지, 양쪽에 같은 조건을 덧대는 것이 아니다.**
test.skip('**S6-b 닫는 조건**: 아는 상대면 걸음 경로에서도 안 묻는다(헌장 ③은 경로에 안 갈린다)', async () => {
  const known = new Set();
  rememberCounterpart(known, 'telegram.send', '111');   // 실제 전송 없이 아는 상대로 만든다
  const { ctx, 보낸것 } = await 자리(known);

  const 결과 = await runTurn({ text: '작업 폴더 보고 오너에게 보내줘' }, ctx(나중에보내는모델('111')));

  assert.notEqual(결과.kind, 'approval',
    '아는 상대인데 **걸음 경로라서** 카드가 다시 떴다 — 헌장 ③ 이 경로에 따라 갈린다.\n'
    + '두 벌 판정의 실제 대가다(S6-PREP §2.1). 한 벌이면 안 생긴다.\n'
    + '  isKnownCounterpart  읽기 turn.js:1324 (계획 경로에만)\n'
    + '  허락한손            읽기 turn.js:2036 (걸음 경로에만)');
  assert.equal(보낸것.length, 1, '아는 상대에게 바로 나가야 한다');
});
