// **S6-c 그물 — 자동이냐 묻느냐를 두 경로가 같은 사실로 가른다.**
//
// S6-PREP §2 의 3번(`decideAutoGrant`). 함수 자체는 이미 한 벌이다 —
// 계획 경로는 `grantFor` 를 통해, 걸음 경로는 경계에서 직접 부른다.
// 그래서 여기서 잴 것은 "같은 함수를 부르나"가 아니라 **같은 사실을 먹이나**다.
//
// `decideAutoGrant` 가 읽는 사실은 넷뿐이다:
//   `kind` · `needsApproval` · `revocable` · `counterpartKnown`
// 한 칸이라도 한쪽 경로에서만 실리면, **같은 손이 어느 왕복에 왔느냐로 자동/승인이 갈린다.**
// F-20 이 정확히 그 병이었다(헌장 ③ 이 경로에 따라 갈림).
//
// §10 규율 12 — 이름·개수가 아니라 **결정**을 잰다. 선언 전수를 두 경로에 흘려 대조한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActionPlan } from '../src/kernel/l2-plan/action-plan.js';
import { 실행전판정 } from '../src/kernel/l2-plan/tool-boundary.js';
import { authorityDecision } from '../src/kernel/l2-plan/authority.js';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** 선언 하나로 두 경로에 같은 손을 세운다. */
const 판 = (선언) => ({
  selfState: { connectedTools: [{ id: '손', executable: true, ...선언 }] },
  intent: { neededTools: ['손'], toolArgs: { 손: { x: 1 } }, desiredOutcome: '해줘' },
});

/** 계획 경로의 답 — `buildActionPlan` 이 자동으로 둘지 카드로 올릴지. */
function 계획경로결정(선언) {
  const { selfState, intent } = 판(선언);
  const plan = buildActionPlan({ intent, selfState });
  if (plan.needsApproval?.some((g) => g.action === '손' || g.label === '손')) return '승인';
  if (plan.autoAllowed?.includes('손')) return '자동';
  return plan.authorityDeferred?.find((g) => g.toolId === '손')?.disposition ?? '누락';
}

/** 걸음 경로의 답 — 경계가 만든 판정행동을 `decideAutoGrant` 가 가른다. */
async function 걸음경로결정(선언) {
  const { selfState } = 판(선언);
  const { 판정행동 } = await 실행전판정({ toolId: '손', args: { x: 1 }, selfState });
  const d = authorityDecision({
    ...판정행동,
    ...(선언.toolKind === 'send' ? { counterpartKnown: false } : {}),
  }).disposition;
  return d === 'approval' ? '승인' : d === 'auto' ? '자동' : d;
}

// 헌장이 실제로 가르는 축만 넣는다. 조합 폭발을 피하되 **갈리는 축은 다 넣는다.**
const 종류들 = [
  'read', 'organize',            // 헌장 밖 — 자동이어야 한다(자동성이 의무다)
  'write', 'delete',             // 되돌림 선언이 자동을 연다
  'send', 'export_sensitive',    // 상대·민감
  'transfer_money',              // **어휘 밖** — 원격 커넥터가 스스로 적어 낸 이름
];
const 되돌림들 = [undefined, true, false];
const 확인요구들 = [undefined, true];

test('① **같은 선언이면 두 경로가 같은 답을 낸다** — 자동/승인이 왕복에 안 갈린다', async () => {
  const 갈린것 = [];
  for (const toolKind of 종류들) {
    for (const reversible of 되돌림들) {
      for (const needsApproval of 확인요구들) {
        const 선언 = { toolKind, reversible, needsApproval };
        const 계획 = 계획경로결정(선언);
        const 걸음 = await 걸음경로결정(선언);
        if (계획 !== 걸음) {
          갈린것.push(`${toolKind} | 되돌림=${reversible} | 확인요구=${needsApproval}  계획:${계획} ≠ 걸음:${걸음}`);
        }
      }
    }
  }
  assert.deepEqual(갈린것, [],
    `**같은 손이 어느 왕복에 왔느냐로 자동/승인이 갈렸다.**\n  ${갈린것.join('\n  ')}\n\n`
    + 'F-20 이 그 병이었다 — 헌장이 경로에 따라 다르게 적용되면 헌장이 아니다.');
});

