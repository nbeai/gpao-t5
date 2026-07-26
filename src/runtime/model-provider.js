// L3 · ModelProvider — 실제 LLM provider 어댑터(P-RT-1). ModelClient 계약(§11)을 실 API로 실행한다.
// 오너 지시(2026-07-26): OpenAI OAuth·OpenAI/Claude/Gemini API 키·오픈소스(OpenAI-호환)를 기본 지원.
// 핵심 경계(channel-sender 패턴 준수):
//   - 와이어는 여기, 정책은 커널: 자격 분류는 kernel classifyModelAuth 단일 소스가 한다.
//     어댑터는 provider 원문 신호를 authSignal로 실어 던질 뿐, 분류표를 중복하지 않는다.
//   - 자격(키·토큰)은 어댑터가 소유하지 않는다. env로 주입되며, 없으면 구성 안 됨(stub 폴백) —
//     몰래 호출하지 않는다.
//   - 실패는 정직하게: 응답을 지어내지 않고 ModelProviderError로 던진다. 타임아웃은 fetch를
//     실제로 abort 하고(§6.21 진짜 취소의 HTTP 구간) ModelTimeoutError로 기존 사용자 언어 경로를 탄다.
//   - 테스트·기본은 실 API를 치지 않는다(fetchImpl 주입). 라이브 서버만 실제 배선.
import { withTimeout } from './with-timeout.js';
import { ModelTimeoutError } from './model-timeout.js';
import { StubModelClient } from './model-client.js';

const DEFAULT_HTTP_TIMEOUT_MS = 25_000; // 서버 withModelTimeout(30s)보다 짧게 — 내부가 먼저 실제 취소
const DEFAULT_MAX_TOKENS = 1024;

export class ModelProviderError extends Error {
  /** @param {{provider:string, status?:number, authSignal:string}} p */
  constructor(p) {
    super(`model provider ${p.provider} failed: ${p.authSignal}`);
    this.name = 'ModelProviderError';
    this.provider = p.provider;
    this.status = p.status;
    this.authSignal = p.authSignal; // classifyModelAuth 가 읽는 원문 신호(비밀값 미포함)
  }
}

/**
 * TaskContextPacket(§11) → 모델 입력. 사실만 전달하고 판단·문장은 모델에 남긴다.
 * 장문 지시문 주입 금지(T3 tool-path-briefing 실증 원리). diagnosticTrace 는 애초에 패킷에 없다.
 * @param {import('../kernel/contracts.js').TaskContextPacket} tc
 * @returns {{system:string, user:string}}
 */
export function buildModelMessages(tc) {
  const sys = [];
  sys.push('너는 사용자의 작업 비서다. 아래 사실을 왜곡하지 말고, 방법과 문장은 네가 자연스럽게 정한다.');
  const sf = tc.selfStateFacts ?? {};
  if (sf.readyTools?.length) sys.push(`준비된 도구: ${sf.readyTools.join(', ')}`);
  if (sf.limits?.length) sys.push(`현재 한계: ${sf.limits.join('; ')}`);
  const af = tc.authorityFacts ?? {};
  if (af.needsApproval?.length) sys.push(`승인 필요(아직 실행 안 됨): ${af.needsApproval.join(', ')}`);
  if (af.forbidden?.length) sys.push(`금지: ${af.forbidden.join(', ')}`);

  const usr = [];
  if (tc.admittedContext?.length) usr.push(`[반영된 기억]\n${tc.admittedContext.map((c) => `- ${c}`).join('\n')}`);
  if (tc.evidenceFacts?.length) {
    usr.push(`[이번 턴 실행 사실]\n${tc.evidenceFacts
      .map((f) => `- ${f.summary}${f.failureState !== 'none' ? ` (미확인: ${f.failureState})` : ''}`)
      .join('\n')}`);
  }
  usr.push(tc.currentRequest); // 원문 보존
  return { system: sys.join('\n'), user: usr.join('\n\n') };
}

