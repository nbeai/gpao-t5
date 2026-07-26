// L3 · 텔레그램 수신기 (P5-1) — **`/channel/inbound` 를 부를 주체**.
//
// 지금까지 T5 는 "받는 문"만 있고 문 앞에 서 있는 사람이 없었다. 채널이 "받을 준비가 됐어요"라고
// 말해도 메시지는 한 통도 들어오지 않았다(Phase 0-5 이월분).
//
// 왜 폴링인가: webhook 은 공개 주소가 필요하다. T5 는 사용자의 로컬 컴퓨터에서 도는 OS 라
// 공개 주소가 없는 게 정상이다. long polling 은 방화벽 뒤에서도 그냥 된다(OpenClaw·Hermes 도
// 로컬 실행에서는 같은 선택을 한다). webhook 은 서버 배포가 생기면 그때 얹는다.
//
// 계약:
//   · 같은 메시지를 두 번 처리하지 않는다 — offset 을 **파일에 남긴다**(재시작해도 유지).
//   · 자격이 없으면 조용히 안 돈다. 없는 걸 도는 척하지 않는다.
//   · 네트워크 실패는 백오프하고 계속 산다(한 번 끊겼다고 수신이 죽으면 안 된다).
//   · 판정은 하지 않는다 — 정규화해서 커널에 넘기고, 허용·정책은 커널이 정한다.
import { withTimeout } from './with-timeout.js';

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;
const LONG_POLL_S = 25;          // 텔레그램 권장 범위. 조용할 때 요청 수를 줄인다.
const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000]; // 연속 실패 시 점점 뜸하게

/**
 * 텔레그램 update → T5 인바운드 메시지(정규화 전 단계). 판정하지 않고 사실만 옮긴다.
 * @param {object} update
 * @returns {{channel:string, chatId:string, userId:string, username?:string, text:string,
 *   isDirectMessage:boolean, isMention:boolean}|null}
 */
export function toInboundMessage(update, botUsername) {
  const msg = update?.message ?? update?.edited_message;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!text) return null; // 사진·스티커 등은 지금 다루지 않는다(못 하는 걸 하는 척하지 않는다)
  const chatType = msg.chat?.type;
  const mention = botUsername
    ? new RegExp(`@${botUsername}\\b`, 'i').test(text)
    : /^\//.test(text); // 봇 이름을 모르면 명령형(/...)만 부름으로 본다
  return {
    channel: 'telegram',
    chatId: String(msg.chat?.id ?? ''),
    userId: String(msg.from?.id ?? ''),
    username: msg.from?.username ? String(msg.from.username) : undefined,
    text,
    isDirectMessage: chatType === 'private',
    isMention: mention,
  };
}

/**
 * @param {{token?:string, fetchImpl?:Function, onMessage:Function, offsetStore?:{load:Function,save:Function},
 *   timeoutMs?:number, longPollSeconds?:number, log?:Function}} deps
 */
export function makeTelegramReceiver(deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const longPoll = deps.longPollSeconds ?? LONG_POLL_S;
  const timeoutMs = deps.timeoutMs ?? (longPoll + 10) * 1000;
  const log = deps.log ?? (() => {});
  let running = false;
  let offset = 0;
  let failures = 0;
  let botUsername;

  async function call(method, body) {
    const controller = new AbortController();
    return withTimeout(async () => {
      const r = await fetchImpl(API(deps.token, method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    }, timeoutMs, controller);
  }

  /** 한 번만 돌린다(테스트·수동 확인용). 처리한 메시지 수를 돌려준다. */
  async function pollOnce() {
    const { status, json } = await call('getUpdates', { offset, timeout: longPoll, allowed_updates: ['message'] });
    if (status === 401 || json?.error_code === 401) {
      const e = new Error('telegram_auth_failed');
      e.authFailed = true;
      throw e;
    }
    if (!json?.ok) throw new Error(json?.description ?? `telegram_${status}`);
    const updates = json.result ?? [];
    let handled = 0;
    for (const u of updates) {
      // offset 은 **처리 여부와 무관하게** 전진시킨다. 못 다루는 메시지에 걸려 영원히 같은 것을
      // 다시 받으면 수신이 통째로 막힌다.
      offset = Math.max(offset, (u.update_id ?? 0) + 1);
      const msg = toInboundMessage(u, botUsername);
      if (!msg) continue;
      try { await deps.onMessage(msg); handled += 1; } catch (e) { log('inbound_handler_failed', e?.message); }
    }
    if (updates.length) await deps.offsetStore?.save(offset);
    return handled;
  }

  return {
    get offset() { return offset; },
    get running() { return running; },
    pollOnce,

    /** 자격이 있으면 수신을 시작한다. 없으면 **시작하지 않고 그 사실을 돌려준다**(도는 척 금지). */
    async start() {
      if (!deps.token) return { started: false, reason: 'no_token' };
      if (running) return { started: true, reason: 'already_running' };
      offset = (await deps.offsetStore?.load()) ?? 0;
      // 봇 이름을 알아야 그룹에서 "부름"을 판정할 수 있다. 실패해도 수신은 시작한다(1:1 은 그대로 동작).
      try {
        const me = await call('getMe');
        botUsername = me.json?.result?.username;
      } catch { /* 이름을 몰라도 받는 건 받는다 */ }
      running = true;
      (async () => {
        while (running) {
          try {
            await pollOnce();
            failures = 0;
          } catch (e) {
            if (e?.authFailed) {
              // 토큰이 틀렸다. 계속 두드리지 않는다 — 사용자가 자격을 고쳐야 한다.
              log('telegram_auth_failed');
              running = false;
              break;
            }
            const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
            failures += 1;
            log('telegram_poll_failed', e?.message, `${wait}ms 뒤 재시도`);
            await new Promise((r) => setTimeout(r, wait));
          }
        }
      })();
      return { started: true, botUsername };
    },

    stop() { running = false; },
  };
}
