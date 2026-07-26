// L0 · 응답 표면 (P2-7 3축) — **지금 이 답이 어디로 나가는가.**
//
// 결함(오너 실사용): 텔레그램 답장이 웹 화면용 긴 마크다운 그대로 나갔다. 전사에는 `channel` 을
// 저장하면서 모델 입력에는 안 보냈기 때문이다 — 모델은 자기가 어디에 말하는지 몰랐다.
//
// **규칙을 주지 않는다(§24).** "짧게 말해라"는 지시이고, 지시는 모델을 굳게 만든다.
// 대신 **사실**을 준다: 텔레그램·슬랙으로 보낼 때 우리는 parse_mode 를 쓰지 않는다
// (channel-sender.js 의 실제 동작) — 그래서 `**굵게**` 는 굵어지지 않고 별표가 그대로 보인다.
// 이건 취향이 아니라 그 표면의 성질이다. 사실을 알면 모델은 스스로 조절한다.
//
// 여기서 **내보내지 않는 것**: 방 id(chatId), 수신 정책, 내부 도구 이름. 그건 내부 판단용이고
// 사용자 답변에 새면 안 된다(헌장 <도구>: 내부 식별자는 사용자에게 보여주지 않는다).

/** 채널 id → 그 표면의 **성질**. 라벨은 사용자가 부르는 이름으로 갈아 끼운다(내부 id 비노출). */
const SURFACE_FACTS = {
  web: () => '지금 답이 나가는 곳: 웹 대화 화면. 제목·목록·코드 블록이 서식으로 그려진다.',
  telegram: (label = '텔레그램') =>
    `지금 답이 나가는 곳: ${label} 메시지. 서식이 적용되지 않아 \`#\`·\`**\` 같은 기호는 글자 그대로 보이고, 화면도 좁다.`,
  slack: (label = '슬랙') =>
    `지금 답이 나가는 곳: ${label} 메시지. 짧은 문단과 목록은 잘 보이지만 제목·표는 서식이 되지 않는다.`,
};

/**
 * 이번 턴의 응답 표면을 사실로 만든다. 모르는 채널은 모르는 대로 둔다(지어내지 않는다).
 * @param {{source?:string, channel?:string, channelLabel?:string}} input 턴 입력(서버가 채운다)
 * @returns {{responseSurface:'web'|'telegram'|'slack'|'unknown', channelLabel?:string,
 *            audience:'web_chat'|'external_channel'}}
 */
export function resolveResponseSurface(input = {}) {
  if (input.source !== 'external_channel') return { responseSurface: 'web', audience: 'web_chat' };
  // 채널 id 는 **내부 판단용**이다("slack.channel" → "slack"). 사용자에게 보이는 건 라벨뿐이다.
  const id = typeof input.channel === 'string' ? input.channel.split('.')[0] : undefined;
  return {
    responseSurface: id && id !== 'web' && SURFACE_FACTS[id] ? id : 'unknown',
    channelLabel: input.channelLabel,
    audience: 'external_channel',
  };
}

/**
 * 모델에게 줄 사실 — **한 줄이다.** 표면 사실이 프롬프트를 차지할 이유는 없다.
 * 웹도 말해 둔다: "어디에 답하는지 모르는 상태"가 없어야 한다.
 */
export function responseSurfaceFacts(surface) {
  if (!surface) return undefined;
  const make = SURFACE_FACTS[surface.responseSurface];
  if (make) return make(surface.channelLabel);
  // 모르는 채널이라도 **바깥이라는 사실**은 준다 — 웹 화면인 줄 알고 답하는 것보다 낫다.
  if (surface.audience === 'external_channel') {
    return `지금 답이 나가는 곳: ${surface.channelLabel ?? '연결된 메신저'}. 웹 화면이 아니라 메시지로 전달된다.`;
  }
  return undefined;
}
