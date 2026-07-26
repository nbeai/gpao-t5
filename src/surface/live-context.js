// L4 · 라이브 컨텍스트 — 실제 자격 상태를 env·tools에 **함께** 반영한다(단일 진실).
// 감사 보정(2.0-A §10.1): 도구함 상태 = 실제 실행 상태. slack.post는 SLACK_BOT_TOKEN이 있어야
//   사용 가능(usable/green)이고, 없으면 연결 필요(needs_connection/yellow)로 보이며 실행도 불가하다.
//   → 도구함(projectToolbox)과 실행 게이트(isToolExecutable)가 같은 env를 읽어 어긋나지 않는다.
import { demoEnv, demoTools, demoDescriptors } from './demo-context.js';
import { makeRobotsCheck } from '../runtime/robots.js';
import { makeWebCollector } from '../runtime/web-collector.js';
import { makeChannelSender } from '../runtime/channel-sender.js';
import { makeLocalFileTool } from '../runtime/local-file.js';
import { makeSessionSearchTool } from '../runtime/session-search-tool.js';
import { makeModelConnection } from './model-connection.js';
import { defineConnector } from '../kernel/l2-plan/connector-profile.js';
import { defineChannel } from '../kernel/l2-plan/channel-registry.js';

/**
 * 라이브 채널 상태를 **실제 자격**에서 파생한다(P6-16 blocker 보정). demoChannels(고정 fixture)를
 * 라이브 표면에 쓰지 않는다 — "보이는 것 = 실제 가능한 것". 토큰/수신 설정 없으면 connected:false →
 * `/channels`가 "받을 준비됨(초록)"으로 보이지 않고 연결 안내를 준다(2.0-A slack 초록 오표시와 같은 계열).
 * @param {Record<string,string|undefined>} processEnv
 */
export function liveChannels(processEnv = {}) {
  const tgToken = processEnv.TELEGRAM_BOT_TOKEN;   // 없으면 텔레그램 수신 불가 → 미연결
  const slackToken = processEnv.SLACK_BOT_TOKEN;   // 슬랙 채널 자격도 실제 토큰 유무로
  return [
    defineChannel({
      id: 'telegram',
      connector: defineConnector({ id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: Boolean(tgToken) }),
      // P5-1: 토큰이 있으면 실수신기(long polling)가 실제로 돈다 — 이제 "받는다"고 말해도 참이다.
      // 오너 결정: 봇은 누구나 말을 걸 수 있으므로 기본은 허용된 사람만.
      inboundPolicy: 'allowlist_only', outboundTool: 'telegram.send', hasReceiver: Boolean(tgToken),
    }),
    defineChannel({
      id: 'slack.channel',
      connector: defineConnector({ id: 'slack.channel', label: '슬랙 채널', kind: 'channel', authState: 'oauth', connected: Boolean(slackToken) }),
      inboundPolicy: 'mention_required', outboundTool: 'slack.post',
    }),
  ];
}

/**
 * @param {Record<string,string|undefined>} [processEnv]  실제 자격(SLACK_BOT_TOKEN 등)
 * @param {{fetchImpl?:Function}} [deps]  테스트 주입용 — 기본은 실 fetch(라이브 서버만 실제 호출)
 * @returns {{env:object, tools:object, descriptors:object[], channels:object[], model:object}}
 */
