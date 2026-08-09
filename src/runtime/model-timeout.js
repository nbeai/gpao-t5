// L3 · ModelClient 타임아웃 데코레이터 (안정성 P-STAB-1). 느리거나 멈춘 모델이 턴을 무한 매달지 않게 한다.
// 왜: model.respond가 영영 안 끝나면 스트림은 heartbeat만 계속 나가고 턴이 안 닫히며, withSessionQueue가
//   직렬화하므로 **그 세션의 후속 턴까지 전부 막힌다**(T3 "잘 되다가 갑자기 멈춤" 재발 지점).
// 어떻게: respond를 타임아웃과 race해 **초과 시 reject** → 기존 오류 경로(stream recoverable_error+complete,
//   POST 500)가 턴을 바운드해 닫고 큐를 푼다. 어떤 ModelClient(스텁·실 provider)에도 같은 계약으로 씌운다.
//
// **2026-08-09 · 기본은 무제한이 됐다**(오너 결정). 위 목적은 그대로 옳지만, 그 목적을 **총 걸린
// 시간**으로 이루면 느린 모델과 죽은 모델을 구분하지 못한다 — 그래서 정상 응답이 사용자 앞에서
// 잘렸다. 무한 매달림은 이제 어댑터가 **정체(진짜 죽음)** 로 끊어 막는다. 이 데코레이터는
// 남아 있고(`GPAO_T5_MODEL_TIMEOUT_MS`), 기본값만 0 이다.

export class ModelTimeoutError extends Error {
  /** @param {number} ms @param {'총시간'|'정체'} [사유] 무엇이 잘랐는지 — 기본은 총 시간(옛 경로) */
  constructor(ms, 사유 = '총시간') {
    super(`model response timed out after ${ms}ms (${사유})`);
    this.name = 'ModelTimeoutError';
    this.isModelTimeout = true; // 오류 경로가 사용자 언어를 고르는 표식(진단 원문 아님)
    this.사유 = 사유;
  }
}

// ── 오너 결정(2026-08-09) · 총 소요 시간으로 자르는 상한을 제품에서 없앤다 ────────────
// 25초는 **개발 기준선**으로만 남는다 — 성능 최적화의 자다. 초과를 기록하되 응답은 안 끊는다.
//
// 왜 상수를 여기 모으나: 어댑터가 둘(`model-provider`·`chatgpt-model-client`)이고 서버가 또
// 하나였다. 세 자리에 각자 숫자가 있어서 하나를 풀어도 나머지에서 그대로 잘렸다 —
// 이번 결함이 바로 그 모양이다. 값은 한 자리에서만 산다.

/** 개발 기준선 — **자르는 자가 아니라 재는 자다.** 넘으면 사실로 남기고 응답은 그대로 흐른다. */
export const MODEL_DEV_BASELINE_MS = 25_000;

/**
 * 무응답(정체) 판정 — 흐르기 시작한 스트림이 이만큼 아무것도 안 주면 죽은 것으로 본다.
 * 첫 조각까지의 침묵은 여기에 안 든다(그건 모델이 생각하는 중이다 — `withStallTimeout` 주석).
 */
export const DEFAULT_MODEL_STALL_MS = 180_000;

const 수 = (v, 기본) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 기본;
};

/**
 * 서버 바깥 경계(`withModelTimeout`)의 상한. **기본 0 = 무제한.**
 * 예전 기본은 180초였고, 그 앞엔 30초였다 — 둘 다 "총 걸린 시간"으로 자르는 자였다.
 * 안쪽 어댑터가 정체(진짜 죽음)로 자르므로 바깥에서 총 시간을 또 재지 않는다.
 */
export const modelResponseTimeoutMs = (env = {}) => 수(env.GPAO_T5_MODEL_TIMEOUT_MS, 0);

/** 어댑터 HTTP 총 시간 상한. **기본 0 = 무제한**(조이는 길은 환경변수로 남긴다). */
export const modelHttpTimeoutMs = (env = {}) => 수(env.GPAO_T5_MODEL_HTTP_TIMEOUT_MS, 0);

/** 정체 판정 기준. 0 이면 정체 감시도 끈다(순수 무제한). */
export const modelStallMs = (env = {}) => 수(env.GPAO_T5_MODEL_STALL_MS, DEFAULT_MODEL_STALL_MS);

/** 개발 기준선 값. 계측 전용 — 이 값을 바꿔도 사용자 응답이 잘리는 일은 없다. */
export const modelDevBaselineMs = (env = {}) => 수(env.GPAO_T5_MODEL_BASELINE_MS, MODEL_DEV_BASELINE_MS);

// 기준선 초과 사실을 받는 자리. 기본은 아무 데도 안 보낸다 — **관측이 대상을 바꾸지 않는다.**
let 기준선관찰자 = null;

/** 계측 관찰자를 단다(테스트·회차기록용). `null` 이면 뗀다. @returns {() => void} 떼는 함수 */
export function observeModelBaseline(fn) {
  기준선관찰자 = typeof fn === 'function' ? fn : null;
  return () => { 기준선관찰자 = null; };
}

/**
 * **25초 초과를 사실로 남긴다 — 자르지 않되 보이게.**
 * 기준선 아래면 아무 일도 없다(조용한 정상). 넘으면 관찰자에게, 환경 표식이 있으면 stderr 로.
 * @param {{경로:string, 걸린ms:number, 기준선ms?:number, env?:object}} 사실
 */
export function recordModelBaseline({ 경로, 걸린ms, 기준선ms = MODEL_DEV_BASELINE_MS, env = process.env } = {}) {
  if (!(Number.isFinite(걸린ms) && 걸린ms > 기준선ms)) return null;
  const 기록 = { 경로, 걸린ms: Math.round(걸린ms), 기준선ms, 잘림: false };
  try { 기준선관찰자?.(기록); } catch { /* 계측 실패가 응답을 깨지 않는다 */ }
  if (env?.GPAO_T5_MODEL_BASELINE === '1') {
    // 사용자 화면이 아니라 개발자 콘솔이다. 응답은 이미 정상으로 흘렀다.
    process.stderr.write(`[모델 기준선 초과] ${경로} ${기록.걸린ms}ms > ${기준선ms}ms (자르지 않음)\n`);
  }
  return 기록;
}

/**
 * ModelClient를 타임아웃으로 감싼다. ms<=0이면 원본 그대로(무제한).
 * @param {import('./model-client.js').ModelClient} model
 * @param {number} ms
 * @returns {import('./model-client.js').ModelClient}
 */
export function withModelTimeout(model, ms) {
  if (!ms || ms <= 0) return model;
  return {
    /** opts(예: P-STR-1 onDelta)를 **그대로 통과**시킨다 — 데코레이터가 인자를 삼키면 안 된다. */
    async respond(tc, opts) {
      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new ModelTimeoutError(ms)), ms);
        timer.unref?.(); // 프로세스를 붙잡지 않는다(cron/daemon 아님)
      });
      try {
        return await Promise.race([model.respond(tc, opts), timeout]);
      } finally {
        clearTimeout(timer); // 원본이 먼저 끝나면 타이머 정리(누수 방지)
      }
    },
  };
}
