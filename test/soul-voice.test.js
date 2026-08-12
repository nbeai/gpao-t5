// P2-8 · SOUL 말투 — **목소리는 SOUL 이 갖고, 매 턴 간다.**
//
// 흡수(§24.1, 원리만): OpenClaw·Hermes 는 SOUL.md 를 "agent 의 voice 가 사는 곳"으로 두고
// 운영 규칙(AGENTS.md)과 분리한다. T5 도 나눈다 —
//   SOUL.md      정체·말투·대화 태도
//   판단 헌장     매 턴 모델이 보는 판단 순서
//   response surface  채널별 표면의 성질
//   workingState 지금 대화에서 이어야 할 사실
//
// 실측 결함: T5 의 SOUL 은 `selfhoodLookup` 이 **"너 뭐 할 수 있어?"라고 물었을 때만** 실렸고,
// 대상 섹션도 capabilities/limits/identity 셋뿐이었다. **말투 문장은 한 번도 모델에게 간 적이 없다.**
// 그 상태에서 SOUL.md 를 강화해 봐야 한 글자도 안 간다 — 그래서 배선을 먼저 이었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soulVoice, MAX_VOICE_CHARS } from '../src/kernel/l1-intent/selfhood-lookup.js';
import { SOUL_SEED } from '../src/kernel/soul-seed.js';
import { runTurn } from '../src/kernel/turn.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

async function promptFor({ soul } = {}) {
  let seen;
  await runTurn({ text: '안녕' }, {
    env: demoEnv(), tools: demoTools(), selfhoodDocs: { soul },
    model: { async respond(tc, opts = {}) { seen = tc; return opts.tools?.length ? { text: '네', toolCalls: [] } : '네'; } },
  });
  return { tc: seen, ...buildModelMessages(seen) };
}

test('말투 구역만 뽑는다(문서 전체를 매 턴 싣지 않는다)', () => {
  const v = soulVoice(SOUL_SEED);
  assert.match(v, /반말이면 반말로/);
  assert.doesNotMatch(v, /## /, '다음 구역까지 끌고 오면 안 된다');
  assert.ok(v.length <= MAX_VOICE_CHARS, `${v.length}자 — 매 턴 실리므로 커지면 대화 이력이 밀려난다`);
});

test('**매 턴** 모델 입력에 들어간다(물어봤을 때만이 아니다)', async () => {
  const { system } = await promptFor({ soul: SOUL_SEED });
  assert.match(system, /<말투>/, '말투가 안 가면 목소리가 턴마다 새로 정해진다');
  assert.match(system, /반말이면 반말로/);
});

test('말투는 **취향**이다 — 미러링 · 사람 말 · 온도', () => {
  const v = soulVoice(SOUL_SEED);
  assert.match(v, /반말.*존댓말|존댓말.*반말/, '사용자 말투를 따라간다');
  assert.match(v, /한 대화 안에서 바꾸지 않는다/);
  assert.match(v, /정책문|안내문/, '제품 설명처럼 말하지 않는다');
});

// ── 취향과 계약의 분리 (오너 지시 2026-07-27) ────────────────────────────
// "기능과 성능에 중요한 내용이면, 사용자가 SOUL.md 를 고쳐도 그 부분은 안 바뀌게 하는 게 맞다."
// 강제하는 방법은 검사가 아니라 **위치**다: 계약을 SOUL 에 두지 않으면 지울 수가 없다.
test('계약은 말투 구역에 없다 — 사용자가 지울 수 있는 자리에 두지 않는다', () => {
  const v = soulVoice(SOUL_SEED);
  // 안전·정직·비노출은 헌장(코드)이 든다. 여기 있으면 사용자가 지우는 순간 사라진다.
  for (const contract of [/터미널|명령어/, /승인/, /삭제/, /내부 식별자/, /막혔다/]) {
    assert.doesNotMatch(v, contract, `계약이 말투 구역에 있다: ${contract}`);
  }
});

test('그 계약들은 헌장(코드)에 있다 — SOUL 을 통째로 지워도 남는다', async () => {
  const { system } = await promptFor({ soul: undefined });
  assert.doesNotMatch(system, /<말투>/, '말투는 없어도');
  assert.match(system, /명령어 말고 사람 말로/, '떠넘김 금지는 남는다');
  assert.match(system, /내부 식별자.*보여주지 않는다/, '내부 비노출도 남는다');
  assert.match(system, /안 해 본 일을 "막혔다"고 말하지 않는다/, '정직도 남는다');
});

test('사용자가 말투 구역을 지우면 아무 것도 싣지 않는다(문서 주도권은 사용자에게)', async () => {
  assert.equal(soulVoice('# 나\n\n## 정체\n그냥 나다.'), undefined);
  assert.equal(soulVoice(''), undefined);
  assert.equal(soulVoice(undefined), undefined);
  const { system } = await promptFor({ soul: '# 나\n\n## 정체\n그냥 나다.' });
  assert.doesNotMatch(system, /<말투>/);
});

test('사용자가 고친 말투가 그대로 간다(우리 문장으로 덮지 않는다)', async () => {
  const mine = '# 나\n\n## 말투\n무조건 세 줄 이내로. 이모지 금지.\n';
  const { system } = await promptFor({ soul: mine });
  assert.match(system, /무조건 세 줄 이내로/);
  assert.doesNotMatch(system, /반말이면 반말로/, '기본값이 사용자 설정을 덮으면 고칠 이유가 없다');
});

test('말투는 **고정 접두**에 있다(매 턴 바뀌는 것 앞) — 캐시가 깨지지 않게', async () => {
  const { system } = await promptFor({ soul: SOUL_SEED });
  assert.ok(system.indexOf('<말투>') < system.indexOf('[지금]'),
    '매 턴 바뀌는 시각보다 앞에 있어야 프롬프트 캐시에 얹힌다');
});
