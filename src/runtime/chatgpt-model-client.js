// L3 · ChatGPT 백엔드 ModelClient (P-RT-3). OAuth 토큰은 플랫폼 API 가 아니라 Codex 백엔드에서 동작한다.
// 와이어: POST chatgpt.com/backend-api/codex/responses — Responses 셰이프, stream 필수(SSE 누적 → 단발 반환).
// 다른 provider 와 같은 ModelClient 계약(respond)이라 turn·타임아웃·doctor 가 그대로 적용된다.
import { withTimeout } from './with-timeout.js';
import { ModelTimeoutError } from './model-timeout.js';
import { ModelProviderError } from './model-provider.js';
import { buildModelMessages } from './model-provider.js';

export const CHATGPT_BACKEND_URL = 'https://chatgpt.com/backend-api/codex/responses';

/** 대화 이력 → Responses 입력 아이템. 이 셰이프는 사용자면 input_text, 모델면 output_text 다. */
export function responsesHistory(m) {
  return (m?.history ?? []).map((h) => (h.role === 'assistant'
    ? { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: h.text }] }
    : { type: 'message', role: 'user', content: [{ type: 'input_text', text: h.text }] }));
}
// 계정 경로에서 실제로 통과하는 모델(2026-07-26 오너 계정 실측). codex 접미 계열은 이 경로에서
// "not supported when using Codex with a ChatGPT account" 400 으로 거절된다 — 카탈로그 문자열이
// 있다고 계정 경로에서도 되는 게 아니다(실측 전엔 기본값을 추정하지 않는다).
export const CHATGPT_DEFAULT_MODEL = 'gpt-5.5';
// 계정 경로(추론 모델)는 한 턴이 분 단위로 걸린다 — 2026-07-26 실사용에서 "설명해봐" 한 마디가
// 25초 상한에 걸려 "응답이 늦어 잠시 멈췄어요"로 끊겼다. §6.21 의 목적은 **무한 매달림 방지**이지
// 느린 모델을 죽이는 게 아니다. 넉넉히 잡되 무한은 아니게 한다(스트림 heartbeat 가 대기를 지탱).
const DEFAULT_TIMEOUT_MS = 150_000;

/** SSE 한 줄에서 사용자면 텍스트 조각만 뽑는다(사고 원문·도구 인자는 절대 흘리지 않는다, §6.12). */
export function textDeltaFromLine(line, { allowCompleted = true } = {}) {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  let ev;
  try { ev = JSON.parse(payload); } catch { return null; }
  if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') return ev.delta;
  if (allowCompleted && ev.type === 'response.completed') {
    // 델타를 못 준 응답의 폴백(완성본에서 텍스트만).
    const text = ev.response?.output
      ?.flatMap((o) => o.content ?? [])
      ?.filter((c) => c.type === 'output_text')
      ?.map((c) => c.text)
      ?.join('');
    return text || null;
  }
  return null;
}

/** 전체 SSE 본문에서 최종 텍스트를 누적한다(비스트리밍 경로·테스트용). */
export function accumulateResponsesText(raw) {
  const out = [];
  let sawDelta = false;
  for (const line of raw.split('\n')) {
    const piece = textDeltaFromLine(line, { allowCompleted: !sawDelta });
    if (piece == null) continue;
    if (line.includes('output_text.delta')) sawDelta = true;
    out.push(piece);
  }
  return out.join('');
}

/**
 * 스트림 본문을 줄 단위로 읽으며 텍스트 조각을 흘린다(P-STR-1).
 * 조각은 **화면용 미리보기**다 — 저장하지 않는다. 최종 텍스트는 반환값이 진실.
 * @param {ReadableStream|null} body @param {(t:string)=>void} [onDelta]
 */
