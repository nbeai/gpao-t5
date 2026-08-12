// 자동성 헌장 ③ — **그 상대에 한 번만 묻는다.**
//
// 헌장(오너 승인 2026-08-03): "새 상대에게 첫 외부 전송 — 그 상대에 **한 번만**. 그 뒤로는 묻지 않는다."
//
// 이 계약이 없으면 헌장 ③ 은 문서에만 있고 사용자는 **매번** 같은 카드를 본다. 판정은
// `counterpartKnown` 을 보는데 그 사실을 만드는 자리가 없었기 때문이다(구현 전 실측: 생산자 0).
//
// 흡수(OpenClaw `exec-approvals.ts`): durable 저장은 **사람의 명시 승인에서만** 생긴다.
// 모델이나 자동 경로는 일회 실행을 열 수 있어도 **미래를 열 수 없다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import {
  counterpartRef, isKnownCounterpart, rememberCounterpart, forgetCounterpart,
} from '../src/kernel/l2-plan/known-counterpart.js';

// ── 신분: 채널 + 정규화된 수신자 둘뿐 ────────────────────────────────────
test('상대 신분은 채널과 수신자로만 만든다 — 본문·시각·세션이 섞이면 매번 새 상대가 된다', () => {
  assert.equal(counterpartRef('telegram.send', '111'), 'telegram.send|111');
  assert.equal(counterpartRef('telegram.send', ' 111 '), 'telegram.send|111', '공백은 같은 상대');
  assert.equal(counterpartRef('slack.post', '#일반'), 'slack.post|#일반');
  assert.equal(counterpartRef('slack.post', '#일반'), counterpartRef('slack.post', '#ILBAN'.replace('ILBAN', '일반')));
  // 채널이 다르면 다른 상대다 — 텔레그램 허락이 슬랙 허락이 되지 않는다.
  assert.notEqual(counterpartRef('telegram.send', '111'), counterpartRef('slack.post', '111'));
  // 대상이 없으면 신분이 없다. 없는 상대를 아는 상대로 만들지 않는다.
  assert.equal(counterpartRef('telegram.send', ''), null);
  assert.equal(counterpartRef('telegram.send', undefined), null);
});

test('모르는 형태를 같은 사람으로 추측하지 않는다(안전한 쪽)', () => {
  // 전화번호 형식·이메일 별칭을 여기서 풀면 **다른 사람에게 보내는 사고**가 난다.
  assert.notEqual(counterpartRef('sms.send', '010-1111-2222'), counterpartRef('sms.send', '01011112222'));
});

test('기억·조회·철회', () => {
  const known = new Set();
  assert.equal(isKnownCounterpart(known, 'telegram.send', '111'), false, '처음에는 새 상대다');
  assert.equal(rememberCounterpart(known, 'telegram.send', '111'), true);
  assert.equal(isKnownCounterpart(known, 'telegram.send', '111'), true);
  assert.equal(rememberCounterpart(known, 'telegram.send', '111'), false, '두 번째는 새 사실이 아니다');
  // **철회는 즉시 이긴다** — 지우면 그 상대는 다시 새 상대다.
  assert.equal(forgetCounterpart(known, 'telegram.send', '111'), true);
  assert.equal(isKnownCounterpart(known, 'telegram.send', '111'), false);
});

// ── 제품 경로: 첫 전송은 묻고, 그 뒤로는 안 묻는다 ────────────────────────
const 전송모델 = (target) => ({
  async respond(_tc, opts = {}) {
    if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'telegram.send', args: { text: '정리 끝났어요', target } }] };
    return '보냈어요.';
  },
});

async function 자리(knownCounterparts = new Set()) {
  const dir = await mkdtemp(join(tmpdir(), 'known-cp-'));
  const 보낸것 = [];
  const tools = demoTools({
    senders: { 'telegram.send': { async handler(a) { 보낸것.push(a); return { result: { sent: true, target: a.target } }; } } },
  });
  return {
    dir, 보낸것,
    ctx: (model) => ({
      env: demoEnv(), tools, model,
      pending: new Map(),
      knownCounterparts,
      channelTargets: { 'telegram.send': [{ target: '111', label: '오너' }] },
    }),
  };
}

test('헌장 ③: 새 상대에게 첫 전송은 묻는다', async () => {
  const { ctx, 보낸것 } = await 자리();
  const r = await runTurn({ text: '오너에게 보내줘' }, ctx(전송모델('111')));
  assert.equal(r.kind, 'approval', `새 상대 첫 전송은 헌장 ③ 이라 묻는다: ${r.kind}`);
  assert.equal(보낸것.length, 0, '승인 전에 나갔다');
});

test('헌장 ③: 사용자가 허락한 상대에는 다시 묻지 않는다', async () => {
  const known = new Set();
  const { ctx, 보낸것 } = await 자리(known);
  const 판 = ctx(전송모델('111'));

  // ① 첫 전송 — 카드가 뜨고, 사용자가 **직접 승인**한다.
  const 카드 = await runTurn({ text: '오너에게 보내줘' }, 판);
  assert.equal(카드.kind, 'approval');
  assert.equal(known.size, 0, '승인 전에 상대를 기억하면 안 된다 — 아직 허락받지 않았다');
  await runTurn({ approve: 카드.pendingId }, 판);
  assert.equal(보낸것.length, 1, '승인 뒤에는 실제로 나가야 한다');
  assert.ok(isKnownCounterpart(known, 'telegram.send', '111'), '사람이 허락한 상대를 기억하지 않았다');

  // ② 같은 상대에게 두 번째 — **묻지 않는다.** 이것이 헌장 ③ 이 약속한 마찰 감소다.
  const 두번째 = await runTurn({ text: '오너에게 보내줘' }, ctx(전송모델('111')));
  assert.equal(두번째.kind, 'reply', `아는 상대에 또 물었다: ${두번째.kind}`);
  assert.equal(보낸것.length, 2, '아는 상대인데 안 나갔다');
});

test('헌장 ③: 허락은 그 상대에만 — 다른 상대는 여전히 새 상대다', async () => {
  const known = new Set(['telegram.send|111']);
  const { ctx } = await 자리(known);
  const r = await runTurn({ text: '222 로 보내줘' }, ctx(전송모델('222')));
  assert.equal(r.kind, 'approval', '한 상대 허락이 모든 상대 허락이 되면 헌장 ③ 이 무너진다');
});

test('헌장 ③: 자동으로 흘러간 전송은 새 상대를 만들지 않는다(사람 승인만 미래를 연다)', async () => {
  // 아는 상대(111)로의 전송은 자동으로 돈다. 그 턴에서 모델이 **다른 상대**(999)를 함께 골라도
  // 그 상대가 조용히 아는 상대가 되면 안 된다 — durable 저장은 사람이 누른 자리에서만 생긴다.
  const known = new Set(['telegram.send|111']);
  const { ctx } = await 자리(known);
  await runTurn({ text: '오너에게 보내줘' }, ctx(전송모델('111')));
  assert.equal(known.size, 1, '자동 실행이 새 상대를 저장했다 — 모델이 미래를 열었다');
  assert.ok(!isKnownCounterpart(known, 'telegram.send', '999'));
});
