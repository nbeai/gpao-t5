// L4 · 라이브 컨텍스트 — 실제 자격 상태를 env·tools에 **함께** 반영한다(단일 진실).
// 감사 보정(2.0-A §10.1): 도구함 상태 = 실제 실행 상태. slack.post는 SLACK_BOT_TOKEN이 있어야
//   사용 가능(usable/green)이고, 없으면 연결 필요(needs_connection/yellow)로 보이며 실행도 불가하다.
//   → 도구함(projectToolbox)과 실행 게이트(isToolExecutable)가 같은 env를 읽어 어긋나지 않는다.
import { demoEnv, demoTools, demoDescriptors } from './demo-context.js';
import { makeWebCollector } from '../runtime/web-collector.js';
import { makeChannelSender } from '../runtime/channel-sender.js';

/**
 * @param {Record<string,string|undefined>} [processEnv]  실제 자격(SLACK_BOT_TOKEN 등)
 * @returns {{env:object, tools:object, descriptors:object[]}}
 */
export function liveDeps(processEnv = {}) {
  const slackToken = processEnv.SLACK_BOT_TOKEN;
  const webTimeoutMs = Number(processEnv.GPAO_T5_WEB_TIMEOUT_MS ?? 15_000);

  // slack.post 연결 상태를 실제 토큰 유무로 결정한다. 토큰 없으면 도구함에서 "연결이 필요해요"(노랑),
  // 실행 게이트에서도 실행 불가 — 승인만 받고 뒤늦게 실패하는 불일치를 없앤다.
  const env = demoEnv({ factOverrides: { 'slack.post': { connected: Boolean(slackToken) } } });

  const senders = {
    'slack.post': makeChannelSender({ channel: 'slack', token: slackToken, defaultTarget: processEnv.SLACK_DEFAULT_CHANNEL }),
  };
  const tools = demoTools({ webCollector: makeWebCollector({ timeoutMs: webTimeoutMs }), senders });

  return { env, tools, descriptors: demoDescriptors() };
}
