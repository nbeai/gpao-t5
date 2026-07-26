// L3 · Model Doctor (P-RT-2) — "구성됨"을 "검증됨"으로 승격한다. /channels doctor 와 같은 계열.
// 방법: provider 의 과금 없는 모델 목록 GET 하나로 ①키 유효성 ②도달성 ③설정 모델의 실제 사용
// 가능 여부를 검증한다(P-RT-1 에서 gemini 낡음을 잡은 방법을 제품 기능으로).
// 경계: 목록 조회만(외부 효과 0) · 분류는 kernel classifyModelAuth 단일 소스 · 검증 실패가
// 부팅·턴을 막지 않는다(정직한 표시가 목적, 게이트 추가가 아니다).
import { withTimeout } from './with-timeout.js';
import { MODEL_PROVIDERS, resolveModelConfig } from './model-provider.js';
import { classifyModelAuth } from '../kernel/l0-evidence/self-state.js';
import { AUTH_STATE } from '../kernel/contracts.js';

const DEFAULT_TIMEOUT_MS = 10_000;

// 자격 분류 → 사용자 언어(내부 코드·원문 미노출). nextSafeAction 은 막다른 답 금지 원칙.
const AUTH_LANGUAGE = {
  [AUTH_STATE.AUTH_FAILED]: {
    userSafeSummary: '모델 키가 유효하지 않아요(만료되었거나 잘못 입력됐을 수 있어요).',
    nextSafeAction: '키를 다시 연결하면 이어서 쓸 수 있어요.',
  },
  [AUTH_STATE.BILLING_BLOCKED]: {
    userSafeSummary: '모델 쪽 결제 확인이 필요해요.',
    nextSafeAction: '해당 서비스의 결제 상태를 확인해 주세요.',
  },
  [AUTH_STATE.RATE_LIMITED]: {
    userSafeSummary: '지금 요청이 잠깐 몰렸어요.',
    nextSafeAction: '잠시 후 다시 확인할게요.',
  },
};

/**
 * 미검증 구성의 정직한 표현(doctor 미배선 demo 등에서도 검증 안 됨을 검증됨처럼 말하지 않는다).
 * @param {{id?:string}} [envModel]
 */
export function describeUnprobedModel(envModel = {}) {
  if (!envModel.id || envModel.id === 'beai5-stub') {
    return {
      state: 'stub', modelId: envModel.id ?? null,
      userSafeSummary: '아직 실제 모델이 연결되지 않았어요(내장 안내 모드로 동작 중이에요).',
      nextSafeAction: '모델 키를 연결하면 실제 모델이 답해요.',
    };
  }
  return {
    state: 'unverified', modelId: envModel.id,
    userSafeSummary: '모델이 설정돼 있지만 아직 실제로 확인하지 않았어요.',
    nextSafeAction: '점검을 실행하면 지금 쓸 수 있는지 알려 드려요.',
  };
}

/**
 * env 기반 진입점(하위호환). 구성 없으면 stub.
 * @param {Record<string,string|undefined>} processEnv
 * @param {{fetchImpl?:Function, timeoutMs?:number}} [deps]
 */
export async function checkModelHealth(processEnv = {}, deps = {}) {
  const cfg = resolveModelConfig(processEnv);
  if (!cfg) return describeUnprobedModel({ id: 'beai5-stub' });
  return checkConfigHealth(cfg, deps);
}

/**
 * 구성 직접 검증(P-RT-4: 화면 연결이 저장 전에 이걸로 실검증한다).
 * state: usable|model_missing|auth_failed|billing_blocked|rate_limited|unreachable
 * @param {ReturnType<typeof resolveModelConfig>} cfg
 * @param {{fetchImpl?:Function, timeoutMs?:number}} [deps]
 */
export async function checkConfigHealth(cfg, deps = {}) {
  const spec = MODEL_PROVIDERS[cfg.provider];
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = { provider: cfg.provider, modelId: cfg.modelId };

  let status, json;
  try {
    const controller = new AbortController();
    ({ status, json } = await withTimeout(async () => {
      const r = await fetchImpl(spec.modelsEndpoint(cfg), {
        method: 'GET', headers: spec.headers(cfg), signal: controller.signal,
      });
      let j = null;
      try { j = await r.json(); } catch { /* 비JSON 은 상태코드로 해석 */ }
      return { status: r.status, json: j };
    }, timeoutMs, controller));
  } catch {
    return {
      ...base, state: 'unreachable',
      userSafeSummary: '모델 서비스에 연결이 되지 않아요.',
      nextSafeAction: '네트워크를 확인하고 잠시 후 다시 시도해 주세요.',
    };
  }

  if (status < 200 || status >= 300) {
    const authSignal = spec.errorSignal(status, json);
    const auth = classifyModelAuth(authSignal);
    if (AUTH_LANGUAGE[auth]) return { ...base, state: auth, authSignal, ...AUTH_LANGUAGE[auth] };
    // 자격 문제로 분류되지 않는 HTTP 실패(5xx 등)는 일시 장애로 정직하게.
    return {
      ...base, state: 'unreachable', authSignal,
      userSafeSummary: '모델 서비스가 지금 원활하지 않아요.',
      nextSafeAction: '잠시 후 다시 확인할게요.',
    };
  }

  const models = spec.listModels(json) ?? [];
  if (!models.length) {
    // 목록 미구현 호환 서버 — 키는 통과했으니 usable, 단 모델 존재는 확인 못 했음을 남긴다.
    return {
      ...base, state: 'usable', modelListed: null,
      userSafeSummary: '연결은 확인됐어요(이 서비스는 모델 목록을 제공하지 않아 모델 이름까지는 확인 못 했어요).',
    };
  }
  if (!models.includes(cfg.modelId)) {
    return {
      ...base, state: 'model_missing', modelListed: false, availableSample: models.slice(0, 5),
      userSafeSummary: `설정된 모델(${cfg.modelId})을 이 키로 지금 쓸 수 없어요.`,
      nextSafeAction: `사용 가능한 모델로 바꿔 주세요(예: ${models.slice(0, 3).join(', ')}).`,
    };
  }
  return { ...base, state: 'usable', modelListed: true, userSafeSummary: '지금 바로 쓸 수 있어요.' };
}