export async function readTextStream(body, onDelta) {
  if (!body?.getReader) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let sawDelta = false;
  const out = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? ''; // 마지막 조각은 미완일 수 있다 — 다음 청크와 이어 붙인다
    for (const line of lines) {
      const piece = textDeltaFromLine(line, { allowCompleted: !sawDelta });
      if (piece == null) continue;
      if (line.includes('output_text.delta')) sawDelta = true;
      out.push(piece);
      try { onDelta?.(piece); } catch { /* 화면 갱신 실패가 응답을 깨지 않는다 */ }
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
    /** @param {*} tc @param {{onDelta?:(t:string)=>void}} [opts] 조각은 화면용 미리보기(저장 안 함) */
    /** 내장 검색을 켤 수 있다(1층). 모델이 자기 인프라로 찾아 읽으므로 스크래핑 차단에 안 걸린다. */
    async respond(tc, opts = {}) {
      const cred = await deps.credentials(); // 만료 임박이면 관리자가 여기서 갱신한다
      const m = buildModelMessages(tc);      // §11 사실만 — provider 와 같은 입력 계약
      const controller = new AbortController();
      let status, raw, whole;
      try {
        ({ status, raw, whole } = await withTimeout(async () => {
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
              // Phase 2-1: 이력도 함께 넘긴다. 여기가 빠져 있어서 **라이브에서만** 대화가 안 이어졌다 —
              // 다른 provider 와이어는 고쳐 놓고 이 경로를 빼먹었다(같은 계약, 다른 셰이프).
              input: [...responsesHistory(m), { type: 'message', role: 'user', content: [{ type: 'input_text', text: m.user }] }],
              // Phase 0-2 1층: 내장 검색(§24 — 켜 두고 쓸지는 모델이 판단).
              ...(opts.search ? { tools: [{ type: 'web_search' }] } : {}),
              // 추론 강도는 **속도 다이얼**이다(모델의 판단을 규칙으로 묶는 것과 다르다).
              // 일상 대화까지 높은 강도로 돌면 한 마디에 1분 넘게 걸린다 — 실측 1m52s(오너 지적).
              ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
              stream: true,   // 이 백엔드는 스트림만 받는다
              store: false,   // 대화 저장 안 함(사용자 데이터 최소)
            }),
            signal: controller.signal,
          });
          // 성공이면 **읽으면서 흘린다**(다 모으고 넘기지 않는다 — 체감 지연의 원인이었다).
          // 실패면 진단을 위해 본문을 통째로 읽는다(짧다).
          if (r.status >= 200 && r.status < 300 && r.body?.getReader) {
            return { status: r.status, raw: await readTextStream(r.body, opts.onDelta) };
          }
          return { status: r.status, raw: await r.text(), whole: true };
        }, timeoutMs, controller));
      } catch (e) {
        if (e?.name === 'AbortError') throw new ModelTimeoutError(timeoutMs);
        throw new ModelProviderError({ provider: 'chatgpt_oauth', authSignal: `network ${e?.message ?? e}` });
      }
      if (status < 200 || status >= 300) {
        // 원문을 authSignal 로만 나른다(분류는 kernel classifyModelAuth — 공개면 미노출).
        // 모델 거절(계정 경로 미지원)은 자격 문제가 아니므로 readiness 축으로 갈리게 표식을 붙인다
        // (§6.23 두 축) — "키가 잘못됐다"고 오해하게 만들지 않는다.
        const modelRejected = /model is not supported|model_not_supported|unknown model/i.test(raw);
        throw new ModelProviderError({
          provider: 'chatgpt_oauth', status,
          authSignal: `${modelRejected ? 'model_missing ' : ''}${status} ${raw.slice(0, 300)}`,
        });
      }
      // 스트리밍 경로면 raw 가 이미 누적된 텍스트다. 통째로 읽은 경우(테스트·비스트림 응답)만 파싱.
      const text = whole ? accumulateResponsesText(raw) : raw;
      if (!text) throw new ModelProviderError({ provider: 'chatgpt_oauth', status, authSignal: 'empty response stream' });
      return text;
    },
  };
}