// provider별 요청 빌더·응답 해석(선언형). 토큰 위치·본문 셰이프가 provider마다 다르다.
// errorSignal 은 분류하지 않는다 — 원문을 모으고, 분류기가 못 읽는 벤더 고유 표기만 정규 토큰으로 보강.
const OPENAI_WIRE = {
  defaultBase: 'https://api.openai.com/v1',
  endpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`,
  headers: (cfg) => ({
    'content-type': 'application/json',
    ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}), // 호환(로컬) 서버는 무자격 허용
  }),
  body: (cfg, m) => JSON.stringify({
    model: cfg.modelId,
    max_tokens: cfg.maxTokens,
    // 일부 호환 서버는 user/assistant 만 허용(beai V1 실측 2026-07-26). 그 경우 system 사실을
    // user 턴 앞에 합쳐 보낸다 — 사실 전달은 유지, 셰이프만 서버 제약에 맞춘다.
    messages: cfg.noSystemRole
      ? [{ role: 'user', content: `${m.system}\n\n${m.user}` }]
      : [{ role: 'system', content: m.system }, { role: 'user', content: m.user }],
  }),
  extract: (json) => json?.choices?.[0]?.message?.content,
  errorSignal: (status, json) =>
    [status, json?.error?.code, json?.error?.type, json?.error?.message].filter(Boolean).join(' '),
};

export const MODEL_PROVIDERS = {
  anthropic: {
    defaultModel: 'claude-opus-4-8',
    defaultBase: 'https://api.anthropic.com',
    envKey: 'ANTHROPIC_API_KEY',
    endpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`,
    headers: (cfg) => ({
      'content-type': 'application/json',
      'x-api-key': cfg.token,
      'anthropic-version': '2023-06-01',
    }),
    body: (cfg, m) => JSON.stringify({
      model: cfg.modelId,
      max_tokens: cfg.maxTokens,
      system: m.system,
      messages: [{ role: 'user', content: m.user }],
    }),
    extract: (json) => {
      const parts = (json?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text);
      return parts.length ? parts.join('\n') : undefined;
    },
    errorSignal: (status, json) =>
      [status, json?.error?.type, json?.error?.message].filter(Boolean).join(' '),
  },
  openai: { ...OPENAI_WIRE, defaultModel: 'gpt-5.1', envKey: 'OPENAI_API_KEY' },
  // OAuth 는 와이어 동일, 토큰 출처만 다르다. 로그인/PKCE/refresh 플로우는 P-RT-2 — 여기는 주입 seam.
  openai_oauth: { ...OPENAI_WIRE, defaultModel: 'gpt-5.1', envKey: 'OPENAI_OAUTH_ACCESS_TOKEN' },
  // 오픈소스/기타 모델(Ollama·vLLM·LM Studio 등) — baseUrl·modelId 필수, 토큰 선택.
  openai_compatible: { ...OPENAI_WIRE, defaultModel: undefined, defaultBase: undefined, envKey: 'GPAO_T5_MODEL_API_KEY' },
  // 자사 beai V1(chat.beai.kr) — OpenAI-호환 와이어, 단 user/assistant 만 허용(라이브 실측).
  beai: {
    ...OPENAI_WIRE,
    defaultModel: 'beai-8.6',
    defaultBase: 'https://chat.beai.kr/api/external/v1',
    envKey: 'BEAI_API_KEY',
    noSystemRole: true,
  },
  gemini: {
    // 안정 별칭 — 버전 고정은 "신규 사용자에게 미제공" 404 로 낡는다(2026-07-26 라이브 실측: 2.5-flash 가 그랬다)
    defaultModel: 'gemini-flash-latest',
    defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
    envKey: 'GEMINI_API_KEY',
    endpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/models/${cfg.modelId}:generateContent`,
    headers: (cfg) => ({ 'content-type': 'application/json', 'x-goog-api-key': cfg.token }),
    body: (cfg, m) => JSON.stringify({
      system_instruction: { parts: [{ text: m.system }] },
      contents: [{ role: 'user', parts: [{ text: m.user }] }],
    }),
    extract: (json) => {
      const parts = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean);
      return parts?.length ? parts.join('') : undefined;
    },
    errorSignal: (status, json) => {
      const reasons = (json?.error?.details ?? []).map((d) => d.reason).filter(Boolean);
      const raw = [status, json?.error?.status, json?.error?.message, ...reasons].filter(Boolean).join(' ');
      // 벤더 고유 표기 보강: classifyModelAuth 가 읽는 정규 토큰으로 번역(분류는 여전히 커널이 한다)
      return /API_KEY_INVALID|API key not valid/i.test(raw) ? `${raw} invalid_api_key` : raw;
    },
  },
};

/**
 * env 에서 provider 구성을 해석한다. 명시(GPAO_T5_MODEL_PROVIDER)가 우선, 없으면 자격 유무로 추론.
 * 구성이 안 되면 null — 호출부가 stub 으로 폴백한다(몰래 아무것도 하지 않는다).
 * @param {Record<string,string|undefined>} env
 * @returns {{provider:string, token?:string, modelId:string, baseUrl:string, maxTokens:number}|null}
 */
export function resolveModelConfig(env = {}) {
  const explicit = env.GPAO_T5_MODEL_PROVIDER;
  let provider = explicit;
  if (!provider) {
    if (env.ANTHROPIC_API_KEY) provider = 'anthropic';
    else if (env.OPENAI_API_KEY) provider = 'openai';
    else if (env.GEMINI_API_KEY) provider = 'gemini';
    else if (env.BEAI_API_KEY) provider = 'beai';
    else if (env.OPENAI_OAUTH_ACCESS_TOKEN) provider = 'openai_oauth';
    else if (env.GPAO_T5_MODEL_BASE_URL) provider = 'openai_compatible';
    else return null;
  }
  const spec = MODEL_PROVIDERS[provider];
  if (!spec) return null;
  const token = env[spec.envKey];
  // 호환 provider 만 무자격 허용(로컬 서버). 나머지는 자격 없으면 미구성.
  if (!token && provider !== 'openai_compatible') return null;
  const modelId = env.GPAO_T5_MODEL_ID ?? spec.defaultModel;
  const baseUrl = env.GPAO_T5_MODEL_BASE_URL ?? spec.defaultBase;
  if (!modelId || !baseUrl) return null; // openai_compatible 은 둘 다 명시돼야 구성됨
  return {
    provider,
    token,
    modelId,
    baseUrl,
    maxTokens: Number(env.GPAO_T5_MODEL_MAX_TOKENS ?? DEFAULT_MAX_TOKENS),
    // 서버가 system role 을 거부하는 경우(beai 등) — spec 선언 또는 호환 서버용 env 스위치.
    noSystemRole: Boolean(spec.noSystemRole) || env.GPAO_T5_MODEL_NO_SYSTEM_ROLE === '1',
  };
}

/**
 * 실 provider ModelClient 를 만든다. respond 는 단발 요청(스트리밍은 후속).
 * @param {ReturnType<typeof resolveModelConfig>} cfg
 * @param {{fetchImpl?:Function, timeoutMs?:number}} [deps]
 * @returns {import('./model-client.js').ModelClient}
 */
export function makeProviderModelClient(cfg, deps = {}) {
  const spec = MODEL_PROVIDERS[cfg.provider];
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  return {
    async respond(tc) {
      const messages = buildModelMessages(tc);
      const url = spec.endpoint(cfg);
      const controller = new AbortController();
      let status, json;
      try {
        ({ status, json } = await withTimeout(async () => {
          const r = await fetchImpl(url, {
            method: 'POST',
            headers: spec.headers(cfg),
            body: spec.body(cfg, messages),
            signal: controller.signal,
          });
          let j = null;
          try { j = await r.json(); } catch { /* 비JSON 응답은 상태코드로 해석 */ }
          return { status: r.status, json: j };
        }, timeoutMs, controller));
      } catch (e) {
        if (e?.name === 'AbortError') throw new ModelTimeoutError(timeoutMs); // 진짜 취소 후 기존 경로
        throw new ModelProviderError({ provider: cfg.provider, authSignal: `network ${e?.message ?? e}` });
      }
      if (status >= 200 && status < 300) {
        const text = spec.extract(json);
        if (typeof text === 'string' && text.length) return text;
        throw new ModelProviderError({ provider: cfg.provider, status, authSignal: 'empty or unreadable response' });
      }
      throw new ModelProviderError({ provider: cfg.provider, status, authSignal: spec.errorSignal(status, json) });
    },
  };
}

/**
 * 라이브 배선 단일 진입점: 구성되면 실 provider, 아니면 stub — env.model(SelfState 단일 진실)도 함께 반환.
 * "보이는 것 = 실제": 구성 안 됐는데 실 모델처럼 보이게 하지 않는다.
 * 단, authSignal:'ok'는 **자격이 구성됐다**는 뜻이지 실시간 유효성 검증이 아니다(구성됨≠검증됨).
 * 만료·오류 키는 첫 호출에서 잡혀 classifyModelAuth 로 갈린다. 상시 검증은 후속 provider doctor 에서.
 * @param {Record<string,string|undefined>} env
 * @param {{fetchImpl?:Function}} [deps]
 * @returns {{model:import('./model-client.js').ModelClient, envModel:{id:string, strengths:string, authSignal:string}}}
 */
export function selectLiveModel(env = {}, deps = {}) {
  const cfg = resolveModelConfig(env);
  if (!cfg) {
    return {
      model: new StubModelClient(),
      envModel: { id: 'beai5-stub', strengths: '자연 대화·판단', authSignal: 'ok' },
    };
  }
  const timeoutMs = Number(env.GPAO_T5_MODEL_HTTP_TIMEOUT_MS ?? DEFAULT_HTTP_TIMEOUT_MS);
  return {
    model: makeProviderModelClient(cfg, { fetchImpl: deps.fetchImpl, timeoutMs }),
    envModel: { id: cfg.modelId, strengths: '자연 대화·판단', authSignal: 'ok' },
  };
}
