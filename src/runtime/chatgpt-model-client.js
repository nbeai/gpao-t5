// L3 · ChatGPT 백엔드 ModelClient (P-RT-3). OAuth 토큰은 플랫폼 API 가 아니라 Codex 백엔드에서 동작한다.
// 와이어: POST chatgpt.com/backend-api/codex/responses — Responses 셰이프, stream 필수(SSE 누적 → 단발 반환).
// 다른 provider 와 같은 ModelClient 계약(respond)이라 turn·타임아웃·doctor 가 그대로 적용된다.
import { withTimeout } from './with-timeout.js';
import { ModelTimeoutError } from './model-timeout.js';
import { ModelProviderError } from './model-provider.js';
import { buildModelMessages } from './model-provider.js';

export const CHATGPT_BACKEND_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const CHATGPT_DEFAULT_MODEL = 'gpt-5.3-codex';
const DEFAULT_TIMEOUT_MS = 25_000;

/** SSE 스트림에서 최종 텍스트만 누적한다(사용자면엔 완성문만 — 사고 원문 미노출). */
export function accumulateResponsesText(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') out.push(ev.delta);
    else if (ev.type === 'response.completed' && !out.length) {
      const text = ev.response?.output
        ?.flatMap((o) => o.content ?? [])
        ?.filter((c) => c.type === 'output_text')
        ?.map((c) => c.text)
        ?.join('');
      if (text) out.push(text);
    }
  }
  return out.join('');
}

/**
 * @param {{credentials:() => Promise<{access:string, accountId?:string}>, modelId?:string,
 *          fetchImpl?:Function, timeoutMs?:number}} deps
 * @returns {import('./model-client.js').ModelClient}
 */
export function makeChatGptModelClient(deps) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const modelId = deps.modelId ?? CHATGPT_DEFAULT_MODEL;
  return {
    async respond(tc) {
      const cred = await deps.credentials(); // 만료 임박이면 관리자가 여기서 갱신한다
      const m = buildModelMessages(tc);      // §11 사실만 — provider 와 같은 입력 계약
      const controller = new AbortController();
      let status, raw;
      try {
        ({ status, raw } = await withTimeout(async () => {
          const r = await fetchImpl(CHATGPT_BACKEND_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${cred.access}`,
              ...(cred.accountId ? { 'chatgpt-account-id': cred.accountId } : {}),
              accept: 'text/event-stream',
            },
            body: JSON.stringify({
              model: modelId,
              instructions: m.system,
              input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: m.user }] }],
              stream: true,   // 이 백엔드는 스트림만 받는다
              store: false,   // 대화 저장 안 함(사용자 데이터 최소)
            }),
            signal: controller.signal,
          });
          return { status: r.status, raw: await r.text() };
        }, timeoutMs, controller));
      } catch (e) {
        if (e?.name === 'AbortError') throw new ModelTimeoutError(timeoutMs);
        throw new ModelProviderError({ provider: 'chatgpt_oauth', authSignal: `network ${e?.message ?? e}` });
      }
      if (status < 200 || status >= 300) {
        // 원문을 authSignal 로만 나른다(분류는 kernel classifyModelAuth — 공개면 미노출).
        throw new ModelProviderError({ provider: 'chatgpt_oauth', status, authSignal: `${status} ${raw.slice(0, 300)}` });
      }
      const text = accumulateResponsesText(raw);
      if (!text) throw new ModelProviderError({ provider: 'chatgpt_oauth', status, authSignal: 'empty response stream' });
      return text;
    },
  };
}