export function liveDeps(processEnv = {}, deps = {}) {
  const slackToken = processEnv.SLACK_BOT_TOKEN;
  const tgToken = processEnv.TELEGRAM_BOT_TOKEN;
  const webTimeoutMs = Number(processEnv.GPAO_T5_WEB_TIMEOUT_MS ?? 15_000);

  // 라이브가 **선언하는 도구 = 라이브에 실제 손이 있는 도구**. 예전엔 demo 목록을 그대로 선언해
  // `mail.send`(핸들러가 아예 없다)를 "연결됨"으로 사용자와 모델에게 말했다 — 없는 능력을 있다고
  // 한 것이다. 목록을 손으로 맞추지 말고, 게이트가 선언⊆손 불변식을 매번 검사한다.
  const LIVE_TOOL_IDS = ['web.collect', 'local.file', 'session.search', 'slack.post', 'telegram.send'];

  // 전송 도구의 연결 상태는 실제 토큰 유무로 결정한다. 토큰 없으면 도구함에서 "연결이 필요해요"(노랑),
  // 실행 게이트에서도 실행 불가 — 승인만 받고 뒤늦게 실패하는 불일치를 없앤다.
  const env = demoEnv({
    include: LIVE_TOOL_IDS,
    factOverrides: {
      'slack.post': { connected: Boolean(slackToken) },
      'telegram.send': { connected: Boolean(tgToken) },
    },
  });

  // 모델(P-RT-1·2·4, 단일 진실): 연결 관리자가 소유한다 — 저장된 사용자 연결 > env(개발자) > stub.
  // doctor(두 축 반영·공개면 위생)와 화면 연결(connect/disconnect, 확실한 무효만 거절 §6.27)이 한 곳에 있다.
  const modelConnection = makeModelConnection({
    env, processEnv,
    store: deps.connectionStore, // 없으면 지속 없이 동작(demo·테스트)
    fetchImpl: deps.fetchImpl,
    timeoutMs: processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS ? Number(processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS) : undefined,
  });
  const model = modelConnection.model;
  const modelSupportsSearch = () => modelConnection.supportsSearch();
  const modelProviderId = () => modelConnection.providerId();
  const modelDoctor = () => modelConnection.doctor();

  const senders = {
    'slack.post': makeChannelSender({ channel: 'slack', token: slackToken, defaultTarget: processEnv.SLACK_DEFAULT_CHANNEL }),
    // 채널이 outboundTool 로 선언한 것에는 실제 손이 있어야 한다. 와이어는 이미 있었고 배선만 없었다 —
    // 그래서 텔레그램은 "받을 준비가 됐어요"라고 말하면서 답장을 못 보냈다(감사 지적).
    'telegram.send': makeChannelSender({ channel: 'telegram', token: tgToken, defaultTarget: processEnv.TELEGRAM_DEFAULT_CHAT }),
  };
  // Phase 0-1: 로컬 파일은 **실제 손발**을 배선한다(스텁 금지 — 등록된 도구는 실제로 동작해야 한다).
  const tools = demoTools({
    webCollector: makeWebCollector({
      timeoutMs: webTimeoutMs,
      // 실제 robots.txt 를 확인한다. 안 넘기면 검사가 아예 안 돌아 "수집을 막은 페이지는 읽지 못한다"는
      // 능력 문장이 라이브에서만 거짓이 된다(감사 지적).
      robotsCheck: makeRobotsCheck({ timeoutMs: webTimeoutMs }),
    }),
    senders,
    localFile: makeLocalFileTool({ dataDir: processEnv.GPAO_T5_DATA_DIR }),
    // 지난 대화 찾기 — 실제 세션 저장소에서. 지운 대화는 제외한다(휴지통이 검색으로 되살아나지 않게).
    sessionSearch: deps.sessionStore ? makeSessionSearchTool({ store: deps.sessionStore }) : undefined,
  });

  // 채널도 실제 자격에서 파생해 함께 반환한다(단일 진실 — 라이브 표면이 fixture로 초록 오표시 안 하게).
  // connectors 는 그 채널이 들고 있는 자격 그대로다. 따로 만들면 두 진실이 갈라지고, 안 넘기면
  // 서버가 demo fixture(텔레그램 connected:true 하드코딩)로 폴백해 **토큰 없는 채널이 라이브에서
  // 열린다** — Phase 0-5 에서 실제로 그렇게 새고 있었다.
  const channels = liveChannels(processEnv);
  return {
    env, tools, descriptors: demoDescriptors({ include: LIVE_TOOL_IDS }), channels,
    connectors: channels.map((c) => c.connector),
    model, modelDoctor, modelConnection, modelSupportsSearch, modelProviderId,
  };
}
