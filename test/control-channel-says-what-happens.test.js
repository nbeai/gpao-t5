// **통제 채널 설명은 "승인 뒤 무슨 일이 일어나는가"까지 말한다.**
//
// 라이브 실측 **2회**(2026-08-04 · 사람 사용시험 · 실제 브라우저 · gpt-5.1):
//   ① "내일 아침 9시에 … 확인해서 알려줘"
//      → "예약 같은 건 내가 스스로 시간을 맞춰 다시 일어나는 기능이 **아직 없어서**…"
//   ② "매일 아침 9시에 … 확인해서 알려주는 걸 **반복으로 걸어줘**"
//      → "반복 작업을 예약해서 매일 자동 실행하는 기능까지는 **열려 있지 않아서**"
//      그러고는 사용자에게 cron 스크립트를 짜 줬다(떠넘김).
//
// ②의 발화는 채널 설명의 예시(*"매일 아침"*)와 **글자 그대로 같다.** 그런데도 안 썼다.
//
// ── 런타임은 손을 줬다(측정 확인) ──────────────────────────────────────────
// 같은 발화로 턴을 돌리면 `automation.propose` 가 모델의 도구 목록에 **실제로 들어간다.**
// 그리고 승인 뒤에는 진짜로 돈다 — `makeTickScheduler` 가 서버에 조립돼 있고
// `prepareAutomationRuns` 가 시각이 되면 실행을 만든다(검사 8파일이 그 계약을 지킨다).
//
// ── 그런데 설명은 **절반만** 말했다 ────────────────────────────────────────
//   "실행이 아니다 — 승인 전에는 아무 일도 예약되지 않는다."
// 안 되는 것만 있고 **되는 것이 없다.** 모델이 "제안만 되고 실제 실행은 안 되는구나"로
// 읽으면, 있는 능력을 없다고 단정하고 사용자에게 일을 떠넘긴다.
//
// 이건 손 설명 계약의 거울상이다: *"라벨만 주면 모델이 그럴듯한 하위 기능을 **지어낸다**"* —
// 여기서는 반대로 **있는 기능을 지웠다.** 원인은 같다. **선언이 실제를 다 말하지 않았다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelSchemasFor } from '../src/kernel/l2-plan/model-control.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const 통제 = ['skill.propose', 'automation.propose', 'agent.propose', 'work.state'];
const 채널 = (이름) => modelSchemasFor(buildSelfState(demoEnv()), 통제).find((t) => t.name === 이름);

test('자동화 채널이 모델에게 실제로 간다(이 검사가 성립하는 조건)', () => {
  assert.ok(채널('automation.propose'), '자동화 채널이 모델 도구 목록에 없다');
});

test('자동화 설명이 **승인 뒤 무슨 일이 일어나는지** 말한다', () => {
  const d = String(채널('automation.propose')?.description ?? '');
  assert.match(d, /승인.*(하면|되면|뒤)|정한 시각|그 시각/,
    `안 되는 것만 말하고 되는 것을 안 말한다 — 모델은 "기능이 없다"고 단정한다: "${d}"`);
  assert.match(d, /스스로|자동으로|알아서/,
    `T5 가 스스로 실행한다는 사실이 없다 — 모델은 사용자에게 cron 을 짜 준다: "${d}"`);
});

test('안 되는 것도 그대로 말한다(승인 전에는 아무 일도 없다)', () => {
  const d = String(채널('automation.propose')?.description ?? '');
  assert.match(d, /승인 전에는|실행이 아니/,
    '되는 것만 말하면 모델이 제안을 실행으로 착각한다 — 반대 방향의 거짓이다');
});

test('한 번뿐인 일도 담긴다는 것이 보인다(내일 아침 9시)', () => {
  const c = 채널('automation.propose');
  const 종류 = c?.parameters?.properties?.kind?.enum ?? [];
  assert.ok(종류.includes('once'), '한 번뿐인 예약을 담을 자리가 없다');
  const d = String(c?.description ?? '');
  assert.match(d, /한 번|내일|한 번뿐/,
    `설명이 **반복** 예시로만 시작해서 "내일 아침 9시"가 이 채널로 안 읽힌다: "${d}"`);
});
