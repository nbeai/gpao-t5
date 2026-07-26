// L4 · 라이브 컨텍스트 — 실제 자격 상태를 env·tools에 **함께** 반영한다(단일 진실).
// 감사 보정(2.0-A §10.1): 도구함 상태 = 실제 실행 상태. slack.post는 SLACK_BOT_TOKEN이 있어야
//   사용 가능(usable/green)이고, 없으면 연결 필요(needs_connection/yellow)로 보이며 실행도 불가하다.
//   → 도구함(projectToolbox)과 실행 게이트(isToolExecutable)가 같은 env를 읽어 어긋나지 않는다.
import { demoEnv, demoTools, demoDescriptors } from './demo-context.js';
import { makeWebCollector } from '../runtime/web-collector.js';
import { makeChannelSender } from '../runtime/channel-sender.js';
import { makeLocalFileTool } from '../runtime/local-file.js';
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
      inboundPolicy: 'mention_required', outboundTool: 'telegram.send',
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
  const webTimeoutMs = Number(processEnv.GPAO_T5_WEB_TIMEOUT_MS ?? 15_000);

  // slack.post 연결 상태를 실제 토큰 유무로 결정한다. 토큰 없으면 도구함에서 "연결이 필요해요"(노랑),
  // 실행 게이트에서도 실행 불가 — 승인만 받고 뒤늦게 실패하는 불일치를 없앤다.
  const env = demoEnv({ factOverrides: { 'slack.post': { connected: Boolean(slackToken) } } });

  // 모델(P-RT-1·2·4, 단일 진실): 연결 관리자가 소유한다 — 저장된 사용자 연결 > env(개발자) > stub.
  // doctor(두 축 반영·공개면 위생)와 화면 연결(connect/disconnect, 확실한 무효만 거절 §6.27)이 한 곳에 있다.
  const modelConnection = makeModelConnection({
    env, processEnv,
    store: deps.connectionStore, // 없으면 지속 없이 동작(demo·테스트)
    fetchImpl: deps.fetchImpl,
    timeoutMs: processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS ? Number(processEnv.GPAO_T5_MODEL_HTTP_TIMEOUT_MS) : undefined,
  });
  const model = modelConnection.model;
  const modelDoctor = () => modelConnection.doctor();

  const senders = {
    'slack.post': makeChannelSender({ channel: 'slack', token: slackToken, defaultTarget: processEnv.SLACK_DEFAULT_CHANNEL }),
  };
  // Phase 0-1: 로컬 파일은 **실제 손발**을 배선한다(스텁 금지 — 등록된 도구는 실제로 동작해야 한다).
  const tools = demoTools({
    webCollector: makeWebCollector({ timeoutMs: webTimeoutMs }),
    senders,
    localFile: makeLocalFileTool({ dataDir: processEnv.GPAO_T5_DATA_DIR }),
  });

  // 채널도 실제 자격에서 파생해 함께 반환한다(단일 진실 — 라이브 표면이 fixture로 초록 오표시 안 하게).
  return { env, tools, descriptors: demoDescriptors(), channels: liveChannels(processEnv), model, modelDoctor, modelConnection };
}
