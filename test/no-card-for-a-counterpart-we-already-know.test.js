// **불필요한 승인 카드는 모두 없앤다** (오너 지시 2026-08-12).
//
// 헌장 ③ 은 *"새 상대에게 **첫** 외부 전송"* 만 승인이다. 아는 상대에게 보내는 것은 자동이다.
// 판정 함수는 정확히 그렇게 서 있다 —
//   `authority.js` `case 'send': return action?.counterpartKnown !== true;`
// 배선도 다 되어 있다 — `action-plan.js:277` 이 `counterpartKnown` 을 세워 넘긴다.
//
// 그런데 발신 손 셋(`mail.send`·`slack.post`·`telegram.send`)이 선언에 `needsApproval: true`
// 를 달고 있고, `decideAutoGrant` 의 **첫 줄**이 그것을 먼저 본다:
//   ```js
//   if (action?.needsApproval) return false;   // ← 여기서 끝난다
//   if (isCharterAsk(action)) return false;    // counterpartKnown 은 여기서야 본다
//   ```
// 그래서 **같은 사람에게 백 번째 보내도 매번 카드**다. 헌장이 자동으로 둔 것을 손 선언이 막는다.
//
// 같은 파일이 이미 이 규율을 적어 뒀다(`authority.js:170`):
//   *"이 선언은 이제 **예외**다. 손 전체에 기본값으로 다는 것(옛 http/cli 도구)은 헌장 위반이고,
//     그 기본값들은 걷어냈다."*
// **발신 셋이 안 걷힌 것이다.** 그리고 `action-plan.js:269` 가 같은 자리를 이미 한 번 진단했다 —
//   *"계약과 신분 만드는 자리는 있었는데 **둘을 잇는 배선이 없었다**… 만들어 놓고 안 이었다."*
//
// 오너 규율(2026-07-30): *"자동성이 의무다 — 승인으로 안전을 사지 마라."*
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAutoGrant } from '../src/kernel/l2-plan/authority.js';
import { demoDescriptors } from '../src/surface/demo-context.js';

const 발신손 = ['mail.send', 'slack.post', 'telegram.send'];
const 선언 = (id) => (demoDescriptors() ?? []).find((d) => d.id === id);
/** 계획 층이 실제로 만들어 넘기는 모양 그대로(`action-plan.js` `asAction`). */
const 행동 = (id, { 아는상대 }) => {
  const d = 선언(id);
  assert.ok(d, `${id} 선언이 없다 — 전제부터 안 선다`);
  return {
    label: id, kind: d.toolKind, counterpartKnown: 아는상대,
    revocable: d.reversible, needsApproval: d.needsApproval,
    ...(아는상대 ? { 상대열쇠: `${id}|someone` } : {}),
  };
};

test('① 아는 상대에게 보내면 카드가 안 뜬다 — 헌장 ③ 은 「첫」 전송만이다', () => {
  for (const id of 발신손) {
    assert.equal(decideAutoGrant(행동(id, { 아는상대: true })), true,
      `**${id}: 아는 상대인데도 카드가 뜬다** — 같은 사람에게 백 번째 보내도 매번 묻는다`);
  }
});

test('② 새 상대 첫 전송은 그대로 카드다 — 헌장 ③ 이 안 헐거워졌다', () => {
  for (const id of 발신손) {
    assert.equal(decideAutoGrant(행동(id, { 아는상대: false })), false,
      `**${id}: 새 상대에게 확인 없이 나간다** — 헌장 ③ 이 무너졌다`);
  }
});

test('③ 상대를 못 알아내면 카드다 — 모르면 조인다(fail-closed)', () => {
  for (const id of 발신손) {
    // `상대열쇠` 가 없으면 계획 층이 `counterpartKnown:false` 로 넘긴다(action-plan.js:277).
    assert.equal(decideAutoGrant({ label: id, kind: 선언(id).toolKind, counterpartKnown: false }), false,
      `**${id}: 상대를 모르는데 자동이다**`);
  }
});

test('④ 전송이 되돌릴 수 없다는 사실은 그대로다 — 사실을 고쳐 카드를 없애지 않았다', () => {
  for (const id of 발신손) {
    assert.equal(선언(id).reversible, false,
      `**${id}: reversible 을 true 로 바꿔 카드를 없앴다** — 그건 사실 조작이다(C5)`);
  }
});

test('⑤ 헌장 넷의 나머지는 조건이 열려도 카드다 — 돈·공개·권한·비밀 유출', () => {
  for (const kind of ['pay', 'publish', 'grant_permission', 'export_sensitive', 'escalate']) {
    assert.equal(decideAutoGrant({ kind, counterpartKnown: true, revocable: true }), false,
      `**${kind} 가 자동이 됐다** — 헌장 바닥이 뚫렸다`);
  }
});

test('⑥ 어휘 밖은 여전히 카드다 — 분류 안 된 것을 자동으로 흘리지 않는다', () => {
  assert.equal(decideAutoGrant({ kind: 'transfer_money' }), false,
    '어휘 밖 종류가 자동이 됐다 — 원격 커넥터가 헌장을 그냥 지나간다');
});
