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
import { buildIdentityFacts } from '../kernel/identity.js';
import { judgmentCharter } from '../kernel/judgment-charter.js';
import { modelPromptProfile } from '../kernel/model-prompt-profile.js';
import { workingStateFacts } from '../kernel/l0-evidence/working-state.js';
import { responseSurfaceFacts } from '../kernel/l0-evidence/response-surface.js';
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
  const sf = tc.selfStateFacts ?? {};
  // P-ID-1: **정체성이 먼저다.** 이게 없으면 모델이 빈칸을 자기 출신으로 채운다(오너 실사용:
  // "저는 ChatGPT예요" / 자기가 OS 인 줄 모름). 짧게 유지 — 상세는 물어봤을 때만 아래에서.
  sys.push(...buildIdentityFacts(tc.identity, { model: sf.model, ...(tc.capabilityCounts ?? {}) }));
  // P2-5a: 판단 헌장 — **보는 법**을 준다(금지 목록이 아니다). 매 턴 같은 문장이라 캐시에 얹힌다.
  //   예전엔 이 자리에 "할 수 있는 건 이게 전부다 / 확실치 않으면 확인을 구해라" 같은 허가 목록이
  //   있었고, 그게 모델을 위축시켜 "오늘 날씨"에 두 번 되묻고 헤지하게 만들었다(오너 실사용).
  sys.push(judgmentCharter());
  // 모델별 **운영 보정**만 얇게 얹는다(오너 지시): 정체성·헌장·승인 경계는 모델이 바뀌어도 그대로다.
  // 계열마다 실제로 다르게 구는 지점만 몇 줄 — 여기가 길어지면 그건 헌장에 있어야 할 내용이다.
  const profile = modelPromptProfile({ providerId: tc.modelProviderId, modelId: sf.model });
  if (profile) sys.push(profile);
  // SOUL 의 말투 — **매 턴 같은 자리**에 있어야 목소리가 흔들리지 않는다(OpenClaw·Hermes 의
  // SOUL.md 계층에서 흡수: voice 는 SOUL 이 갖고, 운영 규칙·판단 순서는 따로).
  // 예전엔 SOUL 전체가 "물어봤을 때만" 실려서 말투 문장이 **한 번도 모델에게 간 적이 없었다.**
  if (tc.voice) sys.push(`<말투>\n${tc.voice}\n</말투>`);

  // ── 캐시 경계 ──────────────────────────────────────────────────────────
  // 위(정체성·헌장)는 매 턴 같다. 아래는 **세션 안에서 잘 안 변하는 사실** → 여기까지가 고정 접두다.
  // **매 턴 바뀌는 것(정확한 시각·승인 대기·이번 턴 실행 사실)은 맨 뒤로 뺀다.**
  //   예전엔 "지금은 …12시 14분"을 위쪽에 넣어 매 턴 캐시가 통째로 깨졌다(OpenClaw 는 타임존만
  //   프롬프트에 두고 정확한 시각은 뒤/도구로 뺀다 — 그 원리를 흡수).
  sys.push('[환경]');
  // 지시가 아니라 **사실**로 준다("…로 본다"는 허가처럼 읽혀 모델이 되레 허락을 구했다).
  if (tc.now?.timeZone) sys.push(`사용자 시간대: ${tc.now.timeZone}`);
  if (sf.readyTools?.length) sys.push(`T5 가 대신 실행할 수 있는 도구: ${sf.readyTools.join(', ')}`);
  if (sf.limits?.length) sys.push(`아직 안 되는 것: ${sf.limits.join('; ')}`);
  if (tc.nativeSearch) sys.push('너 자신의 내장 검색으로 최신 정보를 직접 찾을 수 있다.');
  // 3축: 지금 답이 어디로 나가는지. **지시가 아니라 사실 한 줄**이다 — 텔레그램은 서식이 안 먹는다는
  // 성질을 알려주면 모델이 스스로 조절한다("짧게 써라"라고 시키지 않는다, §24).
  const surfaceFact = responseSurfaceFacts(tc.surface);
  if (surfaceFact) sys.push(surfaceFact);
  // 자기 파악 세 번째 축: 지금 이 대화에서 어디까지 왔는가. "그거·거기·그 페이지"가 여기서 풀린다.
  const working = workingStateFacts(tc.workingState);
  if (working) sys.push(`[이 대화에서 지금까지]\n${working}`);

  const af = tc.authorityFacts ?? {};
  if (af.needsApproval?.length) sys.push(`승인 필요(아직 실행 안 됨): ${af.needsApproval.join(', ')}`);
  if (af.forbidden?.length) sys.push(`금지: ${af.forbidden.join(', ')}`);

  // 물어봤을 때만 자기인지 상세를 싣는다(오너 결정: 필요할 때만 찾아 반영).
  if (tc.selfhoodDetail) sys.push(`[너에 대한 자세한 사실]\n${tc.selfhoodDetail}`);

  // ── 여기부터 매 턴 바뀐다(캐시 경계 아래) ──
  if (tc.now?.local) sys.push(`[지금] ${tc.now.local}`);

  const usr = [];
  if (tc.admittedContext?.length) usr.push(`[반영된 기억]\n${tc.admittedContext.map((c) => `- ${c}`).join('\n')}`);
  if (tc.evidenceFacts?.length) {
    usr.push(`[이번 턴 실행 사실]\n${tc.evidenceFacts
      .map((f) => `- ${f.summary}${f.failureState !== 'none' ? ` (미확인: ${f.failureState})` : ''}`
        // P2-8: 검색으로 찾아 읽은 경우, **요청한 것과 읽은 것이 같지 않을 수 있다**는 사실을 준다.
        // 이걸 안 주면 모델이 이유를 추측한다(실측: "검색 수집이 제한돼서" — 그런 일 없었다).
        + (f.provenance
          // "사용자가 준 주소가 아니다"를 먼저 못 박는다 — 실측에서 모델이 검색으로 찾은 블로그를
          // "사용자가 준 글"이라고 말했다. 그리고 **후보 목록이 전부라는 사실**을 준다: 원하던 곳이
          // 목록에 없으면 검색이 못 찾은 것이지 막힌 게 아니다(모델이 "제한돼서"라고 지어냈다).
          ? `\n  이건 사용자가 준 주소가 아니에요. "${f.provenance.sought}"로 검색해서 나온 것 중 하나를 읽었어요.`
            + `\n  읽은 곳: ${f.provenance.readUrl}`
            + `\n  검색이 준 나머지 후보(이게 전부예요): ${f.provenance.others.length ? f.provenance.others.join(' , ') : '없음'}`
            + '\n  찾던 곳이 이 목록에 없으면 검색이 그걸 못 찾은 거예요(막힌 게 아니에요). 주소를 받으면 바로 읽을 수 있어요.'
          : '')
        + (f.data ? `\n  결과: ${f.data}` : ''))
      .join('\n')}`);
  }
  // 막힌 게 있으면 다음 계단을 사실로 알려 준다 — 모델이 "안 됩니다"로 끝내지 않게.
  if (tc.recoveryHint) usr.push(`[막힌 것과 다음 길]\n${tc.recoveryHint}`);
  usr.push(tc.currentRequest); // 원문 보존
  // Phase 2-1: 같은 대화의 이전 발화를 **진짜 대화 턴으로** 넘긴다. 하나의 덩어리로 이어 붙이면
  // 역할이 사라져 모델이 말투·맥락을 다시 고른다 — provider 마다 자기 셰이프로 싣는다.
  const history = (tc.recentTurns ?? [])
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', text: t.text }));
  return { system: sys.join('\n'), user: usr.join('\n\n'), history };
}

