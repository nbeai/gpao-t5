// **막힌 손의 문구가 그대로 답이 되지 않는다** — F-84 (콘솔 라이브 실측 2026-08-12).
//
// 밟은 회차 ①: *"내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘."*
//   ```
//   손1 local.file{list ~}                        ok
//   손2 local.capsule                             blocked
//   손3 local.locate{what:'pdf 파일', depth:5}     ok   후보 5건
//   답  "한 캡슐에서 부를 수 있는 손을 다 썼어요(200번). 조건을 좁혀 다시 해볼까요?"
//   ```
// 답이 `capsule.js:318 userSafeSummary` + `:321 nextSafeAction` 과 **문자 그대로 같다.**
// 그 **뒤에** 성공한 `local.locate` 가 후보 5건을 냈는데 답에 한 글자도 안 들어갔다.
//
// ── 재현으로 잰 기전(㉮㉯㉰) ───────────────────────────────────────────────
//   ㉮ 되부름은 **돌았다** — `goalNotReached` 를 실은 모델 호출 1건(이어간횟수 1)
//   ㉯ 그 되부름에서 모델이 손을 **안 골라** `목적미달이어가기` 가 `return false` 로 빠졌다
//   ㉰ 그런데 답을 만든 자리는 그 `return false` 가 **아니었다.** 그 시점의 `finalOut` 은
//      **빈 글**이었고, 답은 `답완성` 의 빈답 그물이 부른 `fallbackReplyFrom` 이 지었다 —
//      그 함수가 **막힌 영수증만 보고 성공한 영수증을 통째로 버린다.**
//   ㉯-2 되부름이 **글은 냈는데 손을 안 골랐을 때** 그 글도 버려진다(`finalOut = 되부름` 이
//      `고른것.length` 안에 있다) — 되부름이 후보 5건을 정확히 말해도 답이 안 됐다.
//
// ── 오픈북 — 비교군은 억눌렀던 답을 **되살린다** ─────────────────────────────
//   · 헤르메스 `agent/conversation_loop.py:7196-7205` —
//     `_pending_verification_response = final_response; final_response = None; continue`
//     완성된 답을 억누르고 손을 쥔 채 루프로 되돌린다
//   · 헤르메스 `agent/turn_finalizer.py:106-122` — **끝내 어떻게 쓰는가**:
//     `continuation_budget_exhausted = final_response is None and bool(_pending_verification_response)`
//     → `final_response = _pending_verification_response`
//     *"Preserve that exact answer instead of replacing it with another fallible model call."*
//     **버리지 않는다. 낼 것이 없을 때 되살린다.**
//   · 헤르메스 `agent/kanban_stop.py:96-100` — *"Never end a turn with only a promise of
//     future action."* · `verification_stop.py:210-212` — `attempts >= max_attempts` 상한
//   · 오픈클로 `docs/concepts/agent-loop.md:96` — `before_agent_reply` 가 답이 나가기 전 자리
//   · 클로드코드: 도구가 막히면 **막혔다는 문구를 답으로 내보내지 않는다** — 무엇을 시도했고
//     무엇을 알아냈는지 말한다. 되묻고 끝내지 않는다.
//
// 무는 것은 **나가는 말이 원장에 남은 사실 전부 위에 서는가**다. 문구를 지어내지 않고,
// 무엇을 말할지는 여전히 모델의 몫이다 — 커널이 답을 쓸 수밖에 없는 자리에서만 원장을 다 읽는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTurn } from '../src/kernel/turn.js';
import { TruthLedger } from '../src/kernel/l0-evidence/ledger.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 캡슐막힘말 = '한 캡슐에서 부를 수 있는 손을 다 썼어요(200번).';
const 캡슐되물음 = '조건을 좁혀 다시 해볼까요?';
const 찾기말 = '‘pdf 파일’ 후보 5곳을 찾았어요.';

/** 라이브의 그 손 — 캡슐이 호출 한도로 막힌다(`capsule.js:318·321` 그대로). */
const 캡슐막힘 = {
  async approvalEligibility() { return { allowed: true }; },
  async handler() {
    return { blocked: true, userSafeSummary: 캡슐막힘말, nextSafeAction: 캡슐되물음 };
  },
};

/** 라이브의 그 손 — 뒤에 **성공한** 찾기가 후보 5건을 가져왔다. */
const 후보5 = {
  async handler(args) {
    const 후보 = ['a', 'b', 'c', 'd', 'e'].map((v) => ({ path: `/Users/x/${v}.pdf`, why: '이름에 pdf' }));
    return { result: { 후보, candidates: 후보 }, userSafeSummary: `‘${args?.what}’ 후보 5곳을 찾았어요.` };
  },
};

const 첫응답 = {
  text: '',
  toolCalls: [
    { name: 'local.file', args: { action: 'list', path: '~' } },
    { name: 'local.capsule', args: { code: 'x' } },
    { name: 'local.locate', args: { what: 'pdf 파일', depth: 5 } },
  ],
};

/**
 * 회차 ① 재현 문맥. `대본(n, tc, opts)` 이 첫 응답 **뒤**의 모든 모델 호출을 정한다.
 * 완료형 판정 호출에는 `'CHAT'` 을 돌려줘야 경로가 실물과 같아진다(모든 호출에 같은 문장을
 * 돌려주면 엉뚱한 경로를 재게 된다).
 */