test('② **되돌림을 안 밝힌 손은 자동으로 안 간다** — 모르는 것을 안전하다고 하지 않는다', async () => {
  for (const kind of ['write', 'delete']) {
    for (const [이름, 결정] of [['계획', () => 계획경로결정({ toolKind: kind })], ['걸음', () => 걸음경로결정({ toolKind: kind })]]) {
      assert.equal(await 결정(), 'observe',
        `${이름} 경로: 되돌림을 **선언하지 않은** ${kind} 이 자동으로 갔다.\n`
        + '실측 2026-08-03: `http-tool` 은 read 가 아니면 `reversible: undefined` 인데\n'
        + '구글 시트 덮어쓰기가 확인 없이 돌았다 — 원격 SaaS 에는 휴지통이 없다.');
    }
  }
});

test('③ **어휘 밖 종류는 자동으로 안 간다** — 이름을 스스로 적어 내 헌장을 지나가지 못한다', async () => {
  for (const [이름, 결정] of [['계획', () => 계획경로결정({ toolKind: 'transfer_money', reversible: true })],
    ['걸음', () => 걸음경로결정({ toolKind: 'transfer_money', reversible: true })]]) {
    assert.equal(await 결정(), 'observe',
      `${이름} 경로: **분류되지 않은 종류가 자동으로 갔다.**\n`
      + '실측 2026-08-03: 종류를 스스로 적어 내는 원격 커넥터가 `transfer_money`·`crm_write` 같은\n'
      + '이름으로 헌장을 그냥 지나갔다 — 헌장 ④(돈)에 정면으로 닿는 이름조차 자동이었다.');
  }
});

test('④ **되돌릴 수 있다고 밝힌 것은 두 경로 다 자동** — 승인으로 안전을 사지 않는다', async () => {
  for (const kind of ['write', 'delete', 'organize', 'read']) {
    const 선언 = { toolKind: kind, reversible: true };
    assert.equal(계획경로결정(선언), '자동',
      `계획 경로: 되돌릴 수 있는 ${kind} 에 카드를 띄웠다 — 마찰을 늘리면 정교해 보여도 뒤쳐진다`);
    assert.equal(await 걸음경로결정(선언), '자동',
      `걸음 경로: 되돌릴 수 있는 ${kind} 에 카드를 띄웠다`);
  }
});

test('⑤ **정적 확인요구는 두 경로 모두 헌장 밖 카드를 만들지 않는다**', async () => {
  const 선언 = { toolKind: 'read', reversible: true, needsApproval: true };
  assert.equal(계획경로결정(선언), '자동');
  assert.equal(await 걸음경로결정(선언), '자동');
});

// ── ⑥ **헌장 ③ 이 두 곳에 적혀 있다** ────────────────────────────────────────
//
// `decideAutoGrant` 의 `case 'send': return action?.counterpartKnown !== true` 는
// **아는 상대면 자동**이라는 헌장 ③ 이다. 그런데 그 칸을 채우는 자리가 **어디에도 없다**
// (`known-counterpart.test.js:6` 이 "구현 전 실측: 생산자 0" 이라고 적어 뒀다).
// 실제 집행은 `승인면제` 가 한다(S6-b, 216칸 표가 지킨다).
//
// 같은 규칙이 두 곳에 적혀 있으면 언젠가 갈린다. 지우지 않는 이유는 하나다 —
// **지금 이 계약을 밟고 있는 검사가 있고**(autonomy-charter.test.js), 헌장 문서가
// 그 함수를 헌장의 기록으로 쓴다. 그래서 **사실을 못 박아 둔다**: 이 칸은 판정에 안 쓰인다.
// 다음 사람이 여기에 헌장 ③ 을 다시 구현하려 하면 이 검사가 먼저 말을 건다.
test('⑥ **`counterpartKnown` 은 아무도 안 채운다 — 헌장 ③ 은 `승인면제` 가 집행한다**', async () => {
  const 선언 = { toolKind: 'send', reversible: false };
  assert.equal(계획경로결정(선언), '승인',
    '계획 경로가 아는 상대 판정을 여기서 하고 있다 — 헌장 ③ 의 집행 자리는 `승인면제` 하나여야 한다');
  assert.equal(await 걸음경로결정(선언), '승인',
    '걸음 경로가 아는 상대 판정을 여기서 하고 있다 — 두 곳에 적힌 규칙은 언젠가 갈린다');
});