/** 도구 이름은 서버마다 허용 문자가 다르다(점 불가 등). 와이어에서만 바꾸고 응답에서 되돌린다. */
export const wireToolName = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_');

/** 와이어가 준 이름·인자 → 커널 호출. 인자가 깨졌으면 버린다(반쪽 인자로 실행하지 않는다). */
function parseWireCall(name, rawArgs) {
  if (!name) return null;
  if (rawArgs && typeof rawArgs === 'object') return { name, args: rawArgs };
  try { return { name, args: rawArgs ? JSON.parse(rawArgs) : {} }; } catch { return null; }
}

// 이력을 provider 셰이프로. 역할 이름만 다르고 순서·내용은 같다(오래된 것 → 최근 것).
const openaiHistory = (m) => (m.history ?? []).map((h) => ({ role: h.role, content: h.text }));
const geminiHistory = (m) => (m.history ?? []).map((h) => ({
  role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }],
}));

// provider별 요청 빌더·응답 해석(선언형). 토큰 위치·본문 셰이프가 provider마다 다르다.
// errorSignal 은 분류하지 않는다 — 원문을 모으고, 분류기가 못 읽는 벤더 고유 표기만 정규 토큰으로 보강.
const OPENAI_WIRE = {
  defaultBase: 'https://api.openai.com/v1',
  endpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`,
  headers: (cfg) => ({
    'content-type': 'application/json',
    ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}), // 호환(로컬) 서버는 무자격 허용
  }),
  body: (cfg, m, opts = {}) => JSON.stringify({
    model: cfg.modelId,
    max_tokens: cfg.maxTokens,
    // P2-5b-2: 도구 **선택**을 모델에게(집행은 런타임). 이름 제약이 있는 서버가 있어 와이어에서
    // 안전한 이름으로 바꾸고 응답에서 되돌린다(라이브에서 `local.file` 의 점이 400 을 냈다).
    ...(opts.tools?.length ? {
      tools: opts.tools.map((t) => ({
        type: 'function',
        function: { name: wireToolName(t.name), description: t.description, parameters: t.parameters },
      })),
    } : {}),
    // 일부 호환 서버는 user/assistant 만 허용(beai V1 실측 2026-07-26). 그 경우 system 사실을
    // user 턴 앞에 합쳐 보낸다 — 사실 전달은 유지, 셰이프만 서버 제약에 맞춘다.
    messages: cfg.noSystemRole
      ? [...openaiHistory(m), { role: 'user', content: `${m.system}\n\n${m.user}` }]
      : [{ role: 'system', content: m.system }, ...openaiHistory(m), { role: 'user', content: m.user }],
  }),
  extract: (json) => json?.choices?.[0]?.message?.content,
  extractToolCalls: (json) => (json?.choices?.[0]?.message?.tool_calls ?? [])
    .map((c) => parseWireCall(c?.function?.name, c?.function?.arguments))
    .filter(Boolean),
  errorSignal: (status, json) =>
    [status, json?.error?.code, json?.error?.type, json?.error?.message].filter(Boolean).join(' '),
  // doctor(P-RT-2): 과금 없는 모델 목록 GET — 키 유효성·도달성·설정 모델 존재를 한 번에 검증
  modelsEndpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/models`,
  listModels: (json) => json?.data?.map((m) => m.id).filter(Boolean),
  // P-STR-1: 같은 요청에 stream 을 켠 본문. 조각은 `chat.completion.chunk` 의 delta.content.
  streamBody: (cfg, m) => JSON.stringify({
    ...JSON.parse(OPENAI_WIRE.body(cfg, m)),
    stream: true,
  }),
  streamDelta: (ev) => (typeof ev?.choices?.[0]?.delta?.content === 'string' ? ev.choices[0].delta.content : null),
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
    body: (cfg, m, opts = {}) => JSON.stringify({
      model: cfg.modelId,
      max_tokens: cfg.maxTokens,
      system: m.system,
      messages: [...openaiHistory(m), { role: 'user', content: m.user }],
      ...(opts.tools?.length ? {
        tools: opts.tools.map((t) => ({
          name: wireToolName(t.name), description: t.description, input_schema: t.parameters,
        })),
      } : {}),
    }),
    extract: (json) => {
      const parts = (json?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text);
      return parts.length ? parts.join('\n') : undefined;
    },
    extractToolCalls: (json) => (json?.content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => parseWireCall(b.name, b.input))
      .filter(Boolean),
    errorSignal: (status, json) =>
      [status, json?.error?.type, json?.error?.message].filter(Boolean).join(' '),
    modelsEndpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/v1/models`,
    listModels: (json) => json?.data?.map((m) => m.id).filter(Boolean),
    // P0-3: 같은 endpoint 에 stream 을 켜면 SSE 로 온다. 텍스트는 content_block_delta 에만 담긴다
    // (message_start·ping 등 다른 이벤트는 흘리지 않는다 — 사용자면 텍스트만).
    streamBody: (cfg, m) => JSON.stringify({
      model: cfg.modelId, max_tokens: cfg.maxTokens, system: m.system,
      messages: [...openaiHistory(m), { role: 'user', content: m.user }], stream: true,
    }),
    streamDelta: (ev) => (ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta'
      ? ev.delta.text : null),
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
    // **스트리밍 미지원**(2026-07-26 실키 실측: 400 "Streaming is not supported in External API V1").
    // OpenAI 와이어를 물려받으면 stream:true 가 켜져 응답 자체가 깨진다 — 선언을 지워 단발로 돈다.
    // 서버가 지원하게 되면 이 두 줄을 지우기만 하면 된다(와이어는 이미 호환).
    streaming: false,
    streamBody: undefined,
    streamDelta: undefined,
  },
  gemini: {
    // 안정 별칭 — 버전 고정은 "신규 사용자에게 미제공" 404 로 낡는다(2026-07-26 라이브 실측: 2.5-flash 가 그랬다)
    defaultModel: 'gemini-flash-latest',
    defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
    envKey: 'GEMINI_API_KEY',
    endpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/models/${cfg.modelId}:generateContent`,
    headers: (cfg) => ({ 'content-type': 'application/json', 'x-goog-api-key': cfg.token }),
    body: (cfg, m, opts = {}) => JSON.stringify({
      system_instruction: { parts: [{ text: m.system }] },
      contents: [...geminiHistory(m), { role: 'user', parts: [{ text: m.user }] }],
      ...(opts.tools?.length ? {
        tools: [{
          function_declarations: opts.tools.map((t) => ({
            name: wireToolName(t.name), description: t.description, parameters: t.parameters,
          })),
        }],
      } : {}),
    }),
    extract: (json) => {
      const parts = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean);
      return parts?.length ? parts.join('') : undefined;
    },
    extractToolCalls: (json) => (json?.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.functionCall)
      .map((p) => parseWireCall(p.functionCall.name, p.functionCall.args))
      .filter(Boolean),
    errorSignal: (status, json) => {
      const reasons = (json?.error?.details ?? []).map((d) => d.reason).filter(Boolean);
      const raw = [status, json?.error?.status, json?.error?.message, ...reasons].filter(Boolean).join(' ');
      // 벤더 고유 표기 보강: classifyModelAuth 가 읽는 정규 토큰으로 번역(분류는 여전히 커널이 한다)
      return /API_KEY_INVALID|API key not valid/i.test(raw) ? `${raw} invalid_api_key` : raw;
    },
    modelsEndpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/models?pageSize=1000`,
    listModels: (json) => json?.models?.map((m) => m.name?.replace(/^models\//, '')).filter(Boolean),
    // P0-3: gemini 는 **다른 엔드포인트**로 스트리밍한다(:streamGenerateContent + alt=sse).
    streamEndpoint: (cfg) => `${cfg.baseUrl.replace(/\/$/, '')}/models/${cfg.modelId}:streamGenerateContent?alt=sse`,
    streamBody: (cfg, m) => JSON.stringify({
      system_instruction: { parts: [{ text: m.system }] },
      contents: [...geminiHistory(m), { role: 'user', parts: [{ text: m.user }] }],
    }),
    streamDelta: (ev) => {
      const t = ev?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('');
      return t || null;
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
 * OpenAI 계열 SSE 를 읽으며 조각을 흘린다(P-STR-1). 반환값(전체 텍스트)이 진실이고, 조각은 미리보기다.
 * 스트림이 텍스트를 하나도 못 주면 정직하게 오류로 던진다(빈 답을 성공처럼 돌려주지 않는다).
 */
/**
 * SSE 스트림을 읽으며 조각을 흘린다. **와이어는 spec 이 선언**하고 여기는 공통 읽기만 한다
 * (P0-3: OpenAI 계열뿐 아니라 gemini·anthropic 도 같은 함수로 흐른다).
 */
async function streamSse({ spec, cfg, messages, fetchImpl, timeoutMs, onDelta }) {
  const controller = new AbortController();
  // provider 마다 스트림 엔드포인트가 다르다(gemini 는 :streamGenerateContent). 선언이 있으면 그걸 쓴다.
  const url = (spec.streamEndpoint ?? spec.endpoint)(cfg);
  let out = '';
  let status;
  try {
    status = await withTimeout(async () => {
      const r = await fetchImpl(url, {
        method: 'POST',
        headers: { ...spec.headers(cfg), accept: 'text/event-stream' },
        body: spec.streamBody(cfg, messages),
        signal: controller.signal,
      });
      if (r.status < 200 || r.status >= 300 || !r.body?.getReader) {
        const body = await r.text().catch(() => '');
        throw new ModelProviderError({ provider: cfg.provider, status: r.status, authSignal: `${r.status} ${body.slice(0, 300)}` });
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let ev;
          try { ev = JSON.parse(payload); } catch { continue; }
          const piece = spec.streamDelta(ev);
          if (!piece) continue;
          out += piece;
          try { onDelta(piece); } catch { /* 화면 갱신 실패가 응답을 깨지 않는다 */ }
        }
      }
      return r.status;
    }, timeoutMs, controller);
  } catch (e) {
    if (e?.name === 'AbortError') throw new ModelTimeoutError(timeoutMs);
    if (e instanceof ModelProviderError) throw e;
    throw new ModelProviderError({ provider: cfg.provider, authSignal: `network ${e?.message ?? e}` });
  }
  if (!out) throw new ModelProviderError({ provider: cfg.provider, status, authSignal: 'empty response stream' });
  return out;
}

/**
 * 사용자 입력(화면 연결, P-RT-4)에서 provider 구성을 해석한다. env 해석과 같은 규칙:
 * allowlist provider 만, 기본 모델/베이스 적용, compatible 은 baseUrl+modelId 필수.
 * 유효하지 않으면 null — 호출부가 사용자 언어로 안내한다.
 * @param {{provider?:string, key?:string, modelId?:string, baseUrl?:string}} input
 */
export function resolveModelConfigFromInput(input = {}) {
  const spec = MODEL_PROVIDERS[input.provider];
  if (!spec) return null;
  const token = typeof input.key === 'string' && input.key.trim() ? input.key.trim() : undefined;
  if (!token && input.provider !== 'openai_compatible') return null;
  const modelId = (typeof input.modelId === 'string' && input.modelId.trim()) || spec.defaultModel;
  // 사용자 입력 주소는 서버가 직접 fetch 하는 경로 — scheme allowlist(http/https)·URL 자격증명 금지(감사 권고).
  let baseUrl = spec.defaultBase;
  if (typeof input.baseUrl === 'string' && input.baseUrl.trim()) {
    const raw = input.baseUrl.trim();
    try {
      const u = new URL(raw);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
      baseUrl = raw;
    } catch { return null; }
  }
  if (!modelId || !baseUrl) return null;
  return {
    provider: input.provider, token, modelId, baseUrl,
    maxTokens: DEFAULT_MAX_TOKENS,
    noSystemRole: Boolean(spec.noSystemRole),
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
    /** @param {*} tc @param {{onDelta?:(t:string)=>void}} [opts] 조각은 화면용 미리보기(저장 안 함) */
    async respond(tc, opts = {}) {
      const messages = buildModelMessages(tc);
      // 스트리밍 가능한 와이어(OpenAI 계열)면 조각을 흘리며 읽는다(P-STR-1). 못 하는 곳은 그대로.
      // 도구를 준 턴은 단발로 받는다 — 조각 스트림 중간의 도구 호출까지 다루는 것은 이 슬라이스 범위 밖이고,
      // 반쪽으로 만들면 "고른 줄 알았는데 실행 안 됨"이 된다(§16-D 능력 완결).
      if (opts.onDelta && spec.streamBody && !opts.tools?.length) {
        return streamSse({ spec, cfg, messages, fetchImpl, timeoutMs, onDelta: opts.onDelta });
      }
      const url = spec.endpoint(cfg);
      const controller = new AbortController();
      let status, json;
      try {
        ({ status, json } = await withTimeout(async () => {
          const r = await fetchImpl(url, {
            method: 'POST',
            headers: spec.headers(cfg),
            body: spec.body(cfg, messages, opts),
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
        if (!opts.tools?.length) {
          if (typeof text === 'string' && text.length) return text;
          throw new ModelProviderError({ provider: cfg.provider, status, authSignal: 'empty or unreadable response' });
        }
        // 도구를 준 턴은 텍스트가 비어 있을 수 있다 — 그건 빈 응답이 아니라 "손이 필요하다"는 답이다.
        const byWire = new Map(opts.tools.map((t) => [wireToolName(t.name), t.name]));
        const toolCalls = (spec.extractToolCalls?.(json) ?? [])
          .map((c) => (byWire.has(c.name) ? { ...c, name: byWire.get(c.name) } : null))
          .filter(Boolean); // 못 되돌리는 이름은 버린다(모르는 도구는 실행 안 한다)
        if ((typeof text !== 'string' || !text.length) && !toolCalls.length) {
          throw new ModelProviderError({ provider: cfg.provider, status, authSignal: 'empty or unreadable response' });
        }
        return { text: typeof text === 'string' ? text : '', toolCalls };
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