function 문맥(대본) {
  const tools = demoTools({ capsule: 캡슐막힘, localLocate: 후보5 });
  const ids = Object.keys(tools.tools);
  const 흐름 = [];
  let n = 0;
  return {
    흐름,
    ctx: {
      tools,
      ledger: new TruthLedger(),
      env: demoEnv({ include: ids, hands: ids }),
      model: {
        async respond(tc, opts = {}) {
          if (tc.workContractAssessment || opts.requiredTool === 'work.deliverable') {
            return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
          }
          n += 1;
          const 미달 = Object.keys(tc).filter((k) => ['goalNotReached', 'completionMismatch'].includes(k));
          흐름.push({ n, 미달, answerOnly: Boolean(tc.answerOnly) });
          if (n === 1) return 첫응답;
          return 대본(n, tc, opts);
        },
      },
    },
  };
}

const 물음 = { text: '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘.' };
const 되부름수 = (흐름) => 흐름.filter((v) => v.미달.includes('goalNotReached')).length;

test('① 막힌 손의 문구가 **그대로** 최종 답이 되지 않는다 — 성공한 손이 있는 턴', async () => {
  const { ctx, 흐름 } = 문맥(() => ({ text: '', toolCalls: [] }));   // 모델이 끝내 글을 안 낸다
  const out = await runTurn(물음, ctx);

  assert.ok(되부름수(흐름) >= 1, `되부름이 안 돌았다 — 기전 전제가 깨졌다: ${JSON.stringify(흐름)}`);
  assert.notEqual(out.reply.trim(), `${캡슐막힘말} ${캡슐되물음}`,
    `**막힌 손의 두 줄이 그대로 답이 됐다** — 뒤에 성공한 손이 후보 5건을 냈는데도: "${out.reply}"`);
});

test('② 같은 턴에 성공한 손이 가져온 사실이 있으면 답에 그것이 산다', async () => {
  const { ctx } = 문맥(() => ({ text: '', toolCalls: [] }));
  const out = await runTurn(물음, ctx);
  assert.match(out.reply, /후보 5곳/,
    `성공한 손(local.locate)이 가져온 사실이 답에서 버려졌다: "${out.reply}"`);
});

test('②-2 되부름이 **글은 냈는데 손을 안 골랐으면** 그 글이 답이 된다(억누른 답을 되살린다)', async () => {
  const 되부름답 = `${캡슐막힘말} 대신 찾기 손으로 PDF 후보 5곳을 확인했어요: a.pdf, b.pdf, c.pdf, d.pdf, e.pdf.`;
  const { ctx } = 문맥((n, tc) => (tc.goalNotReached ? { text: 되부름답, toolCalls: [] } : { text: '', toolCalls: [] }));
  const out = await runTurn(물음, ctx);
  assert.match(out.reply, /a\.pdf/,
    `되부름이 정확한 답을 냈는데 커널이 버렸다(오픈북 turn_finalizer.py:118 — preserve that exact answer): "${out.reply}"`);
});

test('③ 목적에 닿은 턴은 답이 그대로 나간다 — 멀쩡한 답을 건드리지 않는다', async () => {
  const 좋은답 = '홈 아래에서 PDF 후보 5곳을 찾았어요: a.pdf, b.pdf, c.pdf, d.pdf, e.pdf 입니다.';
  const { ctx } = 문맥(() => ({ text: 좋은답, toolCalls: [] }));
  const out = await runTurn(물음, ctx);
  assert.equal(out.reply.trim(), 좋은답, `멀쩡한 모델 답이 갈렸다: "${out.reply}"`);
});

test('④ 되부름 상한에 닿아도 답은 반드시 나간다 — 빈 답이 없다', async () => {
  // 되부름마다 **새 손**을 골라 상한(`이어가기상한`)까지 돌게 한다. 상한에 닿으면 고리가
  // 물러나는데, 그때 사용자에게 나가는 것이 빈 답이면 실패 문구보다 나쁘다.
  let 회 = 0;
  const { ctx, 흐름 } = 문맥((n, tc) => {
    if (!tc.goalNotReached) return { text: '', toolCalls: [] };
    회 += 1;
    return { text: '', toolCalls: [{ name: 'local.locate', args: { what: `pdf ${회}`, depth: 3 } }] };
  });
  const out = await runTurn(물음, ctx);
  assert.ok(되부름수(흐름) >= 2, `되부름이 상한 근처까지 안 돌았다: ${되부름수(흐름)}회`);
  assert.ok(out.reply.trim().length > 0, '되부름 상한에 닿자 **빈 답**이 사용자에게 갔다');
});

test('⑤ 정직한 미완 고지는 그대로 나간다 — 밝히고 있는 답을 벌하지 않는다', async () => {
  const 고지 = 'PDF 를 아직 다 확인하지 못했어요. 여기까지 본 자리를 남겨 둘게요.';
  const { ctx } = 문맥(() => ({ text: 고지, toolCalls: [] }));
  const out = await runTurn(물음, ctx);
  assert.equal(out.reply.trim(), 고지, `정직한 미완 고지가 갈렸다: "${out.reply}"`);
});

test('⑥ 네 가지가 아닌 되물음으로 턴이 닫히지 않는다 — 성공한 손이 있는 턴', async () => {
  // 헌장 2등 「네 가지만 묻는다」: 비밀번호·되돌릴 수 없는 파괴·새 상대 첫 발송·돈.
  // 막힌 손의 `nextSafeAction`("조건을 좁혀 다시 해볼까요?")은 그 넷 중 아무것도 아니다.
  const { ctx } = 문맥(() => ({ text: '', toolCalls: [] }));
  const out = await runTurn(물음, ctx);
  assert.doesNotMatch(out.reply, /조건을 좁혀 다시 해볼까요/,
    `커널이 쓴 답이 **되물음으로 턴을 닫았다** — 우리가 말할 수 있는 사실(후보 5건)이 있는데도: "${out.reply}"`);
});
