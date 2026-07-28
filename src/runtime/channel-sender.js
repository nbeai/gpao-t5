// L3 · ChannelSender — 실제 채널/메신저 전송 어댑터(P6-6). ConnectorProfile(§6.7) 계약을 실행한다.
// 핵심 경계(깊은 감사):
//   - 전송은 항상 A2 뒤에서만 일어난다(sendNeedsApproval=true). 어댑터는 승인 게이트를 우회하지 않는다 —
//     ActionPlan이 승인시킨 뒤 executePlan이 호출하는 "실행자"일 뿐이다.
//   - 자격(토큰)은 어댑터가 소유하지 않는다. 사용자가 config/env로 넣는다. 없으면 정직하게 needs_auth.
//   - 실패는 정직하게 분류: auth_failed(재시도로 안 풀림→permanent) vs rate_limited/timeout(transient→백오프).
//   - 보냈으면 sent, 못 보냈으면 보낸 척 안 한다.
// 안전 규율: fetchImpl 주입 가능 — 테스트·기본은 실 API를 치지 않는다. 라이브 서버만 실제 어댑터 배선.
import { withTimeout } from './with-timeout.js';

export const SEND_STATES = Object.freeze(['sent', 'needs_auth', 'auth_failed', 'rate_limited', 'timeout', 'blocked']);

// 채널별 요청 빌더·응답 해석(선언형 — 와이어는 여기, 정책은 커널). 토큰 위치가 채널마다 다르다.
const CHANNELS = {
  telegram: {
    endpoint: (token) => `https://api.telegram.org/bot${token}/sendMessage`,
    build: (target, text) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text }),
    }),
    interpret: (status, json) => {
      if (json?.ok === true) return { sendState: 'sent' };
      if (status === 401 || json?.error_code === 401) return { sendState: 'auth_failed', detail: json?.description };
      if (status === 429 || json?.error_code === 429) return { sendState: 'rate_limited', detail: json?.description };
      return { sendState: 'blocked', detail: json?.description };
    },
  },
  slack: {
    endpoint: () => 'https://slack.com/api/chat.postMessage',
    build: (target, text, token) => ({
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: target, text }),
    }),
    interpret: (status, json) => {
      if (json?.ok === true) return { sendState: 'sent' };
      const err = json?.error;
      if (err === 'invalid_auth' || err === 'not_authed' || err === 'token_revoked' || status === 401) {
        return { sendState: 'auth_failed', detail: err };
      }
      if (err === 'ratelimited' || status === 429) return { sendState: 'rate_limited', detail: err };
      return { sendState: 'blocked', detail: err };
    },
  },
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 전송 승인 카드에 실릴 사실을 만든다. **한 자리에서만 만든다** — 실제 어댑터와 데모 손이
 * 각자 문구를 지으면 사용자가 보는 말이 갈라진다(§3-③ 단일 진실).
 *
 * 전송은 **되돌릴 수 없다.** 그래서 무엇이 어디로 가는지를 승인 **전에** 보여야 한다.
 * 계약이 없던 동안은 `${라벨} 실행` 으로 떨어져서, 사용자는 받는 곳도 문면도 모른 채 눌렀다.
 * @param {{channel:'telegram'|'slack', defaultTarget?:string}} p
 */
export function makeSendPreview({ channel, defaultTarget } = {}) {
  const 채널이름 = channel === 'telegram' ? '텔레그램' : '슬랙';
  return (args = {}) => {
    const text = String(args?.text ?? args?.request ?? '').trim();
    if (!text) return undefined;
    // targetLabel: 커널이 확정한 **사람 말**(예: 허용 목록의 라벨). 실행 값(chat id)을 카드에
    // 드러내지 않고, 사용자가 아는 이름으로 받는 곳을 보여준다. 실행은 target 만 쓴다.
    const target = args?.targetLabel ?? args?.target ?? defaultTarget;
    // 문면은 **그대로** 보여준다(요약하면 승인한 것과 나간 것이 갈라진다). 길면 뒤만 자른다.
    const 줄임 = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    return {
      impact: `${채널이름}으로 보내요 — "${줄임}"`,
      scope: target ? `받는 곳: ${target}` : '받는 곳이 아직 정해지지 않았어요',
      duration: '이번 한 번',
      cancel: '보낸 뒤에는 되돌릴 수 없어요',
    };
  };
}