// ── ⑦ **제품 흐름으로도 갈리지 않는다** ──────────────────────────────────────
//
// 위 여섯은 **이음매**를 쟀다. 이음매가 같아도 **먹이는 인자**가 다르면 답은 갈린다 —
// 계획 경로는 등급 인자로 `intent.fileOp`(정규식 파싱)를, 걸음 경로는 모델이 낸 인자를 본다.
// 읽으면 `turn.js:1125` 가 모델 인자로 `fileOp` 를 덮어써 대칭이다. 그런데 이 흐름에서
// **읽어서 같다고 판단한 것이 두 번 틀렸다.** 그래서 밟는다.
//
// 이 자리에 남은 경고가 있다(turn.js:1040): *"스킬이 `local.file` 을 밀어 넣으면 fileOp 가
// 없어 권한은 read 로 통과하는데 실행은 delete 를 했다 — 두 진실이 갈라진 자리에서 안전 바닥이 샜다."*
const 본선 = (opts) => (opts?.tools ?? []).length > 1;

test('⑦ **같은 호출이면 두 경로가 같은 답** — 발화가 말 안 한 삭제를 한쪽만 자동으로 하지 않는다', async () => {
  const 흘리기 = async (모델만들기) => {
    const 실행된 = [];
    const tools = demoTools({
      localFile: { async handler(a) { 실행된.push(a); return { result: { path: a?.path ?? 'x', items: [] } }; } },
    });
    const r = await runTurn({ text: '보고서.md 읽어줘' }, {
      env: demoEnv(), tools, pending: new Map(), model: 모델만들기(),
    });
    return { 카드떴나: r.kind === 'approval', 지운것: 실행된.filter((a) => a?.action === 'delete').length };
  };
  // 사용자는 **읽기**를 지목했는데 모델이 **삭제**를 골랐다 — 발화 밖 파괴다.
  //
  // 발화가 작업을 특정해야 이 게이트가 선다. 처음엔 "보고서 좀 봐줘"로 썼는데
  // 그건 `action:'unknown'` 으로 파싱돼 **범위가 모델의 것**이고, 되돌릴 수 있는 삭제는
  // 헌장이 자동으로 둔 것이라 카드가 안 뜬다 — 제품이 옳았고 **내 전제가 틀렸다**(2026-08-05).
  const 지우는호출 = { name: 'local.file', args: { action: 'delete', path: '전혀다른것.csv' } };
  const 계획 = await 흘리기(() => {
    let 냈나 = false;
    return { async respond(_tc, o) {
      if (본선(o) && !냈나) { 냈나 = true; return { text: '', toolCalls: [지우는호출] }; }
      return '봤어요.';
    } };
  });
  const 걸음 = await 흘리기(() => {
    let n = 0;
    return { async respond(_tc, o) {
      if (!본선(o)) return '봤어요.';
      n += 1;
      if (n === 1) return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'list', path: '작업 폴더' } }] };
      if (n === 2) return { text: '', toolCalls: [지우는호출] };
      return '봤어요.';
    } };
  });
  assert.deepEqual(걸음, 계획,
    `같은 삭제 호출인데 경로에 따라 다르게 끝났다 — 한쪽에서만 카드가 뜨거나 한쪽에서만 지워진다.\n`
    + `  계획: ${JSON.stringify(계획)}\n  걸음: ${JSON.stringify(걸음)}`);
  assert.equal(계획.지운것, 0,
    '사용자가 시키지 않은 삭제가 승인 없이 실행됐다 — 절대 게이트 "현재 요청 침해"의 자리다');
  assert.equal(계획.카드떴나, false,
    '발화 밖 파괴를 승인카드로 바꾸면 안 된다');
});
