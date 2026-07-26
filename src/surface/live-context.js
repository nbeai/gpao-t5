// L4 · 라이브 컨텍스트 — 실제 자격 상태를 env·tools에 **함께** 반영한다(단일 진실).
// 감사 보정(2.0-A §10.1): 도구함 상태 = 실제 실행 상태. slack.post는 SLACK_BOT_TOKEN이 있어야
//   사용 가능(usable/green)이고, 없으면 연결 필요(needs_connection/yellow)로 보이며 실행도 불가하다.
//   → 도구함(projectToolbox)과 실행 게이트(isToolExecutable)가 같은 env를 읽어 어긋나지 않는다.
import { demoEnv, demoTools, demoDescriptors } from './demo-context.js';
import { makeWebCollector } from '../runtime/web-collector.js';
import { makeChannelSender } from '../runtime/channel-sender.js';
import { selectLiveModel } from '../runtime/model-provider.js';
import { checkModelHealth } from '../runtime/model-doctor.js';
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

  // 모델도 실제 자격에서 파생한다(P-RT-1, 단일 진실). 구성되면 실 provider(OpenAI OAuth/API키·
  // Anthropic·Gemini·OpenAI-호환), 아니면 stub — env.model 이 같은 판정을 SelfState 로 나른다.
  const { model, envModel } = selectLiveModel(processEnv, { fetchImpl: deps.fetchImpl });
  env.model = envModel;

  // P-RT-2 doctor: "구성됨"을 실 검증으로 "검증됨"까지 승격한다. 자격 실패로 분류되면 env.model 에
  // 반영 → 턴마다 buildSelfState 가 읽어 기존 칩(limits)이 자동으로 진실을 표시(새 대시보드 없음).
  // model_missing 은 자격 문제가 아니므로 authSignal 을 오염시키지 않는다(리포트로만).
  const modelDoctor = async () => {
    const report = await checkModelHealth(processEnv, { fetchImpl: deps.fetchImpl });
    // authSignal 은 내부 진단값 — env 갱신에만 쓰고 공개 리포트에서는 제거한다(감사 B2:
    // provider 원문 에러에는 키 조각·내부 문구가 섞일 수 있어 사용자 표면으로 새면 안 된다).
    const { authSignal, ...publicReport } = report;
    if (['auth_failed', 'billing_blocked', 'rate_limited'].includes(report.state)) {
      env.model.authSignal = authSignal;
    } else if (report.state === 'usable') {
      env.model.authSignal = 'ok'; // 재검증으로 회복되면 표시도 회복
    }
    // 자격과 별도의 readiness 축(감사 B1): model_missing/unreachable 도 SelfState·칩까지 실어
    // "모델 이름이 틀렸는데 화면은 준비됨"을 막는다(보이는 것=되는 것).
    env.model.healthState = report.state;
    return publicReport;
  };

  const senders = {
    'slack.post': makeChannelSender({ channel: 'slack', token: slackToken, defaultTarget: processEnv.SLACK_DEFAULT_CHANNEL }),
  };
  const tools = demoTools({ webCollector: makeWebCollector({ timeoutMs: webTimeoutMs }), senders });

  // 채널도 실제 자격에서 파생해 함께 반환한다(단일 진실 — 라이브 표면이 fixture로 초록 오표시 안 하게).
  return { env, tools, descriptors: demoDescriptors(), channels: liveChannels(processEnv), model, modelDoctor };
}