/**
 * 실제 채널 전송 도구 핸들러를 만든다. 전송은 A2 승인 뒤 실행자로만 불린다.
 * @param {{channel:'telegram'|'slack', token?:string, defaultTarget?:string, fetchImpl?:Function, timeoutMs?:number}} deps
 * @returns {{toolKind:'send', handler:(args:*)=>Promise<object>}}
 */
export function makeChannelSender(deps = {}) {
  const { channel, token, defaultTarget } = deps;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const spec = CHANNELS[channel];
  return {
    toolKind: 'send',
    previewOf: makeSendPreview({ channel, defaultTarget }),
    async handler(args) {
      const text = String(args?.text ?? args?.request ?? '').trim();
      const target = args?.target ?? defaultTarget;
      if (!spec) return { blocked: true, sendState: 'blocked', userSafeSummary: `알 수 없는 채널이에요: ${channel}` };
      // 자격 없음 → needs_auth(재시도로 안 풀림). 사용자가 연결해야 한다. 몰래 보내지 않는다.
      if (!token) return { blocked: true, sendState: 'needs_auth', userSafeSummary: '채널 자격이 아직 없어요(연결이 필요해요).', nextSafeAction: '채널을 연결하면 이어서 보낼 수 있어요.' };
      if (!text) return { blocked: true, sendState: 'blocked', userSafeSummary: '보낼 내용이 없어요.' };
      if (!target) return { blocked: true, sendState: 'blocked', userSafeSummary: '보낼 대상(채널/채팅)이 지정되지 않았어요.' };

      const url = spec.endpoint(token);
      const { headers, body } = spec.build(target, text, token);
      let status, json;
      try {
        const controller = new AbortController();
        ({ status, json } = await withTimeout(async () => {
          const r = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
          let j = null;
          try { j = await r.json(); } catch { /* 비JSON 응답은 null로 두고 상태코드로 해석 */ }
          return { status: r.status, json: j };
        }, timeoutMs, controller));
      } catch (e) {
        // 네트워크·시간초과 → transient(백오프 재시도 여지). 보낸 척 안 함.
        return { failed: true, sendState: 'timeout', userSafeSummary: '채널에 연결하지 못했어요.', nextSafeAction: '잠시 후 다시 시도할까요?', diagnosticTrace: { message: e?.message } };
      }

      const { sendState, detail } = spec.interpret(status, json);
      if (sendState === 'sent') {
        return { result: { sent: true, channel, target }, userSafeSummary: `${spec === CHANNELS.telegram ? '텔레그램' : '슬랙'}에 보냈어요.` };
      }
      if (sendState === 'auth_failed' || sendState === 'needs_auth') {
        // permanent: 자격 문제는 재시도로 안 풀린다 → blocked(자동화면 즉시 포기, 재연결 필요).
        return { blocked: true, sendState, userSafeSummary: '채널 인증이 유효하지 않아요(다시 연결이 필요해요).', nextSafeAction: '채널을 다시 연결하면 이어서 보낼 수 있어요.', diagnosticTrace: { detail } };
      }
      if (sendState === 'rate_limited') {
        // transient: 잠시 후 재시도 여지 → failed(자동화면 백오프).
        return { failed: true, sendState, userSafeSummary: '채널이 잠시 요청을 제한하고 있어요.', nextSafeAction: '잠시 후 다시 시도할까요?', diagnosticTrace: { detail } };
      }
      return { blocked: true, sendState: 'blocked', userSafeSummary: '채널이 전송을 거부했어요.', diagnosticTrace: { detail } };
    },
  };
}
