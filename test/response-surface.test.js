// P2-7 3축 · 응답 표면 — 모델이 **자기가 어디에 답하는지** 안다.
//
// 오너 실사용: 텔레그램 답장이 웹 화면용 긴 마크다운 그대로 나갔다. 전사에는 channel 을 저장하면서
// 모델 입력에는 안 보냈다 — 모델은 어디에 말하는지 몰랐다.
//
// 검사 방향: "이렇게 말하더라"를 채점하지 않는다(그건 모델의 몫이고 비결정적이다).
// **사실이 정확히 갔는가**와 **가면 안 되는 것이 안 갔는가**를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResponseSurface, responseSurfaceFacts } from '../src/kernel/l0-evidence/response-surface.js';
import { runTurn } from '../src/kernel/turn.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

/** 모델이 받은 입력을 그대로 붙잡는다 — 우리가 검사할 것은 모델의 문장이 아니라 우리가 준 재료다. */
async function promptFor(input) {
  let seen;
  const ctx = {
    env: demoEnv(), tools: demoTools(), modelSupportsSearch: true,
    model: { async respond(tc, opts = {}) { seen = tc; return opts.tools?.length ? { text: '네', toolCalls: [] } : '네'; } },
  };
  await runTurn(input, ctx);
  return { tc: seen, ...buildModelMessages(seen) };
}

// ── 사실이 간다 ─────────────────────────────────────────────────────────
test('웹 턴: 표면이 web 이고, 서식이 그려진다는 사실이 간다', async () => {
  const { tc, system } = await promptFor({ text: '안녕' });
  assert.equal(tc.surface.responseSurface, 'web');
  assert.equal(tc.surface.audience, 'web_chat');
  assert.match(system, /웹 대화 화면/);
});

test('텔레그램 턴: 표면이 telegram 이고, **서식이 안 먹는다는 성질**이 사실로 간다', async () => {
  const { tc, system } = await promptFor({
    text: '안녕', source: 'external_channel', channel: 'telegram', channelLabel: '텔레그램',
    triggerSignals: ['direct_message'], channelConnected: true,
  });
  assert.equal(tc.surface.responseSurface, 'telegram');
  assert.equal(tc.surface.audience, 'external_channel');
  assert.match(system, /텔레그램 메시지/);
  // 이게 핵심이다 — "짧게 써라"라는 지시가 아니라 그 표면의 성질을 준다(§24).
  const surfaceLine = system.split('\n').find((l) => l.startsWith('지금 답이 나가는 곳'));
  assert.match(surfaceLine, /기호는 글자 그대로 보이고/, '규칙 대신 사실을 줘야 모델이 스스로 조절한다');
  // 이 줄에는 **지시가 없어야 한다.** (헌장 본문에는 지시가 있으므로 이 줄만 본다.)
  assert.doesNotMatch(surfaceLine, /해라|하지 마|말아|짧게 (써|답)|금지/, '지시 문구를 심으면 모델이 굳는다');
});

test('슬랙 턴: 슬랙의 성질로 간다(채널마다 별도 커널을 만들지 않는다)', async () => {
  const { tc, system } = await promptFor({
    text: '안녕', source: 'external_channel', channel: 'slack.channel', channelLabel: '슬랙',
    triggerSignals: ['mention'], channelConnected: true,
  });
  assert.equal(tc.surface.responseSurface, 'slack', '"slack.channel" 같은 하위 id 도 슬랙으로 본다');
  assert.match(system, /슬랙 메시지/);
});

test('모르는 채널이어도 "바깥이라는 사실"은 준다(웹인 줄 알고 답하는 것보다 낫다)', () => {
  const s = resolveResponseSurface({ source: 'external_channel', channel: 'discord', channelLabel: '디스코드' });
  assert.equal(s.responseSurface, 'unknown', '모르는 것을 아는 척하지 않는다');
  assert.match(responseSurfaceFacts(s), /디스코드.*메시지로 전달된다/);
});

test('사용자가 부르는 이름으로 말한다(내부 id 가 아니라)', () => {
  const facts = responseSurfaceFacts(resolveResponseSurface({
    source: 'external_channel', channel: 'telegram', channelLabel: '업무 알림방',
  }));
  assert.match(facts, /업무 알림방 메시지/);
  assert.doesNotMatch(facts, /telegram/, '내부 id 가 사람 말 자리에 나오면 안 된다');
});

// ── 가면 안 되는 것 ─────────────────────────────────────────────────────
test('방 id · 수신 정책 · 내부 도구명은 모델 입력에 실리지 않는다', async () => {
  const { system, user, tc } = await promptFor({
    text: '안녕', source: 'external_channel', channel: 'telegram', channelLabel: '텔레그램',
    channelPolicy: 'allowlist_only', channelConnected: true,
    triggerSignals: ['allowlisted', 'direct_message'],
  });
  const all = `${system}\n${user}`;
  assert.doesNotMatch(all, /allowlist_only/, '내부 정책어가 새면 사용자 답변에도 샌다');
  assert.doesNotMatch(all, /telegram\.send/, '내부 도구명은 사용자 언어가 아니다');
  assert.equal(tc.surface.chatId, undefined, '방 id 는 패킷에 담지 않는다');
});

test('표면 사실은 한 줄이다(프롬프트를 차지할 이유가 없다)', () => {
  for (const ch of ['telegram', 'slack', undefined]) {
    const f = responseSurfaceFacts(resolveResponseSurface({ source: 'external_channel', channel: ch })) ?? '';
    assert.equal(f.split('\n').length, 1, `${ch}: ${f}`);
    assert.ok(f.length < 140, `${ch}: ${f.length}자`);
  }
});
